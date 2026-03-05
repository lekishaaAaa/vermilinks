const mqtt = require('mqtt');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const logger = require('../utils/logger');
const SensorData = require('../models/SensorData');
const SensorSnapshot = require('../models/SensorSnapshot');
const DeviceEvent = require('../models/DeviceEvent');
const { checkThresholds, broadcastSensorData } = require('../utils/sensorEvents');
const sensorLogService = require('./sensorLogService');

const DEFAULT_TOPIC = process.env.MQTT_SUBSCRIPTIONS || process.env.MQTT_TOPIC || 'vermilinks/#';
const BROKER = process.env.MQTT_BROKER_URL || process.env.MQTT_URL || process.env.MQTT_BROKER;
const DEDUPE_TTL_SEC = parseInt(process.env.MQTT_DEDUPE_TTL_SEC || '30', 10);
const TOPIC_DEVICE_REGEX = process.env.MQTT_TOPIC_DEVICE_REGEX || 'vermilinks\\/([^\\/]+)';
const IOT_NATIVE_TOPICS = new Set([
  'vermilinks/esp32a/state',
  'vermilinks/esp32a/ack',
  'vermilinks/esp32a/status',
  'vermilinks/esp32b/status',
  'vermilinks/esp32b/metrics',
]);

let client = null;
const dedupeCache = new NodeCache({ stdTTL: DEDUPE_TTL_SEC, checkperiod: Math.max(10, Math.floor(DEDUPE_TTL_SEC / 2)) });

const { parseSubscriptions, DeviceThrottle } = require('./mqttHelpers');
const deviceThrottle = new DeviceThrottle();

function tryParseJson(str) {
  if (!str) return null;
  try {
    if (Buffer.isBuffer(str)) str = str.toString('utf8');
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function makeDedupeSignature(topic, payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  return crypto.createHash('sha256').update(`${topic}::${raw}`).digest('hex');
}

function extractDeviceIdFromTopic(topic) {
  try {
    const re = new RegExp(TOPIC_DEVICE_REGEX);
    const m = re.exec(topic);
    if (m && m[1]) return String(m[1]);
  } catch (e) {
    // ignore
  }
  const parts = topic.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function toNullableNumber(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFloatState(value) {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return 0;
    if (value >= 2) return 2;
    return 1;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return null;
    if (['LOW', 'EMPTY', 'MIN', 'L', '0'].includes(normalized)) return 0;
    if (['FULL', 'HIGH', 'MAX', 'F', '2'].includes(normalized)) return 2;
    if (['NORMAL', 'OK', 'MID', 'MEDIUM', 'N', '1'].includes(normalized)) return 1;
  }
  return null;
}

function normalizeMetrics(raw = {}) {
  const metrics = raw && typeof raw === 'object' ? raw : {};
  const normalizedFloat = normalizeFloatState(
    metrics.floatSensor
      ?? metrics.float_state
      ?? metrics.floatState
      ?? metrics.float
      ?? metrics.water_level
      ?? metrics.waterLevel
  );
  return {
    temperature: toNullableNumber(metrics.temperature ?? metrics.temp ?? metrics.tempC),
    humidity: toNullableNumber(metrics.humidity),
    moisture: toNullableNumber(metrics.moisture ?? metrics.soil_moisture ?? metrics.soilMoisture ?? metrics.soil),
    soilTemperature: toNullableNumber(metrics.soilTemperature ?? metrics.soil_temperature ?? metrics.soilTemp ?? metrics.waterTempC),
    waterLevel: toNullableNumber(metrics.waterLevel ?? metrics.water_level ?? metrics.float_state ?? metrics.floatSensor ?? normalizedFloat),
    floatSensor: toNullableNumber(metrics.floatSensor ?? metrics.float_state ?? metrics.floatState ?? normalizedFloat),
    ph: toNullableNumber(metrics.ph),
    ec: toNullableNumber(metrics.ec),
    nitrogen: toNullableNumber(metrics.nitrogen),
    phosphorus: toNullableNumber(metrics.phosphorus),
    potassium: toNullableNumber(metrics.potassium),
    batteryLevel: toNullableNumber(metrics.batteryLevel ?? metrics.battery_level ?? metrics.battery),
    signalStrength: toNullableNumber(metrics.signalStrength ?? metrics.signal_strength ?? metrics.rssi),
  };
}

function hasSensorSignal(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return false;
  }
  return [
    metrics.temperature,
    metrics.humidity,
    metrics.moisture,
    metrics.soilTemperature,
    metrics.waterLevel,
    metrics.floatSensor,
  ].some((value) => value !== null && typeof value !== 'undefined');
}

async function handleMessage(topic, message) {
  const normalizedTopic = (topic || '').toString().trim().toLowerCase();
  if (
    IOT_NATIVE_TOPICS.has(normalizedTopic)
    || normalizedTopic.startsWith('vermilinks/device_status/')
    || normalizedTopic.startsWith('vermilinks/esp32a/')
    || normalizedTopic.startsWith('vermilinks/esp32b/')
  ) {
    return;
  }

  const payload = tryParseJson(message) || { raw: message ? message.toString('utf8') : null };
  // dedupe
  const sig = makeDedupeSignature(topic, payload);
  if (dedupeCache.get(sig)) {
    logger.debug('MQTT message duplicate skipped', { topic, sig });
    return;
  }
  dedupeCache.set(sig, true);

  const deviceId = (payload.deviceId || payload.device_id || payload.id || extractDeviceIdFromTopic(topic) || 'mqtt-unknown').toString();
  // per-device throttle: drop messages arriving too frequently
  try {
    if (deviceThrottle.shouldThrottle(deviceId, Date.now())) {
      logger.debug('MQTT message throttled (per-device)', { deviceId, topic });
      return;
    }
  } catch (e) {
    // if throttle fails, don't block processing
    logger.warn('Device throttle check failed', e && e.message ? e.message : e);
  }
  const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();

  // persist device event
  try {
    await DeviceEvent.create({
      deviceId,
      eventType: 'mqtt_message',
      payload: JSON.stringify(payload),
      timestamp,
      source: `mqtt:${topic}`.slice(0, 191),
    });
  } catch (err) {
    logger.warn('Failed to persist MQTT DeviceEvent', err && err.message ? err.message : err);
  }

  // If payload contains simple metrics, store into SensorData and SensorSnapshot
  const metrics = normalizeMetrics(payload.metrics || payload);
  if (!hasSensorSignal(metrics)) return;

  try {
    await SensorData.create({
      deviceId,
      temperature: metrics.temperature,
      humidity: metrics.humidity,
      moisture: metrics.moisture,
      soilTemperature: metrics.soilTemperature,
      ph: metrics.ph,
      ec: metrics.ec,
      nitrogen: metrics.nitrogen,
      phosphorus: metrics.phosphorus,
      potassium: metrics.potassium,
      waterLevel: metrics.waterLevel,
      floatSensor: metrics.floatSensor,
      batteryLevel: metrics.batteryLevel,
      signalStrength: metrics.signalStrength,
      timestamp,
      isOfflineData: false,
      source: `mqtt:${topic}`,
      rawPayload: metrics,
    });

    const existingSnapshot = await SensorSnapshot.findByPk(deviceId, { raw: true }).catch(() => null);

    await SensorSnapshot.upsert({
      deviceId,
      temperature: metrics.temperature ?? existingSnapshot?.temperature ?? null,
      humidity: metrics.humidity ?? existingSnapshot?.humidity ?? null,
      moisture: metrics.moisture ?? existingSnapshot?.moisture ?? null,
      ph: metrics.ph ?? existingSnapshot?.ph ?? null,
      ec: metrics.ec ?? existingSnapshot?.ec ?? null,
      nitrogen: metrics.nitrogen ?? existingSnapshot?.nitrogen ?? null,
      phosphorus: metrics.phosphorus ?? existingSnapshot?.phosphorus ?? null,
      potassium: metrics.potassium ?? existingSnapshot?.potassium ?? null,
      waterLevel: metrics.waterLevel ?? existingSnapshot?.waterLevel ?? null,
      floatSensor: metrics.floatSensor ?? existingSnapshot?.floatSensor ?? null,
      batteryLevel: metrics.batteryLevel ?? existingSnapshot?.batteryLevel ?? null,
      signalStrength: metrics.signalStrength ?? existingSnapshot?.signalStrength ?? null,
      timestamp,
    });
    const broadcastPayload = {
      deviceId,
      temperature: metrics.temperature,
      humidity: metrics.humidity,
      moisture: metrics.moisture,
      soilTemperature: metrics.soilTemperature,
      ph: metrics.ph,
      ec: metrics.ec,
      nitrogen: metrics.nitrogen,
      phosphorus: metrics.phosphorus,
      potassium: metrics.potassium,
      waterLevel: metrics.waterLevel,
      floatSensor: metrics.floatSensor,
      batteryLevel: metrics.batteryLevel,
      signalStrength: metrics.signalStrength,
      timestamp,
      source: `mqtt:${topic}`,
    };

    // Run threshold checks and broadcast via sockets
    try {
      const alerts = await checkThresholds(broadcastPayload, global.io);
      if (alerts && alerts.length > 0) broadcastPayload.alerts = alerts;
      broadcastSensorData(broadcastPayload, global.io);
    } catch (e) {
      logger.warn('Failed to run alert checks or broadcast for MQTT message', e && e.message ? e.message : e);
    }

    try {
      await sensorLogService.recordSensorLogs({
        deviceId,
        metrics,
        origin: 'mqtt',
        recordedAt: timestamp,
        rawPayload: sensorLogService.clampRawPayload(broadcastPayload),
        mqttTopic: topic,
      });
    } catch (logErr) {
      logger.warn('Failed to persist MQTT sensor log', logErr && logErr.message ? logErr.message : logErr);
    }
  } catch (err) {
    logger.warn('Failed to persist MQTT SensorData/Snapshot', err && err.message ? err.message : err);
  }
}

function startMqtt() {
  if (!BROKER) {
    logger.info('MQTT broker not configured; skipping MQTT ingest startup');
    return null;
  }

  try {
    const configuredClientId = (process.env.MQTT_CLIENT_ID || '').toString().trim();
    const ingestClientId = configuredClientId
      ? `${configuredClientId}-ingest`
      : `vermilinks-ingest-${Math.random().toString(16).slice(2,8)}`;
    const mqttUsername = (process.env.MQTT_USERNAME || '').toString().trim();
    const mqttPassword = (process.env.MQTT_PASSWORD || '').toString().trim();

    client = mqtt.connect(BROKER, {
      clientId: ingestClientId,
      username: mqttUsername || undefined,
      password: mqttPassword || undefined,
    });

    client.on('connect', () => {
      logger.info('MQTT ingest connected to broker', { broker: BROKER });
      try {
          // DEFAULT_TOPIC may be a CSV list with optional :qos values
          const subs = parseSubscriptions(DEFAULT_TOPIC);
          if (subs && subs.length > 0) {
            subs.forEach((s) => {
              try {
                client.subscribe(s.topic, { qos: s.qos }, (err) => {
                  if (err) logger.warn('MQTT subscribe failed', err && err.message ? err.message : err);
                });
              } catch (e) {
                logger.warn('MQTT subscribe error for topic', s.topic, e && e.message ? e.message : e);
              }
            });
          } else {
            client.subscribe(DEFAULT_TOPIC, { qos: 0 }, (err) => {
              if (err) logger.warn('MQTT subscribe failed', err && err.message ? err.message : err);
            });
          }
      } catch (e) {
        logger.warn('MQTT subscribe error', e && e.message ? e.message : e);
      }
    });

    client.on('message', (topic, message) => {
      handleMessage(topic, message).catch((e) => logger.warn('MQTT message handler error', e && e.message ? e.message : e));
    });

    client.on('error', (err) => {
      logger.warn('MQTT client error', err && err.message ? err.message : err);
    });

    client.on('close', () => {
      logger.info('MQTT client closed');
    });
  } catch (e) {
    logger.warn('Failed to start MQTT client', e && e.message ? e.message : e);
  }

  return client;
}

module.exports = {
  startMqtt,
  _client: () => client,
  handleMessage,
};

// Export internals for testing
module.exports._deviceThrottle = deviceThrottle;
