const request = require('supertest');
const app = require('../test-utils/testServerHelper');
const database = require('../services/database_pg');
const sequelize = database;
const { ensureDatabaseSetup } = database;
const Device = require('../models/Device');
const jwt = require('jsonwebtoken');
require('../models/DevicePort');
require('../models/DeviceCommand');

describe('Admin device port management', () => {
  let token;
  let device;

  beforeAll(async () => {
    await ensureDatabaseSetup({ force: true });
    device = await Device.create({
      deviceId: 'esp-test-001',
      status: 'online',
      lastHeartbeat: new Date(),
    });
    token = jwt.sign(
      { id: 'admin-test', username: 'admin-test', role: 'admin' },
      process.env.JWT_SECRET || 'testsecret',
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    try {
      if (app && app.server && typeof app.server.close === 'function') {
        app.server.close();
      }
    } catch (e) {}
  });

  it('blocks enumerate without auth', async () => {
    const res = await request(app).get(`/api/admin/devices/${device.id}/ports/enumerate`);
    expect(res.status).toBe(401);
  });

  it('returns fallback enumeration when device offline', async () => {
    const res = await request(app)
      .get(`/api/admin/devices/${device.id}/ports/enumerate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.ports)).toBe(true);
    expect(res.body.ports.length).toBe(0);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.devicePingable).toBe(false);
  });

  it('validates port_type values', async () => {
    const res = await request(app)
      .post(`/api/admin/devices/${device.id}/ports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ port_name: 'BadPort', port_type: 'INVALID' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('assigns a port configuration', async () => {
    const payload = {
      port_name: 'UART0',
      port_type: 'UART',
      baud_rate: 115200,
      assignment: { sensor_id: 12, purpose: 'temperature' },
    };
    const res = await request(app)
      .post(`/api/admin/devices/${device.id}/ports`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.port_name).toBe('UART0');
    expect(res.body.data.port_type).toBe('UART');
    expect(res.body.data.baud_rate).toBe(115200);
    expect(res.body.data.known).toBe(true);
    expect(res.body.data.metadata.assignment).toMatchObject({ sensor_id: 12, purpose: 'temperature' });
    expect(res.body.data.configured_at).toBeTruthy();

    const enumerateAfterAssign = await request(app)
      .get(`/api/admin/devices/${device.id}/ports`)
      .set('Authorization', `Bearer ${token}`);

    expect(enumerateAfterAssign.status).toBe(200);
    expect(enumerateAfterAssign.body.success).toBe(true);
    expect(enumerateAfterAssign.body.ports.length).toBe(1);
    expect(enumerateAfterAssign.body.ports[0].port_name).toBe('UART0');
  });
});
