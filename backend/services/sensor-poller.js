/*
Simple sensor poller service
- Polls configured REST endpoint for latest sensor readings
- Normalizes to stable schema
- Appends to backend/data/sensor-stream.jsonl (atomic writes)
- Exposes /internal/sensor-agg for last poll time and counts
*/

const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');

const POLL_URL = process.env.POLL_URL || 'https://vermilinks.onrender.com/api/sensors/latest';
const POLL_MS = parseInt(process.env.POLL_MS || '5000', 10);
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3', 10);
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(__dirname, '..', 'data', 'sensor-stream.jsonl');
const JWT = process.env.JWT;

let running = false;
let inFlight = 0;
let lastPollTime = null;
let counts = {};
let memStore = [];

function normalize(raw) {
  const out = {
    timestamp: new Date().toISOString(),
    sensorId: raw.id || raw.sensorId || String(raw.device || raw.dev || 'unknown'),
    type: 'other',
    value: Number(raw.value ?? raw.v ?? raw.val ?? 0),
    unit: raw.unit || raw.u || '',
    meta: { raw }
  };

  const t = (raw.type || raw.measurement || raw.m || '').toString().toLowerCase();
  if (t.includes('temp')) out.type = 'temperature';
  else if (t.includes('humid')) out.type = 'humidity';
  else if (t.includes('moist')) out.type = 'moisture';
  else if (t.includes('batt') || t.includes('battery')) out.type = 'battery';
  else if (t.includes('phosphorus') || t === 'p') out.type = 'phosphorus';
  else if (t.includes('potassium') || t === 'k') out.type = 'potassium';
  else if (t.includes('nitrogen') || t === 'n') out.type = 'nitrogen';
  else if (t === 'ec' || t.includes('conduct')) out.type = 'ec';
  else if (t === 'ph' || t.includes(' ph') || t.startsWith('ph') ) out.type = 'ph';
  else if (t.includes('water') || t.includes('waterlevel') || t.includes('water_level') || t.includes('level')) out.type = 'waterLevel';

  // ensure numeric parsing for common string values like '45' or '2.1' or '1' etc.
  if (typeof raw.value === 'string' && raw.value.trim() !== '') {
    const maybe = Number(raw.value);
    if (!Number.isNaN(maybe)) out.value = maybe;
  }

  return out;
}

function safeAppendLine(filePath, line) {
  const tmp = filePath + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, line + '\n', { encoding: 'utf8' });
  // append atomically by renaming tmp into append target via appendFile
  const data = fs.readFileSync(tmp, { encoding: 'utf8' });
  fs.appendFileSync(filePath, data, { encoding: 'utf8' });
  fs.unlinkSync(tmp);
}

async function pollOnce() {
  if (inFlight >= MAX_CONCURRENT) return;
  inFlight++;
  try {
    const headers = {};
    if (JWT) headers['Authorization'] = `Bearer ${JWT}`;
    const resp = await axios.get(POLL_URL, { headers, timeout: 10000 });
    const body = resp.data;
    // support array or single
    const items = Array.isArray(body) ? body : (body && body.data ? body.data : [body]);
    for (const it of items) {
      const n = normalize(it);
      memStore.push(n);
      counts[n.type] = (counts[n.type] || 0) + 1;
      try {
        // ensure data dir
        fs.mkdirSync(DATA_DIR, { recursive: true });
        safeAppendLine(OUT_FILE, JSON.stringify(n));
      } catch (e) {
        console.error('Failed to persist reading:', e && e.message ? e.message : e);
      }
    }
    lastPollTime = new Date().toISOString();
    console.log('Polled', POLL_URL, 'items=', items.length || 0, 'lastPollTime=', lastPollTime);
  } catch (err) {
    console.error('Poll error:', err && err.message ? err.message : err);
    throw err;
  } finally {
    inFlight--;
  }
}

async function runLoop() {
  running = true;
  let backoff = 1000;
  while (running) {
    try {
      await pollOnce();
      backoff = 1000; // reset
    } catch (e) {
      console.warn('Poll failed - backing off', backoff);
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(60000, backoff * 2);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

function stopLoop() {
  running = false;
}

// Retry helper: attempt pollOnce with exponential backoff until success or attempts exhausted
async function retryPollWithBackoff(maxAttempts = 5, baseMs = 1000) {
  let attempt = 0;
  let backoff = baseMs;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      await pollOnce();
      return { attempts: attempt, success: true };
    } catch (e) {
      if (attempt >= maxAttempts) {
        return { attempts: attempt, success: false, error: e };
      }
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(60000, backoff * 2);
    }
  }
  return { attempts: attempt, success: false };
}

function startServer(port = 3100) {
  const app = express();
  app.get('/internal/sensor-agg', (req, res) => {
    res.json({ lastPollTime, counts, memStoreLength: memStore.length });
  });
  app.get('/internal/health', (req, res) => res.json({ status: 'ok', lastPollTime }));
  const s = app.listen(port, () => console.log('Sensor poller internal server listening on', port));
  return s;
}

if (require.main === module) {
  // invoked directly
  startServer(process.env.INTERNAL_PORT ? Number(process.env.INTERNAL_PORT) : 3100);
  runLoop().catch(e => {
    console.error('Sensor poller exited with error:', e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { normalize, pollOnce, runLoop, stopLoop, startServer, retryPollWithBackoff };
