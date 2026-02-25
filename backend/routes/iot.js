const express = require('express');
const { SensorData, SensorSnapshot, ActuatorState, PendingCommand, Alert, Settings } = require('../models');
const { validateControlPayload, createCommand } = require('../services/iotCommandService');
const { auth, adminOnly, requireOtpVerified } = require('../middleware/auth');

const router = express.Router();

router.get('/latest', async (req, res) => {
  try {
    const telemetrySnapshot = await SensorSnapshot.findOne({
      order: [['timestamp', 'DESC']],
      raw: true,
    });

    let telemetry = telemetrySnapshot || null;
    if (!telemetry) {
      const latest = await SensorData.findOne({
        order: [['timestamp', 'DESC']],
        raw: true,
      });
      telemetry = latest || null;
    }

    const stateRow = await ActuatorState.findOne({ where: { actuatorKey: 'esp32a' }, raw: true });
    const pending = await PendingCommand.findOne({
      where: { deviceId: 'esp32a', status: ['sent', 'waiting'] },
      order: [['createdAt', 'DESC']],
      raw: true,
    });

    res.json({
      success: true,
      data: {
        telemetry,
        deviceState: stateRow ? stateRow.state : null,
        pendingCommand: pending ? { requestId: pending.requestId, status: pending.status } : null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load latest state.' });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const activeOnly = (req.query.active || 'true').toString().toLowerCase() !== 'false';
    const where = activeOnly ? { isResolved: false } : {};
    const alerts = await Alert.findAll({ where, order: [['createdAt', 'DESC']], limit: 200 });
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load alerts.' });
  }
});

router.patch('/alerts/:id', async (req, res) => {
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

router.delete('/alerts', async (req, res) => {
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
