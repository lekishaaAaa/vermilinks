const express = require('express');
const { body, validationResult } = require('express-validator');
const Device = require('../models/Device');
const SensorData = require('../models/SensorData');
// SensorSnapshot reserved for future device snapshot usage.
const { markDeviceOnline, resetOfflineTimer } = require('../services/deviceManager');
const devicePortsService = require('../services/devicePortsService');
const { auth, optionalAuth } = require('../middleware/auth');
const {
  ensureIsoString,
  sanitizeSensorPayload,
  buildSensorSummary,
} = require('../utils/sensorFormatting');

const router = express.Router();

const DEVICE_STATUS_TIMEOUT_MS = Math.max(
  2000,
  parseInt(process.env.DEVICE_OFFLINE_TIMEOUT_MS || process.env.SENSOR_STALE_THRESHOLD_MS || '60000', 10)
);

const SENSOR_STALE_THRESHOLD_MS = Math.max(
  2000,
  parseInt(process.env.SENSOR_STALE_THRESHOLD_MS || process.env.DEVICE_OFFLINE_TIMEOUT_MS || '60000', 10)
);


const toPlainDevice = (record) => {
  if (!record) {
    return null;
  }
  if (typeof record.get === 'function') {
    return record.get({ plain: true });
  }
  if (typeof record.toJSON === 'function') {
    return record.toJSON();
  }
  return record;
};

const isDeviceFreshOnline = (device) => {
  if (!device || (device.status || '').toLowerCase() !== 'online') {
    return false;
  }
  const hbTs = device.lastHeartbeat ? new Date(device.lastHeartbeat).getTime() : NaN;
  if (!Number.isFinite(hbTs)) {
    return false;
  }
  return (Date.now() - hbTs) <= DEVICE_STATUS_TIMEOUT_MS;
};

// POST /api/devices/heartbeat
// Devices call this endpoint to indicate they are online and provide metadata
router.post('/heartbeat', [
  body('deviceId').notEmpty().withMessage('deviceId is required'),
  body('timestamp').optional().isISO8601()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { deviceId, timestamp, metadata } = req.body;
  try {
    const md = metadata || {};
    const device = await markDeviceOnline(deviceId, md);
    // reply with acknowledged status
    return res.json({ success: true, data: { deviceId: device.deviceId, status: device.status, lastHeartbeat: device.lastHeartbeat } });
  } catch (e) {
    console.error('Heartbeat error:', e);
    return res.status(500).json({ success: false, message: 'Failed to record heartbeat' });
  }
});

// GET /api/devices - list devices (admin or optional auth)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const devices = await Device.findAll({ order: [['lastHeartbeat','DESC']] });
    const normalizedDevices = devices.map(toPlainDevice).filter(Boolean);

    // Devices are reported directly by ESP32 nodes.

    res.json({ success: true, data: normalizedDevices });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to list devices' });
  }
});

// POST /api/devices/:deviceHardwareId/port-report
// Called by devices (ESP32) after completing an enumeration request.
router.post('/:deviceHardwareId/port-report', async (req, res) => {
  const { deviceHardwareId } = req.params;
  try {
    const result = await devicePortsService.recordDevicePortReport(deviceHardwareId, req.body || {});
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    console.error('Device port-report error', error && error.message ? error.message : error);
    res.status(status).json({
      success: false,
      message: error && error.message ? error.message : 'Failed to record port report',
    });
  }
});

// GET /api/devices/:deviceId/sensors
// Returns a summary of the latest sensor readings for a specific device
router.get('/:deviceId/sensors', optionalAuth, async (req, res) => {
  const { deviceId } = req.params;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 200);

  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'deviceId is required' });
  }

  try {
    const deviceRecord = await Device.findOne({ where: { deviceId } }).catch(() => null);

    let samples = [];
    if (SensorData && typeof SensorData.findAll === 'function') {
      try {
        samples = await SensorData.findAll({
          where: { deviceId },
          order: [['timestamp', 'DESC']],
          limit,
          raw: true,
        });
      } catch (sampleErr) {
        console.warn('devices: failed to load sensor samples for', deviceId, sampleErr && sampleErr.message ? sampleErr.message : sampleErr);
        samples = [];
      }
    }

  const latest = samples.length > 0 ? samples[0] : null;
  const sanitizedLatest = latest ? sanitizeSensorPayload(latest, []) : null;
  const summary = sanitizedLatest ? buildSensorSummary(sanitizedLatest) : [];
  const history = samples.slice(0, Math.min(samples.length, limit)).map((item) => sanitizeSensorPayload(item, []));

    const timestampMs = sanitizedLatest && sanitizedLatest.timestamp ? new Date(sanitizedLatest.timestamp).getTime() : NaN;
    const sampleAgeMs = Number.isFinite(timestampMs) ? Date.now() - timestampMs : null;
    const isStale = sampleAgeMs === null ? true : sampleAgeMs > SENSOR_STALE_THRESHOLD_MS;

    let deviceStatus = 'unknown';
    let lastHeartbeat = null;
    let deviceOnline = false;

    if (deviceRecord) {
      deviceStatus = deviceRecord.status || 'unknown';
      lastHeartbeat = deviceRecord.lastHeartbeat ? ensureIsoString(deviceRecord.lastHeartbeat) : null;
      const heartbeatMs = deviceRecord.lastHeartbeat ? new Date(deviceRecord.lastHeartbeat).getTime() : NaN;
      const heartbeatFresh = Number.isFinite(heartbeatMs) && (Date.now() - heartbeatMs) <= DEVICE_STATUS_TIMEOUT_MS;
      deviceOnline = deviceStatus === 'online' && heartbeatFresh;
    } else if (!isStale && sanitizedLatest) {
      deviceStatus = 'online';
      deviceOnline = true;
    }

    const payload = {
      deviceId,
      deviceStatus,
      deviceOnline,
      lastHeartbeat,
      latest: deviceOnline && !isStale ? sanitizedLatest : null,
      latestTimestamp: deviceOnline && !isStale && sanitizedLatest ? sanitizedLatest.timestamp : null,
      sampleAgeMs: deviceOnline && !isStale ? sampleAgeMs : null,
      isStale: deviceOnline ? isStale : true,
      sensors: deviceOnline && !isStale ? summary : [],
      history: deviceOnline && !isStale ? history : [],
    };

    res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    console.error('devices: sensors summary failed', error);
    res.status(500).json({ success: false, message: 'Failed to load device sensors' });
  }
});

module.exports = router;
