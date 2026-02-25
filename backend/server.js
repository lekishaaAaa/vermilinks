const express = require('express');
// MongoDB is used for IoT state/alerts alongside Sequelize/Postgres.
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const envFile = (process.env.NODE_ENV || '').toLowerCase() === 'test' ? '.env.test' : '.env';
require('dotenv').config({ path: path.join(__dirname, envFile), override: true });
const { validateEnv } = require('./utils/validateEnv');
validateEnv();
const logger = require('./utils/logger');
const database = require('./services/database_pg');
const { connectMongo } = require('./db/mongo');
const sequelize = database;
const connectDB = typeof sequelize.connectDB === 'function' ? sequelize.connectDB : async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connected (fallback connectDB)');
  } catch (error) {
    logger.error('Database connection failed during fallback connectDB', error);
    throw error;
  }
};
const { ensureDatabaseSetup } = database;
const schemaReady = ensureDatabaseSetup({ force: (process.env.NODE_ENV || 'development') === 'test' });
connectMongo().catch((error) => {
  logger.warn('MongoDB connection failed during startup', error && error.message ? error.message : error);
});
const {
  markDeviceOnline,
  resetOfflineTimer,
} = require('./services/deviceManager');
const deviceCommandQueue = require('./services/deviceCommandQueue');

// Import routes
const authRoutes = require('./routes/auth');
const sensorRoutes = require('./routes/sensors');
const alertRoutes = require('./routes/alerts');
const settingsRoutes = require('./routes/settings');
const maintenanceRoutes = require('./routes/maintenance');
const notificationRoutes = require('./routes/notifications');
const deviceCommandRoutes = require('./routes/deviceCommands');
const commandRoutes = require('./routes/command');
const iotRoutes = require('./routes/iot');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
// Render and other proxies populate X-Forwarded-* headers; trust the first hop for accurate rate limiting/IP logging
app.set('trust proxy', 1);
const server = http.createServer(app);

const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || process.env.API_RATE_LIMIT_WINDOW_MS || '900000', 10);
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || process.env.API_RATE_LIMIT_MAX_REQUESTS || '5', 10);

const adminAuthLimiter = rateLimit({
  windowMs: Number.isFinite(rateLimitWindowMs) && rateLimitWindowMs > 0 ? rateLimitWindowMs : 15 * 60 * 1000,
  max: Number.isFinite(rateLimitMax) && rateLimitMax > 0 ? rateLimitMax : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again later.',
  },
});

const adminVerifyLimiter = rateLimit({
  windowMs: parseInt(process.env.ADMIN_OTP_WINDOW_MS || (10 * 60 * 1000).toString(), 10),
  max: parseInt(process.env.ADMIN_OTP_MAX_ATTEMPTS || '5', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification attempts. Please try again later.',
  },
});

const adminResendLimiter = rateLimit({
  windowMs: parseInt(process.env.ADMIN_OTP_RESEND_WINDOW_MS || (10 * 60 * 1000).toString(), 10),
  max: parseInt(process.env.ADMIN_OTP_RESEND_MAX_ATTEMPTS || '3', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many resend attempts. Please try again later.',
  },
});

const sensorRateLimiter = rateLimit({
  windowMs: 1000,
  max: parseInt(process.env.SENSORS_RATE_LIMIT_MAX || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
});

const defaultFrontendOrigin = process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN;
const defaultDeviceOrigin = process.env.DEVICE_SOCKET_ORIGIN || process.env.DEVICE_HTTP_ORIGIN;
const envSocketOrigins = (process.env.SOCKETIO_CORS_ORIGINS || process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const allowedSocketOrigins = [
  'https://vermilinks-frontend.onrender.com',
  'http://localhost:3000',
];
envSocketOrigins.forEach((origin) => {
  if (!allowedSocketOrigins.includes(origin)) {
    allowedSocketOrigins.push(origin);
  }
});
if (defaultFrontendOrigin && !allowedSocketOrigins.includes(defaultFrontendOrigin)) {
  allowedSocketOrigins.push(defaultFrontendOrigin);
}
if (defaultDeviceOrigin && !allowedSocketOrigins.includes(defaultDeviceOrigin)) {
  allowedSocketOrigins.push(defaultDeviceOrigin);
}

const io = new Server(server, {
  cors: {
    origin: allowedSocketOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  },
  transports: ['websocket'],
});

global.io = io;
app.set('io', io);

io.on('connection', async (socket) => {
  logger.info('✅ Socket.IO client connected', { socketId: socket.id });

  const handshakeDeviceId = (() => {
    const authId = socket.handshake && socket.handshake.auth ? socket.handshake.auth.deviceId : null;
    const queryId = socket.handshake && socket.handshake.query ? socket.handshake.query.deviceId : null;
    const candidate = authId || queryId;
    return candidate && String(candidate).trim().length > 0 ? String(candidate).trim() : null;
  })();

  if (handshakeDeviceId) {
    const metadata = (socket.handshake && socket.handshake.auth && socket.handshake.auth.metadata) || {};
    deviceCommandQueue.registerSocket(handshakeDeviceId, socket, metadata);
  }

  const handleAckEvent = async (payload = {}, overrideSuccess = null) => {
    const commandId = payload.commandId || payload.id;
    if (!commandId) {
      return;
    }

    const computedSuccess = overrideSuccess !== null
      ? overrideSuccess
      : !(payload.status === 'error' || payload.status === 'failed');

    const ackPayload = payload.payload || payload.data || null;
    const message = payload.message || null;

    try {
      await deviceCommandQueue.handleCommandAck({
        commandId,
        success: computedSuccess,
        payload: ackPayload,
        message,
      });

      if (socket.data && socket.data.hardwareId) {
        await deviceCommandQueue.dispatchPendingCommands(socket.data.hardwareId);
      }
    } catch (ackError) {
      logger.warn('Socket.IO command acknowledgement failed', {
        commandId,
        error: ackError && ackError.message ? ackError.message : ackError,
      });
    }
  };

  socket.on('device:register', async (payload = {}) => {
    const hardwareId = payload.deviceId || payload.hardwareId || payload.id;
    if (!hardwareId) {
      return;
    }
    await deviceCommandQueue.registerSocket(String(hardwareId).trim(), socket, payload.metadata || {});
  });

  socket.on('command:ack', (payload) => handleAckEvent(payload, null));
  socket.on('command:ok', (payload) => handleAckEvent(payload, true));
  socket.on('command:error', (payload) => handleAckEvent(payload, false));

  socket.on('disconnect', (reason) => {
    const hardwareId = socket.data && socket.data.hardwareId ? socket.data.hardwareId : null;
    deviceCommandQueue.deregisterSocket(hardwareId, socket);
    logger.info('❌ Socket.IO client disconnected', { socketId: socket.id, hardwareId, reason });
  });
});

// WebSocket setup for real-time data
const normalizeDeviceWsPath = (value) => {
  if (!value || value === '*') {
    return '/';
  }
  return value.startsWith('/') ? value : `/${value}`;
};

const deviceWsPath = normalizeDeviceWsPath(process.env.DEVICE_WS_PATH);
logger.info('Device WebSocket path configured', { deviceWsPath });
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const requestPath = (request.url || '/').split('?')[0];
  const isDeviceSocket = deviceWsPath === '/'
    ? requestPath === '/' || requestPath === ''
    : requestPath === deviceWsPath;

  if (!isDeviceSocket) {
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Store WebSocket connections
global.wsConnections = new Set();
// Optional mapping from deviceId -> ws connection (when ESP32 registers itself)
global.deviceSockets = new Map();

// Start device command retry loop only when not running tests to avoid open handles
if ((process.env.NODE_ENV || 'development') !== 'test') {
  deviceCommandQueue.startCommandRetryLoop();
} else {
  logger.info('Skipping deviceCommandQueue retry loop in test mode');
}

// Start MQTT ingest service if configured (non-test only)
try {
  // Allow forcing MQTT ingest off even if broker envs remain set.
  // Set `DISABLE_MQTT_INGEST=true` in your Render / environment to opt out.
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_MQTT_INGEST !== 'true') {
    const mqttService = require('./services/mqttIngest');
    mqttService.startMqtt();
  } else {
    logger.info('DISABLE_MQTT_INGEST set or running in test mode; skipping MQTT ingest startup');
  }
} catch (e) {
  logger.warn('Failed to initialize MQTT ingest service', e && e.message ? e.message : e);
}

// Start IoT MQTT service for ESP32 commands/telemetry
try {
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_IOT_MQTT !== 'true') {
    const iotMqtt = require('./services/iotMqtt');
    iotMqtt.startIotMqtt();
  } else {
    logger.info('DISABLE_IOT_MQTT set or running in test mode; skipping IoT MQTT startup');
  }
} catch (e) {
  logger.warn('Failed to initialize IoT MQTT service', e && e.message ? e.message : e);
}

wss.on('connection', (ws, request) => {
  const requestPath = (request && request.url) ? request.url.split('?')[0] : 'unknown';
  logger.info(`New WebSocket connection established [${requestPath || '/'}]`);
  global.wsConnections.add(ws);
  // allow ws clients (ESP32) to register with a deviceId by sending a JSON message:
  // { type: 'register', deviceId: 'esp32-1' }
  ws.on('message', (raw) => {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString());
      if (!msg || typeof msg !== 'object') {
        return;
      }

      const typeValue = msg.type ? String(msg.type).toLowerCase() : '';
      const candidateDeviceId = msg.deviceId || msg.device_id || msg.hardwareId || msg.hardware_id;
      const resolvedDeviceId = candidateDeviceId ? String(candidateDeviceId).trim() : (ws.deviceId || null);

      const ensureOnline = async (deviceId, extraMetadata = {}) => {
        if (!deviceId) {
          return;
        }
        try {
          await markDeviceOnline(deviceId, {
            ...extraMetadata,
            via: 'native-ws',
            lastWsEvent: new Date().toISOString(),
          });
        } catch (error) {
          logger.warn('Failed to mark device online via native WebSocket', {
            deviceId,
            error: error && error.message ? error.message : error,
          });
        }
      };

      if (typeValue === 'register' && resolvedDeviceId) {
        ws.deviceId = msg.deviceId;
        global.deviceSockets.set(msg.deviceId, ws);
        logger.debug('WebSocket client registered', { deviceId: msg.deviceId });
        ensureOnline(msg.deviceId, {
          firmware: msg.firmware || null,
          metadata: msg.metadata || null,
        });
        // When a device registers, immediately send the current thresholds so device can sync
        (async () => {
          try {
            const Settings = require('./models/Settings');
            const settings = await Settings.getSettings();
            const thresholds = settings.thresholds || {};
            const payload = JSON.stringify({ type: 'thresholds', data: thresholds });
            if (ws.readyState === 1) {
              ws.send(payload);
              logger.info('ESP32 connected → Fetched current thresholds from DB → Synchronized successfully', { deviceId: msg.deviceId });
            }
          } catch (err) {
            logger.warn('Failed to send thresholds to device on register', err && err.message ? err.message : err);
          }
        })();
        return;
      }

      if (typeValue === 'heartbeat' && resolvedDeviceId) {
        ensureOnline(resolvedDeviceId, {
          heartbeatTimestamp: msg.timestamp || new Date().toISOString(),
        });
        return;
      }

      if (resolvedDeviceId) {
        ensureOnline(resolvedDeviceId, { messageType: typeValue || 'unknown' });
      }
    } catch (e) {
      // ignore non-JSON or unexpected messages
    }
  });
  
  ws.on('close', () => {
    if (process.env.NODE_ENV !== 'test') {
      logger.info('WebSocket connection closed');
    }
    global.wsConnections.delete(ws);
    if (ws && ws.deviceId && global.deviceSockets.get(ws.deviceId) === ws) {
      global.deviceSockets.delete(ws.deviceId);
      try {
        resetOfflineTimer(ws.deviceId);
      } catch (timerError) {
        logger.warn('Failed to reset offline timer on WS close', timerError && timerError.message ? timerError.message : timerError);
      }
    }
  });
  
  ws.on('error', (error) => {
    logger.warn('WebSocket error', error);
    global.wsConnections.delete(ws);
  });
});

// Security middleware
app.use(helmet());
app.use(compression());

const allowedHttpOrigins = [
  'https://vermilinks-frontend.onrender.com',
  'http://localhost:3000',
];
const envHttpOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
envHttpOrigins.forEach((origin) => {
  if (!allowedHttpOrigins.includes(origin)) {
    allowedHttpOrigins.push(origin);
  }
});
if (defaultFrontendOrigin && !allowedHttpOrigins.includes(defaultFrontendOrigin)) {
  allowedHttpOrigins.push(defaultFrontendOrigin);
}
const deviceHttpOrigin = process.env.DEVICE_HTTP_ORIGIN || process.env.ESP32_HTTP_ORIGIN;
if (deviceHttpOrigin && !allowedHttpOrigins.includes(deviceHttpOrigin)) {
  allowedHttpOrigins.push(deviceHttpOrigin);
}

const allowAllCors = (process.env.ALLOW_ALL_CORS || '').toString().toLowerCase() === 'true';
const resolveCorsOrigin = (origin, callback) => {
  if (!origin) {
    return callback(null, true);
  }
  if (allowAllCors) {
    return callback(null, origin);
  }
  if (allowedHttpOrigins.includes(origin)) {
    return callback(null, origin);
  }
  return callback(new Error('CORS origin not allowed'), false);
};

const httpCors = cors({
  origin: allowAllCors ? '*' : resolveCorsOrigin,
  credentials: !allowAllCors,
});

app.use(httpCors);
app.options('*', httpCors);

const isOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }
  if (allowAllCors) {
    return true;
  }
  return allowedHttpOrigins.includes(origin);
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowAllCors) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('X-Force-Cors', '1');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/admin/login', adminAuthLimiter);
app.use('/api/admin/forgot-password', adminAuthLimiter);
app.use('/api/admin/verify-otp', adminVerifyLimiter);
app.use('/api/admin/resend-otp', adminResendLimiter);

// Friendly JSON parse error handler: body-parser throws a SyntaxError which would
// surface to the generic error handler. Catch it early and return a clear 400
// without crashing or producing confusing stack traces in logs.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    logger.warn('JSON parse failed for request', req.method, req.originalUrl, 'raw body begins with:', (req && req.body && typeof req.body === 'string') ? req.body.slice(0,80) : typeof req.body);
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body' });
  }
  next(err);
});

if (schemaReady && typeof schemaReady.then === 'function') {
  app.use(async (req, res, next) => {
    try {
      await schemaReady;
      next();
    } catch (err) {
      next(err);
    }
  });
}


// Sequelize/Postgres: No MongoDB connection needed
// Database is initialized via Sequelize models and scripts

const buildHealthPayload = () => ({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: Date.now(),
});

app.get('/health', (req, res) => {
  // Provide DB connection info and application metadata
  const appVersion = require('./package.json').version || '0.0.0';
  const dbStatus = (database && typeof database.getActiveDialect === 'function') ? (database.getActiveDialect() === 'sqlite' ? 'connected' : 'connected') : 'unknown';
  res.status(200).json({ ok: true, db: dbStatus, version: appVersion, env: process.env.NODE_ENV || 'development' });
});

app.get('/api/health', async (req, res) => {
  try {
    // Check DB readiness by attempting a lightweight authenticate with retry suppressed
    let db = 'unknown';
    try {
      if (database && typeof database.getActiveDialect === 'function') {
        db = database.getActiveDialect() || 'unknown';
      }
      // If connectDB is available, try a quick authenticate but don't throw on failure
      if (typeof database.authenticate === 'function') {
        try {
          await database.authenticate();
          db = 'connected';
        } catch (e) {
          db = 'disconnected';
        }
      } else if (typeof database.connectDB === 'function') {
        try {
          await database.connectDB();
          db = 'connected';
        } catch (e) {
          db = 'disconnected';
        }
      }
    } catch (e) {
      db = 'error';
    }

    const appVersion = require('./package.json').version || '0.0.0';
    return res.status(200).json({ ok: true, db, version: appVersion, env: process.env.NODE_ENV || 'development' });
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'Health check failed', error: e && e.message ? e.message : String(e) });
  }
});

// Lightweight internal ping for debugging connectivity (temporary)
app.get('/internal/ping', (req, res) => {
  res.status(200).send('pong');
});

app.use('/api', iotRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/sensors', sensorRateLimiter, sensorRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/device-commands', deviceCommandRoutes);
app.use('/api/command', commandRoutes);
// Admin authentication + management routes
const adminAuthRoutes = require('./routes/adminAuth');
app.use('/api/admin', adminAuthRoutes);
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

// Device config endpoint (public) for ESP32 or other devices to fetch current config/thresholds
try {
  const deviceConfigRoutes = require('./routes/deviceConfig');
  app.use('/api/config', deviceConfigRoutes);
} catch (e) {
  logger && typeof logger.warn === 'function' && logger.warn('Device config route not available:', e && e.message ? e.message : e);
}

// Devices (heartbeats) route
const devicesRoutes = require('./routes/devices');
app.use('/api/devices', devicesRoutes);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
const deviceEventsRoutes = require('./routes/deviceEvents');
app.use('/api/device-events', deviceEventsRoutes);
const sensorLogRoutes = require('./routes/sensorLogs');
app.use('/api/sensor-logs', sensorLogRoutes);

// Actuator override endpoints (admin)
try {
  const actuatorOverrides = require('./routes/actuatorOverrides');
  app.use('/api/actuators', actuatorOverrides);
} catch (e) {
  logger && logger.warn && logger.warn('Actuator override routes not available:', e && e.message ? e.message : e);
}

// Serve frontend production build if available (useful in local dev)
try {
  const fs = require('fs');
  const frontendBuild = path.join(__dirname, '..', 'frontend', 'build');
  if (fs.existsSync(frontendBuild)) {
    logger.info('Found frontend build, serving static files from', frontendBuild);
    app.use(express.static(frontendBuild));
    // Serve index.html for SPA routes (admin/dashboard, login, etc.)
    app.get(['/','/login','/admin','/admin/*','/dashboard','/admin/dashboard'], (req, res) => {
      res.sendFile(path.join(frontendBuild, 'index.html'));
    });
  }
} catch (e) {
  logger.warn('Could not enable static frontend serving:', e && e.message ? e.message : e);
}

// 404 handler for unknown routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});
// Error handling middleware (must be last)
app.use(errorHandler);

// Start the server
// Default to 8000 as requested for new deployments; keep override via PORT env var
const PORT = process.env.PORT || 10000;

// Bind to 0.0.0.0 in development so localhost resolves (IPv4/IPv6) from browsers reliably
const BIND_HOST = (process.env.BIND_HOST || '0.0.0.0');

// Resilient binding: try PORT and fall back across a small range if the port is in use
const configuredPort = Number(process.env.PORT || PORT || 10000);
const MAX_TRIES = 10;
let attempts = 0;

function onBound(boundPort) {
  if ((process.env.NODE_ENV || 'development') !== 'test') {
    logger.info('Server running', { port: boundPort });
    logger.info('Health check endpoint ready', { url: `http://localhost:${boundPort}/api/health` });
  const deviceWsLogPath = deviceWsPath === '/' ? '' : deviceWsPath;
  logger.info('WebSocket server running', { url: `ws://localhost:${boundPort}${deviceWsLogPath}` });
    try {
      const addr = server.address();
      logger.debug('Server process info', { pid: process.pid, address: addr });
    } catch (e) {
      logger.warn('Could not determine server address/pid:', e && e.message ? e.message : e);
    }

    // Self-check the internal ping endpoint using the actual bound port
    try {
      const http = require('http');
      const selfOpts = {
        hostname: '127.0.0.1',
        port: boundPort,
        path: '/internal/ping',
        method: 'GET',
        timeout: 2000
      };
      const req = http.request(selfOpts, (res) => {
        let body = '';
        res.on('data', (c) => body += c.toString());
        res.on('end', () => {
          logger.debug('Self-check response', { statusCode: res.statusCode, body: body && body.toString().slice(0, 200) });
        });
      });
      req.on('error', (err) => {
        logger.warn('Self-check error connecting to local HTTP endpoint (this can be normal during startup):', err && err.message ? err.message : err);
      });
      req.on('timeout', () => {
        logger.warn('Self-check timed out connecting to local HTTP endpoint (this can be normal during startup)');
        req.destroy();
      });
      req.end();
    } catch (e) {
      logger.error('Self-check setup failed:', e && e.message ? e.message : e);
    }

    logger.info('✅ Backend boot complete — realtime control active');
  }
}

function tryListen(port) {
  attempts++;
  server.listen(port, BIND_HOST, () => onBound(port));
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} in use (EADDRINUSE)`);
      server.removeAllListeners('error');
      if (attempts < MAX_TRIES) {
        const next = port + 1;
        logger.info(`Attempting to bind to port ${next} (try ${attempts + 1}/${MAX_TRIES})`);
        tryListen(next);
      } else {
        logger.error('Exhausted port retry attempts. Continuing in development mode.');
        if ((process.env.NODE_ENV || 'development') === 'production') {
          process.exit(1);
        }
      }
    } else {
      logger.error('Server listen error', err);
      logger.warn('Continuing to run despite server error (development mode)');
      // Don't exit in development - just log the error
      if ((process.env.NODE_ENV || 'development') === 'production') {
        process.exit(1);
      }
    }
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  const cleanupTasks = [];

  Promise.all(cleanupTasks).finally(() => {
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection captured', { reason, promise });
  // Don't exit in development
  if ((process.env.NODE_ENV || 'development') === 'production') {
    process.exit(1);
  }
});

// Catch uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', error);
  // Don't exit in development
  if ((process.env.NODE_ENV || 'development') === 'production') {
    process.exit(1);
  }
});

// In development, run seed-admin as a non-blocking child process to ensure admin exists
if ((process.env.NODE_ENV || 'development') !== 'production') {
  try {
    // Temporarily disabled seeding to prevent server exit
    // const { spawn } = require('child_process');
    // const seedPath = path.join(__dirname, 'scripts', 'seed-admin.js');
    // const seedProc = spawn(process.execPath, [seedPath], { stdio: 'ignore', detached: true });
    // seedProc.unref();
    logger.info('Dev seeding process disabled (temporary fix)');
  } catch (e) {
    logger.warn('Could not launch dev seeding process:', e && e.message ? e.message : e);
  }
}

// Optionally start the sensor poller inline when RUN_POLLER is enabled.
// This keeps the poller in-process for simple local dev flows and PM2 will manage it when desired.
if (process.env.RUN_POLLER === 'true' || process.env.RUN_POLLER === '1') {
  try {
    const poller = require('./services/sensor-poller');
    const internalPort = process.env.POLLER_INTERNAL_PORT ? Number(process.env.POLLER_INTERNAL_PORT) : (process.env.INTERNAL_PORT ? Number(process.env.INTERNAL_PORT) : 3100);
    // start the internal HTTP server for poller metrics
    try {
      poller.startServer(internalPort);
      logger.info(`Started sensor poller internal server on port ${internalPort}`);
    } catch (e) {
      logger.warn('Sensor poller internal server failed to start:', e && e.message ? e.message : e);
    }

    // start the polling loop (non-blocking)
    poller.runLoop().catch((err) => {
      logger.error('Sensor poller loop exited with error:', err && err.message ? err.message : err);
    });
    logger.info('Sensor poller started (runLoop)');
  } catch (e) {
    logger.warn('Could not start sensor poller inline:', e && e.message ? e.message : e);
  }
}

module.exports = app;
// Export the http server as a property to allow tests to close it gracefully
module.exports.server = server;
module.exports.schemaReady = schemaReady;

// Simple server startup for development
if ((process.env.NODE_ENV || 'development') !== 'test') {
  connectDB()
    .then(() => {
      logger.info('Database connection verified during startup');
    })
    .catch((error) => {
      logger.error('Database connection failed at startup:', error && error.message ? error.message : error);
      if ((process.env.NODE_ENV || 'development') === 'production') {
        process.exit(1);
      } else {
        logger.warn('Continuing to start server without database connectivity; routes that require the database may fail until it reconnects.');
      }
    })
    .finally(() => {
      tryListen(configuredPort);
    });
} else {
  // In test mode we avoid calling server.listen() to prevent open handles during Jest runs.
  // Tests should use the exported `app` with Supertest which does not require the server to listen.
}
