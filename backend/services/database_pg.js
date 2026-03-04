const { Sequelize } = require('sequelize');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('../utils/logger');

const rawNodeEnv = (process.env.NODE_ENV || '').toLowerCase();
const isTestEnv = rawNodeEnv === 'test' || Boolean(process.env.JEST_WORKER_ID);
const envFile = isTestEnv ? '.env.test' : '.env';

// Load environment variables from the env file but do NOT override any
// variables explicitly set in the environment. This makes it possible to
// run the server with a temporary `DATABASE_URL` (for example
// `sqlite::memory:`) without `.env` values clobbering it.
dotenv.config({ path: path.join(__dirname, '..', envFile), override: false });

const baseOptions = {
	logging: false,
	pool: {
		max: Number(process.env.DB_POOL_MAX || 5),
		min: Number(process.env.DB_POOL_MIN || 0),
		acquire: Number(process.env.DB_POOL_ACQUIRE || 30000),
		idle: Number(process.env.DB_POOL_IDLE || 10000)
	}
};


let sequelize;
let currentDialect = 'postgres';
let usesSsl = false;

if (isTestEnv) {
	// Use SQLite in-memory DB to keep tests hermetic and fast.
	sequelize = new Sequelize({
		dialect: 'sqlite',
		storage: process.env.SQLITE_STORAGE || ':memory:',
		logging: false
	});
	currentDialect = 'sqlite';
} else {
	const databaseUrl = process.env.DATABASE_URL || '';
	console.log('[DEBUG] DATABASE_URL:', databaseUrl);
	console.log('[DEBUG] DATABASE_URL type:', typeof databaseUrl);
	if (!databaseUrl || typeof databaseUrl !== 'string') {
		logger.fatal('DATABASE_URL is missing or invalid.');
		throw new Error('DATABASE_URL is missing or invalid.');
	}

	// If someone configured a SQLite DATABASE_URL in a non-development environment
	// and did not explicitly allow SQLite fallback, refuse to start. This prevents
	// accidental usage of a local SQLite DB in production (e.g., Render) which can
	// cause runtime schema/ALTER issues and data loss.
	const isDevEnv = (process.env.NODE_ENV || '').toLowerCase() === 'development';
	const allowSqliteFallback = (process.env.ALLOW_SQLITE_FALLBACK || '').toLowerCase() === 'true';
	if (typeof databaseUrl === 'string' && databaseUrl.trim().toLowerCase().startsWith('sqlite:')) {
		if (!isTestEnv && !isDevEnv && !allowSqliteFallback) {
			logger.fatal('Refusing to use SQLite in non-development environment. Set DATABASE_URL to a PostgreSQL url for production, or enable ALLOW_SQLITE_FALLBACK=true for local development.');
			throw new Error('DATABASE_URL points to SQLite but ALLOW_SQLITE_FALLBACK is not enabled.');
		}
	}
	let parsedUrl;
	try {
		parsedUrl = new URL(databaseUrl);
	} catch (err) {
		console.error('[SAFE URL PARSE ERROR] Database URL:', databaseUrl, err.message);
		throw err;
	}
	const isProduction = process.env.NODE_ENV === 'production';
	usesSsl = isProduction;

	const dialectOptions = isProduction
		? { ssl: { require: true, rejectUnauthorized: false } }
		: {};

	try {
		sequelize = new Sequelize(databaseUrl, {
			...baseOptions,
			dialect: 'postgres',
			dialectOptions,
		});
	} catch (err) {
		console.error('[Sequelize Init Error]', err.message);
		throw err;
	}
}

function loadModels() {
	require('../models/User');
	require('../models/Device');
	require('../models/SensorData');
	require('../models/Alert');
	require('../models/Settings');
	require('../models/Actuator');
	require('../models/ActuatorLog');
	require('../models/DevicePort');
	require('../models/DeviceCommand');
	require('../models').Command;
	require('../models/Admin');
	require('../models/AdminOTP');
	require('../models/Otp');
	require('../models/RevokedToken');
	require('../models/UserSession');
	require('../models/AuditLog');
	require('../models/PasswordResetToken');
	require('../models/SensorSnapshot');
	require('../models/SensorLog');
}

let setupPromise = null;

async function ensureDatabaseSetup(options = {}) {
	if (setupPromise) {
		return setupPromise;
	}

	loadModels();

	const syncOptions = {};
	if (options.force || isTestEnv) {
		syncOptions.force = true;
	}

	// In production we rely on explicit migrations rather than Sequelize's
	// automatic `alter` behavior which can be dangerous when data exists.
	const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
	if (!syncOptions.force) {
		// Only enable `alter` automatically when not in production. Callers can
		// still pass `options.alter = true` to override explicitly (use with care).
		syncOptions.alter = options.alter ?? (!isProd);
	}

	// SQLite has limited ALTER TABLE support and certain alterations (like adding
	// a UNIQUE column) will fail. When using SQLite, avoid running `alter`
	// automatically — migrations should be applied explicitly instead.
	try {
		const dialect = sequelize && typeof sequelize.getDialect === 'function' ? sequelize.getDialect() : null;
		if (dialect === 'sqlite') {
			syncOptions.alter = false;
			// If force was requested (test mode), keep it as-is so tests still run
			if (options.force) {
				syncOptions.force = true;
			}
		}
	} catch (e) {
		// swallow - non-critical
	}

	logger.info('Syncing database schema', { force: Boolean(syncOptions.force), alter: Boolean(syncOptions.alter) });

	setupPromise = sequelize.sync(syncOptions).catch((err) => {
		setupPromise = null;
		throw err;
	});

	return setupPromise;
}

const connectDB = async () => {
	// Attempt connection with retries and exponential backoff to tolerate transient network issues
	const maxAttempts = Number(process.env.DB_CONNECT_RETRIES || 3);
	let attempt = 0;
	let lastErr = null;
	while (attempt < maxAttempts) {
		try {
			attempt += 1;
			await sequelize.authenticate();
			currentDialect = sequelize.getDialect();
			logger.info(`✅ Connected to PostgreSQL (attempt ${attempt}) (SSL mode: ${usesSsl ? 'require' : 'disabled'})`);
			return;
		} catch (error) {
			lastErr = error;
			logger.warn(`Database connect attempt ${attempt} failed: ${error && error.message ? error.message : error}`);
			if (attempt >= maxAttempts) break;
			// exponential backoff
			const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
			await new Promise((res) => setTimeout(res, backoffMs));
		}
	}
	logger.error('Unable to connect to the database after retries:', lastErr && lastErr.message ? lastErr.message : lastErr);
	logger.error('Verify DATABASE_URL and ensure the PostgreSQL service is reachable.');
	throw lastErr || new Error('Failed to connect to database');
};

module.exports = sequelize;
module.exports.connectDB = connectDB;
module.exports.getActiveDialect = () => currentDialect;
module.exports.ensureDatabaseSetup = ensureDatabaseSetup;
module.exports.getSslMode = () => (usesSsl ? 'require' : 'disabled');
