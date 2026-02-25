const SENSOR_FIELD_CONFIG = [
  { key: 'temperature', label: 'Temperature', unit: '°C' },
  { key: 'humidity', label: 'Humidity', unit: '%' },
  { key: 'moisture', label: 'Soil Moisture', unit: '%' },
  { key: 'soilTemperature', label: 'Soil Temperature', unit: '°C' },
  { key: 'ph', label: 'pH', unit: '' },
  { key: 'ec', label: 'EC', unit: 'mS/cm' },
  { key: 'nitrogen', label: 'Nitrogen', unit: 'mg/kg' },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg/kg' },
  { key: 'potassium', label: 'Potassium', unit: 'mg/kg' },
  { key: 'waterLevel', label: 'Water Level', unit: '' },
  { key: 'floatSensor', label: 'Float Sensor', unit: '' },
  { key: 'batteryLevel', label: 'Battery Level', unit: '%' },
  { key: 'signalStrength', label: 'Signal Strength', unit: 'dBm' },
];

const toPlainObject = (record) => {
  if (!record) return null;
  if (typeof record.get === 'function') {
    return record.get({ plain: true });
  }
  if (typeof record.toJSON === 'function') {
    return record.toJSON();
  }
  if (typeof record.toObject === 'function') {
    return record.toObject();
  }
  if (typeof record === 'object') {
    return { ...record };
  }
  return null;
};

const ensureIsoString = (value) => {
  if (!value) {
    return new Date().toISOString();
  }
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString();
    }
    return date.toISOString();
  } catch (error) {
    return new Date().toISOString();
  }
};

const sanitizeSensorPayload = (sensor, alerts = []) => {
  const plainSensor = toPlainObject(sensor) || {};
  const sanitized = {
    ...plainSensor,
    timestamp: ensureIsoString(plainSensor.timestamp),
  };

  if (sanitized.rawPayload) {
    delete sanitized.rawPayload;
  }

  if (!sanitized._id && (sanitized.id || sanitized.ID)) {
    sanitized._id = String(sanitized.id || sanitized.ID);
  }

  const cleanAlerts = Array.isArray(alerts) ? alerts.map(sanitizeAlertPayload) : [];
  if (cleanAlerts.length > 0) {
    sanitized.alerts = cleanAlerts;
  } else {
    delete sanitized.alerts;
  }

  return sanitized;
};

const sanitizeAlertPayload = (alert) => {
  const plainAlert = toPlainObject(alert) || {};
  const sanitized = {
    ...plainAlert,
    createdAt: ensureIsoString(plainAlert.createdAt),
    resolvedAt: plainAlert.resolvedAt ? ensureIsoString(plainAlert.resolvedAt) : null,
    acknowledgedAt: plainAlert.acknowledgedAt ? ensureIsoString(plainAlert.acknowledgedAt) : null,
  };
  if (!sanitized._id && (sanitized.id || sanitized.ID)) {
    sanitized._id = String(sanitized.id || sanitized.ID);
  }
  if (plainAlert.sensorData) {
    sanitized.sensorData = sanitizeSensorPayload(plainAlert.sensorData, []);
  }
  return sanitized;
};

const normalizeNumeric = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildSensorSummary = (sensorRecord) => {
  const sanitized = sanitizeSensorPayload(sensorRecord, []);
  const timestamp = ensureIsoString(sanitized.timestamp);
  const summary = [];

  SENSOR_FIELD_CONFIG.forEach((field) => {
    const rawValue = sanitized[field.key];
    const value = normalizeNumeric(rawValue);
    if (value === null) {
      return;
    }
    summary.push({
      key: field.key,
      label: field.label,
      unit: field.unit,
      value,
      timestamp,
    });
  });

  const nitrogen = normalizeNumeric(sanitized.nitrogen);
  const phosphorus = normalizeNumeric(sanitized.phosphorus);
  const potassium = normalizeNumeric(sanitized.potassium);
  const hasNpk = nitrogen !== null || phosphorus !== null || potassium !== null;
  if (hasNpk) {
    summary.push({
      key: 'npk',
      label: 'NPK',
      unit: 'mg/kg',
      value: {
        nitrogen,
        phosphorus,
        potassium,
      },
      timestamp,
    });
  }

  return summary;
};

module.exports = {
  SENSOR_FIELD_CONFIG,
  toPlainObject,
  ensureIsoString,
  sanitizeSensorPayload,
  sanitizeAlertPayload,
  buildSensorSummary,
};
