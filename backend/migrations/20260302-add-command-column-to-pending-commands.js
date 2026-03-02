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
    const tableName = 'pending_commands';

    if (!(await tableExists(queryInterface, tableName))) {
      return;
    }

    const description = await queryInterface.describeTable(tableName);
    if (!description.command) {
      await queryInterface.addColumn(tableName, 'command', {
        type: DataTypes.STRING,
        allowNull: true,
      });
    }
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = 'pending_commands';

    if (!(await tableExists(queryInterface, tableName))) {
      return;
    }

    const description = await queryInterface.describeTable(tableName);
    if (description.command) {
      await queryInterface.removeColumn(tableName, 'command');
    }
  },
};
