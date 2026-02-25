"use strict";

const { DataTypes } = require('sequelize');

async function tableExists(queryInterface, tableName) {
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = (tables || []).map((entry) => {
      if (typeof entry === 'string') return entry.toLowerCase();
      if (entry && typeof entry.tableName === 'string') return entry.tableName.toLowerCase();
      return String(entry || '').toLowerCase();
    });
    return normalized.includes(tableName.toLowerCase());
  } catch (err) {
    console.warn(`sensor_logs migration: failed to list tables (${tableName})`, err && err.message ? err.message : err);
    return false;
  }
}

module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = 'sensor_logs';

    if (await tableExists(queryInterface, tableName)) {
      console.log(`[sensor_logs] ${tableName} already exists — skipping createTable`);
    } else {
      await queryInterface.createTable(tableName, {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        device_id: { type: DataTypes.STRING(120), allowNull: false },
        sensor_name: { type: DataTypes.STRING(64), allowNull: false },
        value: { type: DataTypes.DOUBLE, allowNull: false },
        unit: { type: DataTypes.STRING(24), allowNull: true },
        mqtt_topic: { type: DataTypes.STRING(255), allowNull: true },
        origin: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'mqtt' },
        recorded_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        raw_payload: { type: DataTypes.JSONB || DataTypes.JSON, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      }, {
        underscored: true,
      });
      console.log(`[sensor_logs] created table ${tableName}`);
    }

    const indexPromises = [
      queryInterface.addIndex(tableName, ['device_id']).catch((err) => {
        if (err && err.message && err.message.includes('exists')) return null;
        throw err;
      }),
      queryInterface.addIndex(tableName, ['sensor_name']).catch((err) => {
        if (err && err.message && err.message.includes('exists')) return null;
        throw err;
      }),
      queryInterface.addIndex(tableName, ['recorded_at']).catch((err) => {
        if (err && err.message && err.message.includes('exists')) return null;
        throw err;
      }),
    ];

    await Promise.all(indexPromises);
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = 'sensor_logs';
    await queryInterface.dropTable(tableName).catch((err) => {
      console.warn(`[sensor_logs] drop failed for ${tableName}`, err && err.message ? err.message : err);
    });
  },
};
