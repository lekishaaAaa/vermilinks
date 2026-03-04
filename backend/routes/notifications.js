const express = require('express');
const Alert = require('../models/Alert');
const { auth, adminOnly } = require('../middleware/auth');
const { sanitizeAlertPayload } = require('../utils/sensorFormatting');

const router = express.Router();

function emitNotificationUpdate(notification) {
  if (!global.io || typeof global.io.emit !== 'function') {
    return;
  }
  try {
    global.io.emit('notification_update', notification);
  } catch (error) {
    console.warn('notifications: broadcast failed', error && error.message ? error.message : error);
  }
}

router.get('/', [auth, adminOnly], async (req, res) => {
  try {
    const { status, limit = 25 } = req.query;
    const where = {};
    if (status && typeof status === 'string') {
      const lowered = status.toLowerCase();
      if (['new', 'read'].includes(lowered)) {
        where.status = lowered;
      }
    }

    const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const alerts = await Alert.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: numericLimit,
    });

    const payload = alerts.map((alert) => sanitizeAlertPayload(alert));
    res.json({ success: true, data: payload });
  } catch (error) {
    console.error('notifications: failed to list', error);
    res.status(500).json({ success: false, message: 'Failed to load notifications' });
  }
});

router.get('/stats', [auth, adminOnly], async (req, res) => {
  try {
    const total = await Alert.count();
    const unread = await Alert.count({ where: { status: 'new' } });
    const resolved = await Alert.count({ where: { isResolved: true } });

    res.json({
      success: true,
      data: {
        total,
        unread,
        resolved,
      },
    });
  } catch (error) {
    console.error('notifications: stats failed', error);
    res.status(500).json({ success: false, message: 'Failed to load notification stats' });
  }
});

router.patch('/:id/mark-read', [auth, adminOnly], async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    alert.status = 'read';
    alert.acknowledgedBy = req.user && req.user.username ? req.user.username : null;
    alert.acknowledgedAt = new Date();
    alert.updatedAt = new Date();
    await alert.save();

    const payload = sanitizeAlertPayload(alert);
    emitNotificationUpdate(payload);
    res.json({ success: true, data: payload });
  } catch (error) {
    console.error('notifications: mark-read failed', error);
    res.status(500).json({ success: false, message: 'Failed to update notification' });
  }
});

router.patch('/:id/mark-unread', [auth, adminOnly], async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    alert.status = 'new';
    alert.acknowledgedBy = null;
    alert.acknowledgedAt = null;
    alert.updatedAt = new Date();
    await alert.save();

    const payload = sanitizeAlertPayload(alert);
    emitNotificationUpdate(payload);
    res.json({ success: true, data: payload });
  } catch (error) {
    console.error('notifications: mark-unread failed', error);
    res.status(500).json({ success: false, message: 'Failed to update notification' });
  }
});

router.patch('/mark-all-read', [auth, adminOnly], async (req, res) => {
  try {
    const username = req.user && req.user.username ? req.user.username : null;
    const now = new Date();
    const [updated] = await Alert.update({
      status: 'read',
      acknowledgedBy: username,
      acknowledgedAt: now,
      updatedAt: now,
    }, {
      where: { status: 'new' },
    });

    emitNotificationUpdate({ type: 'bulk_mark_read', updated, timestamp: now.toISOString() });
    res.json({ success: true, data: { updated } });
  } catch (error) {
    console.error('notifications: mark-all-read failed', error);
    res.status(500).json({ success: false, message: 'Failed to mark all notifications as read' });
  }
});

router.delete('/:id', [auth, adminOnly], async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    await Alert.destroy({ where: { id: alert.id } });
    emitNotificationUpdate({ ...sanitizeAlertPayload(alert), deleted: true });
    res.json({ success: true, message: 'Notification removed' });
  } catch (error) {
    console.error('notifications: delete failed', error);
    res.status(500).json({ success: false, message: 'Failed to delete notification' });
  }
});

module.exports = router;
