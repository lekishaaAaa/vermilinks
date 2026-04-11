import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert, SensorData } from '../types';
import api, {
  alertService,
  deviceService,
  discoverApi,
  sensorService,
} from '../services/api';
import { getSocket } from '../socket';

interface DeviceStatusInfo {
  deviceId: string;
  online: boolean;
  status: string;
  lastHeartbeat: string | null;
  updatedAt: string | null;
}

interface AlertBuckets {
  critical: Alert[];
  warning: Alert[];
  info: Alert[];
}

interface AlertSummary {
  critical: number;
  warning: number;
  info: number;
  lastAlertAt: string | null;
}

interface FloatLockoutState {
  active: boolean;
  deviceId: string | null;
  message: string | null;
  floatSensor: number | null;
  updatedAt: string | null;
}

interface DataContextType {
  latestTelemetry: SensorData | null;
  latestSensorData: SensorData[];
  actuatorStates: Record<string, boolean | number | null> | null;
  deviceStatuses: Record<string, DeviceStatusInfo>;
  recentAlerts: Alert[];
  groupedAlerts: AlertBuckets;
  alertSummary: AlertSummary;
  floatLockoutState: FloatLockoutState | null;
  isConnected: boolean;
  isLoading: boolean;
  lastFetchAt: string | null;
  lastFetchError: string | null;
  refreshTelemetry: (options?: { background?: boolean }) => Promise<void>;
  refreshSensors: (options?: { background?: boolean }) => Promise<void>;
  refreshAlerts: () => Promise<void>;
  clearAlerts: () => Promise<void>;
  clearLastFetchError: () => void;
  telemetryDisabled: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

interface DataProviderProps {
  children: ReactNode;
}

const normalizeSeverityToBucket = (severity?: string | null): keyof AlertBuckets => {
  const value = (severity || '').toString().toLowerCase();
  if (value === 'critical') return 'critical';
  if (value === 'high' || value === 'warning' || value === 'medium') return 'warning';
  return 'info';
};

const bucketizeAlerts = (alerts: Alert[]): AlertBuckets => {
  const buckets: AlertBuckets = { critical: [], warning: [], info: [] };
  alerts.forEach((alert) => {
    const bucket = normalizeSeverityToBucket(alert?.severity || alert?.type);
    buckets[bucket].push(alert);
  });
  return buckets;
};

const computeSummaryFromBuckets = (buckets: AlertBuckets): AlertSummary => {
  const allAlerts = [...buckets.critical, ...buckets.warning, ...buckets.info];
  const lastAlertAt = allAlerts
    .map((alert) => alert?.createdAt || alert?.updatedAt || null)
    .filter(Boolean)
    .map((value) => new Date(value as string).getTime())
    .reduce<number | null>((acc, ts) => {
      if (!Number.isFinite(ts)) return acc;
      if (acc === null) return ts as number;
      return ts > acc ? ts : acc;
    }, null);

  return {
    critical: buckets.critical.length,
    warning: buckets.warning.length,
    info: buckets.info.length,
    lastAlertAt: lastAlertAt ? new Date(lastAlertAt).toISOString() : null,
  };
};

const backendBaseFromApi = () => {
  const current = api.defaults.baseURL || '';
  if (!current) return '';
  return current.replace(/\/?api$/i, '');
};

const socketsEnabled = (process.env.REACT_APP_ENABLE_SOCKETS || '').toString().toLowerCase() === 'true';
const TELEMETRY_SMOOTH_ALPHA = (() => {
  const raw = Number(process.env.REACT_APP_TELEMETRY_SMOOTH_ALPHA ?? 0.4);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.4;
})();
const DEVICE_FRESHNESS_MS = 60000;
const STALE_TELEMETRY_THRESHOLD_MS = (() => {
  const raw = Number(process.env.REACT_APP_HIDE_STALE_MS || 5 * 60 * 1000);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
})();
const allowStaleTelemetry = (process.env.REACT_APP_ALLOW_STALE_DATA || 'false').toString().toLowerCase() === 'true';
const envForceTelemetryDisabled = (process.env.REACT_APP_TELEMETRY_DISABLED || '').toString().toLowerCase() === 'true';
const preferredTelemetryDeviceId = (process.env.REACT_APP_PRIMARY_SENSOR_DEVICE_ID || '').toString().trim() || null;
const TELEMETRY_DISABLED_MESSAGE = 'Telemetry feed temporarily disabled until sensors come online.';

const toNumber = (value: unknown): number | undefined => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIsoString = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  try {
    const date = value instanceof Date ? value : new Date(value as string);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  } catch {
    return null;
  }
};

const actuatorTrueTokens = new Set(['on', 'true', '1', 'open', 'enabled', 'start', 'active']);
const actuatorFalseTokens = new Set(['off', 'false', '0', 'closed', 'disabled', 'stop', 'inactive']);

const parseActuatorPrimitive = (value: unknown): boolean | number | null => {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (actuatorTrueTokens.has(normalized)) {
      return true;
    }
    if (actuatorFalseTokens.has(normalized)) {
      return false;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const coerceActuatorRecord = (raw: any): Record<string, any> | null => {
  if (!raw) {
    return null;
  }
  let source = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }
  if (Array.isArray(source)) {
    return source.reduce<Record<string, any>>((acc, entry) => {
      if (!entry || typeof entry !== 'object') {
        return acc;
      }
      const key = entry.key || entry.actuatorKey || entry.name || entry.id || entry.actuator;
      if (!key) {
        return acc;
      }
      acc[key.toString()] = entry.state ?? entry.status ?? entry.value ?? entry.desiredState ?? entry.on ?? null;
      return acc;
    }, {});
  }
  if (typeof source === 'object') {
    return source as Record<string, any>;
  }
  return null;
};

const extractActuatorStates = (sample: any): Record<string, boolean | number | null> | null => {
  if (!sample || typeof sample !== 'object') {
    return null;
  }
  const candidate = sample.actuatorStates
    ?? sample.actuator_states
    ?? sample.actuators
    ?? sample.actuatorState
    ?? sample.actuator
    ?? sample.latestActuators
    ?? null;
  if (!candidate) {
    return null;
  }
  const record = coerceActuatorRecord(candidate);
  if (!record) {
    return null;
  }
  const normalized: Record<string, boolean | number | null> = {};
  Object.entries(record).forEach(([rawKey, rawValue]) => {
    if (!rawKey) {
      return;
    }
    const key = rawKey.toString();
    const candidateValue = (rawValue && typeof rawValue === 'object')
      ? (rawValue.state ?? rawValue.value ?? rawValue.status ?? rawValue.desiredState ?? rawValue.on ?? null)
      : rawValue;
    normalized[key] = parseActuatorPrimitive(candidateValue);
  });
  return Object.keys(normalized).length > 0 ? normalized : null;
};

const normalizeSensorSample = (sample: any, fallbackDeviceId?: string): SensorData | null => {
  if (!sample || typeof sample !== 'object') {
    return null;
  }
  const resolvedDeviceIdRaw = sample.deviceId || sample.device_id || fallbackDeviceId || 'unknown-device';
  const deviceId = resolvedDeviceIdRaw ? resolvedDeviceIdRaw.toString() : 'unknown-device';
  const normalizedDeviceId = deviceId.trim().toLowerCase();
  const explicitFloatSourceDeviceId = (sample.floatSourceDeviceId || sample.float_source_device_id || '').toString().trim().toLowerCase();
  const isFloatSourceDevice = normalizedDeviceId === 'esp32a' || explicitFloatSourceDeviceId === 'esp32a';
  const floatSensorValue = isFloatSourceDevice
    ? toNullableNumber(
      sample.floatSensor
        ?? sample.float_sensor
        ?? sample.float_state
        ?? sample.floatLevel
        ?? sample.waterLevel
        ?? sample.water_level
    )
    : null;
  const timestampIso = toIsoString(sample.timestamp || sample.updated_at || sample.createdAt || sample.receivedAt) || new Date().toISOString();
  const sensorSummary = Array.isArray(sample.sensorSummary) ? sample.sensorSummary : undefined;
  const floatStatus = (() => {
    if (!isFloatSourceDevice) {
      return null;
    }
    const candidate = sample.floatStatus ?? sample.float_status ?? null;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
    return null;
  })();
  const normalizedWaterLevel = isFloatSourceDevice
    ? (toNumber(sample.waterLevel ?? sample.water_level ?? sample.waterlevel) ?? (typeof floatSensorValue === 'number' ? floatSensorValue : undefined))
    : undefined;

  const normalized: SensorData = {
    ...(sample as SensorData),
    deviceId,
    temperature: toNumber(sample.temperature ?? sample.temp ?? sample.temperatureC),
    humidity: toNumber(sample.humidity ?? sample.relativeHumidity),
    ambientTemperature: toNumber(sample.ambientTemperature ?? sample.ambient_temperature),
    ambientHumidity: toNumber(sample.ambientHumidity ?? sample.ambient_humidity),
    binTemperature: toNumber(sample.binTemperature ?? sample.bin_temperature),
    binHumidity: toNumber(sample.binHumidity ?? sample.bin_humidity),
    moisture: toNumber(sample.moisture ?? sample.soil_moisture ?? sample.soilMoisture),
    soilMoistureLayer1: toNumber(sample.soilMoistureLayer1 ?? sample.soil_moisture_layer1),
    soilMoistureLayer2: toNumber(sample.soilMoistureLayer2 ?? sample.soil_moisture_layer2),
    soilMoistureLayer3: toNumber(sample.soilMoistureLayer3 ?? sample.soil_moisture_layer3),
    soilTemperature: toNumber(sample.soilTemperature ?? sample.soil_temperature ?? sample.waterTempC ?? sample.soilTemp),
    soilTemperatureLayer1: toNumber(sample.soilTemperatureLayer1 ?? sample.soil_temperature_layer1),
    soilTemperatureLayer2: toNumber(sample.soilTemperatureLayer2 ?? sample.soil_temperature_layer2),
    soilTemperatureLayer3: toNumber(sample.soilTemperatureLayer3 ?? sample.soil_temperature_layer3),
    ph: toNumber(sample.ph),
    ec: toNumber(sample.ec ?? sample.electricalConductivity),
    nitrogen: toNumber(sample.nitrogen),
    phosphorus: toNumber(sample.phosphorus),
    potassium: toNumber(sample.potassium),
    waterLevel: normalizedWaterLevel,
    floatSensor: floatSensorValue,
    floatStatus,
    floatSourceDeviceId: isFloatSourceDevice ? 'esp32a' : null,
    floatSensorTimestamp: toIsoString(sample.floatSensorTimestamp ?? sample.float_sensor_timestamp ?? sample.floatTimestamp ?? sample.float_timestamp),
    batteryLevel: toNumber(sample.batteryLevel ?? sample.battery_level ?? sample.battery ?? sample.batt),
    signalStrength: toNumber(sample.signalStrength ?? sample.signal_strength ?? sample.rssi),
    timestamp: timestampIso,
    actuatorStates: extractActuatorStates(sample),
    sensorSummary,
  };

  return normalized;
};

const mergeSensorReadings = (existing: SensorData | null, incoming: SensorData | null): SensorData | null => {
  if (!incoming) return existing ? { ...existing } : null;
  if (!existing) return { ...incoming };

  const decide = (key: keyof SensorData) => {
    const inc = (incoming as any)[key];
    const ex = (existing as any)[key];
    if (inc === null || typeof inc === 'undefined') return ex ?? null;
    if (typeof inc === 'number' && inc === 0 && typeof ex === 'number' && ex !== 0) return ex;
    return inc;
  };

  const merged: SensorData = {
    ...existing,
    ...incoming,
    temperature: decide('temperature') as any,
    humidity: decide('humidity') as any,
    ambientTemperature: decide('ambientTemperature') as any,
    ambientHumidity: decide('ambientHumidity') as any,
    binTemperature: decide('binTemperature') as any,
    binHumidity: decide('binHumidity') as any,
    moisture: decide('moisture') as any,
    soilMoistureLayer1: decide('soilMoistureLayer1') as any,
    soilMoistureLayer2: decide('soilMoistureLayer2') as any,
    soilMoistureLayer3: decide('soilMoistureLayer3') as any,
    soilTemperature: decide('soilTemperature') as any,
    soilTemperatureLayer1: decide('soilTemperatureLayer1') as any,
    soilTemperatureLayer2: decide('soilTemperatureLayer2') as any,
    soilTemperatureLayer3: decide('soilTemperatureLayer3') as any,
    ph: decide('ph') as any,
    ec: decide('ec') as any,
    nitrogen: decide('nitrogen') as any,
    phosphorus: decide('phosphorus') as any,
    potassium: decide('potassium') as any,
    waterLevel: decide('waterLevel') as any,
    floatSensor: decide('floatSensor') as any,
    floatStatus: incoming.floatStatus ?? existing.floatStatus ?? null,
    floatSourceDeviceId: incoming.floatSourceDeviceId ?? existing.floatSourceDeviceId ?? null,
    batteryLevel: decide('batteryLevel') as any,
    signalStrength: decide('signalStrength') as any,
    actuatorStates: incoming.actuatorStates ?? existing.actuatorStates ?? null,
  } as SensorData;

  return merged;
};

export const DataProvider: React.FC<DataProviderProps> = ({ children }) => {
  const [latestTelemetry, setLatestTelemetry] = useState<SensorData | null>(null);
  const [lastTelemetry, setLastTelemetry] = useState<SensorData | null>(null);
  const [latestSensorData, setLatestSensorData] = useState<SensorData[]>([]);
  const [actuatorStates, setActuatorStates] = useState<Record<string, boolean | number | null> | null>(null);
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, DeviceStatusInfo>>({});
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [groupedAlerts, setGroupedAlerts] = useState<AlertBuckets>({ critical: [], warning: [], info: [] });
  const [alertSummary, setAlertSummary] = useState<AlertSummary>({ critical: 0, warning: 0, info: 0, lastAlertAt: null });
  const [floatLockoutState, setFloatLockoutState] = useState<FloatLockoutState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [lastFetchError, setLastFetchError] = useState<string | null>(null);
  const telemetryDisabled = envForceTelemetryDisabled;
  const backendBaseRef = useRef<string>('');
  const latestTelemetryRef = useRef<SensorData | null>(null);
  const telemetryCacheRef = useRef<SensorData[]>([]);
  useEffect(() => {
    latestTelemetryRef.current = latestTelemetry;
  }, [latestTelemetry]);
  const parsedPollInterval = Number(process.env.REACT_APP_SENSOR_POLL_INTERVAL_MS || '5000');
  const pollIntervalMs = Number.isFinite(parsedPollInterval) && parsedPollInterval > 0
    ? parsedPollInterval
    : 5000;

  const ensureBackendBase = useCallback(async () => {
    if (backendBaseRef.current) return backendBaseRef.current;
    const fromApi = backendBaseFromApi();
    if (fromApi) {
      backendBaseRef.current = fromApi;
      return backendBaseRef.current;
    }
    try {
      const discovery = await discoverApi({ timeout: 1500 });
      if (discovery.ok && discovery.baseURL) {
        const normalized = discovery.baseURL.replace(/\/?api$/i, '');
        backendBaseRef.current = normalized;
        return backendBaseRef.current;
      }
    } catch (e) {
      // discovery best-effort only
    }
    return '';
  }, []);

  const mergeDeviceStatus = useCallback((update: Partial<DeviceStatusInfo> & { deviceId: string }) => {
    setDeviceStatuses((prev) => {
      const existing = prev[update.deviceId];
      const deviceId = update.deviceId;
      const heartbeat = update.lastHeartbeat ?? existing?.lastHeartbeat ?? null;
      const heartbeatMs = heartbeat ? new Date(heartbeat).getTime() : NaN;
      const nextOnline = Number.isFinite(heartbeatMs)
        ? (Date.now() - heartbeatMs) < DEVICE_FRESHNESS_MS
        : Boolean(update.online ?? existing?.online ?? false);

      const next: DeviceStatusInfo = {
        deviceId,
        online: nextOnline,
        status: update.status || existing?.status || (nextOnline ? 'online' : 'offline'),
        lastHeartbeat: update.lastHeartbeat ?? existing?.lastHeartbeat ?? null,
        updatedAt: update.updatedAt ?? new Date().toISOString(),
      };

      const computed = { ...prev, [deviceId]: next };
      const anyOnline = Object.values(computed).some((state) => state.online);
      setIsConnected(anyOnline);
      return computed;
    });
  }, []);

  const refreshAlerts = useCallback(async () => {
    if (telemetryDisabled) {
      setRecentAlerts([]);
      setGroupedAlerts({ critical: [], warning: [], info: [] });
      setAlertSummary({ critical: 0, warning: 0, info: 0, lastAlertAt: null });
      setLastFetchError(TELEMETRY_DISABLED_MESSAGE);
      return;
    }
    try {
      const [recentResponse, summaryResponse] = await Promise.all([
        alertService.getRecentAlerts(20).catch(() => ({ data: { data: [] } })),
        alertService.getSummary().catch(() => ({ critical: 0, warning: 0, info: 0, lastAlertAt: null })),
      ]);

      const recentPayload = (recentResponse?.data?.data ?? []) as Alert[];
      const sortedAlerts = [...recentPayload].sort((a, b) => {
        const aTs = new Date(a?.createdAt || a?.updatedAt || 0).getTime();
        const bTs = new Date(b?.createdAt || b?.updatedAt || 0).getTime();
        return bTs - aTs;
      });

      const buckets = bucketizeAlerts(sortedAlerts);
      let summary: AlertSummary;
      if ('critical' in summaryResponse && 'warning' in summaryResponse && 'info' in summaryResponse) {
        const summaryCandidate = summaryResponse as Partial<AlertSummary> & { critical?: number; warning?: number; info?: number };
        summary = {
          critical: Number(summaryCandidate.critical ?? 0),
          warning: Number(summaryCandidate.warning ?? 0),
          info: Number(summaryCandidate.info ?? 0),
          lastAlertAt: typeof summaryCandidate.lastAlertAt !== 'undefined'
            ? summaryCandidate.lastAlertAt ?? computeSummaryFromBuckets(buckets).lastAlertAt
            : computeSummaryFromBuckets(buckets).lastAlertAt,
        };
      } else {
        summary = computeSummaryFromBuckets(buckets);
      }

      setRecentAlerts(sortedAlerts);
      setGroupedAlerts(buckets);
      setAlertSummary(summary);
    } catch (error: any) {
      setRecentAlerts([]);
      setGroupedAlerts({ critical: [], warning: [], info: [] });
      setAlertSummary({ critical: 0, warning: 0, info: 0, lastAlertAt: null });
      setLastFetchError(error?.message || 'Unable to load alerts');
      throw error;
    }
  }, [telemetryDisabled]);

  const getStableTelemetry = useCallback((newTelemetry: SensorData | null): SensorData | null => {
    if (newTelemetry) {
      setLastTelemetry(newTelemetry);
      return newTelemetry;
    }
    return lastTelemetry ?? latestTelemetryRef.current;
  }, [lastTelemetry]);

  const updateTelemetryCache = useCallback((reading: SensorData | null) => {
    if (!reading) {
      telemetryCacheRef.current = [];
      setLatestSensorData([]);
      return;
    }
    const nextCache = [...telemetryCacheRef.current, reading].slice(-10);
    telemetryCacheRef.current = nextCache;
    setLatestSensorData(nextCache);
  }, []);

  const clearAlerts = useCallback(async () => {
    if (telemetryDisabled) {
      setLastFetchError(TELEMETRY_DISABLED_MESSAGE);
      return;
    }
    try {
      await alertService.clearAll();
      await refreshAlerts();
    } catch (error: any) {
      setLastFetchError(error?.message || 'Unable to clear alerts');
      throw error;
    }
  }, [refreshAlerts, telemetryDisabled]);

  const handleTelemetryPayload = useCallback((raw: any, options?: { updateLatestList?: boolean }) => {
    if (!raw || telemetryDisabled) return null;
    const sample = Array.isArray(raw) ? raw[0] : raw;
    if (!sample || typeof sample !== 'object') return null;
    const normalized = normalizeSensorSample(sample, (sample as any)?.deviceId || (sample as any)?.device_id || undefined);
    if (!normalized) {
      return null;
    }
    const deviceId = normalized.deviceId || 'unknown-device';

    const timestampMs = normalized.timestamp ? new Date(normalized.timestamp).getTime() : NaN;
    const sampleAgeMs = Number.isFinite(timestampMs) ? Date.now() - timestampMs : null;
    const isStale = sampleAgeMs === null ? true : sampleAgeMs > STALE_TELEMETRY_THRESHOLD_MS;
    normalized.sampleAgeMs = sampleAgeMs;
    normalized.isStale = isStale;
    normalized.lastSeen = normalized.timestamp ? new Date(normalized.timestamp).toISOString() : null;
    normalized.deviceOnline = Boolean(normalized.deviceOnline && !isStale);

    const connectionHealthy = !isStale || allowStaleTelemetry;
    if (isStale && !allowStaleTelemetry) {
      const fallbackTelemetry = latestTelemetryRef.current || lastTelemetry;
      if (fallbackTelemetry) {
        setLatestTelemetry(fallbackTelemetry);
        setLastTelemetry(fallbackTelemetry);
        updateTelemetryCache(fallbackTelemetry);
        setActuatorStates(fallbackTelemetry.actuatorStates || null);
      }
      setIsConnected(false);
      setLastFetchError('Awaiting live telemetry from sensors');
      return fallbackTelemetry || null;
    }

    if (!connectionHealthy && !latestTelemetryRef.current) {
      setLastFetchError('Awaiting live telemetry from sensors');
    } else {
      setLastFetchError(null);
    }

    const merged = mergeSensorReadings(latestTelemetryRef.current, normalized) || normalized;
    // preserve the freshly computed metadata from this incoming sample
    merged.sampleAgeMs = normalized.sampleAgeMs;
    merged.isStale = normalized.isStale;
    merged.lastSeen = normalized.lastSeen;
    merged.deviceOnline = normalized.deviceOnline;

    // Apply simple exponential smoothing to numeric telemetry values to reduce UI jitter
    const smooth = (existing: SensorData | null, incoming: SensorData, alpha = TELEMETRY_SMOOTH_ALPHA): SensorData => {
      if (!existing) return { ...incoming };
      const out: any = { ...existing, ...incoming };
      const numericKeys: Array<keyof SensorData> = ['temperature', 'humidity', 'moisture', 'ph', 'ec', 'nitrogen', 'phosphorus', 'potassium', 'waterLevel', 'floatSensor', 'batteryLevel', 'signalStrength'];
      numericKeys.forEach((k) => {
        const inc = (incoming as any)[k];
        const ex = (existing as any)[k];
        if (typeof inc === 'number' && typeof ex === 'number') {
          out[k] = Number((ex * (1 - alpha) + inc * alpha).toFixed(4));
        } else if (typeof inc === 'number') {
          out[k] = inc;
        } else {
          out[k] = ex ?? null;
        }
      });
      return out as SensorData;
    };

    const smoothed = smooth(latestTelemetryRef.current, merged);
    setLatestTelemetry(smoothed);
    setLastTelemetry(smoothed);
    setIsConnected(connectionHealthy);
    setActuatorStates(merged.actuatorStates || null);
    if (options?.updateLatestList !== false) {
      updateTelemetryCache(smoothed);
    }
    setLastFetchAt(new Date().toISOString());
    setLastFetchError(null);

    const normalizedDeviceStatus = ((sample as any)?.deviceStatus || '').toString().toLowerCase();
    const online = typeof normalized.deviceOnline === 'boolean'
      ? normalized.deviceOnline
      : normalizedDeviceStatus === 'online';
    const heartbeat = normalized.lastSeen || (sample as any)?.timestamp || (sample as any)?.receivedAt || null;
    mergeDeviceStatus({
      deviceId,
      online,
      status: online ? 'online' : 'offline',
      lastHeartbeat: heartbeat ? new Date(heartbeat).toISOString() : null,
      updatedAt: new Date().toISOString(),
    });
    return normalized;
  }, [lastTelemetry, mergeDeviceStatus, telemetryDisabled, updateTelemetryCache]);

  const refreshTelemetry = useCallback(async (options?: { background?: boolean }) => {
    if (telemetryDisabled) {
      setLatestTelemetry(null);
      setLatestSensorData([]);
      setActuatorStates(null);
      setIsConnected(false);
      setLastFetchAt(null);
      setLastFetchError(TELEMETRY_DISABLED_MESSAGE);
      setIsLoading(false);
      return;
    }
    const background = Boolean(options?.background);
    if (!background) {
      setIsLoading(true);
      setLastFetchError(null);
    }
    try {
      await ensureBackendBase();
      const requestedDeviceId = preferredTelemetryDeviceId || undefined;
      const shouldHydrateEsp32aFloat = !requestedDeviceId || requestedDeviceId.toString().trim().toLowerCase() !== 'esp32a';
      const [snapshot, esp32aFloatSnapshot, latestActuatorStateResponse] = await Promise.all([
        sensorService.getLatestData(requestedDeviceId),
        shouldHydrateEsp32aFloat
          ? sensorService.getLatestData('esp32a').catch(() => null)
          : Promise.resolve(null),
        api.get('/latest').catch(() => null),
      ]);
      const resolvedDeviceId = (snapshot as any)?.device_id || (snapshot as any)?.deviceId || preferredTelemetryDeviceId || 'unknown-device';
      const snapshotRecord = snapshot as any;
      let reading: SensorData | null = snapshot
        ? normalizeSensorSample({
            deviceId: resolvedDeviceId,
            temperature: snapshot.temperature,
            humidity: snapshot.humidity,
            ambientTemperature: snapshotRecord?.ambient_temperature ?? snapshotRecord?.ambientTemperature,
            ambientHumidity: snapshotRecord?.ambient_humidity ?? snapshotRecord?.ambientHumidity,
            binTemperature: snapshotRecord?.bin_temperature ?? snapshotRecord?.binTemperature,
            binHumidity: snapshotRecord?.bin_humidity ?? snapshotRecord?.binHumidity,
            moisture: snapshot.soil_moisture,
            soilMoistureLayer1: snapshotRecord?.soil_moisture_layer1 ?? snapshotRecord?.soilMoistureLayer1,
            soilMoistureLayer2: snapshotRecord?.soil_moisture_layer2 ?? snapshotRecord?.soilMoistureLayer2,
            soilMoistureLayer3: snapshotRecord?.soil_moisture_layer3 ?? snapshotRecord?.soilMoistureLayer3,
            soilTemperature: snapshot.soil_temperature ?? (snapshot as any).soilTemperature,
            soilTemperatureLayer1: snapshotRecord?.soil_temperature_layer1 ?? snapshotRecord?.soilTemperatureLayer1,
            soilTemperatureLayer2: snapshotRecord?.soil_temperature_layer2 ?? snapshotRecord?.soilTemperatureLayer2,
            soilTemperatureLayer3: snapshotRecord?.soil_temperature_layer3 ?? snapshotRecord?.soilTemperatureLayer3,
            ph: snapshot.ph,
            ec: snapshot.ec,
            nitrogen: snapshot.nitrogen,
            phosphorus: snapshot.phosphorus,
            potassium: snapshot.potassium,
            waterLevel: snapshot.water_level,
            floatSensor: snapshot.float_state,
            floatStatus: snapshotRecord?.float_status ?? snapshotRecord?.floatStatus,
            batteryLevel: snapshot.battery_level,
            signalStrength: snapshot.signal_strength,
            actuatorStates: snapshotRecord?.actuatorStates ?? snapshotRecord?.actuator_states ?? null,
            timestamp: snapshotRecord?.timestamp ?? snapshot.updated_at,
            isOfflineData: Boolean(snapshotRecord?.isOfflineData),
            deviceOnline: typeof snapshotRecord?.deviceOnline === 'boolean'
              ? snapshotRecord.deviceOnline
              : !Boolean(snapshotRecord?.isOfflineData),
          }, resolvedDeviceId)
        : null;

      if (reading && esp32aFloatSnapshot) {
        const esp32aRecord = esp32aFloatSnapshot as any;
        const esp32aReading = normalizeSensorSample({
          deviceId: esp32aRecord?.device_id || esp32aRecord?.deviceId || 'esp32a',
          waterLevel: esp32aFloatSnapshot.water_level,
          floatSensor: esp32aFloatSnapshot.float_state,
          floatStatus: esp32aRecord?.float_status ?? esp32aRecord?.floatStatus,
          floatSensorTimestamp: esp32aRecord?.updated_at ?? esp32aRecord?.timestamp,
          timestamp: esp32aRecord?.timestamp ?? esp32aFloatSnapshot.updated_at,
        }, 'esp32a');

        if (esp32aReading) {
          reading = {
            ...reading,
            waterLevel: typeof esp32aReading.waterLevel === 'number' ? esp32aReading.waterLevel : reading.waterLevel,
            floatSensor: esp32aReading.floatSensor ?? reading.floatSensor ?? null,
            floatStatus: esp32aReading.floatStatus ?? reading.floatStatus ?? null,
            floatSourceDeviceId: 'esp32a',
            floatSensorTimestamp: esp32aReading.floatSensorTimestamp ?? reading.floatSensorTimestamp ?? null,
          };
        }
      }

      const stateEnvelope = latestActuatorStateResponse?.data?.data || latestActuatorStateResponse?.data || null;
      const actuatorState = stateEnvelope?.deviceState || null;
      if (actuatorState && typeof actuatorState === 'object') {
        const rawFloatState = actuatorState.float_state ?? actuatorState.float ?? null;
        const rawFloatStatus = actuatorState.float_state ?? actuatorState.floatStatus ?? actuatorState.float_status ?? null;
        const normalizedFloatStatus = typeof rawFloatStatus === 'string' && rawFloatStatus.trim()
          ? rawFloatStatus.trim().toUpperCase()
          : null;
        const normalizedFloatSensor = typeof rawFloatState === 'number'
          ? rawFloatState
          : (normalizedFloatStatus === 'LOW'
            ? 0
            : normalizedFloatStatus === 'NORMAL'
              ? 1
              : normalizedFloatStatus === 'FULL' || normalizedFloatStatus === 'HIGH'
                ? 2
                : null);

        if (reading) {
          reading = {
            ...reading,
            waterLevel: typeof normalizedFloatSensor === 'number' ? normalizedFloatSensor : reading.waterLevel,
            floatSensor: normalizedFloatSensor ?? reading.floatSensor ?? null,
            floatStatus: normalizedFloatStatus ?? reading.floatStatus ?? null,
            floatSourceDeviceId: 'esp32a',
            floatSensorTimestamp: actuatorState.ts ?? reading.floatSensorTimestamp ?? null,
          };
        } else if (typeof normalizedFloatSensor === 'number' || normalizedFloatStatus) {
          reading = normalizeSensorSample({
            deviceId: 'esp32a',
            waterLevel: normalizedFloatSensor,
            floatSensor: normalizedFloatSensor,
            floatStatus: normalizedFloatStatus,
            timestamp: actuatorState.ts || new Date().toISOString(),
          }, 'esp32a');
        }
      }

      if (reading) {
        const processed = handleTelemetryPayload(reading, { updateLatestList: false });
        const stableTelemetry = getStableTelemetry(processed);
        if (stableTelemetry) {
          setLatestTelemetry(stableTelemetry);
          updateTelemetryCache(stableTelemetry);
        } else {
          updateTelemetryCache(null);
        }
        setActuatorStates(reading.actuatorStates || null);
      } else {
        const fallbackTelemetry = latestTelemetryRef.current || lastTelemetry;
        if (fallbackTelemetry) {
          setLatestTelemetry(fallbackTelemetry);
          setLastTelemetry(fallbackTelemetry);
          updateTelemetryCache(fallbackTelemetry);
          setActuatorStates(fallbackTelemetry.actuatorStates || null);
          setIsConnected(false);
        } else {
          setLatestTelemetry(null);
          setLastTelemetry(null);
          updateTelemetryCache(null);
          setActuatorStates(null);
          setIsConnected(false);
        }
      }
      if (!background) {
        setLastFetchError(null);
      }
    } catch (error: any) {
      setLastFetchError(error?.message || 'Unable to load telemetry');
      if (!background) {
        if (!latestTelemetryRef.current) {
          setLatestTelemetry(null);
          updateTelemetryCache(null);
          setActuatorStates(null);
          setIsConnected(false);
        }
        throw error;
      }
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, [ensureBackendBase, getStableTelemetry, handleTelemetryPayload, lastTelemetry, telemetryDisabled, updateTelemetryCache]);

  const refreshSensors = useCallback(async (options?: { background?: boolean }) => {
    await refreshTelemetry(options);
  }, [refreshTelemetry]);

  useEffect(() => {
    let isMounted = true;

    const resetRealtimeState = () => {
      setLatestTelemetry(null);
      setLastTelemetry(null);
      setLatestSensorData([]);
      setActuatorStates(null);
      setDeviceStatuses({});
      setRecentAlerts([]);
      setGroupedAlerts({ critical: [], warning: [], info: [] });
      setAlertSummary({ critical: 0, warning: 0, info: 0, lastAlertAt: null });
      setIsConnected(false);
      setIsLoading(false);
      setLastFetchAt(null);
      setLastFetchError(TELEMETRY_DISABLED_MESSAGE);
    };

    if (envForceTelemetryDisabled) {
      resetRealtimeState();
      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        await ensureBackendBase();
        await Promise.all([
          refreshTelemetry().catch(() => null),
          refreshAlerts().catch(() => null),
          (async () => {
            const resp = await deviceService.list().catch(() => null);
            const devices = (resp?.data?.data ?? resp?.data ?? []) as any[];
            devices.forEach((device) => {
              const deviceId = (device?.deviceId || device?.device_id || '').toString();
              if (!deviceId || !isMounted) return;
              mergeDeviceStatus({
                deviceId,
                online: Boolean(device?.status === 'online' || device?.online === true),
                status: (device?.status || (device?.online ? 'online' : 'offline')) || 'offline',
                lastHeartbeat: device?.lastHeartbeat ? new Date(device.lastHeartbeat).toISOString() : null,
                updatedAt: device?.updatedAt ? new Date(device.updatedAt).toISOString() : new Date().toISOString(),
              });
            });
          })(),
        ]);
      } catch (error: any) {
        setLastFetchError(error?.message || 'Initialization failed');
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [ensureBackendBase, mergeDeviceStatus, refreshAlerts, refreshTelemetry]);

  useEffect(() => {
    let isMounted = true;
    if (telemetryDisabled) {
      setLatestTelemetry(null);
      setLastTelemetry(null);
      setLatestSensorData([]);
      setActuatorStates(null);
      setDeviceStatuses({});
      setRecentAlerts([]);
      setGroupedAlerts({ critical: [], warning: [], info: [] });
      setAlertSummary({ critical: 0, warning: 0, info: 0, lastAlertAt: null });
      setIsConnected(false);
      setIsLoading(false);
      setLastFetchAt(null);
      setLastFetchError(TELEMETRY_DISABLED_MESSAGE);
      return () => {
        isMounted = false;
      };
    }
    (async () => {
      try {
        await ensureBackendBase();
        await Promise.all([
          refreshTelemetry().catch(() => null),
          refreshAlerts().catch(() => null),
          (async () => {
            const resp = await deviceService.list().catch(() => null);
            const devices = (resp?.data?.data ?? resp?.data ?? []) as any[];
            devices.forEach((device) => {
              const deviceId = (device?.deviceId || device?.device_id || '').toString();
              if (!deviceId) return;
              if (!isMounted) return;
              mergeDeviceStatus({
                deviceId,
                online: Boolean(device?.status === 'online' || device?.online === true),
                status: (device?.status || (device?.online ? 'online' : 'offline')) || 'offline',
                lastHeartbeat: device?.lastHeartbeat ? new Date(device.lastHeartbeat).toISOString() : null,
                updatedAt: device?.updatedAt ? new Date(device.updatedAt).toISOString() : new Date().toISOString(),
              });
            });
          })(),
        ]);
      } catch (error: any) {
        setLastFetchError(error?.message || 'Initialization failed');
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [ensureBackendBase, mergeDeviceStatus, refreshAlerts, refreshTelemetry, telemetryDisabled]);

  useEffect(() => {
    if (telemetryDisabled || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      refreshTelemetry({ background: true }).catch(() => null);
    }, pollIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [pollIntervalMs, refreshTelemetry, telemetryDisabled]);

  useEffect(() => {
    if (telemetryDisabled || !socketsEnabled) {
      return;
    }

    const socket = getSocket();
    if (!socket) {
      return;
    }

    const telemetryHandler = (payload: any) => handleTelemetryPayload(payload);

    const deviceStatusHandler = (payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      const deviceId = (payload.deviceId || payload.device_id || payload.id || '').toString();
      if (!deviceId) return;
      mergeDeviceStatus({
        deviceId,
        online: Boolean(payload.online ?? (payload.status || '').toString().toLowerCase() === 'online'),
        status: (payload.status || (payload.online ? 'online' : 'offline')) || 'offline',
        lastHeartbeat: payload.lastHeartbeat ? new Date(payload.lastHeartbeat).toISOString() : null,
        updatedAt: new Date().toISOString(),
      });
    };

    const floatLockoutHandler = (payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      const action = (payload.action || payload.type || '').toString().toLowerCase();
      if (action === 'clear' || action === 'cleared') {
        setFloatLockoutState({
          active: false,
          deviceId: payload.deviceId ?? null,
          message: null,
          floatSensor: typeof payload.floatSensor === 'number' ? payload.floatSensor : null,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      setFloatLockoutState({
        active: true,
        deviceId: payload.deviceId ?? null,
        message: payload.message || 'Float sensor lockout active',
        floatSensor: typeof payload.floatSensor === 'number' ? payload.floatSensor : null,
        updatedAt: new Date().toISOString(),
      });
    };

    const alertsTriggerHandler = () => {
      refreshAlerts().catch(() => null);
    };

    socket.on('telemetry:update', telemetryHandler);
    socket.on('sensor:update', telemetryHandler);
    socket.on('sensor_update', telemetryHandler);
    socket.on('device:status', deviceStatusHandler);
    socket.on('device_status', deviceStatusHandler);
    socket.on('float:lockout', floatLockoutHandler);
    socket.on('floatLockout', floatLockoutHandler);
    socket.on('floatLockoutCleared', floatLockoutHandler);
    socket.on('alert:new', alertsTriggerHandler);
    socket.on('alert:cleared', alertsTriggerHandler);
    socket.on('alert:trigger', alertsTriggerHandler);

    return () => {
      socket.off('telemetry:update', telemetryHandler);
      socket.off('sensor:update', telemetryHandler);
      socket.off('sensor_update', telemetryHandler);
      socket.off('device:status', deviceStatusHandler);
      socket.off('device_status', deviceStatusHandler);
      socket.off('float:lockout', floatLockoutHandler);
      socket.off('floatLockout', floatLockoutHandler);
      socket.off('floatLockoutCleared', floatLockoutHandler);
      socket.off('alert:new', alertsTriggerHandler);
      socket.off('alert:cleared', alertsTriggerHandler);
      socket.off('alert:trigger', alertsTriggerHandler);
    };
  }, [handleTelemetryPayload, mergeDeviceStatus, refreshAlerts, telemetryDisabled]);

  const contextValue = useMemo<DataContextType>(() => ({
    latestTelemetry,
    latestSensorData,
    actuatorStates,
    deviceStatuses,
    recentAlerts,
    groupedAlerts,
    alertSummary,
    floatLockoutState,
    isConnected,
    isLoading,
    lastFetchAt,
    lastFetchError,
    refreshTelemetry,
    refreshSensors,
    refreshAlerts,
    clearAlerts,
    clearLastFetchError: () => setLastFetchError(null),
    telemetryDisabled,
  }), [
    latestTelemetry,
    latestSensorData,
    actuatorStates,
    deviceStatuses,
    recentAlerts,
    groupedAlerts,
    alertSummary,
    floatLockoutState,
    isConnected,
    isLoading,
    lastFetchAt,
    lastFetchError,
    refreshTelemetry,
    refreshSensors,
    refreshAlerts,
    clearAlerts,
    telemetryDisabled,
  ]);

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = (): DataContextType => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
