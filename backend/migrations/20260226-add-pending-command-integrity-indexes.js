'use strict';

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

async function indexExists(queryInterface, tableName, indexName) {
  try {
    const indexes = await queryInterface.showIndex(tableName);
    return (indexes || []).some((idx) => idx && idx.name === indexName);
  } catch (error) {
    return false;
  }
}

async function constraintExists(sequelize, tableName, constraintName) {
  try {
    const [rows] = await sequelize.query(
      `SELECT 1 FROM information_schema.table_constraints WHERE table_name = :tableName AND constraint_name = :constraintName LIMIT 1`,
      { replacements: { tableName, constraintName } },
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    return false;
  }
}

module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'pending_commands')) {
      if (!(await indexExists(queryInterface, 'pending_commands', 'pending_commands_device_status_created_idx'))) {
        await queryInterface.addIndex('pending_commands', ['device_id', 'status', 'created_at'], {
          name: 'pending_commands_device_status_created_idx',
        });
      }

      if (!(await indexExists(queryInterface, 'pending_commands', 'pending_commands_status_created_idx'))) {
        await queryInterface.addIndex('pending_commands', ['status', 'created_at'], {
          name: 'pending_commands_status_created_idx',
        });
      }

      if (!(await indexExists(queryInterface, 'pending_commands', 'pending_commands_device_id_idx'))) {
        await queryInterface.addIndex('pending_commands', ['device_id'], {
          name: 'pending_commands_device_id_idx',
        });
      }

      if (await tableExists(queryInterface, 'devices')) {
        await sequelize.query(`
          INSERT INTO devices ("deviceId", status, online, "lastHeartbeat", updated_at)
          SELECT DISTINCT pc.device_id, 'offline', false, NULL, NOW()
          FROM pending_commands pc
          LEFT JOIN devices d ON d."deviceId" = pc.device_id
          WHERE d.id IS NULL
        `).catch(() => {});

        if (!(await constraintExists(sequelize, 'pending_commands', 'pending_commands_device_id_fkey'))) {
          await queryInterface.addConstraint('pending_commands', {
            fields: ['device_id'],
            type: 'foreign key',
            name: 'pending_commands_device_id_fkey',
            references: {
              table: 'devices',
              field: 'deviceId',
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          });
        }
      }
    }

    if (await tableExists(queryInterface, 'sensor_data')) {
      const tableDescription = await queryInterface.describeTable('sensor_data');
      if (tableDescription.deviceId && !tableDescription.device_id) {
        await queryInterface.renameColumn('sensor_data', 'deviceId', 'device_id');
      }
      if (tableDescription.timestamp && !tableDescription.created_at) {
        await queryInterface.renameColumn('sensor_data', 'timestamp', 'created_at');
      }

      if (!(await indexExists(queryInterface, 'sensor_data', 'sensor_data_device_created_idx'))) {
        await queryInterface.addIndex('sensor_data', ['device_id', 'created_at'], {
          name: 'sensor_data_device_created_idx',
        });
      }
    }
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'pending_commands')) {
      await queryInterface.removeConstraint('pending_commands', 'pending_commands_device_id_fkey').catch(() => {});
      await queryInterface.removeIndex('pending_commands', 'pending_commands_device_status_created_idx').catch(() => {});
      await queryInterface.removeIndex('pending_commands', 'pending_commands_status_created_idx').catch(() => {});
      await queryInterface.removeIndex('pending_commands', 'pending_commands_device_id_idx').catch(() => {});
    }

    if (await tableExists(queryInterface, 'sensor_data')) {
      await queryInterface.removeIndex('sensor_data', 'sensor_data_device_created_idx').catch(() => {});
    }
  },
};
