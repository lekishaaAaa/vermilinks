const Alert = require('../models/Alert');

async function createWaterReservoirLowAlert(deviceId, sensorData) {
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
    message: 'Water Reservoir Low: Layer 4 water reservoir is low. Please refill manually.',
    deviceId: deviceId || null,
    sensorData: sensorData || null,
    status: 'new',
    createdAt: new Date(),
  });
}

module.exports = {
  createWaterReservoirLowAlert,
};
