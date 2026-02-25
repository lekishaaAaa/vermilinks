const SensorLog = require('../models/SensorLog');
const logger = require('../utils/logger');

const RAW_LIMIT = Math.max(1024, Number.parseInt(process.env.SENSOR_LOG_RAW_LIMIT || '8192', 10));
const SENSOR_ALIAS = {
  soil_moisture: 'moisture',
  'soil-moisture': 'moisture',
  soilmoisture: 'moisture',
  soil_temperature: 'soilTemperature',
  'soil-temperature': 'soilTemperature',
  soiltemperature: 'soilTemperature',
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
  moisture: '%',
  soilTemperature: 'C',
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
const RESERVED_KEYS = new Set(['timestamp', 'deviceId', 'device_id', 'metrics', 'source']);

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
      rawPayload: index === 0 ? rawPayload : null,
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
  clampRawPayload,
  recordSensorLogs,
  RESERVED_KEYS,
  normalizeKey,
  RAW_LIMIT,
};
