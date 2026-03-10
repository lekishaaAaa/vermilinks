const express = require('express');
const { body, validationResult } = require('express-validator');
const Device = require('../models/Device');
const SensorData = require('../models/SensorData');
const SensorSnapshot = require('../models/SensorSnapshot');
// SensorSnapshot reserved for future device snapshot usage.
const Alert = require('../models/Alert');
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

const DEVICE_ONLINE_WINDOW_MS = Math.max(
  45000,
  DEVICE_STATUS_TIMEOUT_MS,
);

const SENSOR_STALE_THRESHOLD_MS = Math.max(
  2000,
  parseInt(process.env.SENSOR_STALE_THRESHOLD_MS || process.env.DEVICE_OFFLINE_TIMEOUT_MS || '60000', 10)
);

const normalizeDeviceId = (value) => {
  const normalized = (value || '').toString().trim().toLowerCase();
  return normalized || null;
};


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

const toTimestampMs = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveOnlineStatus = (lastSeenTimestamp, nowMs) => {
  if (!Number.isFinite(lastSeenTimestamp)) {
    return false;
  }
  return (nowMs - lastSeenTimestamp) < DEVICE_ONLINE_WINDOW_MS;
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

  const { timestamp, metadata } = req.body;
  const deviceId = normalizeDeviceId(req.body.deviceId || req.body.device_id);
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

// GET /api/devices/status - lightweight online/offline status by last seen message
router.get('/status', optionalAuth, async (req, res) => {
  try {
    const now = Date.now();
    const normalizedId = (value) => (value || '').toString().trim();

    const [devices, snapshots] = await Promise.all([
      Device.findAll({ order: [['lastHeartbeat', 'DESC']] }).catch(() => []),
      SensorSnapshot.findAll({ raw: true }).catch(() => []),
    ]);

    const statusMap = new Map();

    (devices || []).forEach((record) => {
      const plain = toPlainDevice(record);
      const deviceId = normalizedId(plain?.deviceId);
      if (!deviceId) return;

      const heartbeatTs = toTimestampMs(plain?.lastHeartbeat);
      const lastSeenTs = toTimestampMs(plain?.lastSeen ?? plain?.last_seen);
      const lastSeenTimestamp = [heartbeatTs, lastSeenTs].filter((value) => Number.isFinite(value)).sort((a, b) => b - a)[0] ?? null;

      statusMap.set(deviceId.toLowerCase(), {
        device_id: deviceId,
        online: resolveOnlineStatus(lastSeenTimestamp, now),
        last_seen: Number.isFinite(lastSeenTimestamp) ? new Date(lastSeenTimestamp).toISOString() : null,
        signalStrength: null,
      });
    });

    (snapshots || []).forEach((snapshot) => {
      const deviceId = normalizedId(snapshot?.deviceId || snapshot?.device_id);
      if (!deviceId) return;

      const snapshotTs = toTimestampMs(snapshot?.timestamp);
      const existing = statusMap.get(deviceId.toLowerCase()) || {
        device_id: deviceId,
        online: false,
        last_seen: null,
        signalStrength: null,
      };
      const existingTs = toTimestampMs(existing.last_seen);
      const lastSeenTimestamp = [existingTs, snapshotTs].filter((value) => Number.isFinite(value)).sort((a, b) => b - a)[0] ?? null;

      statusMap.set(deviceId.toLowerCase(), {
        ...existing,
        device_id: deviceId,
        online: resolveOnlineStatus(lastSeenTimestamp, now),
        last_seen: Number.isFinite(lastSeenTimestamp) ? new Date(lastSeenTimestamp).toISOString() : null,
        signalStrength: snapshot?.signalStrength ?? snapshot?.signal_strength ?? existing.signalStrength ?? null,
      });
    });

    const devicesPayload = Array.from(statusMap.values()).sort((a, b) => {
      return a.device_id.localeCompare(b.device_id);
    });

    return res.json({ devices: devicesPayload });
  } catch (error) {
    console.error('devices: status endpoint failed', error);
    return res.status(500).json({ message: 'Unable to load device status' });
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
  const deviceId = normalizeDeviceId(req.params.deviceId);
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

// DELETE /api/devices/:deviceId
// Remove a device and associated telemetry footprint from system tracking
router.delete('/:deviceId', auth, async (req, res) => {
  const deviceId = (req.params.deviceId || '').toString().trim();
  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'deviceId is required' });
  }

  try {
    const [deviceDeleted, snapshotDeleted, telemetryDeleted] = await Promise.all([
      Device.destroy({ where: { deviceId } }).catch(() => 0),
      SensorSnapshot.destroy({ where: { deviceId } }).catch(() => 0),
      SensorData.destroy({ where: { deviceId } }).catch(() => 0),
    ]);

    await Alert.update(
      { isResolved: true, resolvedAt: new Date() },
      { where: { deviceId, isResolved: false } },
    ).catch(() => null);

    resetOfflineTimer(deviceId);

    return res.json({
      success: true,
      data: {
        deviceId,
        deleted: {
          device: deviceDeleted,
          sensorSnapshot: snapshotDeleted,
          sensorData: telemetryDeleted,
        },
      },
    });
  } catch (error) {
    console.error('devices: delete failed', error);
    return res.status(500).json({ success: false, message: 'Failed to delete device' });
  }
});

module.exports = router;
