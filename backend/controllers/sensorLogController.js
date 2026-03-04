const { Op, literal } = require('sequelize');
const SensorLog = require('../models/SensorLog');
const sensorLogService = require('../services/sensorLogService');

const DEVICE_METRIC_DB_KEYS = ['uptime', 'ts', 'online', 'signalStrength', 'signal_strength', 'rssi'];

const getLikeOperator = () => {
  try {
    const dialect = SensorLog.sequelize.getDialect();
    return dialect === 'postgres' ? Op.iLike : Op.like;
  } catch (err) {
    return Op.like;
  }
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parsePositiveNumber = (value) => {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num > 0 ? num : null;
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || typeof value === 'undefined') {
    return false;
  }
  const normalized = value.toString().trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
};

exports.list = async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page || '1', 10), 1);
  const limitRaw = Number.parseInt(req.query.limit || '25', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1), 200);
  const offset = (page - 1) * limit;
  const where = {};
  const likeOp = getLikeOperator();

  const deviceId = req.query.deviceId ? req.query.deviceId.toString().trim() : '';
  if (deviceId) {
    where.deviceId = deviceId;
  }

  const sensorName = req.query.sensor ? req.query.sensor.toString().trim() : '';
  if (sensorName) {
    where.sensorName = sensorLogService.normalizeKey(sensorName);
  }

  const requestedCategory = req.query.category ? req.query.category.toString().trim().toLowerCase() : 'environmental';
  if (requestedCategory === 'device' || requestedCategory === 'device_metrics' || requestedCategory === 'device-metrics') {
    where.sensorName = { [Op.in]: DEVICE_METRIC_DB_KEYS };
  } else if (requestedCategory !== 'all') {
    where.sensorName = { [Op.notIn]: DEVICE_METRIC_DB_KEYS };
  }

  const origin = req.query.origin ? req.query.origin.toString().trim() : '';
  if (origin) {
    where.origin = origin;
  }

  const startDate = parseDate(req.query.start);
  const endDate = parseDate(req.query.end);
  if (startDate || endDate) {
    where.recordedAt = {};
    if (startDate) {
      where.recordedAt[Op.gte] = startDate;
    }
    if (endDate) {
      where.recordedAt[Op.lte] = endDate;
    }
  }

  const search = req.query.search ? req.query.search.toString().trim() : '';
  if (search) {
    const pattern = `%${search}%`;
    where[Op.or] = [
      { sensorName: { [likeOp]: pattern } },
      { deviceId: { [likeOp]: pattern } },
      { origin: { [likeOp]: pattern } },
    ];
    try {
      if (SensorLog.sequelize.getDialect() === 'postgres') {
        where[Op.or].push(
          SensorLog.sequelize.where(
            literal('CAST(raw_payload AS TEXT)'),
            { [likeOp]: pattern },
          ),
        );
      }
    } catch (err) {
      // fallback: ignore raw_payload search on dialects without CAST
    }
  }

  try {
    const { rows, count } = await SensorLog.findAndCountAll({
      where,
      order: [['recordedAt', 'DESC']],
      offset,
      limit,
    });

    const items = rows.map((row) => {
      const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
      const normalizedSensorName = sensorLogService.normalizeKey(plain.sensorName) || plain.sensorName;
      const category = sensorLogService.classifySensorCategory(normalizedSensorName);
      return {
        id: plain.id,
        deviceId: plain.deviceId,
        sensorName: normalizedSensorName,
        category,
        value: plain.value,
        unit: plain.unit,
        origin: plain.origin,
        recordedAt: plain.recordedAt ? new Date(plain.recordedAt).toISOString() : null,
        mqttTopic: plain.mqttTopic,
        rawPayload: plain.rawPayload,
      };
    });

    return res.json({
      success: true,
      data: {
        items,
        pagination: {
          current: page,
          limit,
          total: count,
          pages: Math.max(1, Math.ceil(count / limit)),
        },
      },
      meta: {
        sensors: Object.keys(sensorLogService.SENSOR_UNITS),
        categories: ['Environmental Sensors', 'Device Metrics'],
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load sensor logs', error: error && error.message ? error.message : error });
  }
};

exports.purge = async (req, res) => {
  const readParam = (key) => {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
      return req.body[key];
    }
    if (req.query && Object.prototype.hasOwnProperty.call(req.query, key)) {
      return req.query[key];
    }
    return undefined;
  };

  const readFromAliases = (...keys) => {
    for (const key of keys) {
      if (typeof key === 'string') {
        const value = readParam(key);
        if (typeof value !== 'undefined' && value !== null) {
          return value;
        }
      }
    }
    return undefined;
  };

  const where = {};
  const deviceId = readFromAliases('deviceId', 'device', 'device_id');
  if (deviceId && deviceId.toString().trim()) {
    where.deviceId = deviceId.toString().trim();
  }

  const sensorName = readFromAliases('sensor', 'sensorName');
  if (sensorName && sensorName.toString().trim()) {
    where.sensorName = sensorName.toString().trim();
  }

  const origin = readFromAliases('origin');
  if (origin && origin.toString().trim()) {
    where.origin = origin.toString().trim();
  }

  let cutoff = null;
  const beforeRaw = readFromAliases('before', 'cutoff');
  const daysRaw = readFromAliases('days', 'olderThanDays');
  if (beforeRaw) {
    cutoff = parseDate(beforeRaw);
  }
  if (!cutoff && daysRaw) {
    const days = parsePositiveNumber(daysRaw);
    if (days) {
      cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    }
  }

  if (!cutoff) {
    return res.status(400).json({ success: false, message: 'Provide a valid `before` ISO date or positive `days` value to target old logs.' });
  }

  where.recordedAt = { [Op.lt]: cutoff };

  const dryRun = parseBoolean(readFromAliases('dryRun', 'dry-run', 'preview'));

  try {
    const matched = await SensorLog.count({ where });
    if (dryRun) {
      return res.json({
        success: true,
        data: {
          dryRun: true,
          matched,
          deleted: 0,
          cutoff: cutoff.toISOString(),
        },
      });
    }

    if (matched === 0) {
      return res.json({ success: true, data: { deleted: 0, matched: 0, cutoff: cutoff.toISOString() } });
    }

    const deleted = await SensorLog.destroy({ where });
    return res.json({
      success: true,
      data: {
        deleted,
        matched,
        cutoff: cutoff.toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to purge sensor logs', error: error && error.message ? error.message : error });
  }
};

exports.remove = async (req, res) => {
  const readId = () => {
    if (req.params && typeof req.params.id !== 'undefined') {
      return req.params.id;
    }
    if (req.body && typeof req.body.id !== 'undefined') {
      return req.body.id;
    }
    if (req.query && typeof req.query.id !== 'undefined') {
      return req.query.id;
    }
    return undefined;
  };

  const rawId = readId();
  const parsedId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    return res.status(400).json({ success: false, message: 'Provide a valid sensor log ID to delete.' });
  }

  try {
    const log = await SensorLog.findByPk(parsedId);
    if (!log) {
      return res.status(404).json({ success: false, message: 'Sensor log not found.' });
    }

    await log.destroy();
    return res.json({ success: true, data: { deleted: 1, id: parsedId } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to delete sensor log', error: error && error.message ? error.message : error });
  }
};

exports.bulkRemove = async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const normalizedIds = ids
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!normalizedIds.length) {
    return res.status(400).json({ success: false, message: 'Provide a non-empty ids array.' });
  }

  try {
    const deleted = await SensorLog.destroy({ where: { id: { [Op.in]: normalizedIds } } });
    return res.json({ success: true, data: { deleted, ids: normalizedIds } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to bulk delete sensor logs', error: error && error.message ? error.message : error });
  }
};

exports.removeAll = async (req, res) => {
  try {
    const deleted = await SensorLog.destroy({ where: {}, truncate: false });
    return res.json({ success: true, data: { deleted } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to delete all sensor logs', error: error && error.message ? error.message : error });
  }
};
