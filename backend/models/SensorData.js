const { DataTypes } = require('sequelize');
const sequelize = require('../services/database_pg');

// Sequelize model for sensor readings. Fields align with the REST route payloads.
const dialect = typeof sequelize.getDialect === 'function' ? sequelize.getDialect() : 'postgres';
const rawPayloadType = dialect === 'postgres' ? DataTypes.JSONB : DataTypes.JSON;

const SensorData = sequelize.define('SensorData', {
  deviceId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  temperature: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  humidity: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  moisture: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  soilTemperature: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'soil_temperature',
  },
  ph: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  ec: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  nitrogen: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  phosphorus: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  potassium: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  waterLevel: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  floatSensor: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'float_sensor',
  },
  batteryLevel: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  signalStrength: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  isOfflineData: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  },
  source: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  rawPayload: {
    type: rawPayloadType,
    allowNull: true,
    field: 'raw_payload',
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'sensordata',
  timestamps: false,
  underscored: true,
});

module.exports = SensorData;
