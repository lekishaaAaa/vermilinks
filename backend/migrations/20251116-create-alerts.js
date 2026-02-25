const { DataTypes } = require('sequelize');

// idempotent migration: create alerts table if missing
module.exports = {
  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = 'alerts';
    const exists = await queryInterface.sequelize.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = '${tableName}'`
    );
    if (Array.isArray(exists) && exists[0] && exists[0].length > 0) {
      return;
    }

    await queryInterface.createTable(tableName, {
      id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      type: { type: DataTypes.STRING, allowNull: false },
      severity: { type: DataTypes.STRING, allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      device_id: { type: DataTypes.STRING, allowNull: true },
      sensor_data: { type: DataTypes.JSONB || DataTypes.JSON, allowNull: true },
      is_resolved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      acknowledged_by: { type: DataTypes.STRING, allowNull: true },
      acknowledged_at: { type: DataTypes.DATE, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'new' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.fn('NOW') },
      updated_at: { type: DataTypes.DATE, allowNull: true },
    });
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable('alerts');
  }
};
