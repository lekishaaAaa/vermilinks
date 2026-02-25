'use strict';

const { DataTypes } = require('sequelize');

async function tableExists(queryInterface, tableName) {
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = (tables || []).map((t) => {
      if (typeof t === 'string') return t.toLowerCase();
      if (t && typeof t.tableName === 'string') return t.tableName.toLowerCase();
      return String(t || '').toLowerCase();
    });
    return normalized.includes(tableName.toLowerCase());
  } catch (error) {
    return false;
  }
}

module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = 'pending_commands';

    if (await tableExists(queryInterface, tableName)) {
      return;
    }

    await queryInterface.createTable(tableName, {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      request_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      device_id: { type: DataTypes.STRING, allowNull: false },
      desired_state: { type: DataTypes.JSON, allowNull: true },
      response_state: { type: DataTypes.JSON, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'sent' },
      error: { type: DataTypes.TEXT, allowNull: true },
      ack_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: true },
    });
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    try {
      await queryInterface.dropTable('pending_commands');
    } catch (error) {
      // ignore
    }
  },
};
