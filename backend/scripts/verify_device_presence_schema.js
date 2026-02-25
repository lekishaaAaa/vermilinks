const sequelize = require('../services/database_pg');

async function run() {
  await sequelize.authenticate();

  const qi = sequelize.getQueryInterface();
  const description = await qi.describeTable('devices');

  const columnNames = Object.keys(description || {}).sort();
  console.log('devices columns:', columnNames);

  const required = ['online', 'last_seen', 'updated_at'];
  const missing = required.filter((name) => !Object.prototype.hasOwnProperty.call(description, name));
  console.log('required columns missing:', missing);

  try {
    const [indexes] = await sequelize.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'devices' ORDER BY indexname;`
    );
    const onlineIndexes = (indexes || []).filter((row) => String(row.indexdef || '').includes('(online)'));
    console.log('devices indexes (pg):', indexes);
    console.log('online index present:', onlineIndexes.length > 0);
  } catch (e) {
    console.log('index inspection skipped (non-postgres or insufficient perms)');
  }

  // Note: the legacy column is "deviceId" (camelCase) in this schema.
  const [rows] = await sequelize.query(
    'SELECT "deviceId" AS device_id, online, last_seen, updated_at, status FROM devices ORDER BY updated_at DESC NULLS LAST LIMIT 50;'
  );
  console.log('devices presence rows (sample):', rows);

  await sequelize.close();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('verify_device_presence_schema failed:', err && err.message ? err.message : err);
    process.exit(1);
  });
}
