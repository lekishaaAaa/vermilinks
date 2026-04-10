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
		acquire: Number(process.env.DB_POOL_ACQUIRE || 8000),
		idle: Number(process.env.DB_POOL_IDLE || 10000)
	},
	retry: {
		max: Number(process.env.DB_QUERY_RETRY_MAX || 2),
		match: [
			/SequelizeConnectionError/i,
			/SequelizeConnectionAcquireTimeoutError/i,
			/Connection terminated unexpectedly/i,
				/timeout expired/i,
			/ECONNRESET/i,
			/ETIMEDOUT/i,
		],
	}
};

const modelModulePaths = [
	'../models/Actuator',
	'../models/ActuatorLog',
	'../models/ActuatorState',
	'../models/Admin',
	'../models/AdminOTP',
	'../models/Alert',
	'../models/AuditLog',
	'../models/Command',
	'../models/Device',
	'../models/DeviceCommand',
	'../models/DeviceEvent',
	'../models/DevicePort',
	'../models/Otp',
	'../models/PasswordResetToken',
	'../models/PendingCommand',
	'../models/RevokedToken',
	'../models/SensorData',
	'../models/SensorLog',
	'../models/SensorSnapshot',
	'../models/Settings',
	'../models/SoilReading',
	'../models/User',
	'../models/UserSession',
];

function deriveRenderInternalHost(hostname) {
	if (!hostname || typeof hostname !== 'string') {
		return null;
	}
	const match = hostname.match(/^([a-z0-9-]+)\.[a-z0-9-]+-postgres\.render\.com$/i);
	return match ? match[1] : null;
}


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
	let effectiveDatabaseUrl = databaseUrl;
	try {
		parsedUrl = new URL(databaseUrl);
	} catch (err) {
		console.error('[SAFE URL PARSE ERROR] Database URL:', databaseUrl, err.message);
		throw err;
	}

	const preferRenderInternal = (process.env.PREFER_RENDER_INTERNAL_DB || 'true').toLowerCase() !== 'false';
	const isRenderRuntime = String(process.env.RENDER || '').toLowerCase() === 'true' || Boolean(process.env.RENDER_SERVICE_ID);
	if (preferRenderInternal && isRenderRuntime) {
		const derivedInternalHost = deriveRenderInternalHost(parsedUrl.hostname);
		const configuredInternalHost = (process.env.DATABASE_HOST_INTERNAL || '').trim();
		const internalHost = configuredInternalHost || derivedInternalHost;

		if (internalHost && internalHost !== parsedUrl.hostname) {
			const originalHost = parsedUrl.hostname;
			parsedUrl.hostname = internalHost;
			effectiveDatabaseUrl = parsedUrl.toString();
			logger.info('Using Render internal database host for connection stability', {
				externalHost: originalHost,
				internalHost,
			});
		}
	}
	const isProduction = process.env.NODE_ENV === 'production';
	usesSsl = isProduction;

	const dialectOptions = isProduction
		? {
			ssl: { require: true, rejectUnauthorized: false },
			keepAlive: true,
			keepAliveInitialDelayMillis: Number(process.env.DB_KEEPALIVE_INITIAL_DELAY_MS || 10000),
			connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8000),
		}
		: {
			keepAlive: true,
			keepAliveInitialDelayMillis: Number(process.env.DB_KEEPALIVE_INITIAL_DELAY_MS || 10000),
			connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8000),
		};

	try {
		sequelize = new Sequelize(effectiveDatabaseUrl, {
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
	modelModulePaths.forEach((modulePath) => {
		require(modulePath);
	});
}

function normalizeTableNames(tables) {
	if (!Array.isArray(tables)) {
		return [];
	}

	return tables.map((table) => {
		if (typeof table === 'string') {
			return table;
		}
		if (table && typeof table === 'object') {
			return table.tableName || table.table || table.name || table.toString();
		}
		return String(table);
	}).filter(Boolean);
}

async function logVerifiedTables() {
	try {
		const tables = normalizeTableNames(await sequelize.getQueryInterface().showAllTables());
		const trackedTables = ['sensor_data', 'sensor_snapshots', 'alerts', 'devices'];
		const verifiedTables = trackedTables.filter((table) => tables.includes(table));
		if (tables.includes('otps')) {
			verifiedTables.push('otps');
		}
		logger.info('Database synced successfully');
		logger.info(`Tables verified: ${verifiedTables.length > 0 ? verifiedTables.join(', ') : trackedTables.join(', ')}`);
	} catch (error) {
		logger.warn('Database synced successfully, but table verification could not be completed', {
			error: error && error.message ? error.message : error,
		});
	}
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

	if (!syncOptions.force) {
		syncOptions.alter = options.alter ?? true;
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

	setupPromise = (async () => {
		try {
			await sequelize.sync(syncOptions);
		} catch (error) {
			const dialect = sequelize && typeof sequelize.getDialect === 'function' ? sequelize.getDialect() : null;
			if (dialect !== 'sqlite' && !syncOptions.force) {
				logger.warn('Initial schema sync failed, attempting auto-repair with alter:true', {
					error: error && error.message ? error.message : error,
				});
				await sequelize.sync({ alter: true });
			} else {
				throw error;
			}
		}

		await logVerifiedTables();
	})();

	setupPromise.catch(() => {
		setupPromise = null;
	});

	return setupPromise;
}

const connectDB = async () => {
	// Attempt connection with retries and exponential backoff to tolerate transient network issues
	const maxAttempts = Number(process.env.DB_CONNECT_RETRIES || 5);
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
