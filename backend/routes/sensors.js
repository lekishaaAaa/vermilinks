const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { Op, fn, col, where } = require('sequelize');
const NodeCache = require('node-cache');
const SensorData = require('../models/SensorData');
const Device = require('../models/Device');
const SensorSnapshot = require('../models/SensorSnapshot');
const ActuatorLog = require('../models/ActuatorLog');
const ActuatorState = require('../models/ActuatorState');
const PendingCommand = require('../models/PendingCommand');
const deviceManager = require('../services/deviceManager');
const { auth, adminOnly } = require('../middleware/auth');
const {
  toPlainObject,
  ensureIsoString,
  sanitizeSensorPayload,
} = require('../utils/sensorFormatting');
const {
  resolveIo,
  broadcastSensorData,
  checkThresholds,
} = require('../utils/sensorEvents');
const sensorLogService = require('../services/sensorLogService');

const DEVICE_STATUS_TIMEOUT_MS = Math.max(
  2000,
  parseInt(process.env.DEVICE_OFFLINE_TIMEOUT_MS || process.env.SENSOR_STALE_THRESHOLD_MS || '60000', 10)
);

const STALE_SENSOR_MAX_AGE_MS = Math.max(
  2000,
  parseInt(process.env.SENSOR_STALE_THRESHOLD_MS || process.env.DEVICE_OFFLINE_TIMEOUT_MS || '60000', 10)
);

const DEVICE_FRESHNESS_MS = 60000;
const COMMAND_PENDING_UI_TIMEOUT_MS = 3000;

const router = express.Router();
const sensorCache = new NodeCache({ stdTTL: 5, checkperiod: 2 });

const normalizeDeviceId = (value) => {
  const normalized = (value || '').toString().trim().toLowerCase();
  return normalized || null;
};

const isSyntheticDeviceId = (value) => {
  const normalized = normalizeDeviceId(value);
  if (!normalized) {
    return true;
  }
  return /^(mock|dummy|demo|sim|simulated|test)[-_]/i.test(normalized);
};

const toTelemetryTimestampMs = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload.timestamp || payload.updated_at || payload.created_at;
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const isLiveTelemetryPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const deviceId = payload.deviceId || payload.device_id;
  if (isSyntheticDeviceId(deviceId)) {
    return false;
  }
  const timestampMs = toTelemetryTimestampMs(payload);
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  return (Date.now() - timestampMs) <= STALE_SENSOR_MAX_AGE_MS;
};

const buildDeviceIdWhere = (deviceId) => {
  const normalized = normalizeDeviceId(deviceId);
  if (!normalized) {
    return null;
  }
  return where(fn('lower', col('device_id')), normalized);
};

const buildActuatorKeyWhere = (deviceId) => {
  const normalized = normalizeDeviceId(deviceId);
  if (!normalized) {
    return null;
  }
  return where(fn('lower', col('actuator_key')), normalized);
};


const formatLatestSnapshot = (snapshot) => {
  if (!snapshot) {
    return null;
  }
  const toNumber = (value) => (value === null || value === undefined ? null : Number(value));
  const timestamp = snapshot.timestamp || snapshot.updated_at || snapshot.created_at;
  const normalizedDeviceId = (snapshot.deviceId || snapshot.device_id || '').toString().trim() || null;
  return {
    deviceId: normalizedDeviceId,
    device_id: normalizedDeviceId,
    temperature: toNumber(snapshot.temperature),
    humidity: toNumber(snapshot.humidity),
    soil_moisture: toNumber(snapshot.moisture ?? snapshot.soil_moisture),
    soil_temperature: toNumber(snapshot.soilTemperature ?? snapshot.soil_temperature ?? snapshot.waterTempC),
    ph: toNumber(snapshot.ph),
    ec: toNumber(snapshot.ec),
    nitrogen: toNumber(snapshot.nitrogen),
    phosphorus: toNumber(snapshot.phosphorus),
    potassium: toNumber(snapshot.potassium),
    water_level: toNumber(snapshot.waterLevel ?? snapshot.water_level),
    float_state: snapshot.floatSensor !== undefined && snapshot.floatSensor !== null
      ? Number(snapshot.floatSensor)
      : (snapshot.float_state !== undefined && snapshot.float_state !== null ? Number(snapshot.float_state) : null),
    battery_level: toNumber(snapshot.batteryLevel ?? snapshot.battery_level),
    signal_strength: toNumber(snapshot.signalStrength ?? snapshot.signal_strength),
    timestamp: ensureIsoString(timestamp),
    updated_at: ensureIsoString(timestamp),
  };
};

const hydrateMissingTelemetryFields = async (snapshotPayload) => {
  if (!snapshotPayload || typeof snapshotPayload !== 'object') {
    return snapshotPayload;
  }

  const deviceId = (snapshotPayload.deviceId || snapshotPayload.device_id || '').toString().trim();
  if (!deviceId) {
    return snapshotPayload;
  }

  const deviceIdWhere = buildDeviceIdWhere(deviceId);
  if (!deviceIdWhere) {
    return snapshotPayload;
  }

  const fallback = await SensorData.findAll({
    where: deviceIdWhere,
    order: [['timestamp', 'DESC']],
    limit: 25,
    raw: true,
  });

  if (!Array.isArray(fallback) || fallback.length === 0) {
    return snapshotPayload;
  }

  const safeNumber = (value) => (value === null || typeof value === 'undefined' ? null : Number(value));
  const findLatestNumber = (selector) => {
    for (const row of fallback) {
      const candidate = safeNumber(selector(row));
      if (candidate !== null && !Number.isNaN(candidate)) {
        return candidate;
      }
    }
    return null;
  };
  const firstTimestampRow = fallback.find((row) => row && row.timestamp) || null;

  return {
    ...snapshotPayload,
    temperature: snapshotPayload.temperature ?? findLatestNumber((row) => row.temperature),
    humidity: snapshotPayload.humidity ?? findLatestNumber((row) => row.humidity),
    soil_moisture: snapshotPayload.soil_moisture ?? findLatestNumber((row) => row.moisture),
    soil_temperature: snapshotPayload.soil_temperature ?? findLatestNumber((row) => row.soilTemperature),
    water_level: snapshotPayload.water_level ?? findLatestNumber((row) => row.waterLevel),
    float_state: snapshotPayload.float_state ?? findLatestNumber((row) => row.floatSensor),
    updated_at: snapshotPayload.updated_at || (firstTimestampRow?.timestamp ? ensureIsoString(firstTimestampRow.timestamp) : snapshotPayload.updated_at),
    timestamp: snapshotPayload.timestamp || (firstTimestampRow?.timestamp ? ensureIsoString(firstTimestampRow.timestamp) : snapshotPayload.timestamp),
  };
};

// @route   POST /api/sensors
// @desc    Submit sensor data (from ESP32)
// @access  Public (ESP32 doesn't authenticate)
router.post('/', [
  body('deviceId').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('deviceId must be a non-empty string'),
  body('device_id').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('device_id must be a non-empty string'),
  body('temperature').optional().isNumeric().withMessage('Temperature must be a number'),
  body('humidity').optional().isNumeric().withMessage('Humidity must be a number'),
  body('moisture').optional().isNumeric().withMessage('Moisture must be a number'),
  body('soil_moisture').optional().isNumeric().withMessage('soil_moisture must be a number'),
  body('ph').optional().isNumeric().withMessage('pH must be a number'),
  body('ec').optional().isNumeric().withMessage('EC must be a number'),
  body('nitrogen').optional().isNumeric().withMessage('Nitrogen must be a number'),
  body('phosphorus').optional().isNumeric().withMessage('Phosphorus must be a number'),
  body('potassium').optional().isNumeric().withMessage('Potassium must be a number'),
  body('waterLevel').optional().isInt().withMessage('Water level must be an integer'),
  body('float_sensor').optional().isInt({ min: 0, max: 1 }).withMessage('float_sensor must be 0 or 1'),
  body('timestamp').optional().isISO8601().withMessage('Invalid timestamp format')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const normalizedDeviceId = normalizeDeviceId(req.body.deviceId || req.body.device_id);
    if (!normalizedDeviceId) {
      return res.status(400).json({ success: false, message: 'Device ID is required' });
    }

    // Reject simulated telemetry explicitly when flagged by device
    if (req.body.isSimulated) {
      // Non-error: ignore simulated data from clients
      return res.status(204).json({ success: false, message: 'Ignored simulated telemetry' });
    }

    const {
      temperature,
      humidity,
      moisture,
      ph,
      ec,
      nitrogen,
      phosphorus,
      potassium,
      waterLevel,
      timestamp,
      batteryLevel,
      signalStrength,
      isOfflineData = false
    } = req.body;

    const soilMoisture = req.body.soil_moisture !== undefined ? Number(req.body.soil_moisture) : moisture;
    const floatSensor = req.body.float_sensor !== undefined ? Number(req.body.float_sensor) : undefined;

    // Ensure payload contains at least one real sensor reading (production policy)
    const hasRealReading = (temperature !== undefined && temperature !== null) ||
      (humidity !== undefined && humidity !== null) ||
      (soilMoisture !== undefined && soilMoisture !== null) ||
      (typeof floatSensor === 'number');

    if (!hasRealReading) {
      // Ignore empty telemetry posts (common from test clients); return 204 No Content
      return res.status(204).json({ success: false, message: 'Ignored empty or non-sensor telemetry' });
    }

    // Validate device registration and online status before accepting live sensor data
    let device = await Device.findOne({ where: { deviceId: normalizedDeviceId } });
    if (!device || device.status !== 'online') {
      try {
        // Auto-register devices that skipped the heartbeat flow so readings are not discarded.
        device = await deviceManager.markDeviceOnline(normalizedDeviceId, {
          autoRegisteredAt: new Date().toISOString(),
          source: 'sensor_post_auto_register'
        });
      } catch (error) {
        console.warn('Failed to auto-register device from sensor data:', error && error.message ? error.message : error);
      }

      if (!device || device.status !== 'online') {
        // Reject data from unknown or offline devices if auto-registration still failed
        return res.status(403).json({ success: false, message: 'Device not registered or not online' });
      }
    }

    // Enforce recent timestamp (avoid stale readings)
    const ts = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(ts.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid timestamp format' });
    }
    if (Date.now() - ts.getTime() > STALE_SENSOR_MAX_AGE_MS) {
      return res.status(204).json({ success: false, message: 'Ignored stale telemetry' });
    }

    const io = resolveIo(req);
    const soilTemperature = req.body.soil_temperature !== undefined ? Number(req.body.soil_temperature) : undefined;

    const sensorData = await SensorData.create({
      deviceId: normalizedDeviceId,
      temperature: temperature !== undefined ? Number(temperature) : undefined,
      humidity: humidity !== undefined ? Number(humidity) : undefined,
      moisture: soilMoisture !== undefined ? Number(soilMoisture) : undefined,
      soilTemperature: soilTemperature !== undefined ? Number(soilTemperature) : undefined,
      ph: ph !== undefined ? Number(ph) : undefined,
      ec: ec !== undefined ? Number(ec) : undefined,
      nitrogen: nitrogen !== undefined ? Number(nitrogen) : undefined,
      phosphorus: phosphorus !== undefined ? Number(phosphorus) : undefined,
      potassium: potassium !== undefined ? Number(potassium) : undefined,
      waterLevel: waterLevel !== undefined ? Number(waterLevel) : undefined,
      floatSensor: floatSensor,
      batteryLevel: batteryLevel !== undefined ? Number(batteryLevel) : undefined,
      signalStrength: signalStrength !== undefined ? Number(signalStrength) : undefined,
      isOfflineData: Boolean(isOfflineData),
      source: 'esp32_post',
      rawPayload: req.body || null,
      timestamp: ts,
    });

    await SensorSnapshot.upsert({
      deviceId: normalizedDeviceId,
      temperature: temperature !== undefined ? Number(temperature) : undefined,
      humidity: humidity !== undefined ? Number(humidity) : undefined,
      moisture: soilMoisture !== undefined ? Number(soilMoisture) : undefined,
      soilTemperature: soilTemperature !== undefined ? Number(soilTemperature) : undefined,
      ph: ph !== undefined ? Number(ph) : undefined,
      ec: ec !== undefined ? Number(ec) : undefined,
      nitrogen: nitrogen !== undefined ? Number(nitrogen) : undefined,
      phosphorus: phosphorus !== undefined ? Number(phosphorus) : undefined,
      potassium: potassium !== undefined ? Number(potassium) : undefined,
      waterLevel: waterLevel !== undefined ? Number(waterLevel) : undefined,
      floatSensor,
      batteryLevel: batteryLevel !== undefined ? Number(batteryLevel) : undefined,
      signalStrength: signalStrength !== undefined ? Number(signalStrength) : undefined,
      timestamp: ts,
    });

    const sensorPayload = toPlainObject(sensorData);

    await sensorLogService.recordSensorLogs({
      deviceId: normalizedDeviceId,
      metrics: {
        temperature: sensorPayload.temperature ?? null,
        humidity: sensorPayload.humidity ?? null,
        moisture: sensorPayload.moisture ?? null,
        soilTemperature: sensorPayload.soilTemperature ?? null,
        ph: sensorPayload.ph ?? null,
        ec: sensorPayload.ec ?? null,
        batteryLevel: sensorPayload.batteryLevel ?? null,
        signalStrength: sensorPayload.signalStrength ?? null,
      },
      origin: 'esp32_post',
      recordedAt: sensorPayload.timestamp || ts,
      rawPayload: req.body || null,
    });

    const alerts = await checkThresholds(sensorPayload, io);

    sensorCache.del('latest:all');
    sensorCache.del(`latest:${normalizedDeviceId}`);

    broadcastSensorData(sensorPayload, io);

    return res.status(201).json({
      success: true,
      message: 'Sensor data saved successfully',
      data: sanitizeSensorPayload(sensorPayload, alerts),
    });

  } catch (error) {
    console.error('Error saving sensor data:', error);
    return res.status(500).json({
      success: false,
      message: 'Error saving sensor data'
    });
  }
});

// @route   GET /api/sensors/latest
// @desc    Get latest sensor reading (device-specific actuator reads bypass cache)
// @access  Public
router.get('/latest', async (req, res) => {
  try {
    const deviceId = normalizeDeviceId(req.query.device_id || req.query.deviceId);
    const cacheKey = deviceId ? `latest:${deviceId}` : 'latest:all';
    const shouldUseCache = !deviceId;
    if (shouldUseCache) {
      const cached = sensorCache.get(cacheKey);
      if (cached !== undefined) {
        if (cached === null) {
          return res.status(204).send();
        }
        return res.json(cached);
      }
    }

    let formatted = null;

    const findLatestLiveSnapshot = async (queryDeviceId) => {
      if (queryDeviceId) {
        let snapshot = await SensorSnapshot.findByPk(queryDeviceId, { raw: true });
        if (!snapshot) {
          const snapshotWhere = buildDeviceIdWhere(queryDeviceId);
          snapshot = await SensorSnapshot.findOne({
            where: snapshotWhere,
            raw: true,
          });
        }
        if (!snapshot) {
          return null;
        }
        const candidate = formatLatestSnapshot(snapshot);
        return isLiveTelemetryPayload(candidate) ? candidate : null;
      }

      const snapshots = await SensorSnapshot.findAll({
        order: [['timestamp', 'DESC']],
        limit: 25,
        raw: true,
      });
      for (const snapshot of snapshots) {
        const candidate = formatLatestSnapshot(snapshot);
        if (isLiveTelemetryPayload(candidate)) {
          return candidate;
        }
      }
      return null;
    };

    const findLatestLiveSensorData = async (queryDeviceId) => {
      const dataWhere = {};
      if (queryDeviceId) {
        Object.assign(dataWhere, { [Op.and]: [buildDeviceIdWhere(queryDeviceId)] });
      }
      const rows = await SensorData.findAll({
        where: dataWhere,
        order: [['timestamp', 'DESC']],
        limit: queryDeviceId ? 5 : 25,
        raw: true,
      });

      for (const latest of rows) {
        const candidate = formatLatestSnapshot({
          deviceId: latest.deviceId || latest.device_id,
          temperature: latest.temperature,
          humidity: latest.humidity,
          moisture: latest.moisture,
          soilTemperature: latest.soilTemperature,
          waterLevel: latest.waterLevel,
          floatSensor: latest.floatSensor,
          timestamp: latest.timestamp,
        });
        if (isLiveTelemetryPayload(candidate)) {
          return candidate;
        }
      }

      return null;
    };

    formatted = await findLatestLiveSnapshot(deviceId);

    if (!formatted) {
      formatted = await findLatestLiveSensorData(deviceId);
    }

    if (formatted) {
      formatted = await hydrateMissingTelemetryFields(formatted);
      if (!isLiveTelemetryPayload(formatted)) {
        formatted = null;
      }
    }

    let deviceState = null;
    let pendingCommand = null;
    let lastSeenIso = null;
    let deviceOnline = false;

    if (deviceId) {
      const [deviceRecord, stateRow, pendingRow] = await Promise.all([
        Device.findOne({ where: buildDeviceIdWhere(deviceId), raw: true }).catch(() => null),
        ActuatorState.findOne({ where: buildActuatorKeyWhere(deviceId), raw: true }).catch(() => null),
        PendingCommand.findOne({
          where: {
            deviceId,
            status: { [Op.in]: ['sent', 'waiting'] },
            createdAt: { [Op.gte]: new Date(Date.now() - COMMAND_PENDING_UI_TIMEOUT_MS) },
          },
          order: [['createdAt', 'DESC']],
          raw: true,
        }).catch(() => null),
      ]);

      if (stateRow && stateRow.state && typeof stateRow.state === 'object') {
        deviceState = {
          ...stateRow.state,
          ts: stateRow.state.ts || ensureIsoString(stateRow.reportedAt),
          float_state: stateRow.state.float_state || stateRow.state.float || null,
          forcePumpOverride: stateRow.state.forcePumpOverride === true,
        };
      }

      const lastSeenCandidates = [
        deviceRecord?.lastHeartbeat,
        deviceRecord?.lastSeen,
        stateRow?.reportedAt,
        deviceState?.ts,
        formatted?.updated_at,
        formatted?.timestamp,
      ]
        .map((value) => value ? new Date(value).getTime() : NaN)
        .filter((value) => Number.isFinite(value));

      const lastSeenMs = lastSeenCandidates.length > 0 ? Math.max(...lastSeenCandidates) : NaN;
      lastSeenIso = Number.isFinite(lastSeenMs) ? new Date(lastSeenMs).toISOString() : null;
      deviceOnline = Number.isFinite(lastSeenMs) ? (Date.now() - lastSeenMs) < DEVICE_FRESHNESS_MS : false;

      if (pendingRow) {
        pendingCommand = {
          requestId: pendingRow.requestId,
          status: pendingRow.status,
        };
      }
    }

    const responsePayload = formatted || (deviceId ? {
      deviceId,
      device_id: deviceId,
      temperature: null,
      humidity: null,
      soil_moisture: null,
      soil_temperature: null,
      water_level: null,
      float_state: deviceState?.float_state === 'LOW' ? 0 : deviceState?.float_state === 'FULL' ? 2 : deviceState?.float_state === 'NORMAL' ? 1 : null,
      signal_strength: null,
      timestamp: lastSeenIso,
      updated_at: lastSeenIso,
    } : null);

    const enrichedPayload = responsePayload ? {
      ...responsePayload,
      deviceState,
      pendingCommand,
      deviceOnline,
      lastSeen: lastSeenIso,
      lastHeartbeat: lastSeenIso,
    } : null;

    if (shouldUseCache) {
      sensorCache.set(cacheKey, enrichedPayload || null);
    }

    if (!enrichedPayload) {
      return res.status(204).send();
    }

    return res.json(enrichedPayload);
  } catch (error) {
    console.error('GET /api/sensors/latest err', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

// @route   GET /api/sensors
// @desc    Get paginated sensor readings (newest first)
// @access  Private (admin only)
router.get('/', auth, adminOnly, [
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  query('since').optional().isISO8601().withMessage('since must be ISO-8601 timestamp'),
  query('device_id').optional().isString().trim().notEmpty().withMessage('device_id must be a non-empty string'),
  query('deviceId').optional().isString().trim().notEmpty().withMessage('deviceId must be a non-empty string'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, errors: errors.array(), error: 'validation_failed' });
    }

    const limit = Math.min(1000, parseInt(req.query.limit, 10) || 100);
    const deviceId = (req.query.device_id || req.query.deviceId || '').toString().trim() || null;
    const since = req.query.since ? new Date(req.query.since) : null;

    const where = {};
    if (deviceId) {
      where.deviceId = deviceId;
    }
    if (!Number.isNaN(since?.getTime())) {
      where.timestamp = { [Op.gt]: since };
    }

    const rows = await SensorData.findAll({
      where,
      order: [['timestamp', 'DESC']],
      limit,
      raw: true,
    });

    return res.json({ ok: true, data: rows.map((row) => sanitizeSensorPayload(row, [])) });
  } catch (error) {
    console.error('GET /api/sensors err', error);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// @route   GET /api/sensors/stats
// @desc    Get sensor statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const { deviceId, hours = 24 } = req.query;
    
    const hoursAgo = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);
    
    let query = { timestamp: { $gte: hoursAgo } };
    if (deviceId) {
      query.deviceId = deviceId;
    }

    // Compute stats with Sequelize if available, otherwise fallback to aggregation
    try {
      if (SensorData && SensorData.sequelize && typeof SensorData.findAll === 'function') {
        const { fn, col } = SensorData.sequelize;
        const rows = await SensorData.findAll({
          where: query,
          attributes: [
            [fn('AVG', col('temperature')), 'avgTemperature'],
            [fn('MAX', col('temperature')), 'maxTemperature'],
            [fn('MIN', col('temperature')), 'minTemperature'],
            [fn('AVG', col('humidity')), 'avgHumidity'],
            [fn('MAX', col('humidity')), 'maxHumidity'],
            [fn('MIN', col('humidity')), 'minHumidity'],
            [fn('AVG', col('moisture')), 'avgMoisture'],
            [fn('MAX', col('moisture')), 'maxMoisture'],
            [fn('MIN', col('moisture')), 'minMoisture'],
            [fn('COUNT', col('*')), 'count']
          ],
          raw: true
        });
        const stats = rows && rows[0] ? rows[0] : {};
        res.json({ success: true, data: { stats, period: `${hours} hours`, deviceId: deviceId || 'all' } });
      } else {
        res.json({ success: true, data: { stats: {}, period: `${hours} hours`, deviceId: deviceId || 'all' } });
      }
    } catch (e) {
      console.error('Error fetching sensor stats:', e && e.message ? e.message : e);
      res.status(500).json({ success: false, message: 'Error fetching sensor statistics' });
    }

  } catch (error) {
    console.error('Error fetching sensor stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching sensor statistics'
    });
  }
});

// Register a new sensor (for admin management)
router.post('/register', auth, [
  body('deviceId').isString().notEmpty().withMessage('Device ID is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { deviceId } = req.body;

    const existingDevice = await Device.findOne({ where: { deviceId } });
    if (existingDevice) {
      return res.status(409).json({ success: false, message: 'Device with this ID already exists' });
    }

    const now = new Date();
    const registeredDevice = await Device.create({
      deviceId,
      status: 'offline',
      online: false,
      lastHeartbeat: now,
      lastSeen: now,
      metadata: { registrationSource: 'admin' },
    });

    res.json({ success: true, message: 'Device registered successfully', data: registeredDevice });
  } catch (error) {
    console.error('Error registering sensor:', error);
    res.status(500).json({ success: false, message: 'Error registering sensor' });
  }
});

// @route   GET /api/sensors/history
// @desc    Get historical sensor readings for charts
// @access  Private (auth required)
router.get('/history', auth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 336, 1), 2000);
    const deviceId = (req.query.deviceId || req.query.device_id || '').toString().trim() || null;
    const start = req.query.start ? new Date(req.query.start) : null;
    const end = req.query.end ? new Date(req.query.end) : null;

    const where = {};
    if (deviceId) {
      where.deviceId = deviceId;
    }
    const hasValidStart = Boolean(start && !Number.isNaN(start.getTime()));
    const hasValidEnd = Boolean(end && !Number.isNaN(end.getTime()));

    if (hasValidStart && hasValidEnd) {
      where.createdAt = { [Op.between]: [start, end] };
      where.timestamp = { ...(where.timestamp || {}), [Op.gte]: start, [Op.lte]: end };
    } else {
      if (hasValidStart) {
        where.timestamp = { ...(where.timestamp || {}), [Op.gte]: start };
      }
      if (hasValidEnd) {
        where.timestamp = { ...(where.timestamp || {}), [Op.lte]: end };
      }
    }

    const readings = await SensorData.findAll({
      where,
      order: [['timestamp', 'ASC']],
      limit,
      raw: true,
    });

    res.json({
      success: true,
      data: {
        deviceId: deviceId || 'all',
        readings: readings.map((row) => sanitizeSensorPayload(row, [])),
      },
    });
  } catch (error) {
    console.error('GET /api/sensors/history err', error);
    res.status(500).json({ success: false, message: 'Failed to load sensor history.' });
  }
});

// @route   GET /api/sensors/daily
// @desc    Daily aggregates + actuator activity for a date
// @access  Public (read-only daily aggregates)
router.get('/daily', async (req, res) => {
  try {
    const dateStr = (req.query.date || '').toString().trim();
    if (!dateStr) {
      return res.status(400).json({ success: false, message: 'date is required (YYYY-MM-DD)' });
    }
    const deviceId = (req.query.deviceId || req.query.device_id || '').toString().trim() || null;

    const start = new Date(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const where = { timestamp: { [Op.gte]: start, [Op.lt]: end } };
    if (deviceId) {
      where.deviceId = deviceId;
    }

    const { fn, col } = SensorData.sequelize;
    const rows = await SensorData.findAll({
      where,
      attributes: [
        [fn('AVG', col('temperature')), 'avgTemperature'],
        [fn('MAX', col('temperature')), 'maxTemperature'],
        [fn('MIN', col('temperature')), 'minTemperature'],
        [fn('AVG', col('humidity')), 'avgHumidity'],
        [fn('MAX', col('humidity')), 'maxHumidity'],
        [fn('MIN', col('humidity')), 'minHumidity'],
        [fn('AVG', col('moisture')), 'avgMoisture'],
        [fn('MAX', col('moisture')), 'maxMoisture'],
        [fn('MIN', col('moisture')), 'minMoisture'],
        [fn('AVG', col('soil_temperature')), 'avgSoilTemperature'],
        [fn('MAX', col('soil_temperature')), 'maxSoilTemperature'],
        [fn('MIN', col('soil_temperature')), 'minSoilTemperature'],
        [fn('COUNT', col('*')), 'count'],
      ],
      raw: true,
    });

    const actuatorWhere = { timestamp: { [Op.gte]: start, [Op.lt]: end } };
    if (deviceId) {
      actuatorWhere.deviceId = deviceId;
    }
    const actuatorLogs = await ActuatorLog.findAll({
      where: actuatorWhere,
      order: [['timestamp', 'ASC']],
      raw: true,
    });

    res.json({
      success: true,
      data: {
        date: dateStr,
        deviceId: deviceId || 'all',
        stats: rows && rows[0] ? rows[0] : {},
        actuatorActivity: actuatorLogs,
      },
    });
  } catch (error) {
    console.error('GET /api/sensors/daily err', error);
    res.status(500).json({ success: false, message: 'Failed to load daily summary.' });
  }
});

module.exports = router;
