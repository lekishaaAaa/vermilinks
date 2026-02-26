const logger = require('./logger');

const requiredKeys = [
  'DATABASE_URL',
  'JWT_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'CORS_ORIGINS',
];

const alternateKeys = {
  CORS_ORIGINS: ['CORS_ORIGIN'],
};

function hasValue(key) {
  const raw = process.env[key];
  if (raw !== undefined && String(raw).trim().length > 0) {
    return true;
  }
  if (alternateKeys[key]) {
    return alternateKeys[key].some((alias) => {
      const value = process.env[alias];
      return value !== undefined && String(value).trim().length > 0;
    });
  }
  return false;
}

function validateEnv() {
  const missing = requiredKeys.filter((key) => !hasValue(key));
  if (missing.length > 0) {
    logger.fatal('Missing required environment variables', { missing });
    logger.fatal('Please update your environment configuration before starting the server.');
    process.exit(1);
  }
}

module.exports = {
  validateEnv,
  requiredKeys,
};
