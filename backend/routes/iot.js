const express = require('express');
const { Op, fn, col, where } = require('sequelize');
const { SensorData, SensorSnapshot, ActuatorState, PendingCommand, Alert, Settings } = require('../models');
const { validateControlPayload, createCommand } = require('../services/iotCommandService');
const { auth, adminOnly, requireOtpVerified } = require('../middleware/auth');

const router = express.Router();

const PRIMARY_DEVICE_ID = 'esp32a';
const COMMAND_ACK_TIMEOUT_MS = (() => {
  const raw = parseInt(process.env.COMMAND_ACK_TIMEOUT_MS || '5000', 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 5000;
  }
  return Math.min(Math.max(raw, 3000), 5000);
})();
const buildDeviceIdWhere = (deviceId) => where(fn('lower', col('device_id')), deviceId);
const buildActuatorKeyWhere = (deviceId) => where(fn('lower', col('actuator_key')), deviceId);

const AUTO_CONTROL_INTERVAL_MS = (() => {
  const raw = parseInt(process.env.AUTO_CONTROL_INTERVAL_MS || '10000', 10);
  if (!Number.isFinite(raw) || raw < 3000) {
    return 10000;
  }
  return Math.min(raw, 60000);
})();
const AUTO_MOISTURE_ON_THRESHOLD = (() => {
  const raw = Number(process.env.AUTO_MOISTURE_ON_THRESHOLD || 30);
  return Number.isFinite(raw) ? raw : 30;
})();
const AUTO_MOISTURE_OFF_THRESHOLD = (() => {
  const raw = Number(process.env.AUTO_MOISTURE_OFF_THRESHOLD || 70);
  return Number.isFinite(raw) ? raw : 70;
})();
const AUTO_SOURCE_DEVICE_ID = ((process.env.AUTO_SOURCE_DEVICE_ID || 'esp32b').toString().trim().toLowerCase()) || 'esp32b';

let autoControlTimer = null;

const normalizeControlMode = (value) => {
  const normalized = (value || '').toString().trim().toLowerCase();
  if (normalized === 'automatic' || normalized === 'auto') {
    return 'automatic';
  }
  return 'manual';
};

const resolveSoilMoisture = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const candidates = [
    snapshot.soil_moisture,
    snapshot.moisture,
    snapshot.soilMoisture,
    snapshot.soil_moisture_layer1,
    snapshot.soil_moisture_layer2,
    snapshot.soil_moisture_layer3,
    snapshot.soilMoistureLayer1,
    snapshot.soilMoistureLayer2,
    snapshot.soilMoistureLayer3,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const findLatestAutomationSnapshot = async () => {
  let preferred = await SensorSnapshot.findOne({
    where: buildDeviceIdWhere(AUTO_SOURCE_DEVICE_ID),
    order: [['timestamp', 'DESC']],
    raw: true,
  }).catch(() => null);

  if (preferred) {
    return preferred;
  }

  return SensorSnapshot.findOne({
    order: [['timestamp', 'DESC']],
    raw: true,
  }).catch(() => null);
};

const getCurrentControlMode = async () => {
  const stateRow = await ActuatorState.findOne({ where: buildActuatorKeyWhere(PRIMARY_DEVICE_ID), raw: true }).catch(() => null);
  return normalizeControlMode(stateRow?.state?.controlMode);
};

const persistControlMode = async (mode) => {
  const normalizedMode = normalizeControlMode(mode);
  const stateRow = await ActuatorState.findOne({ where: buildActuatorKeyWhere(PRIMARY_DEVICE_ID) }).catch(() => null);
  const nowIso = new Date().toISOString();

  if (stateRow) {
    const nextState = {
      ...(stateRow.state || {}),
      controlMode: normalizedMode,
      controlModeUpdatedAt: nowIso,
    };
    stateRow.state = nextState;
    stateRow.reportedAt = new Date();
    await stateRow.save();
    return nextState;
  }

  const created = await ActuatorState.create({
    actuatorKey: PRIMARY_DEVICE_ID,
    reportedAt: new Date(),
    state: {
      pump: false,
      valve1: false,
      valve2: false,
      valve3: false,
      controlMode: normalizedMode,
      controlModeUpdatedAt: nowIso,
    },
  });

  return created.state || { controlMode: normalizedMode, controlModeUpdatedAt: nowIso };
};

const runAutomaticControlPass = async ({ source = 'scheduler' } = {}) => {
  const currentMode = await getCurrentControlMode();
  if (currentMode !== 'automatic') {
    return { ok: true, skipped: 'mode_manual' };
  }

  const pendingCutoff = new Date(Date.now() - COMMAND_ACK_TIMEOUT_MS);
  const pending = await PendingCommand.findOne({
    where: {
      deviceId: PRIMARY_DEVICE_ID,
      status: { [Op.in]: ['sent', 'waiting'] },
      createdAt: { [Op.gte]: pendingCutoff },
    },
    order: [['createdAt', 'DESC']],
    raw: true,
  }).catch(() => null);
  if (pending) {
    return { ok: true, skipped: 'pending_command', requestId: pending.requestId };
  }

  const [automationSnapshot, stateRow] = await Promise.all([
    findLatestAutomationSnapshot(),
    ActuatorState.findOne({ where: buildActuatorKeyWhere(PRIMARY_DEVICE_ID), raw: true }).catch(() => null),
  ]);

  const moisture = resolveSoilMoisture(automationSnapshot);
  if (!Number.isFinite(moisture)) {
    return { ok: true, skipped: 'missing_moisture' };
  }

  const currentState = stateRow?.state || {};
  const desiredState = {
    pump: Boolean(currentState.pump),
    valve1: Boolean(currentState.valve1),
    valve2: Boolean(currentState.valve2),
    valve3: Boolean(currentState.valve3),
    forcePumpOverride: false,
  };

  if (moisture < AUTO_MOISTURE_ON_THRESHOLD) {
    desiredState.pump = true;
    desiredState.valve1 = true;
    desiredState.valve2 = true;
    desiredState.valve3 = true;
  } else if (moisture > AUTO_MOISTURE_OFF_THRESHOLD) {
    desiredState.pump = false;
    desiredState.valve1 = false;
    desiredState.valve2 = false;
    desiredState.valve3 = false;
  } else {
    return { ok: true, skipped: 'within_band', moisture };
  }

  const unchanged =
    desiredState.pump === Boolean(currentState.pump) &&
    desiredState.valve1 === Boolean(currentState.valve1) &&
    desiredState.valve2 === Boolean(currentState.valve2) &&
    desiredState.valve3 === Boolean(currentState.valve3) &&
    desiredState.forcePumpOverride === Boolean(currentState.forcePumpOverride);

  if (unchanged) {
    return { ok: true, skipped: 'already_applied', moisture };
  }

  return createCommand({
    deviceId: PRIMARY_DEVICE_ID,
    desiredState,
    actor: 'system:auto',
    actorMeta: {
      source,
      moisture,
      moistureThresholds: {
        onBelow: AUTO_MOISTURE_ON_THRESHOLD,
        offAbove: AUTO_MOISTURE_OFF_THRESHOLD,
      },
      telemetryDeviceId: automationSnapshot?.deviceId || automationSnapshot?.device_id || null,
    },
    allowWhenAutomatic: true,
  });
};

const ensureAutomaticControlScheduler = () => {
  if (autoControlTimer || (process.env.NODE_ENV || 'development') === 'test') {
    return;
  }

  autoControlTimer = setInterval(() => {
    runAutomaticControlPass({ source: 'scheduler' }).catch(() => null);
  }, AUTO_CONTROL_INTERVAL_MS);

  if (typeof autoControlTimer.unref === 'function') {
    autoControlTimer.unref();
  }
};

router.get('/latest', async (req, res) => {
  try {
    let telemetrySnapshot = await SensorSnapshot.findByPk(PRIMARY_DEVICE_ID, { raw: true });
    if (!telemetrySnapshot) {
      telemetrySnapshot = await SensorSnapshot.findOne({
        where: buildDeviceIdWhere(PRIMARY_DEVICE_ID),
        order: [['timestamp', 'DESC']],
        raw: true,
      });
    }

    let telemetry = telemetrySnapshot || null;
    if (!telemetry) {
      const latest = await SensorData.findOne({
        where: buildDeviceIdWhere(PRIMARY_DEVICE_ID),
        order: [['timestamp', 'DESC']],
        raw: true,
      });
      telemetry = latest || null;
    }

    const stateRow = await ActuatorState.findOne({ where: { actuatorKey: 'esp32a' }, raw: true });
    const controlMode = normalizeControlMode(stateRow?.state?.controlMode);
    const pendingCutoff = new Date(Date.now() - COMMAND_ACK_TIMEOUT_MS);
    const pending = await PendingCommand.findOne({
      where: {
        deviceId: 'esp32a',
        status: { [Op.in]: ['sent', 'waiting'] },
        createdAt: { [Op.gte]: pendingCutoff },
      },
      order: [['createdAt', 'DESC']],
      raw: true,
    });

    res.json({
      success: true,
      data: {
        telemetry,
        deviceState: stateRow ? { ...stateRow.state, controlMode } : { controlMode },
        controlMode,
        pendingCommand: pending ? { requestId: pending.requestId, status: pending.status } : null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load latest state.' });
  }
});

router.get('/alerts', auth, adminOnly, async (req, res) => {
  try {
    const activeOnly = (req.query.active || 'true').toString().toLowerCase() !== 'false';
    const where = activeOnly ? { isResolved: false } : {};
    const alerts = await Alert.findAll({ where, order: [['createdAt', 'DESC']], limit: 200 });
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load alerts.' });
  }
});

router.patch('/alerts/:id', auth, adminOnly, requireOtpVerified, async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found.' });
    }
    alert.status = 'read';
    alert.acknowledgedAt = new Date();
    await alert.save();
    return res.json({ success: true, data: alert });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to acknowledge alert.' });
  }
});

router.delete('/alerts', auth, adminOnly, requireOtpVerified, async (req, res) => {
  try {
    const now = new Date();
    const result = await Alert.update({ isResolved: true, resolvedAt: now }, { where: { isResolved: false } });
    res.json({ success: true, data: { cleared: result[0] || 0 } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to clear alerts.' });
  }
});

router.post('/control', auth, adminOnly, requireOtpVerified, async (req, res) => {
  const validation = validateControlPayload(req.body);
  if (!validation.ok) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  try {
    const actor = req.user?.username || req.user?.email || req.user?.id || null;
    const actorMeta = { ip: req.ip || req.connection?.remoteAddress || null };
    const result = await createCommand({ desiredState: req.body, actor, actorMeta });
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message, requestId: result.requestId || null });
    }

    return res.status(result.status || 202).json({ success: true, data: { requestId: result.requestId } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to dispatch control command.' });
  }
});

router.get('/control-mode', auth, adminOnly, async (req, res) => {
  try {
    const mode = await getCurrentControlMode();
    return res.json({
      success: true,
      data: {
        deviceId: PRIMARY_DEVICE_ID,
        mode,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load control mode.' });
  }
});

router.post('/control-mode', auth, adminOnly, requireOtpVerified, async (req, res) => {
  const rawMode = (req.body?.mode || '').toString().trim().toLowerCase();
  if (!['automatic', 'auto', 'manual'].includes(rawMode)) {
    return res.status(400).json({ success: false, message: 'mode must be automatic or manual.' });
  }
  const requestedMode = rawMode === 'auto' ? 'automatic' : rawMode;

  try {
    const nextState = await persistControlMode(requestedMode);
    let autoResult = null;
    if (requestedMode === 'automatic') {
      autoResult = await runAutomaticControlPass({ source: 'mode_change' }).catch(() => null);
    }

    return res.json({
      success: true,
      data: {
        deviceId: PRIMARY_DEVICE_ID,
        mode: requestedMode,
        updatedAt: nextState?.controlModeUpdatedAt || new Date().toISOString(),
        autoResult,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update control mode.' });
  }
});

router.get('/thresholds', auth, adminOnly, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.json({ success: true, data: settings.thresholds || {} });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load thresholds.' });
  }
});

router.put('/thresholds', auth, adminOnly, async (req, res) => {
  try {
    const payload = req.body || {};
    const settings = await Settings.getSettings();
    const merged = {
      ...settings,
      thresholds: {
        ...(settings.thresholds || {}),
        ...(payload || {}),
      },
    };

    await Settings.upsert({
      key: 'thresholds',
      value: JSON.stringify(merged.thresholds),
    });

    res.json({ success: true, data: merged.thresholds });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update thresholds.' });
  }
});

module.exports = router;

ensureAutomaticControlScheduler();
