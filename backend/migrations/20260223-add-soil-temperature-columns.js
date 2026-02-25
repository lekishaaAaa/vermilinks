'use strict';

const { DataTypes } = require('sequelize');

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const description = await queryInterface.describeTable(tableName);
    return Object.prototype.hasOwnProperty.call(description, columnName);
  } catch (error) {
    return false;
  }
}

module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();

    const sensorDataTable = 'sensordata';
    if (!(await columnExists(queryInterface, sensorDataTable, 'soil_temperature'))) {
      await queryInterface.addColumn(sensorDataTable, 'soil_temperature', {
        type: DataTypes.FLOAT,
        allowNull: true,
      });
    }

    const snapshotTable = 'sensor_snapshots';
    if (!(await columnExists(queryInterface, snapshotTable, 'soil_temperature'))) {
      await queryInterface.addColumn(snapshotTable, 'soil_temperature', {
        type: DataTypes.FLOAT,
        allowNull: true,
      });
    }
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    try {
      await queryInterface.removeColumn('sensordata', 'soil_temperature');
    } catch (error) {
      // ignore
    }
    try {
      await queryInterface.removeColumn('sensor_snapshots', 'soil_temperature');
    } catch (error) {
      // ignore
    }
  },
};
