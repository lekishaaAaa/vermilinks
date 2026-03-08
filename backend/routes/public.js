const express = require('express');
const { fn, col, where } = require('sequelize');
const SensorSnapshot = require('../models/SensorSnapshot');
const SensorData = require('../models/SensorData');
const logger = require('../utils/logger');

const router = express.Router();

const normalizeDeviceId = (value) => {
  const normalized = (value || '').toString().trim().toLowerCase();
  return normalized || null;
};

const buildDeviceIdWhere = (deviceId) => {
  const normalized = normalizeDeviceId(deviceId);
  if (!normalized) {
    return null;
  }
  return where(fn('lower', col('device_id')), normalized);
};

const toNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const formatSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const timestamp = snapshot.timestamp || snapshot.updated_at || snapshot.created_at || Date.now();
  return {
    temperature: toNumber(snapshot.temperature),
    humidity: toNumber(snapshot.humidity),
    soil_moisture: toNumber(snapshot.moisture ?? snapshot.soil_moisture),
    ph: toNumber(snapshot.ph),
    ec: toNumber(snapshot.ec),
    nitrogen: toNumber(snapshot.nitrogen),
    phosphorus: toNumber(snapshot.phosphorus),
    potassium: toNumber(snapshot.potassium),
    water_level: toNumber(snapshot.waterLevel ?? snapshot.water_level),
    float_state: toNumber(snapshot.floatSensor ?? snapshot.float_state),
    battery_level: toNumber(snapshot.batteryLevel ?? snapshot.battery_level),
    signal_strength: toNumber(snapshot.signalStrength ?? snapshot.signal_strength),
    updated_at: new Date(timestamp).toISOString(),
  };
};

router.get('/telemetry', async (req, res) => {
  try {
    const deviceId = normalizeDeviceId(req.query.deviceId || req.query.device_id);

    let snapshot = null;
    if (deviceId) {
      snapshot = await SensorSnapshot.findByPk(deviceId, { raw: true });
      if (!snapshot) {
        snapshot = await SensorSnapshot.findOne({ where: buildDeviceIdWhere(deviceId), raw: true });
      }
    } else {
      snapshot = await SensorSnapshot.findOne({ order: [['timestamp', 'DESC']], raw: true });
    }

    if (!snapshot) {
      const conditions = {};
      if (deviceId) {
        Object.assign(conditions, { [require('sequelize').Op.and]: [buildDeviceIdWhere(deviceId)] });
      }
      const latestData = await SensorData.findOne({ where: conditions, order: [['timestamp', 'DESC']], raw: true });
      if (latestData) {
        snapshot = {
          temperature: latestData.temperature,
          humidity: latestData.humidity,
          moisture: latestData.moisture,
          ph: latestData.ph,
          ec: latestData.ec,
          nitrogen: latestData.nitrogen,
          phosphorus: latestData.phosphorus,
          potassium: latestData.potassium,
          waterLevel: latestData.waterLevel,
          floatSensor: latestData.floatSensor,
          batteryLevel: latestData.batteryLevel,
          signalStrength: latestData.signalStrength,
          timestamp: latestData.timestamp,
        };
      }
    }

    if (!snapshot) {
      return res.status(200).json({ success: true, data: null });
    }

    return res.status(200).json({ success: true, data: formatSnapshot(snapshot) });
  } catch (error) {
    if (logger && typeof logger.error === 'function') {
      logger.error('GET /api/public/telemetry failed', error);
    }
    return res.status(500).json({ success: false, message: 'Unable to load telemetry' });
  }
});

module.exports = router;
