const express = require('express');

const router = express.Router();

// Device command queue endpoints are retired in this deployment. Return HTTP 410 for all usage.
router.all('*', (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Device command queue endpoints were removed. Use /api/control for actuator commands.',
    code: 'device_commands_deprecated',
  });
});

module.exports = router;
