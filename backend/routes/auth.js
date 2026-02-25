const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { getJwtSecret } = require('../utils/jwtSecret');

const router = express.Router();

const resolveJwtSecret = (res) => {
  try {
    return getJwtSecret();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server misconfiguration: JWT_SECRET is required.'
    });
    return null;
  }
};

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    // Dev-only: log incoming request headers and a masked snapshot of the body
    try {
      if ((process.env.NODE_ENV || 'development') !== 'production') {
        const ct = req.headers['content-type'] || req.headers['Content-Type'];
        const bodyPreview = (() => {
          try {
            if (!req.body) return String(req.body);
            if (typeof req.body === 'string') return req.body.slice(0, 200);
            const copy = { ...req.body };
            if (copy.password) copy.password = '***';
            if (copy.username && typeof copy.username === 'string' && copy.username.length > 100) copy.username = copy.username.slice(0,100)+'...';
            return JSON.stringify(copy);
          } catch (e) {
            return '<<unavailable>>';
          }
        })();
        console.log('Auth incoming request - Content-Type:', ct, 'Origin:', req.headers.origin || req.headers.Origin || 'unknown');
        console.log('Auth body preview:', bodyPreview);
      }
    } catch (logErr) { /* ignore logging errors */ }
    // Note: express-validator ran earlier, but we perform robust normalization here
    // so malformed or double-encoded payloads are handled consistently.
    // Do not let client-side mistakes produce 500 server errors.
    let username = undefined;
    let password = undefined;
    const rawBody = req.body;

    try {
      // Case A: client sent parsed JSON object { username, password }
      if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
        // Some clients send a single-key form with the JSON string as the only field.
        const keys = Object.keys(rawBody);
        if (keys.length === 1) {
          const onlyVal = rawBody[keys[0]];
          if (typeof onlyVal === 'string' && onlyVal.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(onlyVal);
              username = parsed.username;
              password = parsed.password;
              console.warn('Auth: parsed single-key JSON payload (form-encoded JSON)');
            } catch (e) {
              // fallthrough to try reading canonical fields below
            }
          }
        }

        // If not set from single-key payload, try canonical fields
        if (!username && 'username' in rawBody) username = rawBody.username;
        if (!password && 'password' in rawBody) password = rawBody.password;
      }

      // Case B: client sent raw string body (double-encoded JSON or text)
      if ((typeof rawBody === 'string' || typeof rawBody === 'number') && String(rawBody).trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(String(rawBody));
          username = parsed.username || username;
          password = parsed.password || password;
          console.warn('Auth: parsed raw-string JSON body');
        } catch (e) {
          // ignore parse error - we'll validate below
        }
      }

      // Fallback: some broken clients may have double-encoded username field specifically
      if (!username && rawBody && typeof rawBody === 'object' && typeof rawBody.username === 'string' && rawBody.username.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(rawBody.username);
          username = parsed.username || username;
          password = parsed.password || password;
          console.warn('Auth: parsed double-encoded username payload (fallback)');
        } catch (e) {
          // no-op
        }
      }
    } catch (normErr) {
      console.warn('Auth: normalization error', normErr && (normErr.message || normErr));
    }

    username = (typeof username === 'string') ? username.trim() : username;

  // Authentication uses DB-seeded users; no short-circuit fallback here.
    // Debug: log login attempts (username only) but never print the password
    try { console.log(`Login attempt for username='${username}' (password present=${!!password})`); } catch(e) {}

    // Server-side validation after normalization to provide clear 4xx responses
    if (!username || !password) {
      console.warn('Auth: missing username or password after normalization', { usernamePresent: !!username, passwordPresent: !!password });
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    // Attempt DB lookup; if DB is down allow an explicit local-admin fallback
    let user;
      try {
      console.log('Auth: looking up user in DB for', username);
      // defensive lookup: try exact match first, then case-insensitive/trimmed fallback
      user = await User.findOne({ where: { username } });
      if (!user && typeof username === 'string') {
        try {
          user = await User.findOne({ where: { username: username.toLowerCase() } });
        } catch (innerErr) {
          // ignore and continue
        }
      }
      console.log('Auth: DB lookup result for', username, !!user);
    } catch (dbErr) {
      // If DB lookup fails for any reason, allow a development fallback when enabled.
      // This makes local testing robust to different error shapes from Sequelize/pg.
      const localUser = (process.env.LOCAL_ADMIN_USER || '').trim();
      const localPass = process.env.LOCAL_ADMIN_PASS || '';
      const hasLocalCredentials = Boolean(localUser && localPass);
      const allowFallback = (process.env.ENABLE_LOCAL_ADMIN === 'true' || process.env.NODE_ENV !== 'production') && hasLocalCredentials;
      // Debugging: log DB error and fallback decision so we can see why a request may return 503
      try {
        console.warn('Auth login DB lookup error:', dbErr && (dbErr.message || dbErr.toString() || dbErr));
        console.warn(`Auth login allowFallback=${allowFallback} NODE_ENV=${process.env.NODE_ENV} ENABLE_LOCAL_ADMIN=${process.env.ENABLE_LOCAL_ADMIN}`);
      } catch (logErr) {
        // ignore logging errors
      }
      if (allowFallback) {
        if (username === localUser && password === localPass) {
          const payload = { id: 'local-admin', username: localUser, role: 'admin' };
          const secret = resolveJwtSecret(res);
          if (!secret) {
            return undefined;
          }
          const token = jwt.sign(payload, secret, { expiresIn: '24h' });
            if ((process.env.NODE_ENV || 'development') !== 'production') {
              try { console.log('DEV-LOGIN-TOKEN (local-fallback):', token); } catch(e) {}
            }
            return res.json({ success: true, message: 'Login successful (local admin)', data: { token, user: { id: payload.id, username: payload.username, role: payload.role } } });
        }
        // If fallback allowed but credentials don't match, return invalid credentials
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      // Otherwise return a DB unavailable error
      return res.status(503).json({ success: false, message: 'Database unavailable. Check PostgreSQL and DATABASE_URL.' });
    }

    if (!user) {
      console.warn('Auth: no user found for', username);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // If the model uses isActive check, treat undefined as active
    if (user.isActive === false) {
      return res.status(401).json({ success: false, message: 'Account is deactivated' });
    }

    // Defensive password compare
    try {
      if (!user.password) {
        console.warn('Auth: user has no password stored for', username);
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
      const isMatch = await bcrypt.compare(password || '', user.password);
      console.log('Auth: password compare for', username, 'result=', isMatch);
      if (!isMatch) {
        console.warn('Auth: password mismatch for', username);
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
    } catch (compareErr) {
      console.error('Auth: bcrypt.compare error for', username, compareErr && (compareErr.message || compareErr));
      return res.status(500).json({ success: false, message: 'Server error during authentication' });
    }

    // Non-fatal updates
    try {
      const updateFields = {};
      if ('lastLogin' in user) updateFields.lastLogin = new Date();
      if ('loginCount' in user) updateFields.loginCount = (user.loginCount || 0) + 1;
      if (Object.keys(updateFields).length) await user.update(updateFields);
    } catch (e) {
      console.warn('Could not update lastLogin/loginCount:', e && e.message ? e.message : e);
    }

  const payload = { id: user.id, username: user.username, role: user.role };
  const secret = resolveJwtSecret(res);
  if (!secret) {
    return undefined;
  }
  const token = jwt.sign(payload, secret, { expiresIn: '24h' });
  try { console.log(`Login successful for user id=${user.id} via DB`); } catch(e) {}
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      try { console.log('DEV-LOGIN-TOKEN (db):', token); } catch(e) {}
    }

    res.json({ success: true, message: 'Login successful', data: { token, user: { id: user.id, username: user.username, role: user.role, lastLogin: user.lastLogin || null, loginCount: user.loginCount || 0 } } });

  } catch (error) {
    const emsg = (error && (error.message || error.toString()) || '').toLowerCase();
    if (emsg.includes('econnrefused') || emsg.includes('connectionrefused') || (error && error.parent && error.parent.code === 'ECONNREFUSED')) {
      console.error('Login DB connection error (ECONNREFUSED):', error && (error.message || error));
      return res.status(503).json({ success: false, message: 'Database unavailable. Check PostgreSQL and DATABASE_URL.' });
    }

    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// Logout (no-op server-side)
router.post('/logout', (req, res) => res.json({ success: true, message: 'Logged out successfully' }));

// Get current user
router.get('/me', require('../middleware/auth').auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: { user: { id: user.id, username: user.username, role: user.role, lastLogin: user.lastLogin || null, loginCount: user.loginCount || 0 } } });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Verify token
// Backwards-compatible verify endpoint used by frontend on startup
router.get('/verify', require('../middleware/auth').auth, (req, res) => {
  return res.json({ success: true, message: 'Token is valid', data: { user: { id: req.user.id, username: req.user.username, role: req.user.role } } });
});

// Deprecated POST verify-token kept for backwards compatibility
router.post('/verify-token', require('../middleware/auth').auth, (req, res) => res.json({ success: true, message: 'Token is valid', data: { user: { id: req.user.id, username: req.user.username, role: req.user.role } } }));

module.exports = router;

// --- Dev-only debug endpoint (disabled by default) ---
// To enable this endpoint for local debugging set ENABLE_DEBUG_USERS=true in your local .env (do NOT enable in production).
try {
  const enableDebugUsers = (process.env.ENABLE_DEBUG_USERS === 'true');
  if (enableDebugUsers && (process.env.NODE_ENV || 'development') !== 'production') {
    // Inspect raw body for debugging client payload shapes
    router.post('/debug-raw-body', (req, res) => {
      try {
        return res.json({ success: true, rawBodyType: typeof req.body, rawBody: req.body });
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Could not inspect body', error: e && e.message });
      }
    });
    router.get('/debug-users', async (req, res) => {
      try {
        const users = await User.findAll({ attributes: ['id', 'username', 'password', 'role'] });
        return res.json({ success: true, data: users.map(u => ({ id: u.id, username: u.username, hasPassword: !!u.password, role: u.role })) });
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Could not list users', error: e && e.message });
      }
    });
  }
} catch (e) {
  // ignore if User is not defined or other issues
}
