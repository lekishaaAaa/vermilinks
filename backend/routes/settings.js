const express = require('express');
const { body, validationResult } = require('express-validator');
const Settings = require('../models/Settings');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_ALERT_RULES = Settings.DEFAULT_ALERT_RULES || {
  temperature: true,
  humidity: true,
  moisture: true,
  ph: true,
  system: true,
  emailNotifications: false,
};

const truthyValues = new Set(['true', '1', 'yes', 'on', 'enabled']);

const findSettingRecord = async (key) => Settings.findOne({ where: { key } });

const upsertSettingValue = async (key, value) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const existing = await findSettingRecord(key);
  if (existing) {
    existing.value = serialized;
    await existing.save();
    return;
  }
  await Settings.create({ key, value: serialized });
};

const parseSettingValue = (raw, fallback) => {
  if (!raw || typeof raw.value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(raw.value);
  } catch {
    return fallback;
  }
};

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return truthyValues.has(value.trim().toLowerCase());
  return fallback;
};

// @route   GET /api/settings
// @desc    Get current settings
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    // If user is not admin, hide sensitive SMS settings
    if (req.user.role !== 'admin') {
      const publicSettings = {
        thresholds: settings.thresholds,
        monitoring: {
          dataCollectionInterval: settings.monitoring.dataCollectionInterval,
          dataRetentionDays: settings.monitoring.dataRetentionDays
        },
        system: {
          timezone: settings.system.timezone
        },
        alerts: settings.alerts || { ...DEFAULT_ALERT_RULES },
      };
      
      return res.json({
        success: true,
        data: publicSettings
      });
    }

    res.json({
      success: true,
      data: settings
    });

  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settings'
    });
  }
});

router.get('/alerts', auth, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    const config = settings.alerts || { ...DEFAULT_ALERT_RULES };
    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Error fetching alert configuration:', error);
    res.status(500).json({ success: false, message: 'Failed to load alert configuration' });
  }
});

// @route   PUT /api/settings
// @desc    Update settings with partial payload
// @access  Private (Admin only)
router.put('/', [auth, adminOnly], async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const updatableKeys = ['thresholds', 'alerts', 'sms', 'monitoring', 'vermitea', 'system'];

    for (const key of updatableKeys) {
      if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] && typeof payload[key] === 'object') {
        await upsertSettingValue(key, payload[key]);
      }
    }

    const settings = await Settings.getSettings();
    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: settings,
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating settings',
    });
  }
});

// @route   PUT /api/settings/thresholds
// @desc    Update alert thresholds
// @access  Private (Admin only)
router.put('/thresholds', [auth, adminOnly], async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    const existing = settings.thresholds || {};
    const payloadRoot = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = payloadRoot.thresholds && typeof payloadRoot.thresholds === 'object'
      ? payloadRoot.thresholds
      : payloadRoot;

    const metrics = ['temperature', 'humidity', 'moisture', 'batteryLevel', 'ec'];

    const parseMetric = (name) => {
      const current = existing[name] || {};
      const incoming = payload[name] || {};
      const base = { ...current };
      ['min', 'max', 'warning', 'critical'].forEach((key) => {
        if (incoming[key] === undefined) {
          return;
        }
        const value = Number(incoming[key]);
        if (Number.isFinite(value)) {
          base[key] = value;
        }
      });
      return base;
    };

    const nextThresholds = { ...existing };
    metrics.forEach((metric) => {
      nextThresholds[metric] = parseMetric(metric);
    });

    const incomingPh = payload.ph || {};
    const currentPh = existing.ph || {};
    nextThresholds.ph = {
      ...currentPh,
      ...(Number.isFinite(Number(incomingPh.minWarning)) ? { minWarning: Number(incomingPh.minWarning) } : {}),
      ...(Number.isFinite(Number(incomingPh.minCritical)) ? { minCritical: Number(incomingPh.minCritical) } : {}),
      ...(Number.isFinite(Number(incomingPh.maxWarning)) ? { maxWarning: Number(incomingPh.maxWarning) } : {}),
      ...(Number.isFinite(Number(incomingPh.maxCritical)) ? { maxCritical: Number(incomingPh.maxCritical) } : {}),
    };

    const validationErrors = [];

    const rangeWithin = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

    const metricBounds = {
      temperature: { min: -50, max: 100 },
      humidity: { min: 0, max: 100 },
      moisture: { min: 0, max: 100 },
      batteryLevel: { min: 0, max: 100 },
      ec: { min: 0, max: 10000 },
    };

    metrics.forEach((metric) => {
      const limits = metricBounds[metric];
      const data = nextThresholds[metric] || {};
      const minValue = Number.isFinite(Number(data.min)) ? Number(data.min) : null;
      const maxValue = Number.isFinite(Number(data.max)) ? Number(data.max) : null;
      const warning = Number.isFinite(Number(data.warning)) ? Number(data.warning) : null;
      const critical = Number.isFinite(Number(data.critical)) ? Number(data.critical) : null;

      if (minValue !== null && maxValue !== null && minValue >= maxValue) {
        validationErrors.push(`${metric}: min must be lower than max`);
      }

      if (limits) {
        if (minValue !== null && !rangeWithin(minValue, limits.min, limits.max)) {
          validationErrors.push(`${metric}: min must be between ${limits.min} and ${limits.max}`);
        }
        if (maxValue !== null && !rangeWithin(maxValue, limits.min, limits.max)) {
          validationErrors.push(`${metric}: max must be between ${limits.min} and ${limits.max}`);
        }
        if (warning !== null && !rangeWithin(warning, limits.min, limits.max)) {
          validationErrors.push(`${metric}: warning must be between ${limits.min} and ${limits.max}`);
        }
        if (critical !== null && !rangeWithin(critical, limits.min, limits.max)) {
          validationErrors.push(`${metric}: critical must be between ${limits.min} and ${limits.max}`);
        }
      }

      if (warning !== null && critical !== null) {
        if (metric === 'moisture' || metric === 'batteryLevel') {
          if (critical >= warning) {
            validationErrors.push(`${metric}: critical must be lower than warning`);
          }
        } else if (critical <= warning) {
          validationErrors.push(`${metric}: critical must be higher than warning`);
        }
      }
    });

    const { minWarning, minCritical, maxWarning, maxCritical } = nextThresholds.ph || {};
    const validPh = [minWarning, minCritical, maxWarning, maxCritical].map((value) => Number(value));
    const phInRange = (value) => Number.isFinite(value) && value >= 0 && value <= 14;

    validPh.forEach((value) => {
      if (!phInRange(value)) {
        validationErrors.push('ph: values must be between 0 and 14');
      }
    });

    if (Number.isFinite(minCritical) && Number.isFinite(minWarning) && minCritical >= minWarning) {
      validationErrors.push('ph: minimum critical must be lower than minimum warning');
    }
    if (Number.isFinite(maxCritical) && Number.isFinite(maxWarning) && maxCritical <= maxWarning) {
      validationErrors.push('ph: maximum critical must be higher than maximum warning');
    }
    if (
      Number.isFinite(minWarning) &&
      Number.isFinite(maxWarning) &&
      Number.isFinite(minCritical) &&
      Number.isFinite(maxCritical) &&
      !(minCritical <= minWarning && minWarning < maxWarning && maxWarning <= maxCritical)
    ) {
      validationErrors.push('ph: thresholds must be ordered as minCritical < minWarning < maxWarning < maxCritical');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Threshold validation failed',
        errors: validationErrors,
      });
    }

    const thresholdRecord = await Settings.findOne({ where: { key: 'thresholds' } });
    const serialized = JSON.stringify(nextThresholds);
    if (thresholdRecord) {
      thresholdRecord.value = serialized;
      await thresholdRecord.save();
    } else {
      await Settings.create({ key: 'thresholds', value: serialized });
    }

    // Broadcast threshold update to connected clients (Socket.IO)
    try {
      if (global.io && typeof global.io.emit === 'function') {
        // Attempt to detect connected socket count for informative logging
        let clientCount = null;
        try {
          if (global.io.sockets && global.io.sockets.sockets) {
            // socket.io v3+: sockets.sockets is a Map
            if (typeof global.io.sockets.sockets.size === 'number') {
              clientCount = global.io.sockets.sockets.size;
            } else if (typeof Object.keys === 'function') {
              clientCount = Object.keys(global.io.sockets.sockets).length;
            }
          }
        } catch (countErr) {
          clientCount = null;
        }

        if (clientCount === 0) {
          // Ensure a clear stdout log so Render and other hosts pick this up even if logger utility
          // isn't wired into this module. This makes it explicit in service logs that emit was skipped.
          try {
            console.log('Thresholds saved — no connected Socket.IO clients; skipping live emit');
          } catch (cLogErr) {
            // ignore
          }
          try {
            if (typeof logger !== 'undefined' && logger && typeof logger.info === 'function') {
              logger.info('Thresholds saved — no connected Socket.IO clients; skipping live emit');
            }
          } catch (logGuardErr) {
            // ignore logging guard errors
          }
        }

        // Non-blocking emit: wrap in try/catch but don't fail the request if emit fails
        try {
          global.io.emit('threshold_update', nextThresholds);
        } catch (emitErr) {
          console.warn('Socket emit failed (no devices online). Continuing:', emitErr && emitErr.message ? emitErr.message : emitErr);
        }
      }
    } catch (emitErrOuter) {
      console.warn('Failed while attempting to broadcast threshold_update (continuing):', emitErrOuter && emitErrOuter.message ? emitErrOuter.message : emitErrOuter);
    }

    // Return success regardless of socket state. Log to stdout for visibility in hosting logs.
    try {
      console.log('Threshold update received → DB write successful');
    } catch (cLogErr) {
      // ignore
    }
    try {
      if (typeof logger !== 'undefined' && logger && typeof logger.info === 'function') {
        logger.info('Threshold update received → DB write successful');
      }
    } catch (logGuardErr) {
      // ignore logging guard errors
    }

    // Ensure we always return 200 even if Socket.IO emit fails upstream
    res.json({
      success: true,
      message: 'Thresholds updated successfully',
      data: nextThresholds,
    });

  } catch (error) {
    console.error('Error updating thresholds:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating thresholds',
    });
  }
});

router.put('/alerts', [auth, adminOnly], async (req, res) => {
  try {
    const payloadRoot = req.body && typeof req.body === 'object' ? req.body : {};
    const raw = payloadRoot.alerts && typeof payloadRoot.alerts === 'object' ? payloadRoot.alerts : payloadRoot;

    const nextConfig = { ...DEFAULT_ALERT_RULES };
    Object.keys(DEFAULT_ALERT_RULES).forEach((key) => {
      nextConfig[key] = parseBoolean(raw[key], DEFAULT_ALERT_RULES[key]);
    });

    const serialized = JSON.stringify(nextConfig);
    const existing = await Settings.findOne({ where: { key: 'alerts' } });
    if (existing) {
      existing.value = serialized;
      await existing.save();
    } else {
      await Settings.create({ key: 'alerts', value: serialized });
    }

    res.json({
      success: true,
      message: 'Alert configuration updated successfully',
      data: nextConfig,
    });
  } catch (error) {
    console.error('Error updating alert configuration:', error);
    res.status(500).json({ success: false, message: 'Failed to update alert configuration' });
  }
});

// @route   PUT /api/settings/notifications
// @desc    Compatibility endpoint for notification preferences
// @access  Private (Admin only)
router.put('/notifications', [auth, adminOnly], async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const nextNotifications = {
      email: parseBoolean(payload.email, false),
      sms: parseBoolean(payload.sms, false),
      criticalOnly: parseBoolean(payload.criticalOnly, false),
      emailAddress: typeof payload.emailAddress === 'string' ? payload.emailAddress.trim() : '',
    };

    await upsertSettingValue('notifications', nextNotifications);

    const currentAlertsRecord = await findSettingRecord('alerts');
    const alertsConfig = {
      ...DEFAULT_ALERT_RULES,
      ...(parseSettingValue(currentAlertsRecord, DEFAULT_ALERT_RULES) || {}),
      emailNotifications: Boolean(nextNotifications.email),
    };
    await upsertSettingValue('alerts', alertsConfig);

    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      data: nextNotifications,
    });
  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification settings',
    });
  }
});

// @route   POST /api/settings/phone-numbers
// @desc    Compatibility endpoint for adding SMS phone numbers
// @access  Private (Admin only)
router.post('/phone-numbers', [auth, adminOnly], [
  body('name').notEmpty().withMessage('Name is required'),
  body('number').matches(/^\+[1-9]\d{1,14}$/).withMessage('Phone number must be in international format (+1234567890)')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const smsRecord = await findSettingRecord('sms');
    const smsConfig = parseSettingValue(smsRecord, { enabled: false, rateLimitMinutes: 15, phoneNumbers: [] }) || { enabled: false, rateLimitMinutes: 15, phoneNumbers: [] };
    const phoneNumbers = Array.isArray(smsConfig.phoneNumbers) ? smsConfig.phoneNumbers : [];

    if (phoneNumbers.some((phone) => phone && phone.number === req.body.number)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already exists',
      });
    }

    const entry = {
      id: `phone_${Date.now()}`,
      name: req.body.name,
      number: req.body.number,
      createdAt: new Date().toISOString(),
    };

    const nextSmsConfig = {
      ...smsConfig,
      phoneNumbers: [...phoneNumbers, entry],
    };

    await upsertSettingValue('sms', nextSmsConfig);

    return res.status(201).json({
      success: true,
      message: 'Phone number added successfully',
      data: nextSmsConfig.phoneNumbers,
    });
  } catch (error) {
    console.error('Error adding compatibility phone number:', error);
    return res.status(500).json({ success: false, message: 'Error adding phone number' });
  }
});

// @route   DELETE /api/settings/phone-numbers/:phoneId
// @desc    Compatibility endpoint for removing SMS phone numbers
// @access  Private (Admin only)
router.delete('/phone-numbers/:phoneId', [auth, adminOnly], async (req, res) => {
  try {
    const smsRecord = await findSettingRecord('sms');
    const smsConfig = parseSettingValue(smsRecord, { enabled: false, rateLimitMinutes: 15, phoneNumbers: [] }) || { enabled: false, rateLimitMinutes: 15, phoneNumbers: [] };
    const phoneNumbers = Array.isArray(smsConfig.phoneNumbers) ? smsConfig.phoneNumbers : [];

    const nextPhoneNumbers = phoneNumbers.filter((phone) => {
      const id = phone && (phone.id || phone._id);
      return String(id) !== String(req.params.phoneId);
    });

    if (nextPhoneNumbers.length === phoneNumbers.length) {
      return res.status(404).json({ success: false, message: 'Phone number not found' });
    }

    const nextSmsConfig = {
      ...smsConfig,
      phoneNumbers: nextPhoneNumbers,
    };
    await upsertSettingValue('sms', nextSmsConfig);

    return res.json({
      success: true,
      message: 'Phone number removed successfully',
      data: nextSmsConfig.phoneNumbers,
    });
  } catch (error) {
    console.error('Error removing compatibility phone number:', error);
    return res.status(500).json({ success: false, message: 'Error removing phone number' });
  }
});

// @route   POST /api/settings/test-sms
// @desc    Compatibility endpoint for test SMS requests
// @access  Private (Admin only)
router.post('/test-sms', [auth, adminOnly], [
  body('phoneNumber').optional().isString().isLength({ min: 1 }).withMessage('phoneNumber is required when provided'),
  body('message').optional().isString().isLength({ min: 1, max: 500 }).withMessage('message must be between 1 and 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { phoneNumber = null, message = 'BeanToBin test SMS' } = req.body || {};

    return res.json({
      success: true,
      message: 'Test SMS request accepted',
      data: {
        phoneNumber,
        message,
      },
    });
  } catch (error) {
    console.error('Error handling test SMS request:', error);
    return res.status(500).json({ success: false, message: 'Error handling test SMS request' });
  }
});

// @route   PUT /api/settings/sms
// @desc    Update SMS settings
// @access  Private (Admin only)
router.put('/sms', [auth, adminOnly], [
  body('enabled').optional().isBoolean().withMessage('Enabled must be a boolean'),
  body('rateLimitMinutes').optional().isInt({ min: 1, max: 1440 }).withMessage('Rate limit must be between 1 and 1440 minutes')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const settings = await Settings.getSettings();
    
    if (req.body.enabled !== undefined) {
      settings.sms.enabled = req.body.enabled;
    }
    if (req.body.rateLimitMinutes !== undefined) {
      settings.sms.rateLimitMinutes = req.body.rateLimitMinutes;
    }

    await settings.save();

    res.json({
      success: true,
      message: 'SMS settings updated successfully',
      data: settings.sms
    });

  } catch (error) {
    console.error('Error updating SMS settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating SMS settings'
    });
  }
});

// @route   POST /api/settings/sms/phone
// @desc    Add phone number for SMS alerts
// @access  Private (Admin only)
router.post('/sms/phone', [auth, adminOnly], [
  body('name').notEmpty().withMessage('Name is required'),
  body('number').matches(/^\+[1-9]\d{1,14}$/).withMessage('Phone number must be in international format (+1234567890)')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, number } = req.body;
    const settings = await Settings.getSettings();

    // Check if phone number already exists
    const existingPhone = settings.sms.phoneNumbers.find(phone => phone.number === number);
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already exists'
      });
    }

    await settings.addPhoneNumber(name, number);

    res.status(201).json({
      success: true,
      message: 'Phone number added successfully',
      data: settings.sms.phoneNumbers
    });

  } catch (error) {
    console.error('Error adding phone number:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding phone number'
    });
  }
});

// @route   DELETE /api/settings/sms/phone/:phoneId
// @desc    Remove phone number
// @access  Private (Admin only)
router.delete('/sms/phone/:phoneId', [auth, adminOnly], async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    const phoneNumber = settings.sms.phoneNumbers.id(req.params.phoneId);
    
    if (!phoneNumber) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not found'
      });
    }

    await settings.removePhoneNumber(req.params.phoneId);

    res.json({
      success: true,
      message: 'Phone number removed successfully',
      data: settings.sms.phoneNumbers
    });

  } catch (error) {
    console.error('Error removing phone number:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing phone number'
    });
  }
});

// @route   PUT /api/settings/monitoring
// @desc    Update monitoring settings
// @access  Private (Admin only)
router.put('/monitoring', [auth, adminOnly], [
  body('dataCollectionInterval').optional().isInt({ min: 10, max: 3600 }).withMessage('Data collection interval must be between 10 and 3600 seconds'),
  body('offlineTimeoutMinutes').optional().isInt({ min: 1, max: 60 }).withMessage('Offline timeout must be between 1 and 60 minutes'),
  body('dataRetentionDays').optional().isInt({ min: 1, max: 365 }).withMessage('Data retention must be between 1 and 365 days')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const settings = await Settings.getSettings();
    
    if (req.body.dataCollectionInterval !== undefined) {
      settings.monitoring.dataCollectionInterval = req.body.dataCollectionInterval;
    }
    if (req.body.offlineTimeoutMinutes !== undefined) {
      settings.monitoring.offlineTimeoutMinutes = req.body.offlineTimeoutMinutes;
    }
    if (req.body.dataRetentionDays !== undefined) {
      settings.monitoring.dataRetentionDays = req.body.dataRetentionDays;
    }

    await settings.save();

    res.json({
      success: true,
      message: 'Monitoring settings updated successfully',
      data: settings.monitoring
    });

  } catch (error) {
    console.error('Error updating monitoring settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating monitoring settings'
    });
  }
});

// @route   PUT /api/settings/vermitea
// @desc    Update vermitea calibration settings
// @access  Private (Admin only)
router.put('/vermitea', [auth, adminOnly], [
  body('tankAreaLitersPerUnit').optional().isFloat({ min: 0 }).withMessage('tankAreaLitersPerUnit must be a positive number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const settings = await Settings.getSettings();
    if (!settings.vermitea) settings.vermitea = { tankAreaLitersPerUnit: 0.5 };

    if (req.body.tankAreaLitersPerUnit !== undefined) {
      settings.vermitea.tankAreaLitersPerUnit = parseFloat(req.body.tankAreaLitersPerUnit);
    }

    // Persist by saving in Settings table as JSON string under key 'vermitea'
    // Upsert pattern: try update, else create
    const sequelize = require('../services/database_pg');
    const SettingsModel = require('../models/Settings');
    const key = 'vermitea';
    const value = JSON.stringify(settings.vermitea);

    try {
      const existing = await SettingsModel.findOne({ where: { key } });
      if (existing) {
        await SettingsModel.update({ value }, { where: { key } });
      } else {
        await SettingsModel.create({ key, value });
      }
    } catch (e) {
      console.warn('Failed to persist vermitea settings:', e && e.message ? e.message : e);
    }

    res.json({ success: true, message: 'Vermitea settings updated', data: settings.vermitea });
  } catch (error) {
    console.error('Error updating vermitea settings:', error);
    res.status(500).json({ success: false, message: 'Error updating vermitea settings' });
  }
});

// @route   PUT /api/settings/system
// @desc    Update system settings
// @access  Private (Admin only)
router.put('/system', [auth, adminOnly], [
  body('timezone').optional().notEmpty().withMessage('Timezone cannot be empty'),
  body('autoResolveAlerts').optional().isBoolean().withMessage('Auto resolve alerts must be a boolean'),
  body('autoResolveTimeMinutes').optional().isInt({ min: 5, max: 1440 }).withMessage('Auto resolve time must be between 5 and 1440 minutes')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const settings = await Settings.getSettings();
    
    if (req.body.timezone !== undefined) {
      settings.system.timezone = req.body.timezone;
    }
    if (req.body.autoResolveAlerts !== undefined) {
      settings.system.autoResolveAlerts = req.body.autoResolveAlerts;
    }
    if (req.body.autoResolveTimeMinutes !== undefined) {
      settings.system.autoResolveTimeMinutes = req.body.autoResolveTimeMinutes;
    }

    await settings.save();

    res.json({
      success: true,
      message: 'System settings updated successfully',
      data: settings.system
    });

  } catch (error) {
    console.error('Error updating system settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating system settings'
    });
  }
});

// @route   POST /api/settings/reset
// @desc    Reset settings to default
// @access  Private (Admin only)
router.post('/reset', [auth, adminOnly], async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    // Reset to default values
    const defaultSettings = new Settings({});
    
    settings.thresholds = defaultSettings.thresholds;
    settings.monitoring = defaultSettings.monitoring;
    settings.system = defaultSettings.system;
    
    // Keep SMS settings as they contain user data
    
    await settings.save();

    res.json({
      success: true,
      message: 'Settings reset to default values',
      data: settings
    });

  } catch (error) {
    console.error('Error resetting settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting settings'
    });
  }
});

module.exports = router;
