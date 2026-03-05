const { getLatestFloatState } = require('./floatSensorGuard');

const normalizeFloatState = (value) => {
  if (value === null || typeof value === 'undefined') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return 'LOW';
  if (numeric >= 2) return 'FULL';
  return 'NORMAL';
};

async function evaluatePumpSafety({ deviceId, desiredState }) {
  if (!desiredState || desiredState.pump !== true) {
    return { allowed: true, floatState: null };
  }

  const latest = await getLatestFloatState(deviceId);
  const floatState = normalizeFloatState(latest && latest.value);

  if (floatState === 'LOW') {
    return {
      allowed: false,
      statusCode: 409,
      floatState,
      message: 'Water Reservoir Low: pump locked while reservoir is empty.',
    };
  }

  if (floatState === 'FULL') {
    return {
      allowed: false,
      statusCode: 409,
      floatState,
      message: 'Reservoir FULL: pump remains OFF for safety.',
    };
  }

  return {
    allowed: true,
    floatState,
  };
}

module.exports = {
  evaluatePumpSafety,
};