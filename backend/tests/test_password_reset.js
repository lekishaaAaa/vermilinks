const bcrypt = require('bcryptjs');
const request = require('supertest');

const sentResetEmails = [];

jest.mock('../services/emailService', () => ({
  sendEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(async (payload) => {
    sentResetEmails.push(payload);
  }),
}));

const app = require('../test-utils/testServerHelper');
const sequelize = require('../services/database_pg');
const Admin = require('../models/Admin');
const PasswordResetToken = require('../models/PasswordResetToken');

process.env.RESET_TOKEN_EXPIRY_MINUTES = process.env.RESET_TOKEN_EXPIRY_MINUTES || '15';
process.env.RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS || '900000';
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '5';

describe('Admin password reset flow', () => {
  let admin;

  beforeAll(async () => {
    await sequelize.sync({ force: true });
    admin = await Admin.create({
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash('InitialPass123!', 12),
    });
  });

  beforeEach(async () => {
    sentResetEmails.length = 0;
    await PasswordResetToken.destroy({ where: {} });
  });

  it('issues a single-use reset token and rejects reuse', async () => {
    const forgotRes = await request(app)
      .post('/api/admin/forgot-password')
      .send({ email: admin.email });

    expect(forgotRes.status).toBe(200);
    expect(sentResetEmails.length).toBe(1);
    const token = sentResetEmails[0].token;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(32);

    const resetRes = await request(app)
      .post('/api/admin/reset-password')
      .send({ token, password: 'NewSecurePass!45' });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

  await admin.reload();
  const passwordMatches = await bcrypt.compare('NewSecurePass!45', admin.passwordHash);
    expect(passwordMatches).toBe(true);

    const reuseRes = await request(app)
      .post('/api/admin/reset-password')
      .send({ token, password: 'AnotherPass!56' });

    expect(reuseRes.status).toBe(400);
    expect(reuseRes.body.success).toBe(false);

    const tokenRecord = await PasswordResetToken.findOne({ where: { userId: admin.id } });
    expect(tokenRecord).not.toBeNull();
    expect(tokenRecord.used).toBe(true);
  });
});
