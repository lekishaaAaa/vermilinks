const axios = require('axios');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const ioClient = require('socket.io-client');

const BACKEND = process.env.VERMILINKS_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:10000';
const ADMIN_EMAIL = process.env.VERMILINKS_ADMIN_EMAIL || process.env.GMAIL_ADDRESS || '';
const ADMIN_PASSWORD = process.env.VERMILINKS_ADMIN_PASSWORD || '';
const GMAIL_USER = process.env.VERMILINKS_GMAIL_USER || process.env.GMAIL_USER || ADMIN_EMAIL;
const GMAIL_PASS = process.env.VERMILINKS_GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOtp() {
  if (!GMAIL_PASS) throw new Error('No Gmail app password configured in env');
  const client = new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.GMAIL_IMAP_PORT || 993),
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  await client.connect();
  await client.mailboxOpen('INBOX');
  const since = new Date(Date.now() - 10 * 60 * 1000);
  try {
    const uids = await client.search({ since }, { uid: true });
    const sorted = [...uids].sort((a,b) => b - a);
    for (const uid of sorted) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true });
      if (!msg || !msg.envelope) continue;
      const subject = (msg.envelope.subject || '').toLowerCase();
      if (!subject.includes('otp') && !subject.includes('verification')) continue;
      const parsed = await simpleParser(msg.source);
      const text = parsed.text || parsed.html || '';
      const match = text.match(/\b(\d{6})\b/);
      if (match) {
        return match[1];
      }
    }
  } finally {
    try { await client.logout(); } catch(e){}
  }
  throw new Error('OTP not found in recent emails');
}

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Missing admin credentials. Set VERMILINKS_ADMIN_EMAIL and VERMILINKS_ADMIN_PASSWORD.');
  }
  console.log('Backend:', BACKEND);

  const axiosInst = axios.create({ baseURL: BACKEND, timeout: 15000 });

  console.log('1) Requesting admin login (OTP)');
  const loginRes = await axiosInst.post('/api/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  console.log('login response:', loginRes.data && loginRes.data.message);

  console.log('2) Polling email for OTP');
  let otp = null;
  for (let i=0;i<8;i++) {
    try {
      otp = await fetchOtp();
      if (otp) break;
    } catch (e) {
      // ignore and retry
    }
    await sleep(4000);
  }
  if (!otp) throw new Error('Failed to fetch OTP');
  console.log('OTP fetched:', otp);

  console.log('3) Verifying OTP to receive token');
  const verifyRes = await axiosInst.post('/api/admin/verify-otp', { email: ADMIN_EMAIL, otp });
  if (!verifyRes.data || !verifyRes.data.data || !verifyRes.data.data.token) {
    throw new Error('OTP verify did not return token');
  }
  const token = verifyRes.data.data.token;
  console.log('Received admin token (trimmed):', token.slice(0,20) + '...');

  // Connect socket and listen for threshold_update
  console.log('4) Connecting Socket.IO to listen for threshold_update');
  const socket = ioClient(BACKEND, { auth: { token }, transports: ['websocket', 'polling'], timeout: 10000 });

  let sawThresholdUpdate = false;
  socket.on('connect', () => console.log('Socket connected', socket.id));
  socket.on('connect_error', (err) => console.warn('Socket connect error', err && err.message));
  socket.on('threshold_update', (payload) => {
    sawThresholdUpdate = true;
    console.log('Received threshold_update event:', payload);
  });

  // Wait for socket connected
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
      socket.once('connect', () => { clearTimeout(t); resolve(); });
      socket.once('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
  } catch (e) {
    console.warn('Socket connection failed or timed out; continuing without real-time verification:', e && e.message ? e.message : e);
  }

  // Prepare new thresholds to update
  const newThresholds = {
    temperature: { warning: 30, critical: 35 },
    humidity: { warning: 75, critical: 80 },
    moisture: { warning: 55, critical: 45 },
    ec: { warning: 2000, critical: 3000 },
    ph: { minWarning: 6.0, minCritical: 5.5, maxWarning: 7.5, maxCritical: 8.0 }
  };

  console.log('5) Sending PUT /api/settings/thresholds');
  let putRes;
  try {
    putRes = await axiosInst.put('/api/settings/thresholds', { thresholds: newThresholds }, { headers: { Authorization: `Bearer ${token}` } });
    console.log('PUT response:', putRes.data && putRes.data.message);
  } catch (err) {
    console.error('PUT failed:', (err.response && err.response.status), (err.response && err.response.data) || err.message);
    throw err;
  }

  // Wait a moment to receive socket event
  await sleep(1500);

  console.log('threshold_update seen via socket?', sawThresholdUpdate);

  console.log('6) GET /api/settings to confirm persisted values');
  const getRes = await axiosInst.get('/api/settings', { headers: { Authorization: `Bearer ${token}` } });
  console.log('GET settings success:', getRes.data && getRes.data.success);
  console.log('Stored thresholds snapshot:', JSON.stringify(getRes.data.data.thresholds, null, 2));

  console.log('7) Simulate sensor POST exceeding humidity critical threshold to trigger alert');
  const sensorPayload = {
    deviceId: process.env.PRIMARY_DEVICE_ID || process.env.DEFAULT_DEVICE_ID || 'ESP32-01',
    humidity: 82,
    temperature: 28,
    moisture: 60,
    ph: 7.0,
    ec: 500,
    timestamp: new Date().toISOString()
  };

  const postSensor = await axiosInst.post('/api/sensors', sensorPayload, { timeout: 10000 });
  console.log('Sensor POST status:', postSensor.status);

  console.log('8) Query recent alerts (admin) to find generated alert');
  await sleep(1000);
  const alertsRes = await axiosInst.get('/api/alerts/recent', { headers: { Authorization: `Bearer ${token}` } });
  console.log('Recent alerts count:', Array.isArray(alertsRes.data.data) ? alertsRes.data.data.length : 0);
  console.log('Recent alerts snapshot:', JSON.stringify(alertsRes.data.data.slice(0,5), null, 2));

  // Cleanup
  socket.disconnect();
  console.log('Test flow complete');
}

main().catch((err) => {
  console.error('Test flow error', err && err.message ? err.message : err);
  process.exitCode = 1;
});
