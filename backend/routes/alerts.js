const express = require('express');
const { query, validationResult, body } = require('express-validator');
const Alert = require('../models/Alert');
const { auth, adminOnly } = require('../middleware/auth');
const { sanitizeAlertPayload } = require('../utils/sensorFormatting');
const { REALTIME_EVENTS, emitRealtime } = require('../utils/realtime');

const router = express.Router();

// @route   GET /api/alerts
// @desc    Get alerts with pagination and filtering
// @access  Private
router.get('/', auth, [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid severity level'),
  query('type').optional().isIn(['temperature', 'humidity', 'moisture', 'device_offline', 'device_online', 'battery_low', 'ph', 'ec', 'nitrogen', 'phosphorus', 'potassium', 'water_level']).withMessage('Invalid alert type'),
  query('deviceId').optional().notEmpty().withMessage('Device ID cannot be empty'),
  query('resolved').optional().isBoolean().withMessage('Resolved must be a boolean')
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

    const {
      limit = 20,
      page = 1,
      severity,
      type,
      deviceId,
      resolved
    } = req.query;

    // Build query
    let query = {};
    
    if (severity) query.severity = severity;
    if (type) query.type = type;
    if (deviceId) query.deviceId = deviceId;
    if (resolved !== undefined) query.isResolved = resolved === 'true';

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get alerts with pagination using Sequelize
    const where = query; // Sequelize will use this object for filtering
    const alerts = await Alert.findAll({
      where,
      order: [['createdAt', 'DESC']],
      offset: skip,
      limit: parseInt(limit)
    });
    const total = await Alert.count({ where });

    res.json({
      success: true,
      data: {
        alerts,
        pagination: {
          current: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching alerts'
    });
  }
});

// @route   GET /api/alerts/recent
// @desc    Get recent unresolved alerts
// @access  Private
router.get('/recent', auth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const alerts = await Alert.findAll({
      where: { isResolved: false },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: alerts
    });

  } catch (error) {
    console.error('Error fetching recent alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching recent alerts'
    });
  }
});

// @route   GET /api/alerts/active
// @desc    Get unresolved (active) alerts
// @access  Private
router.get('/active', auth, async (req, res) => {
  try {
    const {
      deviceId,
      severity,
      limit = 50,
      sort = 'desc',
    } = req.query;

    const where = { isResolved: false };
    if (deviceId) where.deviceId = deviceId;
    if (severity) where.severity = severity;

    const direction = typeof sort === 'string' && sort.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const alerts = await Alert.findAll({
      where,
      order: [['createdAt', direction]],
      limit: numericLimit,
    });

    const payload = alerts.map((alert) => sanitizeAlertPayload(alert));

    res.json({ success: true, data: payload });
  } catch (error) {
    console.error('Error fetching active alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active alerts',
    });
  }
});

// @route   GET /api/alerts/latest
// @desc    Get the 10 most recent alerts (for admin notifications)
// @access  Private (Admin only)
router.get('/latest', [auth, adminOnly], async (req, res) => {
  try {
    const alerts = await Alert.findAll({
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    res.json({
      success: true,
      data: alerts
    });

  } catch (error) {
    console.error('Error fetching latest alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching latest alerts'
    });
  }
});

// @route   POST /api/alerts
// @desc    Create a new alert (for public users to report issues)
// @access  Private (User role allowed)
router.post('/', [
  auth,
  body('type').isIn(['sensor', 'connectivity', 'threshold', 'device_offline', 'other']).withMessage('Invalid alert type'),
  body('message').isLength({ min: 1, max: 500 }).withMessage('Message must be 1-500 characters'),
  body('timestamp').optional().isISO8601().withMessage('Invalid timestamp format')
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

    const { type, message, timestamp } = req.body;

    const alert = await Alert.createAlert({
      type,
      message,
      createdAt: timestamp ? new Date(timestamp) : new Date(),
      status: 'new'
    });

    res.status(201).json({
      success: true,
      message: 'Alert created successfully',
      data: alert
    });

  } catch (error) {
    console.error('Error creating alert:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating alert'
    });
  }
});

// @route   PATCH /api/alerts/:id
// @desc    Mark an alert as read (for admin acknowledgment)
// @access  Private (Admin only)
router.patch('/:id', [auth, adminOnly], async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id);

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    // Update status to 'read' and acknowledged info
    alert.status = 'read';
    alert.acknowledgedBy = req.user.username;
    alert.acknowledgedAt = new Date();

    await alert.save();

    res.json({
      success: true,
      message: 'Alert marked as read',
      data: alert
    });

  } catch (error) {
    console.error('Error updating alert:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating alert'
    });
  }
});

// @route   PUT /api/alerts/:id/acknowledge
// @desc    Acknowledge an alert (compatibility endpoint)
// @access  Private (Admin only)
router.put('/:id/acknowledge', [auth, adminOnly], async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id);

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    alert.status = 'read';
    alert.acknowledgedBy = req.user.username;
    alert.acknowledgedAt = new Date();
    await alert.save();

    return res.json({
      success: true,
      message: 'Alert acknowledged successfully',
      data: alert,
    });
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    return res.status(500).json({
      success: false,
      message: 'Error acknowledging alert',
    });
  }
});

// @route   GET /api/alerts/stats
// @desc    Get alert statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    
    const hoursAgo = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);

    // Use Sequelize to compute breakdown and overall stats
    // Breakdown: counts grouped by severity and type
    const { Sequelize } = require('sequelize');
    const db = Alert.sequelize;

    // Raw query using Sequelize to count by severity and type
    const breakdownRows = await Alert.findAll({
      attributes: [
        'severity', 'type', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
      ],
      where: { createdAt: { [Sequelize.Op.gte]: hoursAgo } },
      group: ['severity', 'type']
    });

    // Transform rows into desired structure
    const breakdownMap = {};
    breakdownRows.forEach(r => {
      const sev = r.get('severity') || 'unknown';
      const type = r.get('type') || 'unknown';
      const count = parseInt(r.get('count') || 0, 10);
      if (!breakdownMap[sev]) breakdownMap[sev] = { severity: sev, types: [], total: 0 };
      breakdownMap[sev].types.push({ type, count });
      breakdownMap[sev].total += count;
    });

    const breakdown = Object.values(breakdownMap);

    // Overall stats
    const total = await Alert.count({ where: { createdAt: { [Sequelize.Op.gte]: hoursAgo } } });
    const resolved = await Alert.count({ where: { createdAt: { [Sequelize.Op.gte]: hoursAgo }, isResolved: true } });
    const unresolved = await Alert.count({ where: { createdAt: { [Sequelize.Op.gte]: hoursAgo }, isResolved: false } });

    res.json({
      success: true,
      data: {
        summary: { total, resolved, unresolved },
        breakdown,
        period: `${hours} hours`
      }
    });

  } catch (error) {
    console.error('Error fetching alert stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching alert statistics'
    });
  }
});

// @route   GET /api/alerts/summary
// @desc    Get aggregated counts by severity buckets
// @access  Private
router.get('/summary', auth, async (req, res) => {
  try {
    // Count unresolved (active) alerts and map into buckets required by frontend
    const where = { isResolved: false };
    const { Sequelize } = require('sequelize');
    const db = Alert.sequelize;

    // Get counts grouped by raw severity
    const rows = await Alert.findAll({
      attributes: ['severity', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
      where,
      group: ['severity'],
      raw: true,
    });

    // Map raw severities to buckets: critical | warning | info
    const bucket = { critical: 0, warning: 0, info: 0 };
    for (const r of rows) {
      const sev = (r.severity || '').toString().toLowerCase();
      const count = parseInt(r.count || 0, 10) || 0;
      if (sev === 'critical') {
        bucket.critical += count;
      } else if (sev === 'high' || sev === 'medium' || sev === 'warning') {
        bucket.warning += count;
      } else {
        // low, info, unknown fall into info
        bucket.info += count;
      }
    }

    return res.json(bucket);
  } catch (error) {
    console.error('Error building alerts summary:', error);
    return res.status(500).json({ success: false, message: 'Error building alerts summary' });
  }
});

// @route   DELETE /api/alerts/clear
// @desc    Clear all active (unresolved) alerts
// @access  Private (Admin only)
router.delete('/clear', [auth, adminOnly], async (req, res) => {
  try {
    const [updated] = await Alert.update(
      { isResolved: true, resolvedAt: new Date(), acknowledgedAt: new Date(), acknowledgedBy: (req.user && req.user.username) || 'admin' },
      { where: { isResolved: false } }
    );

    // Broadcast a realtime update so dashboards can refresh summaries
    emitRealtime(REALTIME_EVENTS.ALERT_CLEARED, {
      type: 'cleared',
      event: 'cleared',
      resolved: updated,
      resolvedCount: updated,
      deviceId: null,
      timestamp: new Date().toISOString(),
    }, { io: req.app });

    return res.json({ ok: true, resolved: updated });
  } catch (error) {
    console.error('Error clearing alerts:', error);
    return res.status(500).json({ success: false, message: 'Error clearing alerts' });
  }
});

// @route   PUT /api/alerts/:id/resolve
// @desc    Resolve an alert
// @access  Private (Admin only)
router.put('/:id/resolve', [auth, adminOnly], async (req, res) => {
  try {
  const alert = await Alert.findByPk(req.params.id);
    
    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    if (alert.isResolved) {
      return res.status(400).json({
        success: false,
        message: 'Alert is already resolved'
      });
    }

    await alert.resolve(req.user.username);

    emitRealtime(REALTIME_EVENTS.ALERT_CLEARED, {
      type: 'resolved',
      event: 'resolved',
      alertId: alert.id,
      deviceId: alert.deviceId || null,
      alert: sanitizeAlertPayload(alert),
      timestamp: new Date().toISOString(),
    }, { io: req.app });

    res.json({
      success: true,
      message: 'Alert resolved successfully',
      data: alert
    });

  } catch (error) {
    console.error('Error resolving alert:', error);
    res.status(500).json({
      success: false,
      message: 'Error resolving alert'
    });
  }
});

// @route   PUT /api/alerts/resolve-all
// @desc    Resolve all alerts for a device or all devices
// @access  Private (Admin only)
router.put('/resolve-all', [auth, adminOnly], async (req, res) => {
  try {
    const { deviceId } = req.body;
    
    let query = { isResolved: false };
    if (deviceId) {
      query.deviceId = deviceId;
    }

    // Sequelize equivalent: update matching alerts
    const [updatedCount] = await Alert.update(
      {
        isResolved: true,
        resolvedAt: new Date(),
        acknowledgedBy: req.user.username,
        acknowledgedAt: new Date()
      },
      { where: query }
    );

    emitRealtime(REALTIME_EVENTS.ALERT_CLEARED, {
      type: 'resolved-all',
      event: 'resolved-all',
      deviceId: deviceId || null,
      resolved: updatedCount,
      resolvedCount: updatedCount,
      timestamp: new Date().toISOString(),
    }, { io: req.app });

    res.json({
      success: true,
      message: `${updatedCount} alerts resolved successfully`,
      data: {
        resolved: updatedCount,
        deviceId: deviceId || 'all'
      }
    });

  } catch (error) {
    console.error('Error resolving all alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Error resolving alerts'
    });
  }
});

// @route   DELETE /api/alerts/:id
// @desc    Delete an alert
// @access  Private (Admin only)
router.delete('/:id', [auth, adminOnly], async (req, res) => {
  try {
  const alert = await Alert.findByPk(req.params.id);
    
    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

  await Alert.destroy({ where: { id: req.params.id } });

    res.json({
      success: true,
      message: 'Alert deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting alert:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting alert'
    });
  }
});

// @route   POST /api/alerts/test
// @desc    Create a test alert
// @access  Private (Admin only)
router.post('/test', [auth, adminOnly], async (req, res) => {
  try {
    const testAlert = await Alert.createAlert({
      type: 'temperature',
      severity: 'medium',
      message: 'Test alert created by admin',
      deviceId: 'TEST_DEVICE',
      sensorData: {
        temperature: 25.5,
        humidity: 60.0,
        moisture: 45.0
      }
    });

    const sanitized = sanitizeAlertPayload(testAlert);
    emitRealtime(REALTIME_EVENTS.ALERT_NEW, {
      deviceId: sanitized.deviceId || null,
      alerts: [sanitized],
      event: 'test',
      triggeredAt: new Date().toISOString(),
    }, { io: req.app });

    res.status(201).json({
      success: true,
      message: 'Test alert created successfully',
      data: testAlert
    });

  } catch (error) {
    console.error('Error creating test alert:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating test alert'
    });
  }
});

module.exports = router;
