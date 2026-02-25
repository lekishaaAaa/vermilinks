"use strict";

const { DataTypes } = require('sequelize');

module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = 'devices';

    const dialect = typeof sequelize.getDialect === 'function' ? sequelize.getDialect() : null;

    let description = null;
    try {
      description = await queryInterface.describeTable(tableName);
    } catch (error) {
      description = null;
    }

    if (!description) {
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(description, 'online')) {
      await queryInterface.addColumn(tableName, 'online', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      try {
        await queryInterface.addIndex(tableName, ['online']);
      } catch (error) {
        console.warn('Failed to add index on devices.online', error && error.message ? error.message : error);
      }
    }

    if (!Object.prototype.hasOwnProperty.call(description, 'last_seen')) {
      await queryInterface.addColumn(tableName, 'last_seen', {
        type: DataTypes.DATE,
        allowNull: true,
      });
    }

    if (!Object.prototype.hasOwnProperty.call(description, 'updated_at')) {
      await queryInterface.addColumn(tableName, 'updated_at', {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      });
    }

    try {
      await queryInterface.sequelize.query(
        "UPDATE devices SET online = (status = 'online'), last_seen = COALESCE(last_seen, \"lastHeartbeat\"), updated_at = COALESCE(updated_at, NOW())"
      );
    } catch (error) {
      console.warn('Failed to backfill devices presence columns', error && error.message ? error.message : error);
    }

    if (dialect === 'postgres') {
      try {
        await queryInterface.sequelize.query(`
          CREATE OR REPLACE FUNCTION devices_set_updated_at()
          RETURNS trigger AS $$
          BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
        `);
        await queryInterface.sequelize.query(`
          DROP TRIGGER IF EXISTS trg_devices_set_updated_at ON devices;
          CREATE TRIGGER trg_devices_set_updated_at
          BEFORE UPDATE ON devices
          FOR EACH ROW
          EXECUTE FUNCTION devices_set_updated_at();
        `);
      } catch (error) {
        console.warn('Failed to create devices.updated_at trigger', error && error.message ? error.message : error);
      }
    }
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = 'devices';

    const dialect = typeof sequelize.getDialect === 'function' ? sequelize.getDialect() : null;

    if (dialect === 'postgres') {
      try {
        await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS trg_devices_set_updated_at ON devices;');
        await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS devices_set_updated_at();');
      } catch (error) {
        console.warn('Down migration: failed to drop devices.updated_at trigger', error && error.message ? error.message : error);
      }
    }

    try {
      const description = await queryInterface.describeTable(tableName);
      if (description && Object.prototype.hasOwnProperty.call(description, 'online')) {
        try {
          await queryInterface.removeIndex(tableName, ['online']);
        } catch (error) {
          // ignore
        }
        await queryInterface.removeColumn(tableName, 'online');
      }
      if (description && Object.prototype.hasOwnProperty.call(description, 'last_seen')) {
        await queryInterface.removeColumn(tableName, 'last_seen');
      }
      if (description && Object.prototype.hasOwnProperty.call(description, 'updated_at')) {
        await queryInterface.removeColumn(tableName, 'updated_at');
      }
    } catch (error) {
      console.warn('Down migration add-device-presence-columns failed', error && error.message ? error.message : error);
    }
  }
};
