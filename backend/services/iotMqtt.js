const mqtt = require('mqtt');
const logger = require('../utils/logger');
const { SensorData, SensorSnapshot, ActuatorState, PendingCommand, Alert, ActuatorLog } = require('../models');
const Device = require('../models/Device');
const { REALTIME_EVENTS, emitRealtime } = require('../utils/realtime');
const { broadcastSensorData, checkThresholds } = require('../utils/sensorEvents');
const sensorLogService = require('./sensorLogService');
const { markDeviceOnline } = require('./deviceManager');

const BROKER = process.env.MQTT_BROKER_URL || process.env.MQTT_URL || process.env.MQTT_BROKER;
const TOPICS = {
  state: 'vermilinks/esp32a/state',
  ack: 'vermilinks/esp32a/ack',
  statusA: 'vermilinks/esp32a/status',
  command: 'vermilinks/esp32a/command',
  telemetry: 'vermilinks/esp32b/metrics',
  statusB: 'vermilinks/esp32b/status',
  deviceStatusPrefix: 'vermilinks/device_status/',
};

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

async function createReservoirLowAlert(deviceId, sensorData) {
  const where = { type: 'water_reservoir_low', deviceId: deviceId || null, isResolved: false };
  const recent = await Alert.findOne({ where, order: [['createdAt', 'DESC']] }).catch(() => null);
  if (recent && recent.createdAt) {
    const createdAt = new Date(recent.createdAt).getTime();
    if (Number.isFinite(createdAt) && (Date.now() - createdAt) < 5 * 60 * 1000) {
      return recent;
    }
  }
  return Alert.createAlert({
    type: 'water_reservoir_low',
    severity: 'high',
    message: 'Layer 4 water reservoir is low. Please refill the reservoir manually.',
    deviceId: deviceId || null,
    sensorData: sensorData || null,
    status: 'new',
    createdAt: new Date(),
  });
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
    return fallbackNow;
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

  return fallbackNow;
}

async function upsertActuatorState(deviceId, state) {
  const existing = await ActuatorState.findOne({ where: { actuatorKey: deviceId } });
  if (existing) {
    await existing.update({ state, reportedAt: new Date() });
    return existing;
  }
  return ActuatorState.create({ actuatorKey: deviceId, state, reportedAt: new Date() });
}

async function handleStateMessage(payload) {
  if (!isStatePayload(payload)) {
    logger.warn('iotMqtt: invalid state payload ignored');
    return;
  }
  const rawDeviceId = payload.deviceId || payload.device_id;
  if (typeof rawDeviceId !== 'string' || rawDeviceId.trim().length === 0) {
    logger.warn('iotMqtt: state payload rejected (missing deviceId)');
    return;
  }

  const now = new Date();
  const deviceId = rawDeviceId.trim();
  const floatState = normalizeFloatState(payload.float) || 'UNKNOWN';
  const isReservoirLow = floatState === 'LOW';
  const isReservoirFull = floatState === 'FULL';
  const requestedPumpState = Boolean(payload.pump);
  const enforcedPumpState = (isReservoirLow || isReservoirFull) ? false : requestedPumpState;
  const statePayload = {
    pump: enforcedPumpState,
    valve1: payload.valve1,
    valve2: payload.valve2,
    valve3: payload.valve3,
    float: floatState,
    requestId: payload.requestId || null,
    source: (isReservoirLow || isReservoirFull) && requestedPumpState ? 'safety_override' : (payload.source || 'applied'),
    ts: payload.ts ? new Date(payload.ts * 1000).toISOString() : now.toISOString(),
    online: true,
    lastSeen: now.toISOString(),
  };

  const priorRow = await ActuatorState.findOne({ where: { actuatorKey: deviceId } });
  const priorState = priorRow && priorRow.state ? priorRow.state : null;
  const priorPump = priorState ? Boolean(priorState.pump) : null;

  await upsertActuatorState(deviceId, statePayload);

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
      const reservoirAlert = await createReservoirLowAlert(deviceId, {
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

async function handleTelemetryMessage(payload) {
  const telemetry = buildTelemetryRecord(payload);
  if (!telemetry) {
    logger.warn('iotMqtt: telemetry payload rejected (invalid payload/deviceId)');
    return;
  }

  const { deviceId, timestamp } = telemetry;

  await SensorData.create(telemetry);
  await SensorSnapshot.upsert({
    deviceId,
    temperature: telemetry.temperature,
    humidity: telemetry.humidity,
    moisture: telemetry.moisture,
    soilTemperature: telemetry.soilTemperature,
    waterLevel: telemetry.waterLevel,
    floatSensor: telemetry.floatSensor,
    signalStrength: telemetry.signalStrength,
    timestamp,
  });

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
    mqttTopic: TOPICS.telemetry,
  });
}

function buildTelemetryRecord(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const normalizedPayload = {
    ...payload,
    device_id: payload.device_id ?? payload.deviceId,
    timestamp: payload.timestamp ?? payload.ts ?? payload.time,
    soil_moisture: payload.soil_moisture ?? payload.soilMoisture ?? payload.moisture ?? payload.soil,
    soil_temperature: payload.soil_temperature ?? payload.soilTemp ?? payload.soilTemperature ?? payload.waterTempC,
  };

  const rawDeviceId = normalizedPayload.device_id;
  if (typeof rawDeviceId !== 'string' || rawDeviceId.trim().length === 0) {
    return null;
  }

  const now = new Date();
  const timestamp = resolveTelemetryTimestamp(normalizedPayload, now);
  return {
    deviceId: rawDeviceId.trim(),
    temperature: toNullableNumber(normalizedPayload.temperature ?? normalizedPayload.tempC ?? normalizedPayload.temp),
    humidity: toNullableNumber(normalizedPayload.humidity),
    moisture: toNullableNumber(normalizedPayload.soil_moisture),
    soilTemperature: toNullableNumber(normalizedPayload.soil_temperature),
    waterLevel: toNullableNumber(normalizedPayload.water_level ?? normalizedPayload.waterLevel ?? normalizedPayload.float_state ?? normalizedPayload.floatSensor),
    floatSensor: toNullableNumber(normalizedPayload.float_state ?? normalizedPayload.floatSensor ?? normalizedPayload.float),
    signalStrength: toNullableNumber(normalizedPayload.signalStrength ?? normalizedPayload.rssi),
    timestamp,
    source: 'mqtt',
    rawPayload: payload,
  };
}

function startIotMqtt() {
  if (!BROKER) {
    logger.info('iotMqtt: broker not configured; skipping MQTT startup');
    return null;
  }

  const configuredClientId = (process.env.MQTT_CLIENT_ID || '').toString().trim();
  const iotClientId = configuredClientId
    ? `${configuredClientId}-iot`
    : `vermilinks-iot-${Math.random().toString(16).slice(2, 8)}`;
  const mqttUsername = (process.env.MQTT_USERNAME || '').toString().trim();
  const mqttPassword = (process.env.MQTT_PASSWORD || '').toString().trim();

  client = mqtt.connect(BROKER, {
    clientId: iotClientId,
    username: mqttUsername || undefined,
    password: mqttPassword || undefined,
  });

  client.on('connect', () => {
    lastConnectionState = 'connected';
    logger.info('iotMqtt connected', { broker: BROKER });
    client.subscribe([
      TOPICS.state,
      TOPICS.ack,
      TOPICS.statusA,
      TOPICS.telemetry,
      TOPICS.statusB,
      `${TOPICS.deviceStatusPrefix}#`,
    ], { qos: 0 }, (err) => {
      if (err) {
        logger.warn('iotMqtt subscribe failed', err && err.message ? err.message : err);
      }
    });
  });

  client.on('message', (topic, message) => {
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

    if (topic === TOPICS.state) {
      handleStateMessage(payload).catch((error) => {
        logger.warn('iotMqtt state handler failed', error && error.message ? error.message : error);
      });
      return;
    }

    if (topic === TOPICS.ack) {
      handleAckMessage(payload).catch((error) => {
        logger.warn('iotMqtt ack handler failed', error && error.message ? error.message : error);
      });
      return;
    }

    if (topic === TOPICS.statusA) {
      handleStatusMessage(payload).catch((error) => {
        logger.warn('iotMqtt status handler failed', error && error.message ? error.message : error);
      });
      return;
    }

    if (topic === TOPICS.telemetry) {
      handleTelemetryMessage(payload).catch((error) => {
        logger.warn('iotMqtt telemetry handler failed', error && error.message ? error.message : error);
      });
      return;
    }

    if (topic === TOPICS.statusB) {
      handleStatusMessage(payload).catch((error) => {
        logger.warn('iotMqtt status handler failed', error && error.message ? error.message : error);
      });
    }
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
    broker: BROKER || null,
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
