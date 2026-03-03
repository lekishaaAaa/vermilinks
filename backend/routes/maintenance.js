const express = require('express');
const Settings = require('../models/Settings');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// @route GET /api/maintenance
// @desc  Get maintenance reminders (public read for admins; authenticated users see limited view)
// @access Private
router.get('/', auth, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    const reminders = (settings.maintenance && Array.isArray(settings.maintenance.reminders)) ? settings.maintenance.reminders : null;

    // If no reminders in settings, provide sensible defaults for admins
    const defaults = [
      { id: 'm1', title: 'Check ESP32 firmware', dueInDays: 30, note: 'Verify firmware and update if available.' },
      { id: 'm2', title: 'Clean sensor probes', dueInDays: 60, note: 'Remove deposits and recalibrate.' },
      { id: 'm3', title: 'Inspect battery levels', dueInDays: 7, note: 'Replace or recharge low batteries.' }
    ];

    const data = reminders && reminders.length > 0 ? reminders : defaults;

    // Non-admins should not see internal notes
    const out = data.map(r => ({ id: r.id, title: r.title, dueInDays: r.dueInDays, note: req.user.role === 'admin' ? r.note : undefined }));

    res.json({ success: true, data: out });
  } catch (e) {
    console.error('Error fetching maintenance reminders:', e && e.message ? e.message : e);
    res.status(500).json({ success: false, message: 'Error fetching maintenance reminders' });
  }
});

// @route POST /api/maintenance/ack/:id
// @desc  Acknowledge a maintenance reminder (best-effort compatibility endpoint)
// @access Private
router.post('/ack/:id', auth, async (req, res) => {
  try {
    const id = (req.params.id || '').toString();
    return res.json({
      success: true,
      message: 'Maintenance reminder acknowledged',
      data: {
        id,
        acknowledged: true,
        acknowledgedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('Error acknowledging maintenance reminder:', e && e.message ? e.message : e);
    return res.status(500).json({ success: false, message: 'Error acknowledging maintenance reminder' });
  }
});

// @route POST /api/maintenance/schedule/:id
// @desc  Schedule a maintenance reminder (best-effort compatibility endpoint)
// @access Private
router.post('/schedule/:id', auth, async (req, res) => {
  try {
    const id = (req.params.id || '').toString();
    const when = req.body && typeof req.body.when === 'string' ? req.body.when : null;
    return res.json({
      success: true,
      message: 'Maintenance schedule request received',
      data: {
        id,
        when,
        scheduledAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('Error scheduling maintenance reminder:', e && e.message ? e.message : e);
    return res.status(500).json({ success: false, message: 'Error scheduling maintenance reminder' });
  }
});

module.exports = router;
