import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Activity, ToggleLeft } from 'lucide-react';
import { useSensorsPolling } from '../hooks/useSensorsPolling';
import { SensorData } from '../types';
import { useData } from '../contexts/DataContext';
import SensorOverview from './SensorOverview';
import { sensorService } from '../services/api';

interface SensorSummaryPanelProps {
  className?: string;
  deviceId?: string;
}


const ACTUATOR_LABELS: Record<string, string> = {
  water_pump: 'Water Pump',
  pump: 'Water Pump',
  pump1: 'Water Pump',
  pump2: 'Utility Pump',
  solenoid: 'Solenoid Valve',
  solenoid1: 'Solenoid 1',
  solenoid2: 'Solenoid 2',
  solenoid_valve: 'Solenoid Valve',
  aerator: 'Aeration Fan',
  mister: 'Mister',
};

const ACTUATOR_PRIORITY = ['water_pump', 'pump', 'pump1', 'solenoid', 'solenoid1', 'solenoid2'];

const friendlyActuatorLabel = (key: string): string => {
  const normalized = key.toLowerCase();
  if (ACTUATOR_LABELS[normalized]) {
    return ACTUATOR_LABELS[normalized];
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const actuatorPriorityValue = (key: string): number => {
  const normalized = key.toLowerCase();
  const idx = ACTUATOR_PRIORITY.indexOf(normalized);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
};

const formatActuatorReading = (value: boolean | number | null): { label: string; tone: 'on' | 'off' | 'neutral' } => {
  if (typeof value === 'boolean') {
    return { label: value ? 'On' : 'Off', tone: value ? 'on' : 'off' };
  }
  if (typeof value === 'number') {
    return { label: Number.isInteger(value) ? `${value}` : value.toFixed(1), tone: value > 0 ? 'on' : 'neutral' };
  }
  return { label: 'Unknown', tone: 'neutral' };
};

const SensorSummaryPanel: React.FC<SensorSummaryPanelProps> = ({ className = '', deviceId }) => {
  const {
    telemetryDisabled,
    actuatorStates,
    latestTelemetry: contextLatestTelemetry,
    lastFetchAt,
    isLoading: contextIsLoading,
    lastFetchError,
    refreshTelemetry,
  } = useData();
  const { latest, status, error, refresh, isPolling, lastUpdated } = useSensorsPolling({
    deviceId,
    intervalMs: 5000,
    maxIntervalMs: 60000,
    cacheTtlMs: 2500,
    disabled: telemetryDisabled,
  });
  const [lastTelemetry, setLastTelemetry] = useState<SensorData | null>(null);
  const [esp32aFloatTelemetry, setEsp32aFloatTelemetry] = useState<Partial<SensorData> | null>(null);

  const effectiveLatest = contextLatestTelemetry ?? latest;

  const effectiveStatus = contextLatestTelemetry
    ? 'success'
    : status;

  const effectiveError = contextLatestTelemetry
    ? null
    : (lastFetchError || error);

  const effectiveIsPolling = contextIsLoading || isPolling;

  const effectiveLastUpdated = useMemo(() => {
    // Show only the timestamp of actual telemetry samples; do not advance on poll cycles.
    const latestTimestamp = effectiveLatest?.timestamp || lastTelemetry?.timestamp;
    if (latestTimestamp) {
      const parsed = Date.parse(latestTimestamp instanceof Date ? latestTimestamp.toISOString() : latestTimestamp);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  }, [effectiveLatest, lastTelemetry]);

  const handleRefresh = async () => {
    await refreshTelemetry();
    await refresh();
    await loadEsp32aFloatTelemetry();
  };

  const loadEsp32aFloatTelemetry = async () => {
    try {
      const snapshot = await sensorService.getLatestData('esp32a');
      if (!snapshot) {
        return;
      }

      const snapshotRecord = snapshot as any;
      const rawFloatStatus = snapshotRecord?.float_status ?? snapshotRecord?.floatStatus ?? null;
      const normalizedFloatStatus = typeof rawFloatStatus === 'string' && rawFloatStatus.trim()
        ? rawFloatStatus.trim().toUpperCase()
        : null;

      const normalizedFloatSensor = typeof snapshot.float_state === 'number'
        ? snapshot.float_state
        : (normalizedFloatStatus === 'LOW'
          ? 0
          : normalizedFloatStatus === 'NORMAL'
            ? 1
            : normalizedFloatStatus === 'FULL' || normalizedFloatStatus === 'HIGH'
              ? 2
              : null);

      setEsp32aFloatTelemetry({
        deviceId: 'esp32a',
        waterLevel: typeof normalizedFloatSensor === 'number' ? normalizedFloatSensor : undefined,
        floatSensor: normalizedFloatSensor,
        floatStatus: normalizedFloatStatus,
        floatSourceDeviceId: 'esp32a',
        floatSensorTimestamp: snapshot.updated_at ?? snapshotRecord?.timestamp ?? null,
      });
    } catch {
      // Best-effort overlay only.
    }
  };

  useEffect(() => {
    if (effectiveLatest) {
      setLastTelemetry((previous) => {
        if (!previous) {
          return effectiveLatest;
        }
        return {
          ...previous,
          ...effectiveLatest,
          waterLevel: effectiveLatest.waterLevel ?? previous.waterLevel,
          floatSensor: effectiveLatest.floatSensor ?? previous.floatSensor,
          floatStatus: effectiveLatest.floatStatus ?? previous.floatStatus,
          floatSourceDeviceId: effectiveLatest.floatSourceDeviceId ?? previous.floatSourceDeviceId,
          floatSensorTimestamp: effectiveLatest.floatSensorTimestamp ?? previous.floatSensorTimestamp,
        };
      });
    }
  }, [effectiveLatest]);

  useEffect(() => {
    loadEsp32aFloatTelemetry().catch(() => null);
    const timerId = window.setInterval(() => {
      loadEsp32aFloatTelemetry().catch(() => null);
    }, 5000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  const telemetryForOverview = useMemo(() => {
    if (!esp32aFloatTelemetry) {
      return effectiveLatest;
    }
    if (!effectiveLatest) {
      return esp32aFloatTelemetry as SensorData;
    }
    return {
      ...effectiveLatest,
      ...esp32aFloatTelemetry,
    } as SensorData;
  }, [effectiveLatest, esp32aFloatTelemetry]);

  const lastTelemetryForOverview = useMemo(() => {
    if (!esp32aFloatTelemetry) {
      return lastTelemetry;
    }
    if (!lastTelemetry) {
      return esp32aFloatTelemetry as SensorData;
    }
    return {
      ...lastTelemetry,
      ...esp32aFloatTelemetry,
    } as SensorData;
  }, [esp32aFloatTelemetry, lastTelemetry]);

  const actuatorItems = useMemo(() => {
    if (!actuatorStates || Object.keys(actuatorStates).length === 0) {
      return [];
    }
    return Object.entries(actuatorStates)
      .map(([key, value]) => ({
        key,
        label: friendlyActuatorLabel(key),
        value,
        priority: actuatorPriorityValue(key),
      }))
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.label.localeCompare(b.label);
      });
  }, [actuatorStates]);

  const lastUpdatedText = effectiveLastUpdated ? new Date(effectiveLastUpdated).toLocaleTimeString() : 'Never';
  const statusNotice = telemetryDisabled
    ? {
        className: 'mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
        text: 'Telemetry feed is temporarily disabled until physical sensors come online.',
      }
    : effectiveStatus === 'error'
      ? {
          className: 'mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200',
          text: effectiveError || 'Telemetry temporarily unavailable.',
        }
      : effectiveStatus === 'loading' && !effectiveLatest && !lastTelemetry
        ? {
            className: 'mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
            text: 'Loading latest telemetry…',
          }
        : null;

  return (
    <section
      className={`rounded-2xl border border-gray-100 bg-white/80 p-6 shadow transition dark:border-gray-800 dark:bg-gray-900/70 ${className}`}
    >
      <header className="flex flex-col gap-3 border-b border-gray-100 pb-4 dark:border-gray-800 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200">
            <Activity className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-50">Sensor Overview</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Latest field telemetry with adaptive polling and automatic backoff when offline.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>Last update: {lastUpdatedText}</span>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            className={`inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 font-medium transition hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 ${
              (effectiveIsPolling || telemetryDisabled) ? 'opacity-60 cursor-not-allowed' : ''
            }`}
            disabled={effectiveIsPolling || telemetryDisabled}
          >
            <RefreshCw className={`h-4 w-4 ${effectiveIsPolling ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {statusNotice && (
        <div className={statusNotice.className}>
          {statusNotice.text}
        </div>
      )}

      <SensorOverview telemetry={telemetryForOverview} lastTelemetry={lastTelemetryForOverview} />

      {actuatorItems.length > 0 && (
        <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-900 shadow-sm dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-200/70 p-2 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-100">
              <ToggleLeft className="h-4 w-4" />
            </span>
            <div>
              <p className="text-base font-semibold">Actuator Status</p>
              <p className="text-xs text-emerald-800/90 dark:text-emerald-200/80">Live hardware acknowledgements from VermiLinks actuators.</p>
            </div>
          </div>
          <ul className="mt-4 divide-y divide-emerald-100 dark:divide-emerald-800">
            {actuatorItems.map((item) => {
              const descriptor = formatActuatorReading(item.value);
              const badgeClass = descriptor.tone === 'on'
                ? 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                : descriptor.tone === 'off'
                  ? 'bg-rose-600/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
                  : 'bg-gray-600/10 text-gray-700 dark:bg-gray-600/30 dark:text-gray-200';
              return (
                <li key={item.key} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">{item.label}</p>
                    <p className="text-xs text-emerald-800/70 dark:text-emerald-200/70">{item.key}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${badgeClass}`}>
                    {descriptor.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

    </section>
  );
};

export default SensorSummaryPanel;
