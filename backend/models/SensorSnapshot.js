const { DataTypes } = require('sequelize');
const sequelize = require('../services/database_pg');

const SensorSnapshot = sequelize.define('SensorSnapshot', {
  deviceId: {
    type: DataTypes.STRING(120),
    allowNull: false,
    primaryKey: true,
    field: 'device_id',
  },
  temperature: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'temperature',
  },
  humidity: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'humidity',
  },
  moisture: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'moisture',
  },
  soilTemperature: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'soil_temperature',
  },
  ph: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'ph',
  },
  ec: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'ec',
  },
  nitrogen: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'nitrogen',
  },
  phosphorus: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'phosphorus',
  },
  potassium: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'potassium',
  },
  waterLevel: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'water_level',
  },
  floatSensor: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'float_sensor',
  },
  batteryLevel: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'battery_level',
  },
  signalStrength: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'signal_strength',
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'timestamp',
  },
}, {
  tableName: 'sensor_snapshots',
  timestamps: false,
  underscored: true,
});

module.exports = SensorSnapshot;
