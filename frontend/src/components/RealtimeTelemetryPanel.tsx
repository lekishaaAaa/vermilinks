import React, { useMemo, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SensorData } from '../types';
import SensorOverview from './SensorOverview';
import { sensorService } from '../services/api';

const LIVE_TELEMETRY_MAX_AGE_MS = 60_000;

const formatTimestamp = (value?: string | Date | null) => {
  if (!value) return '—';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  } catch (e) {
    return '—';
  }
};

const SENSOR_VALID_RANGES: Array<{ key: keyof SensorData; label: string; min: number; max: number }> = [
  { key: 'temperature', label: 'External Temperature', min: 15, max: 35 },
  { key: 'humidity', label: 'Humidity', min: 50, max: 90 },
  { key: 'moisture', label: 'Soil Moisture', min: 300, max: 800 },
  { key: 'soilTemperature', label: 'Soil Temperature', min: 18, max: 32 },
];

interface RealtimeTelemetryPanelProps {
  latest: SensorData | null;
  history: SensorData[];
  isConnected: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  telemetryDisabled?: boolean;
}

const RealtimeTelemetryPanel: React.FC<RealtimeTelemetryPanelProps> = ({ latest, history, isConnected, onRefresh, refreshing, telemetryDisabled }) => {
  const [cachedLatest, setCachedLatest] = useState<SensorData | null>(null);
  const [lastTelemetry, setLastTelemetry] = useState<SensorData | null>(null);
  const [esp32aFloatTelemetry, setEsp32aFloatTelemetry] = useState<Partial<SensorData> | null>(null);

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
    if (telemetryDisabled) {
      return;
    }
    const source = latest ?? (Array.isArray(history) && history.length > 0 ? history[history.length - 1] : null);
    if (!source) {
      return;
    }

    // Keep previous values for missing fields so cards stay rendered under partial payloads.
    setCachedLatest((prev) => {
      if (!prev) {
        return source;
      }
      const merged: SensorData = {
        ...prev,
        ...source,
        temperature: source.temperature ?? prev.temperature,
        humidity: source.humidity ?? prev.humidity,
        ambientTemperature: source.ambientTemperature ?? prev.ambientTemperature,
        ambientHumidity: source.ambientHumidity ?? prev.ambientHumidity,
        binTemperature: source.binTemperature ?? prev.binTemperature,
        binHumidity: source.binHumidity ?? prev.binHumidity,
        soilTemperature: source.soilTemperature ?? prev.soilTemperature,
        soilTemperatureLayer1: source.soilTemperatureLayer1 ?? prev.soilTemperatureLayer1,
        soilTemperatureLayer2: source.soilTemperatureLayer2 ?? prev.soilTemperatureLayer2,
        soilTemperatureLayer3: source.soilTemperatureLayer3 ?? prev.soilTemperatureLayer3,
        moisture: source.moisture ?? prev.moisture,
        soilMoistureLayer1: source.soilMoistureLayer1 ?? prev.soilMoistureLayer1,
        soilMoistureLayer2: source.soilMoistureLayer2 ?? prev.soilMoistureLayer2,
        soilMoistureLayer3: source.soilMoistureLayer3 ?? prev.soilMoistureLayer3,
        waterLevel: source.waterLevel ?? prev.waterLevel,
        floatStatus: source.floatStatus ?? prev.floatStatus,
      };
      return merged;
    });
    setLastTelemetry(source);
  }, [history, latest, telemetryDisabled]);

  useEffect(() => {
    loadEsp32aFloatTelemetry().catch(() => null);

    const intervalId = window.setInterval(() => {
      loadEsp32aFloatTelemetry().catch(() => null);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const mergedHistory = useMemo(() => {
    return [...(history || [])]
      .filter(Boolean)
      .sort((a, b) => (new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()))
      .slice(-336);
  }, [history]);

  const effectiveLatest = cachedLatest ?? latest ?? lastTelemetry ?? (mergedHistory.length ? mergedHistory[mergedHistory.length - 1] : null);
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
  const hasTelemetryData = Boolean(effectiveLatest) || mergedHistory.length > 0;
  const showPausedNotice = Boolean(telemetryDisabled) && !hasTelemetryData;
  const latestTimestamp = effectiveLatest?.timestamp || (mergedHistory.length ? mergedHistory[mergedHistory.length - 1].timestamp : null);
  const latestTimestampMs = useMemo(() => {
    if (!latestTimestamp) {
      return NaN;
    }
    const date = latestTimestamp instanceof Date ? latestTimestamp : new Date(latestTimestamp);
    return date.getTime();
  }, [latestTimestamp]);
  const telemetryFresh = Number.isFinite(latestTimestampMs) && (Date.now() - latestTimestampMs) <= LIVE_TELEMETRY_MAX_AGE_MS;

  const effectiveIsConnected = showPausedNotice ? false : Boolean(isConnected && telemetryFresh);
  const outOfRangeWarnings = useMemo(() => {
    if (!effectiveLatest) return [] as string[];
    return SENSOR_VALID_RANGES
      .filter((range) => {
        const value = effectiveLatest[range.key];
        return typeof value === 'number' && (value < range.min || value > range.max);
      })
      .map((range) => range.label);
  }, [effectiveLatest]);

  const chartData = useMemo(() => {
    return mergedHistory.slice(-50).map((entry) => ({
      timestamp: entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '--',
      temperature: typeof entry.temperature === 'number' ? entry.temperature : null,
      humidity: typeof entry.humidity === 'number' ? entry.humidity : null,
      moisture: typeof entry.moisture === 'number' ? entry.moisture : null,
      soilTemperature: typeof entry.soilTemperature === 'number' ? entry.soilTemperature : null,
    }));
  }, [mergedHistory]);

  return (
    <div className="bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded-xl shadow p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">VermiLinks Sensor Status</h3>
          {outOfRangeWarnings.length > 0 && (
            <div className="mt-1 inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              Sensor warning: {outOfRangeWarnings.join(', ')} out of range
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${showPausedNotice ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200' : effectiveIsConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200'}`}>
            <span className={`h-2 w-2 rounded-full ${showPausedNotice ? 'bg-amber-500' : effectiveIsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            {showPausedNotice ? 'Paused' : (effectiveIsConnected ? 'Live' : 'Disconnected')}
          </span>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Last update: <span className="font-semibold text-gray-700 dark:text-gray-200">{formatTimestamp(latestTimestamp)}</span>
          </div>
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing || telemetryDisabled} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${(refreshing || telemetryDisabled) ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {showPausedNotice ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
          No telemetry received
        </div>
      ) : hasTelemetryData ? (
        <SensorOverview telemetry={telemetryForOverview} lastTelemetry={lastTelemetryForOverview} />
      ) : (
        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
          No telemetry received
        </div>
      )}

      {!showPausedNotice && (
        <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/40">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Realtime Telemetry Graphs</h4>
          {chartData.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">No telemetry received</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="h-44 rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis width={40} />
                    <Tooltip />
                    <Line type="monotone" dataKey="temperature" stroke="#ef4444" dot={false} name="External Temperature (°C)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="h-44 rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis width={40} />
                    <Tooltip />
                    <Line type="monotone" dataKey="humidity" stroke="#3b82f6" dot={false} name="Humidity (%)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="h-44 rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis width={40} />
                    <Tooltip />
                    <Line type="monotone" dataKey="moisture" stroke="#22c55e" dot={false} name="Soil Moisture (%)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="h-44 rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis width={40} />
                    <Tooltip />
                    <Line type="monotone" dataKey="soilTemperature" stroke="#f97316" dot={false} name="Soil Temperature (°C)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RealtimeTelemetryPanel;
