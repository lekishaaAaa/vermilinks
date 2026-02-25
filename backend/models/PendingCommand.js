const { DataTypes } = require('sequelize');
const sequelize = require('../services/database_pg');

const PendingCommand = sequelize.define('PendingCommand', {
  requestId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    field: 'request_id',
  },
  deviceId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'device_id',
  },
  desiredState: {
    type: DataTypes.JSON,
    allowNull: true,
    field: 'desired_state',
  },
  responseState: {
    type: DataTypes.JSON,
    allowNull: true,
    field: 'response_state',
  },
  status: {
    type: DataTypes.ENUM('sent', 'waiting', 'acknowledged', 'mismatch', 'failed'),
    allowNull: false,
    defaultValue: 'sent',
  },
  error: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  ackAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'ack_at',
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at',
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'updated_at',
  },
}, {
  tableName: 'pending_commands',
  timestamps: false,
  underscored: true,
});

module.exports = PendingCommand;
