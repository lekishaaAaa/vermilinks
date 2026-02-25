const mongoose = require('mongoose');
const logger = require('../utils/logger');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
let connectingPromise = null;

async function connectMongo() {
  if (!MONGO_URI) {
    logger.info('MongoDB URI not configured; skipping Mongo connection');
    return null;
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectingPromise) {
    connectingPromise = mongoose
      .connect(MONGO_URI, {
        autoIndex: true,
        serverSelectionTimeoutMS: 8000,
      })
      .then(() => {
        logger.info('MongoDB connected');
        return mongoose.connection;
      })
      .catch((error) => {
        logger.warn('MongoDB connection failed', error && error.message ? error.message : error);
        throw error;
      })
      .finally(() => {
        connectingPromise = null;
      });
  }

  return connectingPromise;
}

module.exports = {
  connectMongo,
  mongoose,
};
