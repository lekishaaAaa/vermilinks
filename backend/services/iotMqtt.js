const mqtt = require('mqtt');
const logger = require('../utils/logger');
const { SensorData, SensorSnapshot, ActuatorState, PendingCommand, Alert, ActuatorLog } = require('../models');
const Device = require('../models/Device');
const { REALTIME_EVENTS, emitRealtime } = require('../utils/realtime');
const { broadcastSensorData, checkThresholds } = require('../utils/sensorEvents');
const sensorLogService = require('./sensorLogService');
const alertService = require('./alertService');
const { markDeviceOnline } = require('./deviceManager');

const MQTT_HOST = (process.env.MQTT_HOST || '').toString().trim();
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883', 10);
const MQTT_PROTOCOL = (process.env.MQTT_PROTOCOL || 'mqtts').toString().trim().toLowerCase();
const BROKER = process.env.MQTT_BROKER_URL || process.env.MQTT_URL || process.env.MQTT_BROKER;
const TOPICS = {
  state: 'vermilinks/esp32a/state',
  ack: 'vermilinks/esp32a/ack',
  statusA: 'vermilinks/esp32a/status',
  command: 'vermilinks/esp32A/commands',
  telemetry: 'vermilinks/esp32b/metrics',
  statusB: 'vermilinks/esp32b/status',
  deviceStatusPrefix: 'vermilinks/device_status/',
};

const TELEMETRY_TOPICS = new Set([
  'vermilinks/esp32b/metrics',
  'vermilinks/esp32b/telemetry',
  'vermilinks/esp32a/telemetry',
  'vermilinks/esp32a/metrics',
]);
const TELEMETRY_WILDCARD_TOPIC = 'vermilinks/+/telemetry';
const METRICS_WILDCARD_TOPIC = 'vermilinks/+/metrics';
const STATE_WILDCARD_TOPIC = 'vermilinks/+/state';
const STATUS_WILDCARD_TOPIC = 'vermilinks/+/status';
const COMMANDS_WILDCARD_TOPIC = 'vermilinks/+/commands';

const STATE_TOPICS = new Set(['vermilinks/esp32a/state']);
const ACK_TOPICS = new Set(['vermilinks/esp32a/ack']);
const STATUS_TOPICS = new Set(['vermilinks/esp32a/status', 'vermilinks/esp32b/status']);

function isStateTopic(topic) {
  if (!topic) return false;
  if (STATE_TOPICS.has(topic)) return true;
  return /^vermilinks\/[^/]+\/state$/.test(topic);
}

function isAckTopic(topic) {
  if (!topic) return false;
  if (ACK_TOPICS.has(topic)) return true;
  return /^vermilinks\/[^/]+\/ack$/.test(topic);
}

function isStatusTopic(topic) {
  if (!topic) return false;
  if (STATUS_TOPICS.has(topic)) return true;
  return /^vermilinks\/[^/]+\/status$/.test(topic);
}

function isCommandsTopic(topic) {
  if (!topic) return false;
  return /^vermilinks\/[^/]+\/commands$/.test(topic);
}

let client = null;
let lastConnectionState = 'disconnected';

function safeJsonParse(payload) {
  if (!payload) return null;
  try {
    if (Buffer.isBuffer(payload)) {
      return JSON.parse(payload.toString('utf8'));
    }
    if (typeof payload === 'string') {
      return JSON.parse(payload);
    }
    return null;
  } catch (error) {
    return null;
  }
}

function parseLwtPayload(topic, message) {
  if (!topic || !topic.startsWith(TOPICS.deviceStatusPrefix)) {
    return null;
  }
  const raw = Buffer.isBuffer(message) ? message.toString('utf8') : String(message || '');
  const normalized = raw.trim().toLowerCase();
  if (normalized !== 'online' && normalized !== 'offline') {
    return null;
  }
  const deviceId = topic.slice(TOPICS.deviceStatusPrefix.length).trim();
  if (!deviceId) {
    return null;
  }
  return {
    deviceId,
    online: normalized === 'online',
  };
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function isStatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  return [
    isBoolean(payload.pump),
    isBoolean(payload.valve1),
    isBoolean(payload.valve2),
    isBoolean(payload.valve3),
  ].every(Boolean);
}

function normalizeFloatState(value) {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return null;
    if (['LOW', 'EMPTY', 'MIN', 'L'].includes(normalized)) return 'LOW';
    if (['FULL', 'HIGH', 'MAX', 'F'].includes(normalized)) return 'FULL';
    if (['NORMAL', 'OK', 'MID', 'MEDIUM', 'N'].includes(normalized)) return 'NORMAL';
    return normalized;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (value <= 0) return 'LOW';
    if (value >= 2) return 'FULL';
    return 'NORMAL';
  }
  if (typeof value === 'boolean') {
    return value ? 'NORMAL' : 'LOW';
  }
  return null;
}

function normalizeFloatNumeric(value) {
  const state = normalizeFloatState(value);
  if (state === 'LOW') return 0;
  if (state === 'FULL') return 2;
  if (state === 'NORMAL') return 1;
  return null;
}

function toNullableNumber(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveTelemetryTimestamp(payload, fallbackNow) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const tsRaw = payload.ts ?? payload.timestamp ?? payload.time;
  if (typeof tsRaw === 'number' && Number.isFinite(tsRaw)) {
    const tsMs = tsRaw > 9999999999 ? tsRaw : tsRaw * 1000;
    const parsed = new Date(tsMs);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (typeof tsRaw === 'string' && tsRaw.trim().length > 0) {
    const numeric = Number(tsRaw);
    if (Number.isFinite(numeric)) {
      const tsMs = numeric > 9999999999 ? numeric : numeric * 1000;
      const parsed = new Date(tsMs);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    const parsed = new Date(tsRaw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function canonicalDeviceId(value) {
  const normalized = (value || '').toString().trim();
  if (!normalized) return null;
  return normalized.toLowerCase();
}

function isTelemetryTopic(topic) {
  if (!topic) {
    return false;
  }
  if (TELEMETRY_TOPICS.has(topic)) {
    return true;
  }
  return /^vermilinks\/[^/]+\/(telemetry|metrics)$/.test(topic);
}

function resolveDeviceIdFromTopic(topic) {
  const normalizedTopic = (topic || '').toString().trim();
  const parts = normalizedTopic.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const candidate = parts[1];
  return canonicalDeviceId(candidate);
}

async function upsertActuatorState(deviceId, state) {
  const existing = await ActuatorState.findOne({ where: { actuatorKey: deviceId } });
  if (existing) {
    await existing.update({ state, reportedAt: new Date() });
    return existing;
  }
  return ActuatorState.create({ actuatorKey: deviceId, state, reportedAt: new Date() });
}

async function handleStateMessage(payload, topic) {
  if (!payload || typeof payload !== 'object') {
    logger.warn('iotMqtt: invalid state payload ignored');
    return;
  }
  const rawDeviceId = payload.deviceId || payload.device_id || resolveDeviceIdFromTopic(topic);
  const deviceId = canonicalDeviceId(rawDeviceId);
  if (!deviceId) {
    logger.warn('iotMqtt: state payload rejected (missing deviceId)');
    return;
  }

  const now = new Date();
  const floatState = normalizeFloatState(
    payload.float
      ?? payload.floatState
      ?? payload.float_state
      ?? payload.water_level
      ?? payload.waterLevel
  ) || 'UNKNOWN';
  const isReservoirLow = floatState === 'LOW';
  const isReservoirFull = floatState === 'FULL';
  const priorRow = await ActuatorState.findOne({ where: { actuatorKey: deviceId } });
  const priorState = priorRow && priorRow.state ? priorRow.state : null;
  const overrideRequested = payload.forcePumpOverride === true || (payload.source || '').toString().toLowerCase() === 'forced_manual_override';
  const requestedPumpState = typeof payload.pump === 'boolean'
    ? payload.pump
    : Boolean(priorState && priorState.pump);
  const enforcedPumpState = (isReservoirLow || isReservoirFull) && !overrideRequested ? false : requestedPumpState;
  const statePayload = {
    pump: enforcedPumpState,
    valve1: typeof payload.valve1 === 'boolean' ? payload.valve1 : Boolean(priorState && priorState.valve1),
    valve2: typeof payload.valve2 === 'boolean' ? payload.valve2 : Boolean(priorState && priorState.valve2),
    valve3: typeof payload.valve3 === 'boolean' ? payload.valve3 : Boolean(priorState && priorState.valve3),
    float: floatState,
    float_state: floatState,
    forcePumpOverride: overrideRequested,
    requestId: payload.requestId || null,
    source: (isReservoirLow || isReservoirFull) && requestedPumpState && !overrideRequested ? 'safety_override' : (payload.source || 'applied'),
    ts: payload.ts ? new Date(payload.ts * 1000).toISOString() : now.toISOString(),
    online: true,
    lastSeen: now.toISOString(),
  };
  const priorPump = priorState ? Boolean(priorState.pump) : null;

  await upsertActuatorState(deviceId, statePayload);
  console.log('MQTT state processed', { topic, deviceId, floatState, pump: statePayload.pump });

  if (priorState) {
    const changes = [
      { key: 'pump', type: 'pump' },
      { key: 'valve1', type: 'solenoid' },
      { key: 'valve2', type: 'solenoid' },
      { key: 'valve3', type: 'solenoid' },
    ];
    const triggeredBy = statePayload.source === 'safety_override' ? 'automatic' : 'manual';
    for (const change of changes) {
      const prev = Boolean(priorState[change.key]);
      const next = Boolean(statePayload[change.key]);
      if (prev === next) {
        continue;
      }
      try {
        await ActuatorLog.create({
          deviceId,
          actuatorType: change.type,
          action: next ? 'on' : 'off',
          reason: statePayload.source || null,
          triggeredBy,
          timestamp: now,
        });
      } catch (logErr) {
        logger.warn('iotMqtt: actuator log write failed', logErr && logErr.message ? logErr.message : logErr);
      }
    }
  }

  if (payload.requestId) {
    const pending = await PendingCommand.findOne({ where: { requestId: payload.requestId, status: ['sent', 'waiting'] } });
    if (pending) {
      const desired = pending.desiredState || {};
      const matches =
        desired.pump === payload.pump &&
        desired.valve1 === payload.valve1 &&
        desired.valve2 === payload.valve2 &&
        desired.valve3 === payload.valve3;
      const normalizedSource = (payload.source || '').toString().toLowerCase();
      const isSafetyOverride = normalizedSource === 'safety_override' || normalizedSource === 'safety';
      const nextStatus = matches || isSafetyOverride ? 'acknowledged' : 'mismatch';
      await pending.update({
        status: nextStatus,
        responseState: {
          pump: payload.pump,
          valve1: payload.valve1,
          valve2: payload.valve2,
          valve3: payload.valve3,
          float: floatState,
          source: payload.source || 'applied',
        },
        error: matches || isSafetyOverride ? null : 'Device state mismatch',
        ackAt: now,
        updatedAt: now,
      });
    }
  }

  emitRealtime('actuator:state', {
    deviceId,
    pump: statePayload.pump,
    valve1: statePayload.valve1,
    valve2: statePayload.valve2,
    valve3: statePayload.valve3,
    float: statePayload.float,
    float_state: statePayload.float_state,
    forcePumpOverride: statePayload.forcePumpOverride,
    requestId: statePayload.requestId,
    source: statePayload.source,
    ts: statePayload.ts,
  });

  const actuatorUpdates = [
    { key: 'pump', name: 'Pump', status: statePayload.pump },
    { key: 'valve1', name: 'Valve 1', status: statePayload.valve1 },
    { key: 'valve2', name: 'Valve 2', status: statePayload.valve2 },
    { key: 'valve3', name: 'Valve 3', status: statePayload.valve3 },
  ];

  actuatorUpdates.forEach((item) => {
    emitRealtime(REALTIME_EVENTS.ACTUATOR_UPDATE, {
      key: item.key,
      name: item.name,
      status: item.status,
      mode: 'manual',
      updatedAt: now.toISOString(),
      deviceAck: true,
      deviceAckMessage: null,
    });
  });

  const floatIsLow = floatState === 'LOW';
  const floatNumeric = floatState === 'LOW' ? 0 : (floatState === 'FULL' ? 2 : 1);
  await checkThresholds({
    deviceId,
    floatSensor: floatNumeric,
    waterLevel: floatNumeric,
    pump: statePayload.pump,
    timestamp: now,
  });

  if (isReservoirLow) {
    try {
      const reservoirAlert = await alertService.createWaterReservoirLowAlert(deviceId, {
        floatSensor: floatNumeric,
        pump: false,
        floatState,
      });
      emitRealtime(REALTIME_EVENTS.ALERT_NEW, reservoirAlert);
    } catch (alertErr) {
      logger.warn('iotMqtt: water_reservoir_low alert create failed', alertErr && alertErr.message ? alertErr.message : alertErr);
    }
  }

  if (floatIsLow && priorPump) {
    try {
      const alert = await Alert.createAlert({
        type: 'pump_emergency_shutdown',
        severity: 'critical',
        message: 'Pump shut down due to low float sensor.',
        deviceId,
        sensorData: { floatSensor: floatNumeric, pump: false },
      });
      emitRealtime(REALTIME_EVENTS.ALERT_NEW, alert);
    } catch (alertErr) {
      logger.warn('iotMqtt: emergency alert create failed', alertErr && alertErr.message ? alertErr.message : alertErr);
    }
  }

  await markDeviceOnline(deviceId, { via: 'mqtt', lastStateAt: now.toISOString() });
}

async function handleAckMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
  if (!requestId) {
    logger.warn('iotMqtt: ack payload ignored (missing requestId)');
    return;
  }

  const now = new Date();
  const acknowledged = payload.ack !== false && payload.success !== false;
  const status = acknowledged ? 'acknowledged' : 'failed';
  const errorMessage = acknowledged ? null : (payload.error || payload.message || 'Device reported command failure');

  await PendingCommand.update(
    {
      status,
      error: errorMessage,
      responseState: payload,
      ackAt: now,
      updatedAt: now,
    },
    {
      where: {
        requestId,
        status: ['sent', 'waiting'],
      },
    },
  );

  const ackPayloadDeviceId = payload.deviceId || payload.device_id;
  const ackDeviceId = (typeof ackPayloadDeviceId === 'string' && ackPayloadDeviceId.trim())
    ? ackPayloadDeviceId.trim()
    : 'esp32a';

  emitRealtime(REALTIME_EVENTS.ACTUATOR_UPDATE, {
    key: 'device-command',
    name: 'Device Command',
    status: acknowledged,
    mode: 'manual',
    updatedAt: now.toISOString(),
    deviceAck: acknowledged,
    deviceAckMessage: errorMessage,
    requestId,
    deviceId: ackDeviceId,
  });
}

async function handleStatusMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const rawDeviceId = payload.deviceId || payload.device_id;
  if (typeof rawDeviceId !== 'string' || rawDeviceId.trim().length === 0) {
    return;
  }
  const deviceId = rawDeviceId.trim();

  const now = new Date();
  if (payload.online !== false) {
    await markDeviceOnline(deviceId, { via: 'mqtt', lastStatusAt: now.toISOString() });
  }

  emitRealtime(REALTIME_EVENTS.DEVICE_STATUS, {
    deviceId,
    online: payload.online !== false,
    status: payload.online !== false ? 'online' : 'offline',
    lastHeartbeat: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

async function upsertDeviceStatusSnapshot(deviceId, online) {
  if (!deviceId) {
    return null;
  }
  const now = new Date();
  const [device, created] = await Device.findOrCreate({
    where: { deviceId },
    defaults: {
      deviceId,
      status: online ? 'online' : 'offline',
      online,
      lastHeartbeat: online ? now : null,
      lastSeen: online ? now : null,
      updatedAt: now,
    },
  });

  if (created) {
    return device;
  }

  const updatePayload = {
    status: online ? 'online' : 'offline',
    online,
    updatedAt: now,
  };
  if (online) {
    updatePayload.lastHeartbeat = now;
    updatePayload.lastSeen = now;
  }

  await device.update(updatePayload);
  return device;
}

async function handleLwtStatusMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const deviceId = payload.deviceId;
  const online = payload.online === true;
  const now = new Date();

  const device = await upsertDeviceStatusSnapshot(deviceId, online);
  const lastHeartbeat = device && device.lastHeartbeat ? new Date(device.lastHeartbeat).toISOString() : null;

  emitRealtime(REALTIME_EVENTS.DEVICE_STATUS, {
    deviceId,
    online,
    status: online ? 'online' : 'offline',
    lastHeartbeat,
    updatedAt: now.toISOString(),
  });

  emitRealtime('device_status_update', {
    deviceId,
    online,
  });
}

async function handleTelemetryMessage(payload, topic) {
  const telemetry = buildTelemetryRecord(payload, topic);
  if (!telemetry) {
    logger.warn('iotMqtt: telemetry payload rejected (invalid payload/deviceId)');
    return;
  }

  const { deviceId, timestamp } = telemetry;
  console.log('MQTT telemetry accepted', { topic, deviceId, timestamp: timestamp.toISOString() });

  await SensorData.create(telemetry);
  console.log('SensorData row inserted', { deviceId, timestamp: timestamp.toISOString() });
  const existingSnapshot = await SensorSnapshot.findByPk(deviceId, { raw: true }).catch(() => null);
  await SensorSnapshot.upsert({
    deviceId,
    temperature: telemetry.temperature ?? existingSnapshot?.temperature ?? null,
    humidity: telemetry.humidity ?? existingSnapshot?.humidity ?? null,
    moisture: telemetry.moisture ?? existingSnapshot?.moisture ?? null,
    soilTemperature: telemetry.soilTemperature ?? existingSnapshot?.soilTemperature ?? null,
    waterLevel: telemetry.waterLevel ?? existingSnapshot?.waterLevel ?? null,
    floatSensor: telemetry.floatSensor ?? existingSnapshot?.floatSensor ?? null,
    signalStrength: telemetry.signalStrength ?? existingSnapshot?.signalStrength ?? null,
    timestamp,
  });
  console.log('Snapshot updated', { deviceId, timestamp: timestamp.toISOString() });

  await markDeviceOnline(deviceId, { via: 'mqtt', lastTelemetryAt: timestamp.toISOString() });

  const io = global.io;
  await checkThresholds(telemetry, io);
  broadcastSensorData(telemetry, io);

  await sensorLogService.recordSensorLogs({
    deviceId,
    metrics: {
      temperature: telemetry.temperature,
      humidity: telemetry.humidity,
      moisture: telemetry.moisture,
      soilTemperature: telemetry.soilTemperature,
      waterLevel: telemetry.waterLevel,
      floatSensor: telemetry.floatSensor,
      signalStrength: telemetry.signalStrength,
    },
    origin: 'mqtt',
    recordedAt: timestamp,
    rawPayload: payload,
    mqttTopic: (topic || TOPICS.telemetry),
  });
}

function buildTelemetryRecord(payload, topic) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const deviceIdFromTopic = resolveDeviceIdFromTopic(topic);
  const normalizedPayload = {
    ...payload,
    device_id: payload.device_id ?? payload.deviceId ?? deviceIdFromTopic,
    timestamp: payload.timestamp ?? payload.ts ?? payload.time,
    soil_moisture: payload.soil_moisture ?? payload.soilMoisture ?? payload.moisture ?? payload.soil,
    soil_temperature: payload.soil_temperature ?? payload.soilTemp ?? payload.soilTemperature ?? payload.waterTempC,
  };

  const resolvedDeviceId = canonicalDeviceId(normalizedPayload.device_id);
  if (!resolvedDeviceId) {
    return null;
  }

  const timestamp = resolveTelemetryTimestamp(normalizedPayload, new Date());
  if (!timestamp) {
    return null;
  }
  const normalizedFloat = normalizeFloatNumeric(
    normalizedPayload.float_state
      ?? normalizedPayload.floatSensor
      ?? normalizedPayload.floatState
      ?? normalizedPayload.float
      ?? normalizedPayload.water_level
      ?? normalizedPayload.waterLevel
  );
  const rawWaterLevel = normalizedPayload.water_level ?? normalizedPayload.waterLevel;
  const rawFloatState = normalizedPayload.float_state ?? normalizedPayload.floatSensor ?? normalizedPayload.floatState;
  const parsedWaterLevel = toNullableNumber(rawWaterLevel);
  const parsedFloatSensor = toNullableNumber(rawFloatState);
  const reading = {
    deviceId: resolvedDeviceId,
    temperature: toNullableNumber(normalizedPayload.temperature ?? normalizedPayload.tempC ?? normalizedPayload.temp),
    humidity: toNullableNumber(normalizedPayload.humidity),
    moisture: toNullableNumber(normalizedPayload.soil_moisture),
    soilTemperature: toNullableNumber(normalizedPayload.soil_temperature),
    waterLevel: parsedWaterLevel ?? parsedFloatSensor ?? normalizedFloat,
    floatSensor: parsedFloatSensor ?? parsedWaterLevel ?? normalizedFloat,
    signalStrength: toNullableNumber(normalizedPayload.signalStrength ?? normalizedPayload.rssi),
    timestamp,
    source: 'mqtt',
    rawPayload: payload,
  };

  const hasRequiredCoreFields = [
    reading.temperature,
    reading.humidity,
    reading.moisture,
    reading.soilTemperature,
    reading.waterLevel,
    reading.floatSensor,
  ].every((value) => value !== null && typeof value !== 'undefined');

  if (!hasRequiredCoreFields) {
    return null;
  }

  const hasSignal = [
    reading.temperature,
    reading.humidity,
    reading.moisture,
    reading.soilTemperature,
    reading.waterLevel,
    reading.floatSensor,
  ].some((value) => value !== null && typeof value !== 'undefined');

  if (!hasSignal) {
    return null;
  }

  return reading;
}

function startIotMqtt() {
  const mqttHost = MQTT_HOST || (BROKER ? undefined : '5d106b9834c64a1099a6a01ccba8c6c4.s1.eu.hivemq.cloud');
  const mqttPort = Number.isFinite(MQTT_PORT) && MQTT_PORT > 0 ? MQTT_PORT : 8883;
  const mqttProtocol = MQTT_PROTOCOL || 'mqtts';
  if (!BROKER && !mqttHost) {
    logger.info('iotMqtt: broker not configured; skipping MQTT startup');
    return null;
  }

  const configuredClientId = (process.env.MQTT_CLIENT_ID || '').toString().trim();
  const iotClientId = configuredClientId
    ? `${configuredClientId}-iot`
    : `vermilinks-iot-${Math.random().toString(16).slice(2, 8)}`;
  const mqttUsername = (process.env.MQTT_USERNAME || '').toString().trim();
  const mqttPassword = (process.env.MQTT_PASSWORD || '').toString().trim();
  const reconnectPeriod = parseInt(process.env.MQTT_RECONNECT_PERIOD_MS || '5000', 10);
  const keepalive = parseInt(process.env.MQTT_KEEPALIVE_SEC || '60', 10);
  const connectTimeout = parseInt(process.env.MQTT_CONNECT_TIMEOUT_MS || '30000', 10);

  const subscriptionTopics = [
    ...STATE_TOPICS,
    ...ACK_TOPICS,
    ...STATUS_TOPICS,
    ...TELEMETRY_TOPICS,
    TELEMETRY_WILDCARD_TOPIC,
    METRICS_WILDCARD_TOPIC,
    STATE_WILDCARD_TOPIC,
    STATUS_WILDCARD_TOPIC,
    COMMANDS_WILDCARD_TOPIC,
    `${TOPICS.deviceStatusPrefix}#`,
  ];

  const connectionOptions = {
    clientId: iotClientId,
    host: mqttHost,
    port: mqttPort,
    protocol: mqttProtocol,
    username: mqttUsername || undefined,
    password: mqttPassword || undefined,
    reconnectPeriod: Number.isFinite(reconnectPeriod) && reconnectPeriod > 0 ? reconnectPeriod : 5000,
    keepalive: Number.isFinite(keepalive) && keepalive > 0 ? keepalive : 60,
    clean: true,
    connectTimeout: Number.isFinite(connectTimeout) && connectTimeout > 0 ? connectTimeout : 30000,
    resubscribe: false,
    rejectUnauthorized: false,
  };

  const connectArgs = BROKER
    ? [BROKER, connectionOptions]
    : [connectionOptions];
  client = mqtt.connect(...connectArgs);

  client.on('connect', () => {
    lastConnectionState = 'connected';
    logger.info('iotMqtt connected', { broker: BROKER || `${mqttProtocol}://${mqttHost}:${mqttPort}` });
    console.log(`MQTT connected ${mqttProtocol}://${mqttHost}:${mqttPort}`);
    client.subscribe(subscriptionTopics, { qos: 0 }, (err) => {
      if (err) {
        logger.warn('iotMqtt subscribe failed', err && err.message ? err.message : err);
      } else {
        logger.info('iotMqtt subscriptions active', { topics: subscriptionTopics });
        console.log('MQTT subscribed', subscriptionTopics);
      }
    });
  });

  client.on('message', (topic, message) => {
    console.log('MQTT message received', topic);
    const lwtPayload = parseLwtPayload(topic, message);
    if (lwtPayload) {
      handleLwtStatusMessage(lwtPayload).catch((error) => {
        logger.warn('iotMqtt LWT handler failed', error && error.message ? error.message : error);
      });
      return;
    }

    const payload = safeJsonParse(message);
    if (!payload) {
      return;
    }

    const normalizedTopic = (topic || '').toString().trim().toLowerCase();

    if (isStateTopic(normalizedTopic)) {
      handleStateMessage(payload, topic).catch((error) => {
        logger.warn('iotMqtt state handler failed', error && error.message ? error.message : error);
      });
      return;
    }

    if (isAckTopic(normalizedTopic)) {
      handleAckMessage(payload).catch((error) => {
        logger.warn('iotMqtt ack handler failed', error && error.message ? error.message : error);
      });
      return;
    }

    if (isStatusTopic(normalizedTopic)) {
      handleStatusMessage(payload).catch((error) => {
        logger.warn('iotMqtt status handler failed', error && error.message ? error.message : error);
      });
      return;
    }

    if (isCommandsTopic(normalizedTopic)) {
      // Commands topics are subscribed for fleet compatibility/observability.
      logger.info('iotMqtt command topic observed', { topic: normalizedTopic });
      return;
    }

    if (isTelemetryTopic(normalizedTopic)) {
      handleTelemetryMessage(payload, normalizedTopic).catch((error) => {
        logger.warn('iotMqtt telemetry handler failed', error && error.message ? error.message : error);
      });
      return;
    }
  });

  client.on('reconnect', () => {
    lastConnectionState = 'reconnecting';
    logger.info('iotMqtt reconnected attempt in progress');
  });

  client.on('offline', () => {
    lastConnectionState = 'offline';
    logger.warn('iotMqtt offline');
  });

  client.on('error', (error) => {
    lastConnectionState = 'error';
    logger.warn('iotMqtt error', error && error.message ? error.message : error);
  });

  client.on('close', () => {
    lastConnectionState = 'disconnected';
    logger.info('iotMqtt connection closed');
  });

  return client;
}

function publishCommand(commandPayload) {
  if (!client) {
    throw new Error('MQTT client not initialized');
  }
  const message = JSON.stringify(commandPayload);
  client.publish(TOPICS.command, message, { qos: 1, retain: false });
}

function getConnectionStatus() {
  return {
    broker: BROKER || (MQTT_HOST ? `${MQTT_PROTOCOL}://${MQTT_HOST}:${MQTT_PORT}` : null),
    connected: Boolean(client && client.connected),
    state: Boolean(client && client.connected) ? 'connected' : lastConnectionState,
  };
}

module.exports = {
  startIotMqtt,
  publishCommand,
  getConnectionStatus,
  __testHooks: {
    buildTelemetryRecord,
    handleTelemetryMessage,
    parseLwtPayload,
  },
};
