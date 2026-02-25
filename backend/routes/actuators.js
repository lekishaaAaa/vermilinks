const express = require('express');

const router = express.Router();

// Legacy actuator API intentionally retired. Direct control now uses /api/control.
router.all('*', (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Direct actuator endpoints were retired. Use /api/control instead.',
    code: 'actuators_deprecated',
  });
});

module.exports = router;
