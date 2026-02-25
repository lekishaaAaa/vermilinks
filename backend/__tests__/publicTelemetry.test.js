const request = require('supertest');
const db = require('../services/database_pg');
const SensorSnapshot = require('../models/SensorSnapshot');
const SensorData = require('../models/SensorData');
const app = require('../test-utils/testServerHelper');

jest.setTimeout(20000);

describe('GET /api/public/telemetry', () => {
  beforeAll(async () => {
    await db.ensureDatabaseSetup({ force: true });
  });

  beforeEach(async () => {
    await SensorSnapshot.destroy({ where: {} });
    await SensorData.destroy({ where: {} });
  });

  afterAll(async () => {
    if (typeof db.close === 'function') {
      try {
        await db.close();
      } catch (error) {
        // ignore
      }
    }
  });

  test('returns latest snapshot data when available', async () => {
    const timestamp = new Date();
    await SensorSnapshot.upsert({
      deviceId: 'vermilinks-esp32',
      temperature: 22.5,
      humidity: 55.2,
      moisture: 480,
      floatSensor: 1,
      timestamp,
    });

    const res = await request(app)
      .get('/api/public/telemetry')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      temperature: 22.5,
      humidity: 55.2,
      soil_moisture: 480,
      float_state: 1,
    });
    expect(new Date(res.body.data.updated_at).getTime()).toBeGreaterThan(0);
  });

  test('falls back to SensorData when no snapshot exists', async () => {
    const timestamp = new Date();
    await SensorData.create({
      deviceId: 'device-42',
      temperature: 19.1,
      humidity: 60,
      moisture: 512,
      floatSensor: 0,
      timestamp,
    });

    const res = await request(app)
      .get('/api/public/telemetry?deviceId=device-42')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      temperature: 19.1,
      humidity: 60,
      soil_moisture: 512,
      float_state: 0,
    });
  });
});
