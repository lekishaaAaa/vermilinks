const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../utils/jwtSecret');

// Admin authentication middleware
const adminAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    let secret;
    try {
      secret = getJwtSecret();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Server misconfiguration: JWT_SECRET is required.'
      });
    }
    const decoded = jwt.verify(token, secret);

    // Sequelize: findByPk to fetch user
    const user = await User.findByPk(decoded.id, { attributes: { exclude: ['password'] } });

    if (!user || (user.isActive === false)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user is inactive.'
      });
    }

    // Check if user has admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    }

    console.error('Admin auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during admin authentication.'
    });
  }
};

module.exports = adminAuth;
