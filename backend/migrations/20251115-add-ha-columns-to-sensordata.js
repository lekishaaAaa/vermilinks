'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const dialect = typeof sequelize.getDialect === 'function' ? sequelize.getDialect() : 'postgres';
    const jsonType = dialect === 'postgres' ? DataTypes.JSONB : DataTypes.JSON;
    const table = 'sensor_data';

    await queryInterface.addColumn(table, 'source', {
      type: DataTypes.STRING(64),
      allowNull: true,
    });

    await queryInterface.addColumn(table, 'raw_payload', {
      type: jsonType,
      allowNull: true,
    });

    const description = await queryInterface.describeTable(table);
    const deviceColumn = description.device_id ? 'device_id' : (description.deviceId ? 'deviceId' : null);
    const timestampColumn = description.created_at ? 'created_at' : (description.timestamp ? 'timestamp' : null);

    if (deviceColumn && timestampColumn) {
      await queryInterface.addIndex(table, [deviceColumn, timestampColumn], {
        name: 'sensor_data_device_created_idx',
      });
    }
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const table = 'sensor_data';
    await queryInterface.removeIndex(table, 'sensor_data_device_created_idx').catch(() => {});
    await queryInterface.removeColumn(table, 'raw_payload').catch(() => {});
    await queryInterface.removeColumn(table, 'source').catch(() => {});
  },
};
