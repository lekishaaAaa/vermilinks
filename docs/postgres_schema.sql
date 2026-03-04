-- PostgreSQL schema for the Environmental Monitoring System
-- Generated 2025-10-17

BEGIN;

-- Enumerated types used by multiple tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_status_enum') THEN
    CREATE TYPE device_status_enum AS ENUM ('online', 'offline');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_status_enum') THEN
    CREATE TYPE alert_status_enum AS ENUM ('new', 'read');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'actuator_type_enum') THEN
    CREATE TYPE actuator_type_enum AS ENUM ('pump', 'solenoid', 'cycle');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'actuator_action_enum') THEN
    CREATE TYPE actuator_action_enum AS ENUM ('on', 'off', 'start', 'stop', 'auto', 'manual');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'actuator_trigger_enum') THEN
    CREATE TYPE actuator_trigger_enum AS ENUM ('automatic', 'manual');
  END IF;
END$$;

-- Users table
CREATE TABLE IF NOT EXISTS public.users (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  role        VARCHAR(50) NOT NULL DEFAULT 'user'
);

-- Registered IoT devices (ESP32, etc.)
CREATE TABLE IF NOT EXISTS public.devices (
  id             SERIAL PRIMARY KEY,
  deviceId       VARCHAR(255) NOT NULL UNIQUE,
  status         device_status_enum NOT NULL DEFAULT 'offline',
  lastHeartbeat  TIMESTAMPTZ,
  metadata       JSONB
);

-- Time-series sensor readings
CREATE TABLE IF NOT EXISTS public.sensor_data (
  id               BIGSERIAL PRIMARY KEY,
  device_id        VARCHAR(255) NOT NULL,
  temperature      DOUBLE PRECISION,
  humidity         DOUBLE PRECISION,
  moisture         DOUBLE PRECISION,
  soil_temperature DOUBLE PRECISION,
  ph               DOUBLE PRECISION,
  ec               DOUBLE PRECISION,
  nitrogen         DOUBLE PRECISION,
  phosphorus       DOUBLE PRECISION,
  potassium        DOUBLE PRECISION,
  water_level      INTEGER,
  battery_level    DOUBLE PRECISION,
  signal_strength  DOUBLE PRECISION,
  is_offline_data  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_sensor_data_device FOREIGN KEY (device_id)
    REFERENCES public.devices(deviceid)
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- Alert history (threshold, system, etc.)
CREATE TABLE IF NOT EXISTS public.alerts (
  id              BIGSERIAL PRIMARY KEY,
  type            VARCHAR(100) NOT NULL,
  severity        VARCHAR(100),
  message         TEXT NOT NULL,
  deviceId        VARCHAR(255),
  sensorData      JSONB,
  isResolved      BOOLEAN NOT NULL DEFAULT FALSE,
  resolvedAt      TIMESTAMPTZ,
  acknowledgedBy  VARCHAR(255),
  acknowledgedAt  TIMESTAMPTZ,
  status          alert_status_enum NOT NULL DEFAULT 'new',
  createdAt       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updatedAt       TIMESTAMPTZ,
  CONSTRAINT fk_alerts_device FOREIGN KEY (deviceId)
    REFERENCES public.devices(deviceId)
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- System-wide key/value settings
CREATE TABLE IF NOT EXISTS public.settings (
  id     SERIAL PRIMARY KEY,
  key    VARCHAR(255) NOT NULL UNIQUE,
  value  TEXT NOT NULL
);

-- Logs of actuator actions (pumps, solenoids, etc.)
CREATE TABLE IF NOT EXISTS public.actuator_logs (
  id           BIGSERIAL PRIMARY KEY,
  deviceId     VARCHAR(255) NOT NULL,
  actuatorType actuator_type_enum NOT NULL,
  action       actuator_action_enum NOT NULL,
  reason       VARCHAR(255),
  triggeredBy  actuator_trigger_enum NOT NULL DEFAULT 'automatic',
  userId       INTEGER,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_actuator_logs_device FOREIGN KEY (deviceId)
    REFERENCES public.devices(deviceId)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_actuator_logs_user FOREIGN KEY (userId)
    REFERENCES public.users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- Helpful indexes for query performance
CREATE INDEX IF NOT EXISTS idx_sensor_data_device_created_at
  ON public.sensor_data (device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_data_created_at
  ON public.sensor_data (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_device_status
  ON public.alerts (deviceId, status, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_actuator_logs_device_ts
  ON public.actuator_logs (deviceId, timestamp DESC);

COMMIT;
