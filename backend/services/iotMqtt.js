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
  statusA: 'vermilinks/esp32a/status',
  command: 'vermilinks/esp32a/command',
  telemetry: 'vermilinks/esp32b/telemetry',
  statusB: 'vermilinks/esp32b/status',
  deviceStatusA: 'vermilinks/device_status/esp32a',
  deviceStatusB: 'vermilinks/device_status/esp32b',
};

let client = null;

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
  if (topic !== TOPICS.deviceStatusA && topic !== TOPICS.deviceStatusB) {
    return null;
  }
  const raw = Buffer.isBuffer(message) ? message.toString('utf8') : String(message || '');
  const normalized = raw.trim().toLowerCase();
  if (normalized !== 'online' && normalized !== 'offline') {
    return null;
  }
  return {
    deviceId: topic === TOPICS.deviceStatusA ? 'esp32a' : 'esp32b',
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
    return normalized;
  }
  if (typeof value === 'number') {
    return value <= 0 ? 'LOW' : 'HIGH';
  }
  if (typeof value === 'boolean') {
    return value ? 'HIGH' : 'LOW';
  }
  return null;
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

  const now = new Date();
  const deviceId = 'esp32a';
  const floatState = normalizeFloatState(payload.float) || 'UNKNOWN';
  const statePayload = {
    pump: payload.pump,
    valve1: payload.valve1,
    valve2: payload.valve2,
    valve3: payload.valve3,
    float: floatState,
    requestId: payload.requestId || null,
    source: payload.source || 'applied',
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
  const floatNumeric = floatIsLow ? 0 : 1;
  await checkThresholds({
    deviceId,
    floatSensor: floatNumeric,
    pump: statePayload.pump,
    timestamp: now,
  });

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

async function handleStatusMessage(payload, deviceId) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

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
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const now = new Date();
  const deviceId = 'esp32b';
  const timestamp = payload.ts ? new Date(payload.ts * 1000) : now;
  const telemetry = {
    deviceId,
    temperature: payload.tempC ?? null,
    humidity: payload.humidity ?? null,
    moisture: payload.soil ?? null,
    soilTemperature: payload.waterTempC ?? null,
    timestamp,
    source: 'mqtt',
    rawPayload: payload,
  };

  await SensorData.create(telemetry);
  await SensorSnapshot.upsert({
    deviceId,
    temperature: telemetry.temperature,
    humidity: telemetry.humidity,
    moisture: telemetry.moisture,
    soilTemperature: telemetry.soilTemperature,
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
    },
    origin: 'mqtt',
    recordedAt: timestamp,
    rawPayload: payload,
    mqttTopic: TOPICS.telemetry,
  });
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
    logger.info('iotMqtt connected', { broker: BROKER });
    client.subscribe([
      TOPICS.state,
      TOPICS.statusA,
      TOPICS.telemetry,
      TOPICS.statusB,
      TOPICS.deviceStatusA,
      TOPICS.deviceStatusB,
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

    if (topic === TOPICS.statusA) {
      handleStatusMessage(payload, 'esp32a').catch((error) => {
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
      handleStatusMessage(payload, 'esp32b').catch((error) => {
        logger.warn('iotMqtt status handler failed', error && error.message ? error.message : error);
      });
    }
  });

  client.on('error', (error) => {
    logger.warn('iotMqtt error', error && error.message ? error.message : error);
  });

  client.on('close', () => {
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

module.exports = {
  startIotMqtt,
  publishCommand,
};
