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

async function handleMessage(topic, message) {
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
  const metrics = payload.metrics || payload;
  const numericPresent = Object.values(metrics || {}).some((v) => typeof v === 'number');
  if (!numericPresent) return;

  try {
    await SensorData.create({
      deviceId,
      ...metrics,
      timestamp,
      isOfflineData: false,
      source: `mqtt:${topic}`,
      rawPayload: metrics,
    });

    await SensorSnapshot.upsert({
      deviceId,
      temperature: metrics.temperature || null,
      humidity: metrics.humidity || null,
      moisture: metrics.moisture || null,
      ph: metrics.ph || null,
      ec: metrics.ec || null,
      nitrogen: metrics.nitrogen || null,
      phosphorus: metrics.phosphorus || null,
      potassium: metrics.potassium || null,
      waterLevel: metrics.waterLevel || null,
      floatSensor: metrics.floatSensor || null,
      batteryLevel: metrics.batteryLevel || null,
      signalStrength: metrics.signalStrength || null,
      timestamp,
    });
    const broadcastPayload = {
      deviceId,
      ...metrics,
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
