const { Alert, Threshold } = require('../models_mongo');
const { REALTIME_EVENTS, emitRealtime } = require('../utils/realtime');

const DEFAULT_THRESHOLDS = {
  temperatureLow: 18,
  temperatureCriticalLow: 15,
  temperatureHigh: 32,
  temperatureCriticalHigh: 35,
  humidityLow: 45,
  humidityHigh: 75,
};

const thresholdCache = {
  value: DEFAULT_THRESHOLDS,
  loadedAt: 0,
};

async function loadThresholds() {
  const now = Date.now();
  if (now - thresholdCache.loadedAt < 30000) {
    return thresholdCache.value;
  }

  const stored = await Threshold.findOne({ key: 'default' }).lean();
  thresholdCache.loadedAt = now;
  thresholdCache.value = stored ? {
    temperatureLow: stored.temperatureLow,
    temperatureCriticalLow: stored.temperatureCriticalLow,
    temperatureHigh: stored.temperatureHigh,
    temperatureCriticalHigh: stored.temperatureCriticalHigh,
    humidityLow: stored.humidityLow,
    humidityHigh: stored.humidityHigh,
  } : DEFAULT_THRESHOLDS;

  return thresholdCache.value;
}

function buildSignature({ type, level, deviceId }) {
  return [type, level, deviceId || 'unknown'].join('::');
}

async function ensureAlertActive({ type, level, message, deviceId }) {
  const signature = buildSignature({ type, level, deviceId });
  const now = new Date();

  const existing = await Alert.findOne({ signature, active: true });
  if (existing) {
    existing.lastSeen = now;
    await existing.save();
    return existing;
  }

  const alert = await Alert.create({
    deviceId: deviceId || null,
    type,
    level,
    message,
    signature,
    active: true,
    acknowledged: false,
    lastSeen: now,
  });

  emitRealtime(REALTIME_EVENTS.ALERT_NEW, alert);
  return alert;
}

async function clearAlert({ type, deviceId }) {
  const activeAlerts = await Alert.find({ type, deviceId: deviceId || null, active: true });
  if (!activeAlerts.length) {
    return 0;
  }

  const now = new Date();
  await Alert.updateMany(
    { type, deviceId: deviceId || null, active: true },
    { $set: { active: false, clearedAt: now } }
  );

  activeAlerts.forEach((alert) => {
    emitRealtime(REALTIME_EVENTS.ALERT_CLEARED, {
      id: alert._id,
      type: alert.type,
      level: alert.level,
      deviceId: alert.deviceId,
      clearedAt: now.toISOString(),
    });
  });

  return activeAlerts.length;
}

async function evaluateTelemetry({ deviceId, tempC, humidity }) {
  const thresholds = await loadThresholds();
  if (typeof tempC === 'number' && Number.isFinite(tempC)) {
    if (tempC < thresholds.temperatureCriticalLow) {
      await ensureAlertActive({
        type: 'temperature_low',
        level: 'CRITICAL',
        message: `Temperature critical low: ${tempC.toFixed(1)}C`,
        deviceId,
      });
      await clearAlert({ type: 'temperature_high', deviceId });
    } else if (tempC < thresholds.temperatureLow) {
      await ensureAlertActive({
        type: 'temperature_low',
        level: 'LOW',
        message: `Temperature low: ${tempC.toFixed(1)}C`,
        deviceId,
      });
      await clearAlert({ type: 'temperature_high', deviceId });
    } else if (tempC >= thresholds.temperatureCriticalHigh) {
      await ensureAlertActive({
        type: 'temperature_high',
        level: 'CRITICAL',
        message: `Temperature critical high: ${tempC.toFixed(1)}C`,
        deviceId,
      });
      await clearAlert({ type: 'temperature_low', deviceId });
    } else if (tempC >= thresholds.temperatureHigh) {
      await ensureAlertActive({
        type: 'temperature_high',
        level: 'HIGH',
        message: `Temperature high: ${tempC.toFixed(1)}C`,
        deviceId,
      });
      await clearAlert({ type: 'temperature_low', deviceId });
    } else {
      await clearAlert({ type: 'temperature_low', deviceId });
      await clearAlert({ type: 'temperature_high', deviceId });
    }
  }

  if (typeof humidity === 'number' && Number.isFinite(humidity)) {
    if (humidity < thresholds.humidityLow) {
      await ensureAlertActive({
        type: 'humidity_low',
        level: 'LOW',
        message: `Humidity low: ${humidity.toFixed(1)}%`,
        deviceId,
      });
      await clearAlert({ type: 'humidity_high', deviceId });
    } else if (humidity >= thresholds.humidityHigh) {
      await ensureAlertActive({
        type: 'humidity_high',
        level: 'HIGH',
        message: `Humidity high: ${humidity.toFixed(1)}%`,
        deviceId,
      });
      await clearAlert({ type: 'humidity_low', deviceId });
    } else {
      await clearAlert({ type: 'humidity_low', deviceId });
      await clearAlert({ type: 'humidity_high', deviceId });
    }
  }
}

async function handleFloatLow({ deviceId }) {
  await ensureAlertActive({
    type: 'float_low',
    level: 'CRITICAL',
    message: 'Water tank needs refill',
    deviceId,
  });
}

async function handleFloatNormal({ deviceId }) {
  await clearAlert({ type: 'float_low', deviceId });
}

module.exports = {
  evaluateTelemetry,
  handleFloatLow,
  handleFloatNormal,
};
