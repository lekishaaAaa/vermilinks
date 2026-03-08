// deviceManager: tracks device heartbeats and exposes helpers to mark online/offline
const Device = require('../models/Device');
const Alert = require('../models/Alert');
const { ensureDatabaseSetup } = require('../services/database_pg');
const { REALTIME_EVENTS, emitRealtime } = require('../utils/realtime');

const schemaReady = ensureDatabaseSetup({ force: (process.env.NODE_ENV || 'development') === 'test' });

async function ensureReady() {
  if (schemaReady && typeof schemaReady.then === 'function') {
    await schemaReady;
  }
}

// Default offline timeout (ms) — devices must heartbeat at least every 10 seconds
const OFFLINE_TIMEOUT_MS = parseInt(process.env.DEVICE_OFFLINE_TIMEOUT_MS || process.env.SENSOR_STALE_THRESHOLD_MS || '60000', 10);
const PRESENCE_SWEEP_INTERVAL_MS = Math.max(
  5000,
  parseInt(process.env.PRESENCE_SWEEP_INTERVAL_MS || '10000', 10),
);
let presenceSweepStarted = false;

function normalizeDeviceId(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  return normalized || null;
}

async function markDeviceOnline(deviceId, metadata = {}) {
  deviceId = normalizeDeviceId(deviceId);
  if (!deviceId) return null;
  await ensureReady();
  const now = new Date();
  const [device] = await Device.findOrCreate({ where: { deviceId }, defaults: { deviceId, status: 'online', lastHeartbeat: now, metadata } });
  if (device.lastHeartbeat == null || new Date(device.lastHeartbeat) < now) {
    device.lastHeartbeat = now;
    device.lastSeen = now;
    device.updatedAt = now;
    device.status = 'online';
    device.online = true;
    device.metadata = metadata || device.metadata;
    await device.save();
  }
  // Broadcast device status via Socket.IO
  try {
    const payload = {
      deviceId,
      status: 'online',
      online: true,
      lastHeartbeat: device.lastHeartbeat,
      event: 'online',
    };
    emitRealtime(REALTIME_EVENTS.DEVICE_STATUS, payload);
  } catch (e) {
    // ignore emit errors
  }
  return device;
}

function resetOfflineTimer(deviceId) {
  return deviceId;
}

function isHeartbeatStale(device, now = Date.now()) {
  if (!device || !device.lastHeartbeat) {
    return true;
  }
  const last = new Date(device.lastHeartbeat).getTime();
  if (!Number.isFinite(last)) {
    return true;
  }
  return now - last > OFFLINE_TIMEOUT_MS;
}

async function reconcilePresenceFromDatabase() {
  await ensureReady();
  const now = Date.now();
  const devices = await Device.findAll();

  for (const device of devices) {
    const shouldBeOffline =
      (device.online === true || device.status === 'online') &&
      isHeartbeatStale(device, now);

    if (shouldBeOffline) {
      await markDeviceOffline(device.deviceId);
      continue;
    }

    emitRealtime(REALTIME_EVENTS.DEVICE_STATUS, {
      deviceId: device.deviceId,
      status: device.online === true || device.status === 'online' ? 'online' : 'offline',
      online: device.online === true || device.status === 'online',
      lastHeartbeat: device.lastHeartbeat || null,
      event: 'startup-sync',
    });
  }
}

function startPresenceReconciliation() {
  if (presenceSweepStarted || (process.env.NODE_ENV || 'development') === 'test') {
    return;
  }
  presenceSweepStarted = true;

  reconcilePresenceFromDatabase().catch((e) => {
    console.error('Presence reconciliation failed:', e && e.message ? e.message : e);
  });

  const timer = setInterval(() => {
    reconcilePresenceFromDatabase().catch((e) => {
      console.error('Presence reconciliation failed:', e && e.message ? e.message : e);
    });
  }, PRESENCE_SWEEP_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

async function markDeviceOffline(deviceId) {
  deviceId = normalizeDeviceId(deviceId);
  if (!deviceId) return null;
  await ensureReady();
  const device = await Device.findOne({ where: { deviceId } });
  if (!device) return null;
  const now = new Date();
  device.status = 'offline';
  device.online = false;
  device.updatedAt = now;
  device.lastHeartbeat = now;
  await device.save();
  // resolve alerts related to this device
  try {
    await Alert.update({ isResolved: true, resolvedAt: new Date() }, { where: { deviceId, isResolved: false } });
  } catch (e) {
    console.warn('Failed to resolve alerts for offline device', deviceId, e && e.message ? e.message : e);
  }
  // emit WebSocket / broadcast event if needed
  try {
    if (global.wsConnections && global.wsConnections.size) {
      const message = JSON.stringify({ type: 'device_offline', deviceId });
      global.wsConnections.forEach(ws => { try { if (ws.readyState === 1) ws.send(message); } catch (e) {} });
    }
  } catch (e) { /* ignore */ }
  try {
    const payload = {
      deviceId,
      status: 'offline',
      online: false,
      lastHeartbeat: device.lastHeartbeat,
      event: 'offline',
    };
    emitRealtime(REALTIME_EVENTS.DEVICE_STATUS, payload);
  } catch (e) { /* ignore */ }
  return device;
}

module.exports = { markDeviceOnline, markDeviceOffline, resetOfflineTimer, reconcilePresenceFromDatabase, startPresenceReconciliation };
