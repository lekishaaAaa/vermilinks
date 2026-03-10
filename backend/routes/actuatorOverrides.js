const express = require('express');
const { fn, col, where } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { auth, adminOnly } = require('../middleware/auth');
const ActuatorState = require('../models/ActuatorState');
const ActuatorLog = require('../models/ActuatorLog');
const deviceCommandQueue = require('../services/deviceCommandQueue');
const { createCommand } = require('../services/iotCommandService');
const logger = require('../utils/logger');
const { REALTIME_EVENTS, emitRealtime } = require('../utils/realtime');

const router = express.Router();

const normalizeDeviceId = (value) => {
  const normalized = (value || '').toString().trim().toLowerCase();
  return normalized || null;
};

const buildActuatorKeyWhere = (deviceId) => {
  const normalized = normalizeDeviceId(deviceId);
  if (!normalized) {
    return null;
  }
  return where(fn('lower', col('actuator_key')), normalized);
};

const ACTUATOR_KEY_MAP = new Map([
  ['pump', 'pump'],
  ['water_pump', 'pump'],
  ['solenoid1', 'valve1'],
  ['solenoid_1', 'valve1'],
  ['layer1_solenoid', 'valve1'],
  ['solenoid2', 'valve2'],
  ['solenoid_2', 'valve2'],
  ['layer2_solenoid', 'valve2'],
  ['solenoid3', 'valve3'],
  ['solenoid_3', 'valve3'],
  ['layer3_solenoid', 'valve3'],
]);

const parseBinaryState = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['on', 'open', 'true', '1', 'enable', 'enabled'].includes(normalized)) return true;
    if (['off', 'close', 'false', '0', 'disable', 'disabled'].includes(normalized)) return false;
  }
  return null;
};

// POST /api/actuators/command
// Compatibility endpoint for layer-based dashboard controls.
router.post('/command', [auth, adminOnly, body('actuator').isString().notEmpty(), body('state').exists()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const rawActuator = (req.body.actuator || '').toString().trim().toLowerCase();
    const mappedKey = ACTUATOR_KEY_MAP.get(rawActuator);
    if (!mappedKey) {
      return res.status(400).json({ success: false, message: 'Unsupported actuator key.' });
    }

    const desiredStateValue = parseBinaryState(req.body.state);
    if (desiredStateValue === null) {
      return res.status(400).json({ success: false, message: 'state must be on/off (or boolean).' });
    }

    const deviceId = (req.body.device_id || req.body.deviceId || 'esp32A').toString().trim() || 'esp32A';
    const stateRow = await ActuatorState.findOne({ where: buildActuatorKeyWhere(deviceId), order: [['reportedAt', 'DESC']] }).catch(() => null);
    const current = stateRow && stateRow.state ? stateRow.state : {};

    const desiredState = {
      pump: typeof current.pump === 'boolean' ? current.pump : false,
      valve1: typeof current.valve1 === 'boolean' ? current.valve1 : false,
      valve2: typeof current.valve2 === 'boolean' ? current.valve2 : false,
      valve3: typeof current.valve3 === 'boolean' ? current.valve3 : false,
    };
    desiredState[mappedKey] = desiredStateValue;

    const actor = req.user?.username || req.user?.email || req.user?.id || null;
    const actorMeta = {
      source: 'api/actuators/command',
      actuator: rawActuator,
      mappedActuator: mappedKey,
      ip: req.ip || req.connection?.remoteAddress || null,
    };
    const result = await createCommand({ deviceId, desiredState, actor, actorMeta });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        success: false,
        message: result.message,
        requestId: result.requestId || null,
      });
    }

    return res.status(result.status || 202).json({
      success: true,
      data: {
        requestId: result.requestId,
        device_id: deviceId,
        actuator: rawActuator,
        mappedActuator: mappedKey,
        state: desiredStateValue ? 'on' : 'off',
      },
    });
  } catch (error) {
    logger.warn('Actuator command compatibility endpoint failed', error && error.message ? error.message : error);
    return res.status(500).json({ success: false, message: 'Failed to dispatch actuator command.' });
  }
});

// POST /api/actuators/override
// Admin-only: set an override state for an actuator (persisted)
router.post('/override', [auth, adminOnly, body('deviceId').isString().notEmpty(), body('actuatorKey').isString().notEmpty(), body('state').exists()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { deviceId, actuatorKey, state, actuatorType, reason } = req.body;

    const rec = await ActuatorState.create({ actuatorKey, state, reportedAt: new Date() });

    // create an ActuatorLog entry for audit
    try {
      await ActuatorLog.create({
        deviceId,
        actuatorType: actuatorType || 'pump',
        action: (state && state.on) || state === 'on' ? 'on' : (state && state === 'manual' ? 'manual' : 'off'),
        reason: reason || 'admin_override',
        triggeredBy: 'manual',
        userId: req.user && req.user.id ? req.user.id : null,
      });
    } catch (logErr) {
      logger.warn('Failed to create ActuatorLog for override', logErr && logErr.message ? logErr.message : logErr);
    }

    // enqueue a device command to dispatch to the device (best-effort)
    try {
      await deviceCommandQueue.queueActuatorCommand({
        hardwareId: deviceId,
        actuatorName: actuatorKey,
        desiredState: (state && (state === 'on' || (state.on === true))) || state === true,
        context: { actuator: actuatorKey },
      });
    } catch (cmdErr) {
      logger.warn('Failed to enqueue actuator command for override', cmdErr && cmdErr.message ? cmdErr.message : cmdErr);
    }

    // Broadcast override to connected clients
    try {
      emitRealtime(REALTIME_EVENTS.ACTUATOR_UPDATE, { actuatorKey, state, source: 'admin-override' }, { io: req.app });
    } catch (e) {
      logger.warn('Failed to emit actuator override', e && e.message ? e.message : e);
    }

    return res.status(201).json({ success: true, data: rec });
  } catch (error) {
    console.error('Actuator override error:', error);
    return res.status(500).json({ success: false, message: 'Failed to set override' });
  }
});

// GET /api/actuators/state/:key - get latest persisted state for actuator
router.get('/state/:key', [auth, adminOnly], async (req, res) => {
  try {
    const key = req.params.key;
    const rec = await ActuatorState.findOne({ where: { actuator_key: key }, order: [['reported_at', 'DESC']] });
    if (!rec) return res.status(404).json({ success: false, message: 'State not found' });
    return res.json({ success: true, data: rec });
  } catch (error) {
    console.error('Get actuator state error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve state' });
  }
});

module.exports = router;
