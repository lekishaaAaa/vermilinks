const SensorLog = require('../models/SensorLog');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

const RAW_LIMIT = Math.max(1024, Number.parseInt(process.env.SENSOR_LOG_RAW_LIMIT || '8192', 10));
const SENSOR_ALIAS = {
  moisture: 'soil_moisture',
  soil_moisture: 'soil_moisture',
  'soil-moisture': 'soil_moisture',
  soilmoisture: 'soil_moisture',
  soiltemp: 'soil_temperature',
  soil_temperature: 'soil_temperature',
  'soil-temperature': 'soil_temperature',
  soiltemperature: 'soil_temperature',
  float: 'floatSensor',
  float_sensor: 'floatSensor',
  floatstate: 'floatSensor',
  float_state: 'floatSensor',
  water_level: 'waterLevel',
  waterlevel: 'waterLevel',
  battery_level: 'batteryLevel',
  batterylevel: 'batteryLevel',
  signal_strength: 'signalStrength',
  signalstrength: 'signalStrength',
  rssi: 'signalStrength',
};
const SENSOR_UNITS = {
  temperature: 'C',
  humidity: '%',
  soil_moisture: '%',
  soil_temperature: 'C',
  ph: 'pH',
  ec: 'mS/cm',
  nitrogen: 'ppm',
  phosphorus: 'ppm',
  potassium: 'ppm',
  waterLevel: 'cm',
  floatSensor: 'state',
  batteryLevel: '%',
  signalStrength: 'dBm',
};
const DEVICE_METRIC_KEYS = new Set(['uptime', 'ts', 'online', 'signalStrength', 'signal_strength', 'rssi']);
const RESERVED_KEYS = new Set(['timestamp', 'deviceId', 'device_id', 'metrics', 'source']);
const TELEMETRY_FLUSH_INTERVAL_MS = Math.max(30 * 1000, Number.parseInt(process.env.SENSOR_LOG_AGGREGATION_MS || '180000', 10));
const TELEMETRY_BUFFER_KEYS = ['temperature', 'humidity', 'soil_moisture', 'soil_temperature', 'water_level'];
const LOG_RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.SENSOR_LOG_RETENTION_DAYS || '30', 10));
const CLEANUP_INTERVAL_MS = Math.max(60 * 60 * 1000, Number.parseInt(process.env.SENSOR_LOG_CLEANUP_MS || `${24 * 60 * 60 * 1000}`, 10));
const SENSOR_LOG_INGESTOR_TAG = (process.env.SENSOR_LOG_INGESTOR_TAG || '').toString().trim();
const telemetryBuffers = new Map();
let aggregationTimer = null;
let cleanupTimer = null;

const withIngestorTag = (payload) => {
  if (!SENSOR_LOG_INGESTOR_TAG) {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return { ingestor_tag: SENSOR_LOG_INGESTOR_TAG };
  }
  return {
    ...payload,
    ingestor_tag: SENSOR_LOG_INGESTOR_TAG,
  };
};

const clampRawPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= RAW_LIMIT) {
      return payload;
    }
    return {
      truncated: true,
      preview: serialized.slice(0, RAW_LIMIT),
    };
  } catch (error) {
    return null;
  }
};

const normalizeKey = (key) => {
  if (!key && key !== 0) {
    return null;
  }
  const trimmed = key.toString().trim();
  if (!trimmed) {
    return null;
  }
  const aliasKey = trimmed.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  if (SENSOR_ALIAS[aliasKey]) {
    return SENSOR_ALIAS[aliasKey];
  }
  return trimmed;
};

const toAggregateMetricKey = (normalizedKey) => {
  if (!normalizedKey) return null;
  if (normalizedKey === 'moisture' || normalizedKey === 'soil_moisture') return 'soil_moisture';
  if (normalizedKey === 'soilTemperature' || normalizedKey === 'soil_temperature') return 'soil_temperature';
  if (normalizedKey === 'waterLevel' || normalizedKey === 'water_level' || normalizedKey === 'floatSensor' || normalizedKey === 'float_sensor') return 'water_level';
  if (normalizedKey === 'temperature' || normalizedKey === 'humidity') return normalizedKey;
  return null;
};

const getOrCreateTelemetryBucket = (deviceId) => {
  const existing = telemetryBuffers.get(deviceId);
  if (existing) {
    return existing;
  }
  const bucket = {
    deviceId,
    metrics: {
      temperature: [],
      humidity: [],
      soil_moisture: [],
      soil_temperature: [],
      water_level: [],
    },
    metadata: {
      origin: 'mqtt',
      mqttTopic: null,
      rawPayload: null,
      ingestorTag: SENSOR_LOG_INGESTOR_TAG || null,
      recordedAt: new Date(),
    },
  };
  telemetryBuffers.set(deviceId, bucket);
  return bucket;
};

const average = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(4));
};

const queueTelemetryForAggregation = ({ deviceId, metrics, origin, recordedAt, rawPayload, mqttTopic }) => {
  const bucket = getOrCreateTelemetryBucket(deviceId);
  Object.entries(metrics).forEach(([key, rawValue]) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || RESERVED_KEYS.has(normalizedKey)) {
      return;
    }
    const targetKey = toAggregateMetricKey(normalizedKey);
    if (!targetKey) {
      return;
    }
    const numeric = toNumber(rawValue);
    if (numeric === null) {
      return;
    }
    bucket.metrics[targetKey].push(numeric);
  });

  bucket.metadata.origin = origin || bucket.metadata.origin;
  bucket.metadata.mqttTopic = mqttTopic || bucket.metadata.mqttTopic;
  bucket.metadata.rawPayload = withIngestorTag(rawPayload || bucket.metadata.rawPayload);
  bucket.metadata.recordedAt = recordedAt || new Date();
};

async function flushTelemetryAggregation() {
  if (telemetryBuffers.size === 0) {
    return { inserted: 0 };
  }

  const entries = [];
  telemetryBuffers.forEach((bucket, deviceId) => {
    const avgPayload = {
      device_id: deviceId,
      avg_temperature: average(bucket.metrics.temperature),
      avg_humidity: average(bucket.metrics.humidity),
      avg_soil_moisture: average(bucket.metrics.soil_moisture),
      avg_soil_temperature: average(bucket.metrics.soil_temperature),
      avg_water_level: average(bucket.metrics.water_level),
      samples: {
        temperature: bucket.metrics.temperature.length,
        humidity: bucket.metrics.humidity.length,
        soil_moisture: bucket.metrics.soil_moisture.length,
        soil_temperature: bucket.metrics.soil_temperature.length,
        water_level: bucket.metrics.water_level.length,
      },
      window_ms: TELEMETRY_FLUSH_INTERVAL_MS,
      timestamp: new Date().toISOString(),
    };

    const hasSample = TELEMETRY_BUFFER_KEYS.some((metricKey) => bucket.metrics[metricKey].length > 0);
    if (!hasSample) {
      return;
    }

    entries.push({
      deviceId,
      sensorName: 'telemetry_aggregate',
      value: avgPayload.avg_temperature ?? avgPayload.avg_humidity ?? avgPayload.avg_soil_moisture ?? avgPayload.avg_soil_temperature ?? avgPayload.avg_water_level ?? 0,
      unit: 'aggregate',
      origin: bucket.metadata.origin || 'mqtt',
      recordedAt: bucket.metadata.recordedAt || new Date(),
      mqttTopic: bucket.metadata.mqttTopic || null,
      rawPayload: clampRawPayload(withIngestorTag(avgPayload)),
    });
  });

  telemetryBuffers.clear();

  if (entries.length === 0) {
    return { inserted: 0 };
  }

  try {
    const created = await SensorLog.bulkCreate(entries, { validate: true });
    return { inserted: created.length };
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('sensorLogService.flushTelemetryAggregation failed', error && error.message ? error.message : error);
    }
    return { inserted: 0, error };
  }
}

async function cleanupOldLogs() {
  try {
    const cutoff = new Date(Date.now() - (LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000));
    const deleted = await SensorLog.destroy({ where: { recordedAt: { [Op.lt]: cutoff } } });
    return { deleted };
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('sensorLogService.cleanupOldLogs failed', error && error.message ? error.message : error);
    }
    return { deleted: 0, error };
  }
}

function ensureSchedulers() {
  if ((process.env.NODE_ENV || 'development') === 'test') {
    return;
  }
  if (!aggregationTimer) {
    aggregationTimer = setInterval(() => {
      flushTelemetryAggregation().catch(() => null);
    }, TELEMETRY_FLUSH_INTERVAL_MS);
    if (typeof aggregationTimer.unref === 'function') {
      aggregationTimer.unref();
    }
  }
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      cleanupOldLogs().catch(() => null);
    }, CLEANUP_INTERVAL_MS);
    if (typeof cleanupTimer.unref === 'function') {
      cleanupTimer.unref();
    }
  }
}

const classifySensorCategory = (sensorName) => {
  const normalized = normalizeKey(sensorName);
  if (!normalized) {
    return 'Environmental Sensors';
  }
  return DEVICE_METRIC_KEYS.has(normalized) ? 'Device Metrics' : 'Environmental Sensors';
};

const toNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

async function recordSensorLogs({
  deviceId,
  metrics,
  origin = 'unknown',
  recordedAt = new Date(),
  rawPayload = null,
  mqttTopic = null,
}) {
  if (!deviceId || !metrics || typeof metrics !== 'object') {
    return { inserted: 0 };
  }

  const normalizedDeviceId = deviceId.toString().trim();
  if (!normalizedDeviceId) {
    return { inserted: 0 };
  }

  ensureSchedulers();

  const normalizedOrigin = (origin || '').toString().trim().toLowerCase();
  if (normalizedOrigin === 'mqtt' || normalizedOrigin.startsWith('mqtt:')) {
    queueTelemetryForAggregation({
      deviceId: normalizedDeviceId,
      metrics,
      origin: 'mqtt',
      recordedAt,
      rawPayload,
      mqttTopic,
    });
    return { inserted: 0, buffered: true };
  }

  const entries = [];
  Object.entries(metrics).forEach(([key, rawValue], index) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || RESERVED_KEYS.has(normalizedKey)) {
      return;
    }
    const numericValue = toNumber(rawValue);
    if (numericValue === null) {
      return;
    }
    entries.push({
      deviceId: normalizedDeviceId,
      sensorName: normalizedKey,
      value: numericValue,
      unit: SENSOR_UNITS[normalizedKey] || null,
      origin,
      recordedAt,
      mqttTopic: mqttTopic || null,
      rawPayload: withIngestorTag(index === 0 ? rawPayload : null),
    });
  });

  if (entries.length === 0) {
    return { inserted: 0 };
  }

  try {
    const created = await SensorLog.bulkCreate(entries, { validate: true });
    return { inserted: created.length };
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('sensorLogService.recordSensorLogs failed', error && error.message ? error.message : error);
    }
    return { inserted: 0, error };
  }
}

module.exports = {
  SENSOR_UNITS,
  DEVICE_METRIC_KEYS,
  clampRawPayload,
  recordSensorLogs,
  classifySensorCategory,
  RESERVED_KEYS,
  normalizeKey,
  RAW_LIMIT,
  flushTelemetryAggregation,
  cleanupOldLogs,
};
