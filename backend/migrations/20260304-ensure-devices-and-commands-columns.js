'use strict';

const { DataTypes } = require('sequelize');

async function tableExists(queryInterface, tableName) {
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = (tables || []).map((entry) => {
      if (typeof entry === 'string') return entry.toLowerCase();
      if (entry && typeof entry.tableName === 'string') return entry.tableName.toLowerCase();
      return String(entry || '').toLowerCase();
    });
    return normalized.includes(String(tableName).toLowerCase());
  } catch (_error) {
    return false;
  }
}

module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'devices')) {
      const devicesDescription = await queryInterface.describeTable('devices');

      if (!devicesDescription.online) {
        await queryInterface.addColumn('devices', 'online', {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        });
      }

      if (!devicesDescription.last_seen) {
        await queryInterface.addColumn('devices', 'last_seen', {
          type: DataTypes.DATE,
          allowNull: true,
        });
      }
    }

    if (!(await tableExists(queryInterface, 'commands'))) {
      await queryInterface.createTable('commands', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        device_id: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        command: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        status: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      });
      return;
    }

    const commandsDescription = await queryInterface.describeTable('commands');

    if (!commandsDescription.id) {
      await queryInterface.addColumn('commands', 'id', {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        allowNull: true,
      });
    }

    if (!commandsDescription.device_id) {
      await queryInterface.addColumn('commands', 'device_id', {
        type: DataTypes.TEXT,
        allowNull: true,
      });
    }

    if (!commandsDescription.command) {
      await queryInterface.addColumn('commands', 'command', {
        type: DataTypes.TEXT,
        allowNull: true,
      });
    }

    if (!commandsDescription.status) {
      await queryInterface.addColumn('commands', 'status', {
        type: DataTypes.TEXT,
        allowNull: true,
      });
    }

    if (!commandsDescription.created_at) {
      await queryInterface.addColumn('commands', 'created_at', {
        type: DataTypes.DATE,
        allowNull: true,
      });
    }

    try {
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'commands' AND column_name = 'id'
          ) AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'commands'::regclass
              AND contype = 'p'
          ) THEN
            ALTER TABLE commands ADD PRIMARY KEY (id);
          END IF;
        END $$;
      `);
    } catch (_error) {
      // Keep migration non-destructive and avoid failing if an incompatible primary key already exists.
    }
  },

  down: async () => {
    // Intentionally left as a no-op to keep this migration non-destructive.
  },
};
