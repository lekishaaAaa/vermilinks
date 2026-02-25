import React, { useMemo, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SensorData } from '../types';
import { getSocket } from '../socket';

const resolveTargetDeviceId = () => {
  const candidates = [process.env.REACT_APP_DEVICE_ID, process.env.REACT_APP_PRIMARY_DEVICE];
  for (const value of candidates) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return 'esp32b';
};

const TARGET_DEVICE_ID = resolveTargetDeviceId();

interface MetricConfig {
  key: keyof SensorData;
  label: string;
  unit?: string;
  precision?: number;
}

const METRICS: MetricConfig[] = [
  { key: 'temperature', label: 'Temperature', unit: '°C', precision: 1 },
  { key: 'soilTemperature', label: 'Soil Temperature', unit: '°C', precision: 1 },
  { key: 'moisture', label: 'Soil Moisture', unit: '%', precision: 1 },
  { key: 'ph', label: 'pH', precision: 2 },
  { key: 'ec', label: 'EC', unit: 'mS/cm', precision: 2 },
  { key: 'waterLevel', label: 'Water Level', unit: 'cm', precision: 0 },
  { key: 'batteryLevel', label: 'Battery', unit: '%', precision: 0 },
  { key: 'signalStrength', label: 'Signal', unit: 'dBm', precision: 0 },
];

const formatValue = (value: number | null | undefined, precision = 1, unit?: string) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  const formatted = Number(value).toFixed(precision);
  return unit ? `${formatted}${unit}` : formatted;
};

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

const buildSparkline = (values: number[]) => {
  if (!values || values.length === 0) return [] as number[];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value) => {
    const clamped = Math.max(0, Math.min(1, (value - min) / range));
    return Math.round(clamped * 36) + 4; // px height
  });
};

interface RealtimeTelemetryPanelProps {
  latest: SensorData | null;
  history: SensorData[];
  isConnected: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  telemetryDisabled?: boolean;
}

const RealtimeTelemetryPanel: React.FC<RealtimeTelemetryPanelProps> = ({ latest, history, isConnected, onRefresh, refreshing, telemetryDisabled }) => {
  // local live state merged with incoming props
  const [liveLatest, setLiveLatest] = useState<SensorData | null>(null);
  const [liveHistory, setLiveHistory] = useState<SensorData[]>([]);
  const [socketConnected, setSocketConnected] = useState<boolean>(() => {
    try {
      return getSocket().connected;
    } catch (error) {
      return false;
    }
  });
  const [deviceOnline, setDeviceOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (telemetryDisabled) {
      setLiveLatest(null);
      setLiveHistory([]);
      setSocketConnected(false);
      setDeviceOnline(null);
      return undefined;
    }
    const socket = getSocket();
    if (!socket || typeof socket.on !== 'function') {
      // Socket client may be disabled/mocked during tests or in telemetry-off mode
      setSocketConnected(false);
      return undefined;
    }

    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);

    const handleSensorUpdate = (payload: Partial<SensorData> & { deviceId?: string }) => {
      if (!payload) return;
      if (payload.deviceId && payload.deviceId !== TARGET_DEVICE_ID) {
        return;
      }

      const timestamp = payload.timestamp || new Date().toISOString();
      const incoming: SensorData = {
        ...payload,
        deviceId: payload.deviceId || TARGET_DEVICE_ID,
        timestamp,
      } as SensorData;

      setLiveLatest(incoming);
      setLiveHistory((prev) => [...prev, incoming].slice(-336));
    };

    const handleDeviceStatus = (status: { deviceId?: string; online?: boolean; status?: string }) => {
      if (!status) return;
      if (status.deviceId && status.deviceId !== TARGET_DEVICE_ID) {
        return;
      }
      const online = status.online !== false && status.status !== 'offline';
      setDeviceOnline(online);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('sensor:update', handleSensorUpdate);
    socket.on('device:status', handleDeviceStatus);

    return (): void => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('sensor:update', handleSensorUpdate);
      socket.off('device:status', handleDeviceStatus);
    };
  }, [telemetryDisabled]);

  const mergedHistory = useMemo(() => {
    const merged = [...(history || []), ...liveHistory];
    return merged
      .filter(Boolean)
      .sort((a, b) => (new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()))
      .slice(-336);
  }, [history, liveHistory]);

  const effectiveLatest = liveLatest ?? latest;
  const latestTimestamp = effectiveLatest?.timestamp || (mergedHistory.length ? mergedHistory[mergedHistory.length - 1].timestamp : null);

  const metricSummaries = useMemo(() => METRICS.map((metric) => {
    const latestValue = typeof effectiveLatest?.[metric.key] === 'number' ? Number(effectiveLatest?.[metric.key]) : null;
    const series = mergedHistory.map((e) => e[metric.key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const prevValue = series.length >= 2 ? series[series.length - 2] : null;
    const trend = latestValue !== null && prevValue !== null ? latestValue - prevValue : null;
    const range = series.length > 0 ? { min: Math.min(...series), max: Math.max(...series) } : null;
    const sparkline = buildSparkline(series.slice(-24));
    return { config: metric, latestValue, trend, range, sparkline };
  }), [effectiveLatest, mergedHistory]);

  const realtimeHealthy = socketConnected && (deviceOnline !== false);
  const effectiveIsConnected = telemetryDisabled ? false : realtimeHealthy || isConnected;

  return (
    <div className="bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded-xl shadow p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">VermiLinks Sensor Status</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${telemetryDisabled ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200' : effectiveIsConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200'}`}>
            <span className={`h-2 w-2 rounded-full ${telemetryDisabled ? 'bg-amber-500' : effectiveIsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            {telemetryDisabled ? 'Disabled' : (effectiveIsConnected ? 'Live' : 'Disconnected')}
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

      {telemetryDisabled ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
          Telemetry panels are paused until physical sensors report in. You will not see live metrics until hardware is online.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metricSummaries.map(({ config, latestValue, trend, range, sparkline }) => (
            <div key={config.key as string} className="rounded-lg border border-gray-100 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-900/50">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{config.label}</span>
                {range && (
                  <span>
                    {range.min.toFixed(config.precision ?? 1)}–{range.max.toFixed(config.precision ?? 1)}{config.unit ?? ''}
                  </span>
                )}
              </div>
              <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {formatValue(latestValue, config.precision, config.unit)}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {trend !== null && !Number.isNaN(trend) ? `${trend > 0 ? '+' : ''}${trend.toFixed(config.precision ?? 1)}${config.unit ?? ''} vs prev` : 'Awaiting history'}
              </div>
              <div className="mt-3 flex h-12 items-end gap-1">
                {sparkline.length === 0 ? <div className="text-xs text-gray-400">No recent data</div> : sparkline.map((height, i) => (
                  <span key={`${config.key as string}-${i}`} className="w-1 flex-1 rounded-full bg-emerald-400/70 dark:bg-emerald-500/60" style={{ height }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RealtimeTelemetryPanel;
