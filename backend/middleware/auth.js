const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');
const UserSession = require('../models/UserSession');
const RevokedToken = require('../models/RevokedToken');

const buildAdminPrincipal = (admin) => {
  if (!admin) {
    return null;
  }
  const plain = typeof admin.get === 'function' ? admin.get({ plain: true }) : admin;
  return {
    id: plain.id,
    email: plain.email,
    username: plain.email,
    role: 'admin',
    isActive: true,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
};

const getJwtSecret = () => {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  return secret;
};

// Authentication middleware
const auth = async (req, res, next) => {
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
    } catch (secretError) {
      return res.status(500).json({
        success: false,
        message: 'Server misconfiguration: JWT_SECRET is required.'
      });
    }

    const decoded = jwt.verify(token, secret);

    // Check if token is blacklisted
    try {
      const tokenHash = require('crypto').createHash('sha256').update(token, 'utf8').digest('hex');
      const blacklisted = await RevokedToken.findOne({ where: { tokenHash } });
      if (blacklisted) {
        return res.status(401).json({ success: false, message: 'Token has been revoked.' });
      }
    } catch (e) {
      // ignore DB errors and continue
    }
    // If a session record exists for this token, enforce session state (revoked/expired)
    try {
      const session = await UserSession.findOne({ where: { token } });
      if (session) {
        if (session.revokedAt) {
          return res.status(401).json({ success: false, message: 'Session has been revoked.' });
        }
        if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
          // Destroy expired session if possible and deny access
          try { await session.destroy(); } catch (e) {}
          return res.status(401).json({ success: false, message: 'Session has expired.' });
        }
        // attach session metadata for downstream handlers
        req.session = session;
      }
    } catch (e) {
      // ignore DB errors and continue; JWT verification is still authoritative
    }
    // Sequelize: findByPk to fetch user
    let user = null;
    try {
      user = await User.findByPk(decoded.id, { attributes: { exclude: ['password'] } });
    } catch (e) {
      user = null;
    }

    if (!user) {
      try {
        const adminRecord = await Admin.findByPk(decoded.id, {
          attributes: ['id', 'email', 'createdAt', 'updatedAt'],
        });
        if (adminRecord) {
          user = buildAdminPrincipal(adminRecord);
        }
      } catch (e) {
        // ignore admin lookup errors
      }
    }

    // If user not found in DB but token represents a local/admin fallback, synthesize a user object
    if (!user) {
      const idStr = String(decoded.id || '');
      if (idStr === 'admin-local' || idStr === 'local-admin' || (decoded && decoded.role === 'admin')) {
        // Create a minimal user-like object so downstream code can rely on id/username/role
        user = {
          id: decoded.id || 'admin-local',
          username: decoded.username || 'admin',
          role: decoded.role || 'admin',
          isActive: true,
        };
      }
    }

    if (!user || (user.isActive === false)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user is inactive.'
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
    
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authentication.'
    });
  }
};

// Admin role middleware
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }
};

// Require an OTP-verified admin session for sensitive operations.
const requireOtpVerified = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }

  const metadata = req.session && req.session.metadata ? req.session.metadata : null;
  const verifiedAt = metadata && (metadata.otpVerifiedAt || metadata.otp_verified_at);
  if (!verifiedAt) {
    return res.status(403).json({
      success: false,
      message: 'OTP verification required.'
    });
  }

  return next();
};

// Optional auth middleware (doesn't require token, but validates if present)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const secret = getJwtSecret();
      const decoded = jwt.verify(token, secret);
      let principal = await User.findByPk(decoded.id, { attributes: { exclude: ['password'] } });
      if (!principal) {
        const adminRecord = await Admin.findByPk(decoded.id, {
          attributes: ['id', 'email', 'createdAt', 'updatedAt'],
        }).catch(() => null);
        principal = buildAdminPrincipal(adminRecord);
      }

      if (principal && principal.isActive !== false) {
        req.user = principal;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

module.exports = {
  auth,
  adminOnly,
  requireOtpVerified,
  optionalAuth
};
