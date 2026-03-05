import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Activity, ToggleLeft } from 'lucide-react';
import { useSensorsPolling } from '../hooks/useSensorsPolling';
import { SensorData } from '../types';
import { useData } from '../contexts/DataContext';
import SensorOverview from './SensorOverview';

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
  const { telemetryDisabled, actuatorStates } = useData();
  const { latest, status, error, refresh, isPolling, lastUpdated } = useSensorsPolling({
    deviceId,
    intervalMs: 5000,
    maxIntervalMs: 60000,
    cacheTtlMs: 2500,
    disabled: telemetryDisabled,
  });
  const [lastTelemetry, setLastTelemetry] = useState<SensorData | null>(null);

  useEffect(() => {
    if (latest) {
      setLastTelemetry(latest);
    }
  }, [latest]);

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

  const lastUpdatedText = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Never';

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
            onClick={() => refresh()}
            className={`inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 font-medium transition hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 ${
              (isPolling || telemetryDisabled) ? 'opacity-60 cursor-not-allowed' : ''
            }`}
            disabled={isPolling || telemetryDisabled}
          >
            <RefreshCw className={`h-4 w-4 ${isPolling ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {telemetryDisabled ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          Telemetry feed is temporarily disabled until physical sensors come online.
        </div>
      ) : status === 'error' ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      ) : status === 'loading' && !latest && !lastTelemetry ? (
        <div className="mt-6 grid grid-cols-5 gap-5" style={{ gridTemplateColumns: 'repeat(5,1fr)', gap: 20 }}>
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="animate-pulse rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800"
            >
              <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-3 h-6 w-32 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      ) : (
        <SensorOverview telemetry={latest} lastTelemetry={lastTelemetry} />
      )}

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

      <footer className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
        Looking for actuator controls? Use the “View VermiLinks Actuators” button in the dashboard header to launch the control panel.
      </footer>
    </section>
  );
};

export default SensorSummaryPanel;
