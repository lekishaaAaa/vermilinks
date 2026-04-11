const crypto = require('crypto');
const { Op, fn, col, where } = require('sequelize');
const { ActuatorState, PendingCommand, AuditLog } = require('../models');
const Device = require('../models/Device');
const SensorSnapshot = require('../models/SensorSnapshot');
const { publishCommand } = require('./iotMqtt');
const { evaluatePumpSafety } = require('./actuatorSafetyService');

const COMMAND_ACK_TIMEOUT_MS = (() => {
  const raw = parseInt(process.env.COMMAND_ACK_TIMEOUT_MS || '5000', 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 5000;
  }
  return Math.min(Math.max(raw, 3000), 5000);
})();

const DEVICE_FRESHNESS_MS = Math.max(
  2000,
  parseInt(process.env.DEVICE_OFFLINE_TIMEOUT_MS || process.env.SENSOR_STALE_THRESHOLD_MS || '60000', 10),
);

let timeoutSweeperStarted = false;

function isBoolean(value) {
  return typeof value === 'boolean';
}

function normalizeDeviceId(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  return normalized || null;
}

function buildDeviceIdWhere(deviceId) {
  return where(fn('lower', col('device_id')), deviceId);
}

function buildActuatorKeyWhere(deviceId) {
  return where(fn('lower', col('actuator_key')), deviceId);
}

function normalizeControlMode(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  if (normalized === 'automatic' || normalized === 'auto') {
    return 'automatic';
  }
  return 'manual';
}

async function getDeviceControlMode(deviceId) {
  const stateRow = await ActuatorState.findOne({ where: buildActuatorKeyWhere(deviceId), raw: true }).catch(() => null);
  return normalizeControlMode(stateRow?.state?.controlMode);
}

function toTimestampMs(value) {
  if (!value) {
    return NaN;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function resolveCommandTargetAvailability(deviceId) {
  const [device, actuatorState, snapshot] = await Promise.all([
    Device.findOne({ where: buildDeviceIdWhere(deviceId) }).catch(() => null),
    ActuatorState.findOne({ where: buildActuatorKeyWhere(deviceId), raw: true }).catch(() => null),
    SensorSnapshot.findOne({ where: buildDeviceIdWhere(deviceId), raw: true }).catch(() => null),
  ]);

  const deviceOnline = Boolean(device && (device.online === true || device.status === 'online'));
  const timestampCandidates = [
    device?.lastHeartbeat,
    device?.lastSeen,
    actuatorState?.state?.ts,
    snapshot?.timestamp,
    snapshot?.updated_at,
  ]
    .map(toTimestampMs)
    .filter((value) => Number.isFinite(value));

  const lastSeenMs = timestampCandidates.length > 0 ? Math.max(...timestampCandidates) : NaN;
  const lastSeenIso = Number.isFinite(lastSeenMs) ? new Date(lastSeenMs).toISOString() : null;
  const freshSignalSeen = Number.isFinite(lastSeenMs) ? (Date.now() - lastSeenMs) < DEVICE_FRESHNESS_MS : false;

  if (device && freshSignalSeen && !deviceOnline) {
    const lastSeenDate = new Date(lastSeenMs);
    await device.update({
      status: 'online',
      online: true,
      lastSeen: lastSeenDate,
      lastHeartbeat: device.lastHeartbeat || lastSeenDate,
      updatedAt: new Date(),
    }).catch(() => null);
  }

  return {
    online: deviceOnline || freshSignalSeen,
    lastSeen: lastSeenIso,
    deviceOnline,
    freshSignalSeen,
  };
}

function validateControlPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'Payload required' };
  }

  const keys = ['pump', 'valve1', 'valve2', 'valve3'];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      return { ok: false, message: `${key} is required` };
    }
    if (!isBoolean(payload[key])) {
      return { ok: false, message: `${key} must be boolean` };
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'forcePumpOverride') && !isBoolean(payload.forcePumpOverride)) {
    return { ok: false, message: 'forcePumpOverride must be boolean' };
  }

  return { ok: true };
}

async function ensureNoPendingCommand(deviceId) {
  const cutoff = new Date(Date.now() - COMMAND_ACK_TIMEOUT_MS);
  const existing = await PendingCommand.findOne({
    where: {
      deviceId,
      status: { [Op.in]: ['sent', 'waiting'] },
      createdAt: { [Op.gte]: cutoff },
    },
  });
  return existing || null;
}

async function failStalePendingCommands() {
  const cutoff = new Date(Date.now() - COMMAND_ACK_TIMEOUT_MS);
  await PendingCommand.update(
    {
      status: 'failed',
      error: `Command acknowledgement timeout after ${COMMAND_ACK_TIMEOUT_MS}ms`,
      updatedAt: new Date(),
    },
    {
      where: {
        status: { [Op.in]: ['sent', 'waiting'] },
        createdAt: { [Op.lt]: cutoff },
      },
    },
  );
}

function ensureCommandTimeoutSweeper() {
  if (timeoutSweeperStarted || (process.env.NODE_ENV || 'development') === 'test') {
    return;
  }
  timeoutSweeperStarted = true;

  const timer = setInterval(() => {
    failStalePendingCommands().catch(() => {});
  }, 5000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

async function createCommand({ deviceId = 'esp32a', desiredState, actor = null, actorMeta = null, allowWhenAutomatic = false }) {
  const normalizedDeviceId = normalizeDeviceId(deviceId) || 'esp32a';
  ensureCommandTimeoutSweeper();
  await failStalePendingCommands();

  const controlMode = await getDeviceControlMode(normalizedDeviceId);
  if (controlMode === 'automatic' && !allowWhenAutomatic) {
    return {
      ok: false,
      status: 409,
      message: 'Manual control disabled in Automatic Mode.',
    };
  }

  const availability = await resolveCommandTargetAvailability(normalizedDeviceId);
  if (!availability.online) {
    return {
      ok: false,
      status: 503,
      message: 'Target device is offline. Command rejected.',
    };
  }

  const pending = await ensureNoPendingCommand(normalizedDeviceId);
  if (pending) {
    return {
      ok: false,
      status: 409,
      message: 'A command is already pending confirmation.',
      requestId: pending.requestId,
    };
  }

  const safety = await evaluatePumpSafety({ deviceId: normalizedDeviceId, desiredState });
  if (!safety.allowed) {
    return {
      ok: false,
      status: safety.statusCode || 409,
      message: safety.message || 'Pump command blocked by float safety.',
    };
  }

  const requestId = crypto.randomUUID();
  const commandPayload = {
    pump: desiredState.pump,
    valve1: desiredState.valve1,
    valve2: desiredState.valve2,
    valve3: desiredState.valve3,
    forcePumpOverride: desiredState.forcePumpOverride === true,
    requestId,
  };

  await PendingCommand.create({
    requestId,
    deviceId: normalizedDeviceId,
    command: 'set_state',
    desiredState: commandPayload,
    status: 'sent',
  });

  if (actor) {
    try {
      await AuditLog.create({
        eventType: 'actuator.command.requested',
        actor,
        data: {
          deviceId: normalizedDeviceId,
          desiredState: commandPayload,
          requestId,
          meta: actorMeta || null,
        },
      });
    } catch (auditError) {
      // non-fatal
    }
  }

  try {
    publishCommand(commandPayload);
  } catch (error) {
    await PendingCommand.update(
      { status: 'failed', error: error && error.message ? error.message : 'MQTT publish failed', updatedAt: new Date() },
      { where: { requestId } }
    );
    return {
      ok: false,
      status: 502,
      message: 'Failed to publish MQTT command.',
      requestId,
    };
  }

  return {
    ok: true,
    status: 202,
    requestId,
  };
}

module.exports = {
  validateControlPayload,
  createCommand,
};
