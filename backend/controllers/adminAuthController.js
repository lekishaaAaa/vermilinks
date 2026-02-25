const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { fn, col, where, Op } = require('sequelize');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const Admin = require('../models/Admin');
const Otp = require('../models/Otp');
const UserSession = require('../models/UserSession');
const AuditLog = require('../models/AuditLog');
const RevokedToken = require('../models/RevokedToken');
const { sendPasswordResetEmail } = require('../services/emailService');
const PasswordResetToken = require('../models/PasswordResetToken');
const { getJwtSecret } = require('../utils/jwtSecret');
const {
  LockoutError,
  assertCanAttempt,
  registerAttempt,
  resetAttempts,
} = require('../utils/loginAttemptTracker');

const DEFAULT_OTP_TTL_MS = 3 * 60 * 1000; // 3 minutes
const MIN_OTP_TTL_MS = 60 * 1000; // 1 minute safeguard
const MAX_OTP_TTL_MS = 10 * 60 * 1000; // prevent excessively long OTPs
const OTP_RETENTION_HOURS = parseInt(process.env.ADMIN_OTP_RETENTION_HOURS || '24', 10);
const OTP_RETENTION_BUFFER_MS = Math.max(OTP_RETENTION_HOURS, 1) * 60 * 60 * 1000;
const OTP_CLEANUP_CRON = process.env.ADMIN_OTP_CLEANUP_CRON || '0 3 * * *';
const OTP_CLEANUP_TZ = process.env.ADMIN_OTP_CLEANUP_TZ || undefined;
const REQUIRED_EMAIL_VARS = ['EMAIL_USER', 'EMAIL_PASS'];
let emailEnvWarned = false;
let smtpConfigLogged = false;
let smtpEnvLogged = false;

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

function warnMissingEmailEnv(contextLabel) {
  if (emailEnvWarned) {
    return;
  }

  const missing = REQUIRED_EMAIL_VARS.filter((key) => {
    const value = process.env[key];
    return !value || String(value).trim().length === 0;
  });

  if (missing.length > 0) {
    emailEnvWarned = true;
    console.warn('adminAuthController email configuration missing required env vars', {
      context: contextLabel || 'unknown',
      missing,
    });
  }
}

function logSmtpConfigOnce(contextLabel) {
  if (smtpEnvLogged) {
    return;
  }

  smtpEnvLogged = true;

  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST || null;
  const port = process.env.EMAIL_PORT || process.env.SMTP_PORT || null;
  const secure = process.env.EMAIL_SECURE || process.env.SMTP_SECURE || null;
  const user = process.env.EMAIL_USER || null;
  const from = process.env.EMAIL_FROM || null;
  const hasPass = Boolean(process.env.EMAIL_PASS && String(process.env.EMAIL_PASS).trim().length > 0);

  console.log('SMTP CONFIG:', {
    context: contextLabel || 'startup',
    host,
    port,
    secure,
    user,
    from,
    hasPass,
  });
}

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
}

function getConfiguredAdminCredentials() {
  const email = normalizeEmail(
    process.env.ADMIN_EMAIL ||
    process.env.ADMIN_LOGIN_USERNAME ||
    process.env.INIT_ADMIN_EMAIL
  );
  const password = (
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_LOGIN_PASSWORD ||
    process.env.INIT_ADMIN_PASSWORD ||
    ''
  ).toString();

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getOtpExpiryDate() {
  const configured = Number(process.env.ADMIN_OTP_TTL_MS);
  const effective = Number.isFinite(configured)
    ? Math.min(Math.max(configured, MIN_OTP_TTL_MS), MAX_OTP_TTL_MS)
    : DEFAULT_OTP_TTL_MS;
  return new Date(Date.now() + effective);
}

async function findAdminByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }
  return Admin.findOne({ where: { email: normalized } });
}

function getRequesterIp(req) {
  const forwardedHeader = req && req.headers ? req.headers['x-forwarded-for'] : null;
  if (forwardedHeader && typeof forwardedHeader === 'string') {
    const [firstIp] = forwardedHeader.split(',').map((value) => value.trim()).filter(Boolean);
    if (firstIp) {
      return firstIp;
    }
  }
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

function respondWithLockout(res, err, fallbackMessage) {
  const retryAfterMs = Math.max(err && err.remainingMs ? err.remainingMs : 0, 0);
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  return res.status(429).json({
    success: false,
    message: fallbackMessage || 'Too many attempts. Please try again later.',
    data: {
      retryAfterMs,
      retryAfterSeconds,
    },
  });
}

async function recordAudit(eventType, actor, data) {
  try {
    if (!AuditLog) return;
    await AuditLog.create({ eventType, actor, data });
  } catch (e) {
    console.warn('recordAudit failed', e && e.message ? e.message : e);
  }
}

async function blacklistToken(token, reason) {
  if (!token) return;
  try {
    const tokenHash = hashRefreshToken(token); // reuse hash function
    await RevokedToken.create({ tokenHash, reason });
  } catch (e) {
    console.warn('blacklistToken failed', e && e.message ? e.message : e);
  }
}

async function persistOtpLog(email, otp, expiresAt) {
  if (!email || !otp) {
    return;
  }

  try {
    const codeHash = await bcrypt.hash(otp, 10);
    await Otp.create({ email, codeHash, expiresAt });
  } catch (err) {
    console.warn('adminAuthController.persistOtpLog warning', err && err.message ? err.message : err);
  }
}

async function markOtpVerified(email) {
  if (!email) {
    return;
  }

  try {
    const [latestOtp] = await Otp.findAll({
      where: { email },
      order: [['createdAt', 'DESC']],
      limit: 1,
    });

    if (latestOtp && !latestOtp.verifiedAt) {
      await latestOtp.update({ verifiedAt: new Date() });
    }
  } catch (err) {
    console.warn('adminAuthController.markOtpVerified warning', err && err.message ? err.message : err);
  }
}

let otpCleanupScheduled = false;
let otpCleanupJob = null;

async function cleanupExpiredOtps() {
  try {
    const cutoff = new Date(Date.now() - OTP_RETENTION_BUFFER_MS);
    const deleted = await Otp.destroy({
      where: {
        expiresAt: {
          [Op.lt]: cutoff,
        },
      },
    });
    if (deleted > 0) {
      console.info('OTP cleanup removed expired records', { count: deleted, cutoff: cutoff.toISOString() });
    }
  } catch (err) {
    console.warn('adminAuthController.cleanupExpiredOtps warning', err && err.message ? err.message : err);
  }
}

function ensureOtpCleanupScheduler() {
  if (otpCleanupScheduled) {
    return;
  }
  otpCleanupScheduled = true;

  const isTestEnv = (process.env.NODE_ENV || 'development') === 'test';
  if (isTestEnv) {
    return;
  }

  cleanupExpiredOtps();

  otpCleanupJob = cron.schedule(OTP_CLEANUP_CRON, () => {
    cleanupExpiredOtps();
  }, { timezone: OTP_CLEANUP_TZ });

  if (otpCleanupJob && typeof otpCleanupJob.start === 'function') {
    otpCleanupJob.start();
  }

  console.info('OTP cleanup scheduler enabled', {
    cron: OTP_CLEANUP_CRON,
    timezone: OTP_CLEANUP_TZ || 'server-local',
    retentionHours: OTP_RETENTION_HOURS,
  });
}

ensureOtpCleanupScheduler();
logSmtpConfigOnce('module_init');

async function sendOtpEmailToAdmin({ to, otp, expiresAt }) {
  if (!to || !otp) {
    throw new Error('OTP recipient and code are required');
  }

  warnMissingEmailEnv('otp_delivery');
  logSmtpConfigOnce('otp_delivery');

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be configured');
  }

  const smtpHost = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const smtpPortRaw = process.env.EMAIL_PORT || process.env.SMTP_PORT;
  const smtpSecureRaw = process.env.EMAIL_SECURE || process.env.SMTP_SECURE;
  const smtpConnectionTimeoutRaw = process.env.SMTP_CONNECTION_TIMEOUT_MS;
  const smtpGreetingTimeoutRaw = process.env.SMTP_GREETING_TIMEOUT_MS;
  const smtpSocketTimeoutRaw = process.env.SMTP_SOCKET_TIMEOUT_MS;

  const smtpConnectionTimeout = (() => {
    const parsed = Number(smtpConnectionTimeoutRaw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
  })();
  const smtpGreetingTimeout = (() => {
    const parsed = Number(smtpGreetingTimeoutRaw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
  })();
  const smtpSocketTimeout = (() => {
    const parsed = Number(smtpSocketTimeoutRaw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
  })();

  const parsedPort = (() => {
    const parsed = Number(smtpPortRaw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 587;
  })();
  const parsedSecure = typeof smtpSecureRaw === 'string' ? smtpSecureRaw.toLowerCase() === 'true' : false;

  const transportCandidates = [];
  if (smtpHost) {
    transportCandidates.push({
      mode: 'configured',
      options: {
        host: smtpHost,
        port: parsedPort,
        secure: parsedSecure,
      },
    });

    const isGmailHost = /gmail\.com$/i.test(smtpHost);
    if (isGmailHost) {
      if (!(parsedPort === 465 && parsedSecure === true)) {
        transportCandidates.push({
          mode: 'gmail-host-465',
          options: {
            host: smtpHost,
            port: 465,
            secure: true,
          },
        });
      }
      if (!(parsedPort === 587 && parsedSecure === false)) {
        transportCandidates.push({
          mode: 'gmail-host-587',
          options: {
            host: smtpHost,
            port: 587,
            secure: false,
            requireTLS: true,
          },
        });
      }
    }
  }

  transportCandidates.push({
    mode: 'gmail-service',
    options: {
      service: process.env.EMAIL_SERVICE || 'gmail',
    },
  });

  const from = process.env.EMAIL_FROM || user;

  let lastError = null;
  for (const candidate of transportCandidates) {
    const transporter = nodemailer.createTransport({
      ...candidate.options,
      pool: false,
      connectionTimeout: smtpConnectionTimeout,
      greetingTimeout: smtpGreetingTimeout,
      socketTimeout: smtpSocketTimeout,
      auth: {
        user,
        pass,
      },
    });

    if (!smtpConfigLogged) {
      smtpConfigLogged = true;
      console.info('OTP mail transporter configured', {
        mode: candidate.mode,
        service: candidate.options.service || undefined,
        host: candidate.options.host || undefined,
        port: candidate.options.port || undefined,
        secure: candidate.options.secure || false,
        connectionTimeout: smtpConnectionTimeout,
        greetingTimeout: smtpGreetingTimeout,
        socketTimeout: smtpSocketTimeout,
      });
    }

    try {
      await transporter.verify();
      console.log('SMTP transport verified', {
        mode: candidate.mode,
        host: candidate.options.host || null,
        port: candidate.options.port || null,
        secure: candidate.options.secure || false,
      });
    } catch (verifyErr) {
      lastError = verifyErr;
      console.error('SMTP VERIFY FAILURE:');
      console.error('MODE:', candidate.mode);
      console.error('CODE:', verifyErr && verifyErr.code ? verifyErr.code : null);
      console.error('RESPONSE:', verifyErr && verifyErr.response ? verifyErr.response : null);
      console.error('MESSAGE:', verifyErr && verifyErr.message ? verifyErr.message : verifyErr);
      console.error('STACK:', verifyErr && verifyErr.stack ? verifyErr.stack : null);
      continue;
    }

    try {
      const mailOptions = {
        from,
        to,
        subject: 'VermiLinks OTP Verification',
        text: `Your OTP code is: ${otp}\n\nThis code expires at ${expiresAt.toISOString()}.`,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('OTP EMAIL SENT:', info && info.response ? info.response : null);

      console.info(`OTP sent successfully to ${to}`, {
        mode: candidate.mode,
        messageId: info && info.messageId ? info.messageId : undefined,
      });
      return;
    } catch (sendErr) {
      lastError = sendErr;
      console.error('SMTP FAILURE:');
      console.error('MODE:', candidate.mode);
      console.error('CODE:', sendErr && sendErr.code ? sendErr.code : null);
      console.error('RESPONSE:', sendErr && sendErr.response ? sendErr.response : null);
      console.error('MESSAGE:', sendErr && sendErr.message ? sendErr.message : sendErr);
      console.error('STACK:', sendErr && sendErr.stack ? sendErr.stack : null);
      console.warn('OTP send attempt failed', {
        mode: candidate.mode,
        error: sendErr && sendErr.message ? sendErr.message : sendErr,
      });
    }
  }

  throw (lastError || new Error('All SMTP delivery attempts failed'));
}

async function assignOtpToAdmin(admin, otp, expiresAt) {
  if (!admin) {
    throw new Error('Administrator record is required to assign OTP');
  }

  const hashedOtp = await bcrypt.hash(otp, 10);
  await admin.update({ otpHash: hashedOtp, otpExpiresAt: expiresAt });
}

async function clearAdminOtp(admin) {
  if (!admin) {
    return;
  }

  await admin.update({ otpHash: null, otpExpiresAt: null });
}

function getSessionTtlSeconds() {
  const hoursRaw = Number(process.env.ADMIN_SESSION_TTL_HOURS);
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 2;
  return Math.ceil(hours * 60 * 60);
}

function getRefreshTtlMs() {
  const ttlRaw = Number(process.env.ADMIN_REFRESH_TTL_MS);
  const defaultMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  return Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : defaultMs;
}

function getRefreshExpiryDate() {
  return new Date(Date.now() + getRefreshTtlMs());
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update((rawToken || '').toString(), 'utf8').digest('hex');
}

function buildSessionMetadata(req, overrides) {
  const base = {
    ip: req.ip || null,
    forwardedFor: req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
    lastActivityAt: new Date().toISOString(),
  };
  return {
    ...(req.sessionMetadata || {}),
    ...base,
    ...(overrides || {}),
  };
}

async function persistAdminSession({
  req,
  adminId,
  token,
  tokenExpiresAt,
  refreshTokenHash,
  refreshExpiresAt,
}) {
  if (!adminId || !token) {
    return null;
  }

  const metadata = buildSessionMetadata(req, {
    refreshIssuedAt: new Date().toISOString(),
    otpVerifiedAt: new Date().toISOString(),
  });

  const sessionPayload = {
    adminId,
    token,
    expiresAt: tokenExpiresAt,
    refreshTokenHash,
    refreshExpiresAt,
    revokedAt: null,
    revocationReason: null,
    metadata,
  };

  try {
    const session = await UserSession.create(sessionPayload);
    return session;
  } catch (err) {
    const errMessage = err && err.message ? err.message : err;
    const looksLikeConstraint = err && err.name && err.name.toLowerCase().includes('unique');

    if (looksLikeConstraint || (errMessage && errMessage.toString().includes('duplicate'))) {
      try {
        const existing = await UserSession.findOne({
          where: { adminId },
          order: [['updatedAt', 'DESC']],
        });

        if (existing) {
          await existing.update(sessionPayload);
          console.warn('adminAuthController.persistAdminSession reused existing session', { adminId, sessionId: existing.id });
          return existing;
        }
      } catch (updateErr) {
        console.warn('adminAuthController.persistAdminSession update fallback failed', updateErr && updateErr.message ? updateErr.message : updateErr);
      }
    }

    console.warn('adminAuthController.persistAdminSession failed to persist session record', errMessage);
    return null;
  }
}

exports.login = async (req, res) => {
  try {
    console.log('LOGIN HIT', {
      email: normalizeEmail(req && req.body ? req.body.email : ''),
      hasPassword: Boolean(req && req.body && req.body.password),
      origin: req && req.headers ? (req.headers.origin || req.headers.Origin || null) : null,
      ip: getRequesterIp(req),
    });
  } catch (logErr) {
    // ignore logging failures
  }

  if ((process.env.ADMIN_LOGIN_DEBUG_RESPONSE || '').toString().toLowerCase() === 'true') {
    return res.json({
      success: true,
      reachedBackend: true,
      message: 'Admin login debug response enabled',
    });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  const { email, password } = req.body;
  const normalizedEmail = normalizeEmail(email);
  const requesterIp = getRequesterIp(req);

  try {
    assertCanAttempt('password', normalizedEmail, requesterIp);
  } catch (lockoutErr) {
    if (lockoutErr instanceof LockoutError) {
      return respondWithLockout(res, lockoutErr, 'Too many login attempts. Please try again later.');
    }
    console.error('adminAuthController.login pre-check failure', lockoutErr && lockoutErr.message ? lockoutErr.message : lockoutErr);
    return res.status(500).json({ success: false, message: 'Unable to initiate login' });
  }

  try {
    console.log('Admin login attempt for', normalizedEmail ? `'${normalizedEmail}'` : '<missing email>');
  } catch (logErr) {
    // ignore logging issues
  }

  try {
    const providedPassword = (password || '').toString();
    const configuredAdmin = getConfiguredAdminCredentials();

    let admin = await findAdminByEmail(normalizedEmail);

    if (!admin && configuredAdmin && normalizedEmail === configuredAdmin.email && providedPassword === configuredAdmin.password) {
      try {
        const passwordHash = await bcrypt.hash(configuredAdmin.password, 10);
        admin = await Admin.create({ email: configuredAdmin.email, passwordHash });
        console.info('Admin login bootstrap: created configured admin account from environment');
      } catch (bootstrapErr) {
        console.warn('Admin login bootstrap failed', bootstrapErr && bootstrapErr.message ? bootstrapErr.message : bootstrapErr);
      }
    }

    if (!admin) {
      console.warn('Admin login failed: account not found for', normalizedEmail);
      const attemptState = registerAttempt('password', normalizedEmail, requesterIp);
      try { await recordAudit('login.attempt', normalizedEmail, { success: false, reason: 'not_found', ip: requesterIp }); } catch (e) {}
      if (attemptState.locked) {
        return respondWithLockout(res, { remainingMs: attemptState.lockoutMs }, 'Too many login attempts. Please try again later.');
      }
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    let passwordMatches = await bcrypt.compare(providedPassword, admin.passwordHash || '');
    if (!passwordMatches && configuredAdmin && normalizedEmail === configuredAdmin.email && providedPassword === configuredAdmin.password) {
      try {
        const reconciledHash = await bcrypt.hash(configuredAdmin.password, 10);
        await admin.update({ passwordHash: reconciledHash });
        passwordMatches = true;
        console.info('Admin login reconciliation: refreshed admin password hash from environment');
      } catch (reconcileErr) {
        console.warn('Admin login reconciliation failed', reconcileErr && reconcileErr.message ? reconcileErr.message : reconcileErr);
      }
    }

    if (!passwordMatches) {
      console.warn('Admin login failed: password mismatch for', normalizedEmail);
      const attemptState = registerAttempt('password', normalizedEmail, requesterIp);
      try { await recordAudit('login.attempt', normalizedEmail, { success: false, reason: 'bad_password', ip: requesterIp }); } catch (e) {}
      if (attemptState.locked) {
        return respondWithLockout(res, { remainingMs: attemptState.lockoutMs }, 'Too many login attempts. Please try again later.');
      }
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    resetAttempts('password', normalizedEmail, requesterIp);

    const otp = generateOtpCode();
    const expiresAt = getOtpExpiryDate();

    await assignOtpToAdmin(admin, otp, expiresAt);
    await persistOtpLog(admin.email, otp, expiresAt);
    try { await recordAudit('login.otp_issued', admin.email, { ip: requesterIp, expiresAt: expiresAt.toISOString() }); } catch (e) {}
    // Audit: OTP issued
    try {
      await recordAudit('otp.issued', admin.email, { expiresAt: expiresAt.toISOString(), ip: requesterIp });
    } catch (e) {}

    try {
      await sendOtpEmailToAdmin({ to: admin.email, otp, expiresAt });
      try { await recordAudit('otp.delivery_success', admin.email, { ip: requesterIp, expiresAt: expiresAt.toISOString() }); } catch (auditErr) {
        console.warn('audit log failed for otp delivery success', auditErr && auditErr.message ? auditErr.message : auditErr);
      }
    } catch (emailErr) {
      console.error('adminAuthController: failed to send OTP email', emailErr && emailErr.message ? emailErr.message : emailErr);
      try { await recordAudit('otp.delivery_failed', admin.email, { ip: requesterIp, error: emailErr && emailErr.message ? emailErr.message : String(emailErr) }); } catch (auditErr) {
        console.warn('audit log failed for otp delivery failure', auditErr && auditErr.message ? auditErr.message : auditErr);
      }
      return res.status(502).json({
        success: false,
        message: 'Unable to deliver OTP email right now. Please retry in a moment.',
      });
    }

    const responsePayload = {
      success: true,
      message: 'Verification code generated. Proceed to OTP verification.',
      data: {
        requires2FA: true,
        expiresAt: expiresAt.toISOString(),
        delivery: 'email_sent',
      },
    };

    return res.json(responsePayload);
  } catch (err) {
    try { await recordAudit('login.attempt', normalizeEmail(email), { success: false, error: err && err.message ? err.message : String(err), ip: requesterIp }); } catch (e) {}
    console.error('adminAuthController.login error', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: 'Unable to initiate login' });
  }
};

exports.verifyOtp = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  const normalizedEmail = normalizeEmail(req.body.email);
  const submittedOtp = (req.body.otp || '').toString().trim();
  const requesterIp = getRequesterIp(req);

  try {
    assertCanAttempt('otp', normalizedEmail, requesterIp);
  } catch (lockoutErr) {
    if (lockoutErr instanceof LockoutError) {
      return respondWithLockout(res, lockoutErr, 'Too many verification attempts. Please try again later.');
    }
    console.error('adminAuthController.verifyOtp pre-check failure', lockoutErr && lockoutErr.message ? lockoutErr.message : lockoutErr);
    return res.status(500).json({ success: false, message: 'Unable to verify code' });
  }

  try {
    const admin = await findAdminByEmail(normalizedEmail);
    if (!admin || !admin.otpHash || !admin.otpExpiresAt) {
      const attemptState = registerAttempt('otp', normalizedEmail, requesterIp);
      if (attemptState.locked) {
        return respondWithLockout(res, { remainingMs: attemptState.lockoutMs }, 'Too many verification attempts. Please try again later.');
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired code',
      });
    }

    const isExpired = new Date(admin.otpExpiresAt).getTime() < Date.now();
    if (isExpired) {
      await clearAdminOtp(admin);
      const attemptState = registerAttempt('otp', normalizedEmail, requesterIp);
      try { await recordAudit('otp.verify_attempt', normalizedEmail, { success: false, reason: 'expired', ip: requesterIp }); } catch (e) {}
      if (attemptState.locked) {
        return respondWithLockout(res, { remainingMs: attemptState.lockoutMs }, 'Too many verification attempts. Please try again later.');
      }
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.',
        data: {
          expiredAt: new Date(admin.otpExpiresAt).toISOString(),
        },
      });
    }

    const otpMatches = await bcrypt.compare(submittedOtp, admin.otpHash);
    if (!otpMatches) {
      try { await recordAudit('otp.verify_attempt', normalizedEmail, { success: false, reason: 'incorrect', ip: requesterIp }); } catch (e) {}
      const attemptState = registerAttempt('otp', normalizedEmail, requesterIp);
      if (attemptState.locked) {
        return respondWithLockout(res, { remainingMs: attemptState.lockoutMs }, 'Too many verification attempts. Please try again later.');
      }
      return res.status(401).json({ success: false, message: 'Verification code is incorrect.' });
    }

    const sessionTtlSeconds = getSessionTtlSeconds();
    const tokenExpiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = getRefreshExpiryDate();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const payload = {
      id: admin.id,
      email: admin.email,
      role: 'admin',
    };

    const secret = resolveJwtSecret(res);
    if (!secret) {
      return undefined;
    }
    const token = jwt.sign(payload, secret, { expiresIn: sessionTtlSeconds });

    await clearAdminOtp(admin);
    resetAttempts('otp', normalizedEmail, requesterIp);
    resetAttempts('resend', normalizedEmail, requesterIp);
    await markOtpVerified(admin.email);

    try { await recordAudit('otp.verified', admin.email, { success: true, ip: requesterIp }); } catch (e) {}

    const session = await persistAdminSession({
      req,
      adminId: admin.id,
      token,
      tokenExpiresAt,
      refreshTokenHash,
      refreshExpiresAt,
    });
    if (!session) {
      console.warn('adminAuthController.verifyOtp issued token without durable session record', { adminId: admin.id });
    }

    console.info('Admin OTP verified and session issued', { email: admin.email, sessionExpiresAt: tokenExpiresAt.toISOString() });

    return res.json({
      success: true,
      message: 'Authentication complete',
      data: {
        token,
        expiresAt: tokenExpiresAt.toISOString(),
        refreshToken,
        refreshExpiresAt: refreshExpiresAt.toISOString(),
        sessionId: session && session.id ? session.id : null,
        user: {
          id: admin.id,
          email: admin.email,
          role: 'admin',
        },
      },
    });
  } catch (err) {
    try { await recordAudit('otp.verified', normalizedEmail, { success: false, error: err && err.message ? err.message : String(err) }); } catch (e) {}
    console.error('adminAuthController.verifyOtp error', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: 'Unable to verify code' });
  }
};

exports.forgotPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  const { email } = req.body;

  try {
    const admin = await findAdminByEmail(email);

    if (admin) {
      try {
        await PasswordResetToken.update(
          { used: true, usedAt: new Date() },
          {
            where: {
              userId: admin.id,
              used: false,
            },
          },
        );

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashResetToken(rawToken);
        const expiresAt = getPasswordResetExpiryDate();

        const resetEntry = await PasswordResetToken.create({
          userId: admin.id,
          tokenHash,
          expiresAt,
        });

        try {
          await sendPasswordResetEmail({ to: admin.email, token: rawToken });
        } catch (emailDispatchError) {
          try {
            await resetEntry.update({ used: true, usedAt: new Date() });
          } catch (tokenUpdateErr) {
            console.warn('adminAuthController.forgotPassword failed to invalidate reset token after email failure', tokenUpdateErr && tokenUpdateErr.message ? tokenUpdateErr.message : tokenUpdateErr);
          }
          throw emailDispatchError;
        }
      } catch (emailErr) {
        console.error('adminAuthController.forgotPassword email failure', emailErr && emailErr.message ? emailErr.message : emailErr);
        return res.status(500).json({ success: false, message: 'Unable to send reset instructions. Please try again later.' });
      }
    }

    return res.json({
      success: true,
      message: 'If the account exists, a password reset email has been sent.',
    });
  } catch (err) {
    console.error('adminAuthController.forgotPassword error', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: 'Unable to process request' });
  }
};

exports.resetPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  const { token, password } = req.body;

  try {
    const hashedToken = hashResetToken(token || '');
    const resetRecord = await PasswordResetToken.findOne({ where: { tokenHash: hashedToken } });

    if (!resetRecord) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    }

    if (resetRecord.used) {
      return res.status(400).json({ success: false, message: 'Reset link has already been used.' });
    }

    if (resetRecord.expiresAt && new Date(resetRecord.expiresAt).getTime() < Date.now()) {
      await resetRecord.update({ used: true, usedAt: new Date() });
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    }

    const admin = await Admin.findByPk(resetRecord.userId);
    if (!admin) {
      await resetRecord.update({ used: true, usedAt: new Date() });
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    admin.passwordHash = hashedPassword;
    await admin.save();

    await resetRecord.update({ used: true, usedAt: new Date() });
    await PasswordResetToken.update(
      { used: true, usedAt: new Date() },
      {
        where: {
          userId: admin.id,
          used: false,
          id: {
            [Op.ne]: resetRecord.id,
          },
        },
      },
    );

    return res.json({ success: true, message: 'Password has been reset successfully.' });
  } catch (err) {
    console.error('adminAuthController.resetPassword error', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: 'Unable to reset password' });
  }
};

exports.resendOtp = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  const normalizedEmail = normalizeEmail(req.body.email);
  const requesterIp = getRequesterIp(req);

  try {
    const admin = await findAdminByEmail(normalizedEmail);

    if (!admin) {
      // Do not reveal whether the account exists.
      return res.json({ success: true, message: 'If the account exists, a new verification code has been sent.' });
    }

    try {
      assertCanAttempt('resend', normalizedEmail, requesterIp);
    } catch (lockoutErr) {
      if (lockoutErr instanceof LockoutError) {
        try { await recordAudit('otp.resend_attempt', normalizedEmail, { success: false, reason: 'locked', ip: requesterIp }); } catch (e) {}
        return respondWithLockout(res, lockoutErr, 'Too many resend attempts. Please try again later.');
      }
      console.error('adminAuthController.resendOtp pre-check failure', lockoutErr && lockoutErr.message ? lockoutErr.message : lockoutErr);
      return res.status(500).json({ success: false, message: 'Unable to resend verification code' });
    }

    const otp = generateOtpCode();
    const expiresAt = getOtpExpiryDate();

    await assignOtpToAdmin(admin, otp, expiresAt);
    await persistOtpLog(admin.email, otp, expiresAt);
    try { await recordAudit('otp.resend', admin.email, { expiresAt: expiresAt.toISOString(), ip: requesterIp }); } catch (e) {}

    try {
      await sendOtpEmailToAdmin({ to: admin.email, otp, expiresAt });
      try { await recordAudit('otp.delivery_success', admin.email, { ip: requesterIp, reason: 'resend', expiresAt: expiresAt.toISOString() }); } catch (auditErr) {
        console.warn('audit log failed for resend success', auditErr && auditErr.message ? auditErr.message : auditErr);
      }
    } catch (emailErr) {
      console.error('adminAuthController: failed to resend OTP email', emailErr && emailErr.message ? emailErr.message : emailErr);
      try { await recordAudit('otp.delivery_failed', admin.email, { ip: requesterIp, reason: 'resend', error: emailErr && emailErr.message ? emailErr.message : String(emailErr) }); } catch (auditErr) {
        console.warn('audit log failed for resend', auditErr && auditErr.message ? auditErr.message : auditErr);
      }
      return res.status(502).json({
        success: false,
        message: 'Unable to deliver OTP email right now. Please retry in a moment.',
      });
    }

    const responsePayload = {
      success: true,
      message: 'A new verification code has been generated.',
      data: {
        expiresAt: expiresAt.toISOString(),
        delivery: 'email_sent',
      },
    };

    const attemptState = registerAttempt('resend', normalizedEmail, requesterIp);
    if (attemptState && attemptState.locked && !responsePayload.data.rateLimit) {
      responsePayload.data.rateLimit = {
        locked: true,
        retryAfterMs: attemptState.lockoutMs,
        retryAfterSeconds: Math.ceil((attemptState.lockoutMs || 0) / 1000),
        remaining: 0,
      };
    } else if (attemptState) {
      responsePayload.data.rateLimit = {
        locked: Boolean(attemptState.locked),
        retryAfterMs: attemptState.lockoutMs,
        retryAfterSeconds: Math.ceil((attemptState.lockoutMs || 0) / 1000),
        remaining: attemptState.remaining,
      };
    }

    console.info('Admin OTP re-issued and email dispatched', { email: admin.email, expiresAt: expiresAt.toISOString() });

    return res.json(responsePayload);
  } catch (err) {
    console.error('adminAuthController.resendOtp error', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: 'Unable to resend verification code' });
  }
};

exports.getSession = async (req, res) => {
  const authHeader = (req.headers.authorization || '').toString();
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const token = bearerToken || (req.query && req.query.token ? String(req.query.token).trim() : '') || '';

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const secret = resolveJwtSecret(res);
    if (!secret) {
      return undefined;
    }
    const decoded = jwt.verify(token, secret);
    const decodedPayload = decoded && typeof decoded === 'object' ? decoded : null;
    const adminId = decodedPayload && decodedPayload.id ? decodedPayload.id : null;

    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Session is invalid or has been revoked' });
    }

    let session = await UserSession.findOne({ where: { token } });
    if (!session) {
      const fallbackExpiresAt = decodedPayload && decodedPayload.exp
        ? new Date(decodedPayload.exp * 1000)
        : new Date(Date.now() + getSessionTtlSeconds() * 1000);
      const fallbackMetadata = buildSessionMetadata(req, {
        recoveredAt: new Date().toISOString(),
        reason: 'missing_session_row',
      });

      try {
        session = await UserSession.create({
          adminId,
          token,
          expiresAt: fallbackExpiresAt,
          refreshTokenHash: null,
          refreshExpiresAt: null,
          revokedAt: null,
          revocationReason: null,
          metadata: fallbackMetadata,
        });
        console.warn('adminAuthController.getSession: recreated missing session record', { adminId, sessionId: session.id });
      } catch (creationErr) {
        console.warn('adminAuthController.getSession: unable to persist fallback session', creationErr && creationErr.message ? creationErr.message : creationErr);
        session = {
          adminId,
          token,
          expiresAt: fallbackExpiresAt,
          refreshTokenHash: null,
          refreshExpiresAt: null,
          revokedAt: null,
          revocationReason: null,
          metadata: fallbackMetadata,
        };
      }
    }

    if (session.revokedAt) {
      return res.status(401).json({ success: false, message: 'Session has been revoked' });
    }

    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
      if (typeof session.destroy === 'function') {
        await session.destroy().catch(() => {});
      }
      return res.status(401).json({ success: false, message: 'Session has expired' });
    }

    const admin = await Admin.findByPk(adminId, {
      attributes: ['id', 'email', 'createdAt', 'updatedAt'],
    });

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Account is unavailable' });
    }

    return res.json({
      success: true,
      data: {
        token,
        expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
        refreshExpiresAt: session.refreshExpiresAt ? new Date(session.refreshExpiresAt).toISOString() : null,
        user: {
          id: admin.id,
          email: admin.email,
        },
      },
    });
  } catch (err) {
    console.warn('adminAuthController.getSession error', err && err.message ? err.message : err);
    return res.status(401).json({ success: false, message: 'Session validation failed' });
  }
};

exports.refreshSession = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  const refreshToken = (req.body.refreshToken || '').toString().trim();
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token is required' });
  }

  const hashedRefresh = hashRefreshToken(refreshToken);

  try {
    const session = await UserSession.findOne({ where: { refreshTokenHash: hashedRefresh } });
    if (!session) {
      return res.status(401).json({ success: false, message: 'Session is invalid or has expired' });
    }

    if (session.revokedAt) {
      return res.status(401).json({ success: false, message: 'Session has been revoked' });
    }

    if (session.refreshExpiresAt && new Date(session.refreshExpiresAt).getTime() < Date.now()) {
      await session.update({ revokedAt: new Date(), revocationReason: 'refresh_expired' }).catch(() => {});
      return res.status(401).json({ success: false, message: 'Session has expired. Please log in again.' });
    }

    const admin = await Admin.findByPk(session.adminId, {
      attributes: ['id', 'email', 'createdAt', 'updatedAt'],
    });

    if (!admin) {
      await session.destroy().catch(() => {});
      return res.status(401).json({ success: false, message: 'Account is unavailable' });
    }

    const sessionTtlSeconds = getSessionTtlSeconds();
    const tokenExpiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);
    const refreshExpiresAt = getRefreshExpiryDate();
    const newRefreshToken = generateRefreshToken();
    const newRefreshHash = hashRefreshToken(newRefreshToken);

    const payload = {
      id: admin.id,
      email: admin.email,
      role: 'admin',
    };

    const secret = resolveJwtSecret(res);
    if (!secret) {
      return undefined;
    }
    const token = jwt.sign(payload, secret, { expiresIn: sessionTtlSeconds });

    await session.update({
      token,
      expiresAt: tokenExpiresAt,
      refreshTokenHash: newRefreshHash,
      refreshExpiresAt,
      revokedAt: null,
      revocationReason: null,
      metadata: {
        ...((session.metadata && typeof session.metadata === 'object') ? session.metadata : {}),
        ...buildSessionMetadata(req, {
          lastRefreshIp: getRequesterIp(req),
          lastRefreshAt: new Date().toISOString(),
        }),
      },
    });

    try { await recordAudit('session.refreshed', admin.email, { sessionId: session.id, ip: getRequesterIp(req) }); } catch (e) {}

    // Blacklist the old refresh token to enforce rotation
    await blacklistToken(refreshToken, 'refresh_rotation');

    return res.json({
      success: true,
      message: 'Session refreshed',
      data: {
        token,
        expiresAt: tokenExpiresAt.toISOString(),
        refreshToken: newRefreshToken,
        refreshExpiresAt: refreshExpiresAt.toISOString(),
        user: {
          id: admin.id,
          email: admin.email,
        },
      },
    });
  } catch (err) {
    console.error('adminAuthController.refreshSession error', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: 'Unable to refresh session' });
  }
};

exports.logout = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  const refreshTokenHash = req.body.refreshToken ? hashRefreshToken(req.body.refreshToken) : null;
  const token = req.body.token ? req.body.token.toString().trim() : null;

  if (!refreshTokenHash && !token) {
    return res.status(400).json({ success: false, message: 'A refresh token or access token is required to logout.' });
  }

  try {
    let session = null;

    if (refreshTokenHash) {
      session = await UserSession.findOne({ where: { refreshTokenHash } });
    }

    if (!session && token) {
      session = await UserSession.findOne({ where: { token } });
    }

    if (!session) {
      return res.json({ success: true, message: 'Session ended' });
    }

    await session.update({
      revokedAt: new Date(),
      revocationReason: 'user_logout',
    });
      try { await recordAudit('session.revoked', session.adminId ? String(session.adminId) : 'unknown', { reason: 'logout', sessionId: session.id, ip: getRequesterIp(req) }); } catch (e) {}

    // Blacklist the access token to prevent reuse
    if (session.token) {
      await blacklistToken(session.token, 'logout');
    }

    return res.json({ success: true, message: 'Session ended' });
  } catch (err) {
    console.error('adminAuthController.logout error', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: 'Unable to log out' });
  }
};
