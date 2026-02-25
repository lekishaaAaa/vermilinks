#!/usr/bin/env node
/*
 Robust smoke test for actuators:
 - Tries to login via /api/admin/login using LOCAL_ADMIN_USER/PASS or defaults
 - If login fails, synthesizes an admin JWT using JWT_SECRET
 - Posts pump and valve commands for deviceId 'smoke-sim-01'
 - Attempts to read actuator logs for that device
 - Declares success if the actuator endpoints accepted the commands (200 + success true) or logs were created
*/

const child_process = require('child_process');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./backend/utils/jwtSecret');

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:5000';
const ADMIN_USER = process.env.LOCAL_ADMIN_USER;
const ADMIN_PASS = process.env.LOCAL_ADMIN_PASS;
const JWT_SECRET = getJwtSecret();
const DEVICE_ID = process.env.SMOKE_DEVICE_ID || 'smoke-sim-01';

async function safeFetch(url, opts) {
  if (typeof fetch === 'undefined') {
    // Node <18 fallback: use http/https
    const { URL } = require('url');
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    return new Promise((resolve, reject) => {
      const req = lib.request(u, { method: opts && opts.method ? opts.method : 'GET', headers: (opts && opts.headers) || {} }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          res.text = () => Promise.resolve(body);
          try { res.json = () => Promise.resolve(JSON.parse(body)); } catch (e) { res.json = () => Promise.reject(e); }
          resolve(res);
        });
      });
      req.on('error', reject);
      if (opts && opts.body) req.write(opts.body);
      req.end();
    });
  }

  return fetch(url, opts);
}

async function loginOrMakeToken() {
  if (ADMIN_USER && ADMIN_PASS) {
    try {
      const resp = await safeFetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
      });
      if (resp && resp.status === 200) {
        const body = await resp.json();
        if (body && body.success && body.token) {
          console.log('Logged in via /api/admin/login');
          return body.token;
        }
      }
      console.warn('/api/admin/login did not return a usable token; falling back to synthesized JWT');
    } catch (e) {
      console.warn('Admin login failed:', e && e.message ? e.message : e);
    }
  }

  // Synthesize token matching server admin route fallback
  try {
  const payload = { id: 'admin-local', username: ADMIN_USER || 'admin', role: 'admin' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    console.log('Synthesized admin JWT using local secret fallback');
    return token;
  } catch (e) {
    console.error('Failed to synthesize JWT:', e && e.message ? e.message : e);
    throw e;
  }
}

async function postActuator(path, body, token) {
  try {
    const resp = await safeFetch(`${API_BASE}/api/actuators/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const text = await resp.text();
    try { const json = JSON.parse(text); return { ok: resp.status >=200 && resp.status < 300, status: resp.status, body: json }; } catch(e) { return { ok: resp.status >=200 && resp.status < 300, status: resp.status, body: text }; }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function getLogs(deviceId, token) {
  try {
    const url = `${API_BASE}/api/actuators/logs?limit=5&deviceId=${encodeURIComponent(deviceId)}`;
    const resp = await safeFetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await resp.json().catch(() => null);
    return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, body: json };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function run() {
  try {
    const token = await loginOrMakeToken();

    console.log('Using token (first 12 chars):', token && token.slice(0,12));

    console.log('Posting pump ON...');
    const pumpRes = await postActuator('pump', { deviceId: DEVICE_ID, action: 'on' }, token);
    console.log('pump response:', pumpRes.status || pumpRes.error, pumpRes.body || pumpRes.error);

    console.log('Posting valve open...');
    const valveRes = await postActuator('valve', { deviceId: DEVICE_ID, action: 'open' }, token);
    console.log('valve response:', valveRes.status || valveRes.error, valveRes.body || valveRes.error);

    // Try to get logs
    console.log('Fetching actuator logs for device', DEVICE_ID);
    const logsRes = await getLogs(DEVICE_ID, token);
    if (logsRes.ok && logsRes.body && Array.isArray(logsRes.body.logs) && logsRes.body.logs.length > 0) {
      console.log('Found logs:', logsRes.body.logs.map(l => ({ id: l.id, actuatorType: l.actuatorType, action: l.action, timestamp: l.timestamp }))); 
      console.log('\nSMOKE TEST: SUCCESS (logs present)');
      process.exit(0);
    }

    // If logs missing, still consider success if both actuator endpoints returned OK and success:true
    const pumpOk = pumpRes && pumpRes.ok && pumpRes.body && pumpRes.body.success;
    const valveOk = valveRes && valveRes.ok && valveRes.body && valveRes.body.success;
    if (pumpOk && valveOk) {
      console.log('\nSMOKE TEST: SUCCESS (endpoints accepted commands, logs not available but commands processed)');
      process.exit(0);
    }

    // Otherwise, print diagnostics and fail
    console.error('\nSMOKE TEST: FAILED');
    console.error('pumpRes:', pumpRes);
    console.error('valveRes:', valveRes);
    console.error('logsRes:', logsRes);
    process.exit(2);

  } catch (e) {
    console.error('Smoke test fatal error:', e && e.message ? e.message : e);
    process.exit(3);
  }
}

run();
