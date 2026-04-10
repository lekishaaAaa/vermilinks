const Alert = require('../models/Alert');
const Settings = require('../models/Settings');
const { sendEmail } = require('../services/emailService');
const logger = require('./logger');
const {
  toPlainObject,
  ensureIsoString,
  sanitizeSensorPayload,
  sanitizeAlertPayload,
  buildSensorSummary,
} = require('./sensorFormatting');
const { REALTIME_EVENTS, emitRealtime } = require('./realtime');

const MAX_TRACKED_DEVICES = 500;
const FLOAT_EVENT_COOLDOWN_MS = 30 * 1000;
const floatStateTracker = new Map();
const pumpStateTracker = new Map();
const LAYER_ALERT_LABELS = {
  1: 'Layer 1 (Top)',
  2: 'Layer 2 (Middle)',
  3: 'Layer 3 (Bottom)',
};

const getAlertEmailRecipients = () => {
  const raw =
    process.env.ALERT_EMAIL_RECIPIENTS ||
    process.env.ALERT_EMAIL_TO ||
    process.env.ADMIN_ALERT_EMAILS ||
    '';

  return String(raw)
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const dispatchAlertEmails = ({ alerts, deviceId }) => {
  const recipients = getAlertEmailRecipients();
  if (!Array.isArray(alerts) || alerts.length === 0 || recipients.length === 0) {
    return;
  }

  const emailEligible = alerts.filter((alert) => {
    const severity = String(alert && alert.severity ? alert.severity : '').toLowerCase();
    return severity === 'high' || severity === 'critical';
  });

  if (emailEligible.length === 0) {
    return;
  }

  const criticalCount = emailEligible.filter((alert) => String(alert.severity).toLowerCase() === 'critical').length;
  const highCount = emailEligible.length - criticalCount;
  const deviceLabel = deviceId || 'unknown-device';
  const subject = `[BeanToBin Alert] ${deviceLabel}: ${criticalCount} critical, ${highCount} high`;
  const rows = emailEligible
    .slice(0, 10)
    .map((alert) => {
      const severity = String(alert.severity || '').toUpperCase();
      const type = alert.type || 'unknown';
      const message = alert.message || 'No message provided';
      return `<li><strong>${severity}</strong> [${type}] - ${message}</li>`;
    })
    .join('');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2 style="margin-bottom: 12px;">BeanToBin Alert Notification</h2>
      <p><strong>Device:</strong> ${deviceLabel}</p>
      <p><strong>Total triggered:</strong> ${emailEligible.length}</p>
      <ul>${rows}</ul>
      <p style="font-size: 12px; color: #666;">This email was sent automatically by the BeanToBin alert engine.</p>
    </div>
  `;

  Promise.resolve()
    .then(() => sendEmail({ to: recipients, subject, html }))
    .catch((error) => {
      logger.warn('Failed to send alert notification email', error && error.message ? error.message : error);
    });
};

const limitTrackerSize = (map) => {
  if (map.size <= MAX_TRACKED_DEVICES) {
    return;
  }
  const oldestKey = map.keys().next();
  if (!oldestKey.done) {
    map.delete(oldestKey.value);
  }
};

const toFiniteNumber = (value) => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const classifyMoistureBand = (value) => {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  if (numeric < 30) return 'LOW';
  if (numeric > 70) return 'HIGH';
  return 'NORMAL';
};

const classifyTemperatureBand = (value) => {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  if (numeric < 20) return 'LOW';
  if (numeric > 35) return 'HIGH';
  return 'NORMAL';
};

const getTimestampMs = (sensor) => {
  if (!sensor) {
    return Date.now();
  }
  const raw = sensor.timestamp || sensor.createdAt || sensor.updatedAt;
  if (!raw) {
    return Date.now();
  }
  const parsed = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const normalizePumpStateValue = (value) => {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value >= 1) return true;
    if (value <= 0) return false;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['on', 'true', '1', 'active', 'running', 'start'].includes(normalized)) {
    return true;
  }
  if (['off', 'false', '0', 'inactive', 'stopped', 'stop'].includes(normalized)) {
    return false;
  }
  return null;
};

const resolvePumpState = (sensor) => normalizePumpStateValue(
  sensor && (sensor.pumpState ?? sensor.pump_state ?? sensor.pump ?? sensor.waterPumpState ?? sensor.pumpStatus)
);

const pickNumericField = (sensor, keys = []) => {
  if (!sensor) {
    return null;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(sensor, key)) {
      const value = toFiniteNumber(sensor[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
};

const resolveIo = (app) => {
  if (app && typeof app.get === 'function') {
    const ioInstance = app.get('io');
    if (ioInstance) {
      return ioInstance;
    }
  }
  return global.io;
};

const broadcastSensorData = (data, ioInstance) => {
  const payload = sanitizeSensorPayload(data, data && data.alerts ? data.alerts : []);
  const summary = buildSensorSummary(payload);
  payload.sensorSummary = summary;
  payload.isStale = false;
  payload.receivedAt = ensureIsoString(new Date());

  if (global.wsConnections && global.wsConnections.size > 0) {
    const message = JSON.stringify({
      type: 'sensor_data',
      data: payload,
    });

    global.wsConnections.forEach((ws) => {
      if (ws.readyState === 1) {
        try {
          ws.send(message);
          if (Array.isArray(summary) && summary.length > 0) {
            ws.send(JSON.stringify({
              type: 'device_sensor_summary',
              deviceId: payload.deviceId || null,
              sensors: summary,
              timestamp: payload.timestamp,
            }));
          }
        } catch (error) {
          console.error('WebSocket send error:', error);
          global.wsConnections.delete(ws);
        }
      }
    });
  }

  const io = ioInstance || global.io;
  emitRealtime(REALTIME_EVENTS.SENSOR_UPDATE, payload, { io });
  if (Array.isArray(summary) && summary.length > 0) {
    emitRealtime(REALTIME_EVENTS.SENSOR_SUMMARY, {
      deviceId: payload.deviceId || null,
      sensors: summary,
      timestamp: payload.timestamp,
      isStale: false,
    }, { io });
  }

  return payload;
};

const processFloatLockout = (sensor, config, pushAlert, ioInstance) => {
  if (!sensor || !config) {
    return;
  }
  const floatValue = toFiniteNumber(
    Object.prototype.hasOwnProperty.call(sensor, 'floatSensor')
      ? sensor.floatSensor
      : sensor.waterLevel
  );
  if (floatValue === null) {
    return;
  }
  const normalState = toFiniteNumber(config.normalState);
  const lowState = toFiniteNumber(config.lowAlertState);
  const durationThreshold = toFiniteNumber(config.lowAlertDurationSec) || 90;
  const targetLowState = lowState === null ? 0 : lowState;
  const deviceId = sensor.deviceId || 'unknown_device';
  const timestampMs = getTimestampMs(sensor);
  const tracker = floatStateTracker.get(deviceId) || { lowSince: null, lastState: null, lastAlertAt: null };
  const isLow = floatValue === targetLowState;
  const recovered = tracker.lastState === targetLowState && !isLow && tracker.lowSince !== null;

  if (isLow) {
    if (tracker.lowSince === null) {
      tracker.lowSince = timestampMs;
    }
    const secondsLow = (timestampMs - tracker.lowSince) / 1000;
    if (secondsLow >= durationThreshold) {
      pushAlert({
        type: 'float_sensor',
        severity: 'critical',
        message: `Float sensor low for ${Math.round(secondsLow)}s (min ${durationThreshold}s)`,
        threshold: { value: targetLowState, operator: '==' },
      });
      if (!tracker.lastAlertAt || (timestampMs - tracker.lastAlertAt) > FLOAT_EVENT_COOLDOWN_MS) {
        emitRealtime(REALTIME_EVENTS.FLOAT_LOCKOUT, {
          deviceId,
          floatSensor: floatValue,
          message: `Float sensor low for ${Math.round(secondsLow)}s`,
          action: 'trigger',
          timestamp: new Date(timestampMs).toISOString(),
        }, { io: ioInstance || global.io });
        tracker.lastAlertAt = timestampMs;
      }
    }
  } else if (recovered) {
    tracker.lowSince = null;
    tracker.lastAlertAt = null;
    emitRealtime(REALTIME_EVENTS.FLOAT_LOCKOUT, {
      deviceId,
      floatSensor: floatValue,
      message: 'Float sensor recovered',
      action: 'cleared',
      timestamp: new Date(timestampMs).toISOString(),
    }, { io: ioInstance || global.io });
  } else if (!isLow) {
    tracker.lowSince = null;
  }

  tracker.lastState = floatValue;
  floatStateTracker.set(deviceId, tracker);
  limitTrackerSize(floatStateTracker);
};

const processWaterPump = (sensor, config, pushAlert) => {
  if (!sensor || !config) {
    return;
  }
  const pumpState = resolvePumpState(sensor);
  if (pumpState === null) {
    return;
  }
  const deviceId = sensor.deviceId || 'unknown_device';
  const timestampMs = getTimestampMs(sensor);
  const tracker = pumpStateTracker.get(deviceId) || { lastState: null, lastOn: null, lastOff: null };
  const maxRuntime = toFiniteNumber(config.maxRuntimeSec);
  const minRest = toFiniteNumber(config.minRestSec);
  const minFlow = toFiniteNumber(config.minFlowLpm);

  if (pumpState === true) {
    const isNewRun = tracker.lastState !== true;
    if (isNewRun) {
      if (tracker.lastOff && minRest !== null) {
        const restSeconds = (timestampMs - tracker.lastOff) / 1000;
        if (restSeconds < minRest) {
          pushAlert({
            type: 'water_pump_rest',
            severity: 'warning',
            message: `Pump restarted after ${Math.round(restSeconds)}s rest (min ${minRest}s)`,
            threshold: { value: minRest, operator: '>=' },
          });
        }
      }
      tracker.lastOn = timestampMs;
    }

    const runtimeSeconds = (() => {
      const telemValue = pickNumericField(sensor, ['pumpRuntimeSec', 'pump_runtime_sec', 'pumpRuntime', 'pump_runtime']);
      if (telemValue !== null) {
        return telemValue;
      }
      if (tracker.lastOn) {
        return (timestampMs - tracker.lastOn) / 1000;
      }
      return null;
    })();

    if (runtimeSeconds !== null && maxRuntime !== null && runtimeSeconds > maxRuntime) {
      pushAlert({
        type: 'water_pump_runtime',
        severity: 'critical',
        message: `Pump runtime ${Math.round(runtimeSeconds)}s exceeds ${maxRuntime}s limit`,
        threshold: { value: maxRuntime, operator: '<=' },
      });
    }

    const flowValue = pickNumericField(sensor, ['pumpFlowLpm', 'pump_flow_lpm', 'flowLpm', 'flow_lpm', 'flowRate']);
    if (flowValue !== null && minFlow !== null && flowValue < minFlow) {
      pushAlert({
        type: 'water_pump_flow',
        severity: 'medium',
        message: `Pump flow ${flowValue} L/min below ${minFlow} L/min minimum`,
        threshold: { value: minFlow, operator: '>=' },
      });
    }
  } else if (tracker.lastState === true && tracker.lastOn) {
    tracker.lastOff = timestampMs;
  }

  tracker.lastState = pumpState;
  pumpStateTracker.set(deviceId, tracker);
  limitTrackerSize(pumpStateTracker);
};

const checkThresholds = async (sensorData, ioInstance) => {
  try {
    const plainSensor = toPlainObject(sensorData) || {};

    if (plainSensor.isOfflineData) {
      return [];
    }

    try {
      const rawTimestamp = plainSensor.timestamp || (sensorData && sensorData.timestamp);
      const ts = rawTimestamp ? (rawTimestamp instanceof Date ? rawTimestamp : new Date(rawTimestamp)) : null;
      if (ts && Date.now() - ts.getTime() > 15 * 60 * 1000) {
        return [];
      }
    } catch (error) {
      // ignore timestamp parsing problems, continue without failing the loop
    }

    const settings = await Settings.getSettings();
    const thresholds = (settings && settings.thresholds) || {};
    const sanitizedSensor = sanitizeSensorPayload(plainSensor, []);

    const alertsToCreate = [];
    const pushAlert = ({ type, severity, message, threshold }) => {
      const sensorSnapshot = JSON.parse(JSON.stringify(sanitizedSensor));
      alertsToCreate.push({
        type,
        severity,
        message,
        threshold: threshold || null,
        deviceId: sanitizedSensor.deviceId || null,
        sensorData: sensorSnapshot,
        createdAt: new Date(),
        status: 'new',
      });
    };

    const outOfRangeIssues = [];
    const validateRange = (metricKey, label, value, min, max, unit = '') => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return;
      }
      if (value < min || value > max) {
        outOfRangeIssues.push({ metricKey, label, value, min, max, unit });
      }
    };

    validateRange('temperature', 'Temperature', plainSensor.temperature, 15, 35, '°C');
    validateRange('humidity', 'Humidity', plainSensor.humidity, 50, 90, '%');
    validateRange('moisture', 'Soil Moisture', plainSensor.moisture, 0, 100, '%');
    validateRange('soilTemperature', 'Soil Temperature', plainSensor.soilTemperature, 18, 32, '°C');

    const layerRangeChecks = [
      { key: 'soilMoistureLayer1', label: 'Soil Moisture L1', min: 0, max: 100, unit: '%' },
      { key: 'soilMoistureLayer2', label: 'Soil Moisture L2', min: 0, max: 100, unit: '%' },
      { key: 'soilMoistureLayer3', label: 'Soil Moisture L3', min: 0, max: 100, unit: '%' },
      { key: 'soilTemperatureLayer1', label: 'Soil Temperature L1', min: 18, max: 32, unit: '°C' },
      { key: 'soilTemperatureLayer2', label: 'Soil Temperature L2', min: 18, max: 32, unit: '°C' },
      { key: 'soilTemperatureLayer3', label: 'Soil Temperature L3', min: 18, max: 32, unit: '°C' },
      { key: 'ambientTemperature', label: 'Ambient Temperature', min: 15, max: 35, unit: '°C' },
      { key: 'ambientHumidity', label: 'Ambient Humidity', min: 50, max: 90, unit: '%' },
      { key: 'binTemperature', label: 'Bin Temperature', min: 15, max: 40, unit: '°C' },
      { key: 'binHumidity', label: 'Bin Humidity', min: 45, max: 95, unit: '%' },
    ];

    layerRangeChecks.forEach((entry) => {
      validateRange(entry.key, entry.label, plainSensor[entry.key], entry.min, entry.max, entry.unit);
    });

    if (outOfRangeIssues.length > 0) {
      const summary = outOfRangeIssues
        .map((issue) => `${issue.label}=${issue.value}${issue.unit}`)
        .join(', ');
      pushAlert({
        type: 'sensor_out_of_range',
        severity: 'high',
        message: `Sensor value out of expected range (${summary})`,
        threshold: {
          ranges: outOfRangeIssues.map((issue) => ({
            metric: issue.metricKey,
            min: issue.min,
            max: issue.max,
            value: issue.value,
          })),
          operator: 'outside',
        },
      });
    }

    const layerReadings = [
      {
        index: 1,
        moisture: toFiniteNumber(plainSensor.soilMoistureLayer1),
        temperature: toFiniteNumber(plainSensor.soilTemperatureLayer1),
      },
      {
        index: 2,
        moisture: toFiniteNumber(plainSensor.soilMoistureLayer2),
        temperature: toFiniteNumber(plainSensor.soilTemperatureLayer2),
      },
      {
        index: 3,
        moisture: toFiniteNumber(plainSensor.soilMoistureLayer3),
        temperature: toFiniteNumber(plainSensor.soilTemperatureLayer3),
      },
    ];

    layerReadings.forEach((layer) => {
      const layerLabel = LAYER_ALERT_LABELS[layer.index] || `Layer ${layer.index}`;
      const moistureBand = classifyMoistureBand(layer.moisture);
      const temperatureBand = classifyTemperatureBand(layer.temperature);

      if (moistureBand === 'LOW') {
        pushAlert({
          type: `layer_${layer.index}_moisture_low`,
          severity: 'medium',
          message: `${layerLabel} moisture is too low (${layer.moisture}%).`,
          threshold: { value: 30, operator: '<' },
        });
      } else if (moistureBand === 'HIGH') {
        pushAlert({
          type: `layer_${layer.index}_moisture_high`,
          severity: 'medium',
          message: `${layerLabel} moisture is too high (${layer.moisture}%).`,
          threshold: { value: 70, operator: '>' },
        });
      }

      if (temperatureBand === 'LOW') {
        pushAlert({
          type: `layer_${layer.index}_temperature_low`,
          severity: 'high',
          message: `${layerLabel} temperature is too low (${layer.temperature}°C).`,
          threshold: { value: 20, operator: '<' },
        });
      } else if (temperatureBand === 'HIGH') {
        pushAlert({
          type: `layer_${layer.index}_temperature_high`,
          severity: 'high',
          message: `${layerLabel} temperature is too high (${layer.temperature}°C).`,
          threshold: { value: 35, operator: '>' },
        });
      }
    });

    const temperatureThresholds = thresholds.temperature || {};
    if (typeof plainSensor.temperature === 'number') {
      const { warning, critical, lowWarning, lowCritical } = temperatureThresholds;
      if (typeof critical === 'number' && plainSensor.temperature > critical) {
        pushAlert({
          type: 'temperature',
          severity: 'critical',
          message: `Critical temperature: ${plainSensor.temperature}°C (threshold: ${critical}°C)`,
          threshold: { value: critical, operator: '>' },
        });
      } else if (typeof warning === 'number' && plainSensor.temperature > warning) {
        pushAlert({
          type: 'temperature',
          severity: 'high',
          message: `High temperature: ${plainSensor.temperature}°C (threshold: ${warning}°C)`,
          threshold: { value: warning, operator: '>' },
        });
      } else if (typeof lowCritical === 'number' && plainSensor.temperature < lowCritical) {
        pushAlert({
          type: 'temperature',
          severity: 'critical',
          message: `Critical low temperature: ${plainSensor.temperature}°C (threshold: ${lowCritical}°C)`,
          threshold: { value: lowCritical, operator: '<' },
        });
      } else if (typeof lowWarning === 'number' && plainSensor.temperature < lowWarning) {
        pushAlert({
          type: 'temperature',
          severity: 'medium',
          message: `Low temperature: ${plainSensor.temperature}°C (threshold: ${lowWarning}°C)`,
          threshold: { value: lowWarning, operator: '<' },
        });
      }
    }

    const humidityThresholds = thresholds.humidity || {};
    if (typeof plainSensor.humidity === 'number') {
      const { warning, critical, lowWarning, lowCritical } = humidityThresholds;
      if (typeof critical === 'number' && plainSensor.humidity > critical) {
        pushAlert({
          type: 'humidity',
          severity: 'critical',
          message: `Critical humidity: ${plainSensor.humidity}% (threshold: ${critical}%)`,
          threshold: { value: critical, operator: '>' },
        });
      } else if (typeof warning === 'number' && plainSensor.humidity > warning) {
        pushAlert({
          type: 'humidity',
          severity: 'high',
          message: `High humidity: ${plainSensor.humidity}% (threshold: ${warning}%)`,
          threshold: { value: warning, operator: '>' },
        });
      } else if (typeof lowCritical === 'number' && plainSensor.humidity < lowCritical) {
        pushAlert({
          type: 'humidity',
          severity: 'critical',
          message: `Critical low humidity: ${plainSensor.humidity}% (threshold: ${lowCritical}%)`,
          threshold: { value: lowCritical, operator: '<' },
        });
      } else if (typeof lowWarning === 'number' && plainSensor.humidity < lowWarning) {
        pushAlert({
          type: 'humidity',
          severity: 'medium',
          message: `Low humidity: ${plainSensor.humidity}% (threshold: ${lowWarning}%)`,
          threshold: { value: lowWarning, operator: '<' },
        });
      }
    }

    const moistureThresholds = thresholds.moisture || {};
    if (typeof plainSensor.moisture === 'number') {
      const { warning, critical } = moistureThresholds;
      if (typeof critical === 'number' && plainSensor.moisture < critical) {
        pushAlert({
          type: 'moisture',
          severity: 'critical',
          message: `Critical low moisture: ${plainSensor.moisture}% (threshold: ${critical}%)`,
          threshold: { value: critical, operator: '<' },
        });
      } else if (typeof warning === 'number' && plainSensor.moisture < warning) {
        pushAlert({
          type: 'moisture',
          severity: 'medium',
          message: `Low moisture: ${plainSensor.moisture}% (threshold: ${warning}%)`,
          threshold: { value: warning, operator: '<' },
        });
      }
    }

    const phThresholds = thresholds.ph || {};
    if (typeof plainSensor.ph === 'number') {
      const { minCritical, maxCritical, minWarning, maxWarning } = phThresholds;
      if ((typeof minCritical === 'number' && plainSensor.ph < minCritical) ||
        (typeof maxCritical === 'number' && plainSensor.ph > maxCritical)) {
        pushAlert({
          type: 'ph',
          severity: 'critical',
          message: `Critical pH level: ${plainSensor.ph} (threshold: ${minCritical}-${maxCritical})`,
          threshold: { value: [minCritical, maxCritical], operator: 'outside' },
        });
      } else if ((typeof minWarning === 'number' && plainSensor.ph < minWarning) ||
        (typeof maxWarning === 'number' && plainSensor.ph > maxWarning)) {
        pushAlert({
          type: 'ph',
          severity: 'high',
          message: `Warning pH level: ${plainSensor.ph} (threshold: ${minWarning}-${maxWarning})`,
          threshold: { value: [minWarning, maxWarning], operator: 'outside' },
        });
      }
    }

    const ecThresholds = thresholds.ec || {};
    if (typeof plainSensor.ec === 'number') {
      const { warning, critical, lowWarning } = ecThresholds;
      if (typeof critical === 'number' && plainSensor.ec > critical) {
        pushAlert({
          type: 'ec',
          severity: 'critical',
          message: `Critical EC level: ${plainSensor.ec} mS/cm (threshold: ${critical} mS/cm)`,
          threshold: { value: critical, operator: '>' },
        });
      } else if (typeof warning === 'number' && plainSensor.ec > warning) {
        pushAlert({
          type: 'ec',
          severity: 'high',
          message: `High EC level: ${plainSensor.ec} mS/cm (threshold: ${warning} mS/cm)`,
          threshold: { value: warning, operator: '>' },
        });
      } else if (typeof lowWarning === 'number' && plainSensor.ec < lowWarning) {
        pushAlert({
          type: 'ec',
          severity: 'medium',
          message: `Low EC level: ${plainSensor.ec} mS/cm (threshold: ${lowWarning} mS/cm)`,
          threshold: { value: lowWarning, operator: '<' },
        });
      }
    }

    const nitrogenThresholds = thresholds.nitrogen || {};
    if (typeof plainSensor.nitrogen === 'number') {
      const { minWarning, minCritical, maxWarning, maxCritical } = nitrogenThresholds;
      if (typeof minCritical === 'number' && plainSensor.nitrogen < minCritical) {
        pushAlert({
          type: 'nitrogen',
          severity: 'critical',
          message: `Critical low nitrogen: ${plainSensor.nitrogen} mg/kg (threshold: ${minCritical} mg/kg)`,
          threshold: { value: minCritical, operator: '<' },
        });
      } else if (typeof minWarning === 'number' && plainSensor.nitrogen < minWarning) {
        pushAlert({
          type: 'nitrogen',
          severity: 'medium',
          message: `Low nitrogen: ${plainSensor.nitrogen} mg/kg (threshold: ${minWarning} mg/kg)`,
          threshold: { value: minWarning, operator: '<' },
        });
      } else if (typeof maxCritical === 'number' && plainSensor.nitrogen > maxCritical) {
        pushAlert({
          type: 'nitrogen',
          severity: 'critical',
          message: `Critical high nitrogen: ${plainSensor.nitrogen} mg/kg (threshold: ${maxCritical} mg/kg)`,
          threshold: { value: maxCritical, operator: '>' },
        });
      } else if (typeof maxWarning === 'number' && plainSensor.nitrogen > maxWarning) {
        pushAlert({
          type: 'nitrogen',
          severity: 'high',
          message: `High nitrogen: ${plainSensor.nitrogen} mg/kg (threshold: ${maxWarning} mg/kg)`,
          threshold: { value: maxWarning, operator: '>' },
        });
      }
    }

    const phosphorusThresholds = thresholds.phosphorus || {};
    if (typeof plainSensor.phosphorus === 'number') {
      const { minWarning, minCritical, maxWarning, maxCritical } = phosphorusThresholds;
      if (typeof minCritical === 'number' && plainSensor.phosphorus < minCritical) {
        pushAlert({
          type: 'phosphorus',
          severity: 'critical',
          message: `Critical low phosphorus: ${plainSensor.phosphorus} mg/kg (threshold: ${minCritical} mg/kg)`,
          threshold: { value: minCritical, operator: '<' },
        });
      } else if (typeof minWarning === 'number' && plainSensor.phosphorus < minWarning) {
        pushAlert({
          type: 'phosphorus',
          severity: 'medium',
          message: `Low phosphorus: ${plainSensor.phosphorus} mg/kg (threshold: ${minWarning} mg/kg)`,
          threshold: { value: minWarning, operator: '<' },
        });
      } else if (typeof maxCritical === 'number' && plainSensor.phosphorus > maxCritical) {
        pushAlert({
          type: 'phosphorus',
          severity: 'critical',
          message: `Critical high phosphorus: ${plainSensor.phosphorus} mg/kg (threshold: ${maxCritical} mg/kg)`,
          threshold: { value: maxCritical, operator: '>' },
        });
      } else if (typeof maxWarning === 'number' && plainSensor.phosphorus > maxWarning) {
        pushAlert({
          type: 'phosphorus',
          severity: 'high',
          message: `High phosphorus: ${plainSensor.phosphorus} mg/kg (threshold: ${maxWarning} mg/kg)`,
          threshold: { value: maxWarning, operator: '>' },
        });
      }
    }

    const potassiumThresholds = thresholds.potassium || {};
    if (typeof plainSensor.potassium === 'number') {
      const { minWarning, minCritical, maxWarning, maxCritical } = potassiumThresholds;
      if (typeof minCritical === 'number' && plainSensor.potassium < minCritical) {
        pushAlert({
          type: 'potassium',
          severity: 'critical',
          message: `Critical low potassium: ${plainSensor.potassium} mg/kg (threshold: ${minCritical} mg/kg)`,
          threshold: { value: minCritical, operator: '<' },
        });
      } else if (typeof minWarning === 'number' && plainSensor.potassium < minWarning) {
        pushAlert({
          type: 'potassium',
          severity: 'medium',
          message: `Low potassium: ${plainSensor.potassium} mg/kg (threshold: ${minWarning} mg/kg)`,
          threshold: { value: minWarning, operator: '<' },
        });
      } else if (typeof maxCritical === 'number' && plainSensor.potassium > maxCritical) {
        pushAlert({
          type: 'potassium',
          severity: 'critical',
          message: `Critical high potassium: ${plainSensor.potassium} mg/kg (threshold: ${maxCritical} mg/kg)`,
          threshold: { value: maxCritical, operator: '>' },
        });
      } else if (typeof maxWarning === 'number' && plainSensor.potassium > maxWarning) {
        pushAlert({
          type: 'potassium',
          severity: 'high',
          message: `High potassium: ${plainSensor.potassium} mg/kg (threshold: ${maxWarning} mg/kg)`,
          threshold: { value: maxWarning, operator: '>' },
        });
      }
    }

    const waterLevelThresholds = thresholds.waterLevel || {};
    if (plainSensor.waterLevel !== undefined) {
      const { critical } = waterLevelThresholds;
      if (critical !== undefined && plainSensor.waterLevel === critical) {
        pushAlert({
          type: 'water_level',
          severity: 'critical',
          message: 'Critical water level: No water detected',
          threshold: { value: critical, operator: '==' },
        });
      }
    }

    const floatStatus = String(
      plainSensor.floatStatus
      ?? plainSensor.float_status
      ?? ''
    ).trim().toUpperCase();
    if (floatStatus === 'LOW') {
      pushAlert({
        type: 'float_status_low',
        severity: 'critical',
        message: 'Float sensor status LOW - refill water reservoir',
        threshold: { value: 'LOW', operator: '==' },
      });
    } else if (floatStatus === 'HIGH') {
      pushAlert({
        type: 'float_status_high',
        severity: 'high',
        message: 'Float sensor status HIGH - inspect overflow/drain',
        threshold: { value: 'HIGH', operator: '==' },
      });
    }

    processFloatLockout(sanitizedSensor, thresholds.floatSensor, pushAlert, ioInstance);
    processWaterPump(sanitizedSensor, thresholds.waterPump, pushAlert);

    const batteryThresholds = thresholds.batteryLevel || {};
    if (typeof plainSensor.batteryLevel === 'number') {
      const { warning, critical } = batteryThresholds;
      if (typeof critical === 'number' && plainSensor.batteryLevel < critical) {
        pushAlert({
          type: 'battery_low',
          severity: 'critical',
          message: `Critical battery level: ${plainSensor.batteryLevel}% (threshold: ${critical}%)`,
          threshold: { value: critical, operator: '<' },
        });
      } else if (typeof warning === 'number' && plainSensor.batteryLevel < warning) {
        pushAlert({
          type: 'battery_low',
          severity: 'medium',
          message: `Low battery level: ${plainSensor.batteryLevel}% (threshold: ${warning}%)`,
          threshold: { value: warning, operator: '<' },
        });
      }
    }

    if (alertsToCreate.length === 0) {
      return [];
    }

    const persistedAlerts = [];
    // Debounce / dedupe: avoid creating duplicate unresolved alerts repeatedly
    const debounceMs = (() => {
      try {
        const env = parseInt(process.env.ALERT_DEBOUNCE_MS || process.env.ALERT_DEBOUNCE || '', 10);
        if (!Number.isNaN(env) && env > 0) return env;
      } catch (e) {}
      try {
        const s = settings && settings.alerts && settings.alerts.debounceMs;
        if (typeof s === 'number' && s > 0) return s;
      } catch (e) {}
      return 5 * 60 * 1000; // default 5 minutes
    })();

    for (const alertData of alertsToCreate) {
      try {
        const where = { type: alertData.type };
        if (alertData.deviceId) where.deviceId = alertData.deviceId;
        // look for a recent unresolved alert of same type/device
        const recent = await Alert.findOne({ where: { ...where, isResolved: false }, order: [['createdAt', 'DESC']] });
        if (recent) {
          const createdAt = recent.createdAt ? new Date(recent.createdAt).getTime() : null;
          if (createdAt && (Date.now() - createdAt) < debounceMs) {
            // Skip creating a duplicate alert; optionally update message/updatedAt
            continue;
          }
        }

        const created = await Alert.createAlert(alertData);
        const createdPlain = toPlainObject(created) || {};
        persistedAlerts.push(
          sanitizeAlertPayload({
            ...alertData,
            ...createdPlain,
            sensorData: alertData.sensorData,
          }),
        );
      } catch (e) {
        logger && logger.warn && logger.warn('Failed to persist alert (continuing):', e && e.message ? e.message : e);
      }
    }

    const first = persistedAlerts[0] || {};
    const devId = first.deviceId || sanitizedSensor.deviceId || plainSensor.deviceId || null;
    if (persistedAlerts.length > 0) {
      emitRealtime(REALTIME_EVENTS.ALERT_NEW, {
        deviceId: devId,
        alerts: persistedAlerts,
        event: 'new',
        triggeredAt: new Date().toISOString(),
      }, { io: ioInstance || global.io });

      dispatchAlertEmails({ alerts: persistedAlerts, deviceId: devId });
    }

    return persistedAlerts;
  } catch (error) {
    console.error('Error checking thresholds:', error);
    return [];
  }
};

module.exports = {
  resolveIo,
  broadcastSensorData,
  checkThresholds,
};