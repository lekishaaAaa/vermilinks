import { useCallback, useEffect, useRef, useState } from 'react';
import { sensorService } from '../services/api';
import { SensorData, LatestSnapshot } from '../types';

export type PollingStatus = 'idle' | 'loading' | 'success' | 'error';

export interface SensorsPollingOptions {
  intervalMs?: number;
  maxIntervalMs?: number;
  cacheTtlMs?: number;
  immediate?: boolean;
  deviceId?: string;
  disabled?: boolean;
}

export interface SensorsPollingState {
  data: SensorData[];
  latest: SensorData | null;
  status: PollingStatus;
  error: string | null;
  isPolling: boolean;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
}

const normalizeReading = (input: SensorData): SensorData => {
  const deviceId = (input?.deviceId ?? (input as any)?.device_id ?? 'unknown-device').toString();
  let timestamp = input.timestamp;
  if (timestamp && typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) {
      timestamp = new Date(parsed).toISOString();
    }
  }
  return {
    ...input,
    deviceId,
    timestamp,
  };
};

export const useSensorsPolling = (options: SensorsPollingOptions = {}): SensorsPollingState => {
  const {
    intervalMs: intervalOption,
    maxIntervalMs: maxIntervalOption,
    cacheTtlMs: cacheTtlOption,
    immediate = true,
    deviceId,
    disabled = false,
  } = options;

  const intervalMs = Math.max(1500, intervalOption ?? 5000);
  const maxIntervalMs = Math.max(intervalMs, maxIntervalOption ?? 60000);
  const cacheTtlMs = Math.max(0, cacheTtlOption ?? Math.min(intervalMs * 0.6, 4000));

  const [data, setData] = useState<SensorData[]>([]);
  const [latest, setLatest] = useState<SensorData | null>(null);
  const [status, setStatus] = useState<PollingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef<number>(intervalMs);
  const cacheRef = useRef<{ timestamp: number; payload: SensorData[]; latest: SensorData | null } | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const fetchSensorsRef = useRef<(force: boolean) => Promise<void>>(async () => undefined);

  const scheduleNext = useCallback((delay: number) => {
    if (disabled) {
      return;
    }
    if (!isMountedRef.current) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void fetchSensorsRef.current(false);
    }, delay);
  }, [disabled]);

  const applyPayload = useCallback((payload: SensorData[]) => {
    const normalized = payload.map(normalizeReading);
    const latestReading = normalized.length > 0 ? normalized[0] : null;
    cacheRef.current = {
      timestamp: Date.now(),
      payload: normalized,
      latest: latestReading,
    };
    setData(normalized);
    setLatest(latestReading);
    setLastUpdated(Date.now());
    setError(null);
    setStatus('success');
  }, []);

  const fetchSensors = useCallback(async (force: boolean) => {
    if (disabled) {
      cacheRef.current = null;
      setData([]);
      setLatest(null);
      setLastUpdated(null);
      setStatus('idle');
      setError(null);
      setIsPolling(false);
      return;
    }
    if (!isMountedRef.current) {
      return;
    }

    const now = Date.now();
    const cache = cacheRef.current;
    if (!force && cache && now - cache.timestamp <= cacheTtlMs) {
      setData(cache.payload);
      setLatest(cache.latest);
      setLastUpdated(cache.timestamp);
      setStatus('success');
      setError(null);
      scheduleNext(intervalMs);
      return;
    }

    setIsPolling(true);
    setStatus((prev) => (prev === 'success' && !force ? prev : 'loading'));

    try {
      const snapshot: LatestSnapshot | null = await sensorService.getLatestData(deviceId);
      const resolvedDeviceId = deviceId || 'esp32b';

      const reading: SensorData | null = snapshot
        ? {
            deviceId: resolvedDeviceId,
            temperature: snapshot.temperature === null ? undefined : snapshot.temperature,
            humidity: snapshot.humidity === null ? undefined : snapshot.humidity,
            moisture: snapshot.soil_moisture === null ? undefined : snapshot.soil_moisture,
            soilTemperature: snapshot.soil_temperature === null ? undefined : snapshot.soil_temperature,
            floatSensor: snapshot.float_state === null ? null : snapshot.float_state,
            timestamp: snapshot.updated_at,
            sensorSummary: undefined,
            isOfflineData: false,
            deviceOnline: true,
          }
        : null;

      const readings = reading ? [reading] : [];

      if (readings.length === 0) {
        cacheRef.current = null;
        setData([]);
        setLatest(null);
        setLastUpdated(null);
        setStatus('idle');
        setError(null);
      } else {
        applyPayload(readings);
      }
      backoffRef.current = intervalMs;
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Unable to load sensors';
      setError(message);
      setStatus('error');
      const nextDelay = Math.min(backoffRef.current * 2, maxIntervalMs);
      backoffRef.current = Math.max(intervalMs, nextDelay);
    } finally {
      setIsPolling(false);
      if (isMountedRef.current) {
        scheduleNext(backoffRef.current);
      }
    }
  }, [applyPayload, cacheTtlMs, deviceId, disabled, intervalMs, maxIntervalMs, scheduleNext]);

  useEffect(() => {
    fetchSensorsRef.current = fetchSensors;
  }, [fetchSensors]);

  useEffect(() => {
    isMountedRef.current = true;
    backoffRef.current = intervalMs;
    cacheRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (disabled) {
      setData([]);
      setLatest(null);
      setStatus('idle');
      setError(null);
      return () => {
        isMountedRef.current = false;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
      };
    }

    if (immediate) {
      void fetchSensors(true);
    } else {
      scheduleNext(intervalMs);
    }

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [disabled, fetchSensors, immediate, intervalMs, scheduleNext]);

  useEffect(() => {
    cacheRef.current = null;
  }, [deviceId]);

  const refresh = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    backoffRef.current = intervalMs;
    if (disabled) {
      return;
    }
    await fetchSensors(true);
  }, [disabled, fetchSensors, intervalMs]);

  return {
    data,
    latest,
    status,
    error,
    isPolling,
    lastUpdated,
    refresh,
  };
};
