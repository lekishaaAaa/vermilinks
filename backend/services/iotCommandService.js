const crypto = require('crypto');
const { Op, fn, col, where } = require('sequelize');
const { ActuatorState, PendingCommand, AuditLog } = require('../models');
const Device = require('../models/Device');
const { publishCommand } = require('./iotMqtt');
const { evaluatePumpSafety } = require('./actuatorSafetyService');

const COMMAND_ACK_TIMEOUT_MS = Math.max(
  5000,
  parseInt(process.env.COMMAND_ACK_TIMEOUT_MS || '25000', 10),
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

  return { ok: true };
}

async function ensureNoPendingCommand(deviceId) {
  const existing = await PendingCommand.findOne({
    where: {
      deviceId,
      status: ['sent', 'waiting'],
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

async function createCommand({ deviceId = 'esp32a', desiredState, actor = null, actorMeta = null }) {
  const normalizedDeviceId = normalizeDeviceId(deviceId) || 'esp32a';
  ensureCommandTimeoutSweeper();
  await failStalePendingCommands();

  const device = await Device.findOne({ where: buildDeviceIdWhere(normalizedDeviceId) });
  const isOnline = Boolean(device && (device.online === true || device.status === 'online'));
  if (!isOnline) {
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
