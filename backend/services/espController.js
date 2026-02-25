const logger = require('../utils/logger');

async function sendCommand(actuatorName, action) {
  const message = 'Actuator command support has been retired; dispatch via /api/iot/control instead.';
  logger.warn('[ACTUATOR → ESP32] command rejected', {
    actuator: actuatorName,
    action,
    reason: 'deprecated',
  });
  const error = new Error(message);
  error.code = 'ACTUATOR_COMMAND_DEPRECATED';
  throw error;
}

module.exports = { sendCommand };
