const crypto = require('crypto');
const { ActuatorState, PendingCommand, AuditLog } = require('../models');
const { publishCommand } = require('./iotMqtt');

function isBoolean(value) {
  return typeof value === 'boolean';
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

async function createCommand({ deviceId = 'esp32a', desiredState, actor = null, actorMeta = null }) {
  const pending = await ensureNoPendingCommand(deviceId);
  if (pending) {
    return {
      ok: false,
      status: 409,
      message: 'A command is already pending confirmation.',
      requestId: pending.requestId,
    };
  }

  const stateRow = await ActuatorState.findOne({ where: { actuatorKey: deviceId } });
  const state = stateRow && stateRow.state ? stateRow.state : null;
  const floatState = state ? (state.float || state.floatState || null) : null;
  if (floatState && String(floatState).toUpperCase() === 'LOW' && desiredState.pump) {
    return {
      ok: false,
      status: 409,
      message: 'Pump locked out due to low float sensor.',
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
    deviceId,
    desiredState: commandPayload,
    status: 'sent',
  });

  if (actor) {
    try {
      await AuditLog.create({
        eventType: 'actuator.command.requested',
        actor,
        data: {
          deviceId,
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
