const sequelize = require('./database_pg');
const Device = require('../models/Device');
const DevicePort = require('../models/DevicePort');
const DeviceCommand = require('../models/DeviceCommand');

const ALLOWED_PORT_TYPES = new Set(['UART', 'I2C', 'GPIO', 'SPI', 'OTHER']);
const ENUM_TIMEOUT_MS = Number(process.env.DEVICE_ENUMERATION_TIMEOUT_MS || 8000);

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePortType(type) {
  if (!type && type !== 0) return '';
  return String(type).trim().toUpperCase();
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return {};
  }
}

function resolveSocketForDevice(device) {
  if (!device || !device.deviceId) {
    return { socket: null, hardwareId: null };
  }
  if (global.deviceSockets && typeof global.deviceSockets.get === 'function') {
    const socket = global.deviceSockets.get(device.deviceId);
    if (socket) {
      return { socket, hardwareId: device.deviceId };
    }
  }
  return { socket: null, hardwareId: device.deviceId };
}

function presentPortRecord(record) {
  if (!record) return null;
  const plain = record.get ? record.get({ plain: true }) : record;
  const configuredAt = plain.configured_at instanceof Date
    ? plain.configured_at.toISOString()
    : plain.configured_at || null;

  const metadata = plain.metadata && typeof plain.metadata === 'object'
    ? plain.metadata
    : null;

  const status = metadata && typeof metadata.status === 'string'
    ? metadata.status
    : (configuredAt ? 'active' : 'unknown');

  return {
    id: plain.id,
    device_id: plain.device_id,
    port_name: plain.port_name,
    port_type: plain.port_type,
    baud_rate: plain.baud_rate || null,
    metadata,
    configured_at: configuredAt,
    configured_by: plain.configured_by || null,
    status,
    known: true,
  };
}

async function ensureDevice(rawDeviceId) {
  const parsedId = Number(rawDeviceId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw createHttpError(400, 'Invalid device id');
  }
  const device = await Device.findByPk(parsedId);
  if (!device) {
    throw createHttpError(404, 'Device not found');
  }
  return device;
}

async function queueDeviceCommand(device, socket) {
  let commandRecord = null;
  try {
    commandRecord = await DeviceCommand.create({
      device_id: device.id,
      command_type: 'enumerate_ports',
      payload: { source: 'admin-api', requestedAt: new Date().toISOString() },
      status: socket ? 'dispatched' : 'queued',
      requested_at: new Date(),
      dispatched_at: socket ? new Date() : null,
    });

    if (socket && typeof socket.send === 'function') {
      const message = {
        type: 'command',
        command: 'enumerate_ports',
        commandId: commandRecord.id,
        timeoutMs: ENUM_TIMEOUT_MS,
        requestedAt: commandRecord.requested_at instanceof Date
          ? commandRecord.requested_at.toISOString()
          : new Date().toISOString(),
      };
      socket.send(JSON.stringify(message));
    }
  } catch (error) {
    console.warn('devicePortsService.queueDeviceCommand: failed to create dispatch record', error && error.message ? error.message : error);
  }
  return commandRecord;
}

async function listKnownDevicePorts(rawDeviceId) {
  const device = await ensureDevice(rawDeviceId);
  const rows = await DevicePort.findAll({
    where: { device_id: device.id },
    order: [['port_name', 'ASC']],
  });
  return rows.map((row) => presentPortRecord(row));
}

async function enumerateDevicePorts(rawDeviceId) {
  const device = await ensureDevice(rawDeviceId);
  const ports = await listKnownDevicePorts(device.id);
  const { socket, hardwareId } = resolveSocketForDevice(device);
  const command = await queueDeviceCommand(device, socket);

  return {
    ports,
    devicePingable: Boolean(socket),
    commandId: command ? command.id : null,
    hardwareId,
    source: socket ? 'live-dispatch' : 'db-fallback',
  };
}

async function assignPort(rawDeviceId, payload, adminUserId) {
  if (!payload || typeof payload !== 'object') {
    throw createHttpError(400, 'Invalid payload');
  }

  const device = await ensureDevice(rawDeviceId);
  const portName = String(payload.port_name || '').trim();
  if (!portName) {
    throw createHttpError(400, 'port_name is required');
  }

  const normalizedType = normalizePortType(payload.port_type);
  if (!ALLOWED_PORT_TYPES.has(normalizedType)) {
    throw createHttpError(400, `Unsupported port_type. Allowed: ${Array.from(ALLOWED_PORT_TYPES).join(', ')}`);
  }

  let baudRate = null;
  if (payload.baud_rate !== undefined && payload.baud_rate !== null && payload.baud_rate !== '') {
    const numeric = Number(payload.baud_rate);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw createHttpError(400, 'baud_rate must be a positive number');
    }
    baudRate = Math.floor(numeric);
  }

  const assignment = payload.assignment && typeof payload.assignment === 'object'
    ? sanitizeMetadata(payload.assignment)
    : null;

  const metadataPatch = sanitizeMetadata(payload.metadata);
  if (assignment) {
    metadataPatch.assignment = assignment;
  }
  if (!metadataPatch.status) {
    metadataPatch.status = 'assigned';
  }
  metadataPatch.lastAssignedAt = new Date().toISOString();

  let configuredBy = null;
  if (adminUserId !== undefined && adminUserId !== null && adminUserId !== '') {
    const numericAdmin = Number(adminUserId);
    if (Number.isInteger(numericAdmin)) {
      configuredBy = numericAdmin;
    }
  }
  const now = new Date();

  const transaction = await sequelize.transaction();
  try {
    const [record, created] = await DevicePort.findOrCreate({
      where: { device_id: device.id, port_name: portName },
      defaults: {
        port_type: normalizedType,
        baud_rate: baudRate,
        metadata: metadataPatch,
        configured_at: now,
        configured_by: configuredBy,
      },
      transaction,
    });

    if (!created) {
      if (record.port_type !== normalizedType) {
        record.port_type = normalizedType;
      }
      if (baudRate !== null) {
        record.baud_rate = baudRate;
      }
      const mergedMetadata = {
        ...(record.metadata && typeof record.metadata === 'object' ? record.metadata : {}),
        ...metadataPatch,
      };
      record.metadata = mergedMetadata;
      record.configured_at = now;
      record.configured_by = configuredBy;
      await record.save({ transaction });
    }

    await transaction.commit();
    await record.reload();
    console.log('devicePortsService.assignPort: stored configuration', {
      deviceId: device.id,
      port: portName,
      type: normalizedType,
      configuredBy,
    });
    return presentPortRecord(record);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function recordDevicePortReport(hardwareId, payload = {}) {
  const device = await Device.findOne({ where: { deviceId: hardwareId } });
  if (!device) {
    throw createHttpError(404, 'Device not registered');
  }

  const portsPayload = Array.isArray(payload.ports) ? payload.ports : [];
  const commandId = payload.commandId || payload.command_id || null;
  const transaction = await sequelize.transaction();
  const processed = [];

  try {
    for (const rawPort of portsPayload) {
      if (!rawPort) continue;
      const portName = String(rawPort.port_name || rawPort.name || '').trim();
      if (!portName) continue;

      const normalizedType = normalizePortType(rawPort.port_type || rawPort.type || 'OTHER');
      const safeType = ALLOWED_PORT_TYPES.has(normalizedType) ? normalizedType : 'OTHER';
      const rawBaud = rawPort.baud_rate ?? rawPort.baudRate;
      const numericBaud = rawBaud !== undefined && rawBaud !== null && rawBaud !== '' ? Number(rawBaud) : null;
      const metadataPatch = sanitizeMetadata(rawPort.metadata);
      metadataPatch.status = rawPort.status || rawPort.state || metadataPatch.status || 'unknown';
      metadataPatch.source = 'device-report';
      metadataPatch.lastEnumerationAt = new Date().toISOString();
      if (rawPort.assigned_sensor) {
        metadataPatch.assigned_sensor = rawPort.assigned_sensor;
      }

      const [record, created] = await DevicePort.findOrCreate({
        where: { device_id: device.id, port_name: portName },
        defaults: {
          port_type: safeType,
          baud_rate: Number.isFinite(numericBaud) ? Math.floor(numericBaud) : null,
          metadata: metadataPatch,
        },
        transaction,
      });

      if (!created) {
        record.port_type = safeType;
        if (Number.isFinite(numericBaud) && numericBaud > 0) {
          record.baud_rate = Math.floor(numericBaud);
        }
        const merged = {
          ...(record.metadata && typeof record.metadata === 'object' ? record.metadata : {}),
          ...metadataPatch,
        };
        record.metadata = merged;
        await record.save({ transaction });
      }
      processed.push(record.id);
    }

    if (commandId) {
      const command = await DeviceCommand.findByPk(commandId, { transaction });
      if (command) {
        command.status = 'completed';
        command.response_payload = { ports: portsPayload };
        command.response_received_at = new Date();
        await command.save({ transaction });
      }
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    console.error('devicePortsService.recordDevicePortReport error', error && error.message ? error.message : error);
    throw error;
  }

  const rows = await DevicePort.findAll({
    where: { device_id: device.id },
    order: [['port_name', 'ASC']],
  });

  return {
    deviceId: device.id,
    hardwareId,
    commandId,
    ports: rows.map((row) => presentPortRecord(row)),
    processed,
  };
}

module.exports = {
  enumerateDevicePorts,
  assignPort,
  listKnownDevicePorts,
  recordDevicePortReport,
  ALLOWED_PORT_TYPES: Array.from(ALLOWED_PORT_TYPES),
};
