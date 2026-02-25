"use strict";

const { DataTypes } = require('sequelize');

module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    let definition = null;
    try {
      definition = await queryInterface.describeTable('alerts');
    } catch (err) {
      console.warn('[alerts timestamps] unable to describe alerts table', err && err.message ? err.message : err);
      definition = null;
    }

    const addColumnIfMissing = async (columnName, attributes) => {
      const alreadyPresent = definition && Object.prototype.hasOwnProperty.call(definition, columnName);
      if (alreadyPresent) {
        return;
      }
      try {
        await queryInterface.addColumn('alerts', columnName, attributes);
        console.log(`[alerts timestamps] added column ${columnName}`);
      } catch (err) {
        const message = err && err.message ? err.message : err;
        if (message && message.includes('exists')) {
          return;
        }
        throw err;
      }
    };

    await addColumnIfMissing('created_at', {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: sequelize.fn('NOW'),
    });

    await addColumnIfMissing('updated_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const dropColumnIfPresent = async (columnName) => {
      try {
        const definition = await queryInterface.describeTable('alerts');
        if (definition && Object.prototype.hasOwnProperty.call(definition, columnName)) {
          await queryInterface.removeColumn('alerts', columnName);
          console.log(`[alerts timestamps] removed column ${columnName}`);
        }
      } catch (err) {
        console.warn(`[alerts timestamps] unable to drop ${columnName}`, err && err.message ? err.message : err);
      }
    };

    await dropColumnIfPresent('created_at');
    await dropColumnIfPresent('updated_at');
  },
};
