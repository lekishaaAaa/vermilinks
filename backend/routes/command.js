const express = require('express');

const router = express.Router();

// Legacy actuator command surface retired. Use /api/control for MQTT-backed control.
router.all('*', (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Actuator commands are handled via /api/control. This endpoint is deprecated.',
    code: 'command_deprecated',
  });
});

module.exports = router;
