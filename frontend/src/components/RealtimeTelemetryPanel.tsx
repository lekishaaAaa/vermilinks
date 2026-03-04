import React, { useMemo, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SensorData } from '../types';
import { getSocket } from '../socket';
import { formatMetric } from '../utils/metricFormatter';
import { sensorService } from '../services/api';

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
  { key: 'temperature', label: 'External Temperature', unit: '°C', precision: 2 },
  { key: 'humidity', label: 'Humidity', unit: '%', precision: 2 },
  { key: 'soilTemperature', label: 'Soil Temperature', unit: '°C', precision: 2 },
  { key: 'moisture', label: 'Soil Moisture', unit: '%', precision: 2 },
  { key: 'waterLevel', label: 'Water Level', precision: 0 },
];

const resolveWaterLevelState = (sample?: SensorData | null): 'LOW' | 'NORMAL' | 'HIGH' | 'UNKNOWN' => {
  if (!sample) return 'UNKNOWN';
  const raw = (sample.floatSensor ?? sample.waterLevel) as unknown;
  if (raw === null || typeof raw === 'undefined') return 'UNKNOWN';
  if (typeof raw === 'string') {
    const normalized = raw.trim().toUpperCase();
    if (['LOW', 'NORMAL', 'HIGH'].includes(normalized)) return normalized as 'LOW' | 'NORMAL' | 'HIGH';
    if (normalized === 'FULL') return 'HIGH';
    return 'UNKNOWN';
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return 'UNKNOWN';
  if (numeric <= 0) return 'LOW';
  if (numeric >= 2) return 'HIGH';
  return 'NORMAL';
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
  const [polledHistory, setPolledHistory] = useState<SensorData[]>([]);

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

  useEffect(() => {
    let mounted = true;
    if (telemetryDisabled) {
      setPolledHistory([]);
      return () => {
        mounted = false;
      };
    }

    const normalize = (entry: any): SensorData => ({
      ...entry,
      deviceId: entry.deviceId || entry.device_id || TARGET_DEVICE_ID,
      moisture: typeof entry.moisture === 'number' ? entry.moisture : entry.soil_moisture,
      soilTemperature: typeof entry.soilTemperature === 'number' ? entry.soilTemperature : entry.soil_temperature,
      waterLevel: typeof entry.waterLevel === 'number' ? entry.waterLevel : entry.water_level,
      batteryLevel: typeof entry.batteryLevel === 'number' ? entry.batteryLevel : entry.battery_level,
      signalStrength: typeof entry.signalStrength === 'number' ? entry.signalStrength : entry.signal_strength,
      timestamp: entry.timestamp || entry.updated_at || new Date().toISOString(),
    });

    const pollHistory = async () => {
      try {
        const response = await sensorService.getHistory({ deviceId: TARGET_DEVICE_ID, limit: 50 });
        const readings = response?.data?.data?.readings;
        if (!mounted || !Array.isArray(readings)) {
          return;
        }
        setPolledHistory(readings.map(normalize));
      } catch (error) {
        // Keep existing socket/prop data if history endpoint is unavailable for this session
      }
    };

    pollHistory();
    const timer = window.setInterval(pollHistory, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [telemetryDisabled]);

  const mergedHistory = useMemo(() => {
    const merged = [...(history || []), ...polledHistory, ...liveHistory];
    return merged
      .filter(Boolean)
      .sort((a, b) => (new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()))
      .slice(-336);
  }, [history, liveHistory, polledHistory]);

  const effectiveLatest = liveLatest ?? latest;
  const hasTelemetryData = Boolean(effectiveLatest) || mergedHistory.length > 0;
  const showPausedNotice = Boolean(telemetryDisabled) && !hasTelemetryData;
  const latestTimestamp = effectiveLatest?.timestamp || (mergedHistory.length ? mergedHistory[mergedHistory.length - 1].timestamp : null);

  const metricSummaries = useMemo(() => METRICS.map((metric) => {
    const isWaterLevel = metric.key === 'waterLevel';
    const waterLevelState = isWaterLevel ? resolveWaterLevelState(effectiveLatest) : null;
    const latestValue = typeof effectiveLatest?.[metric.key] === 'number' ? Number(effectiveLatest?.[metric.key]) : null;
    const series = mergedHistory.map((e) => e[metric.key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const prevValue = series.length >= 2 ? series[series.length - 2] : null;
    const trend = latestValue !== null && prevValue !== null ? latestValue - prevValue : null;
    const range = series.length > 0 ? { min: Math.min(...series), max: Math.max(...series) } : null;
    const sparkline = buildSparkline(series.slice(-24));
    return { config: metric, latestValue, trend, range, sparkline, isWaterLevel, waterLevelState };
  }), [effectiveLatest, mergedHistory]);

  const realtimeHealthy = socketConnected && (deviceOnline !== false);
  const effectiveIsConnected = showPausedNotice ? false : realtimeHealthy || isConnected;
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
          Telemetry panels are paused until physical sensors report in. You will not see live metrics until hardware is online.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metricSummaries.map(({ config, latestValue, trend, range, sparkline, isWaterLevel, waterLevelState }) => (
            <div key={config.key as string} className="rounded-lg border border-gray-100 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-900/50">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{config.label}</span>
                {range && !isWaterLevel && (
                  <span>
                    {range.min.toFixed(config.precision ?? 1)}–{range.max.toFixed(config.precision ?? 1)}{config.unit ?? ''}
                  </span>
                )}
              </div>
              <div className={`mt-2 text-2xl font-semibold ${isWaterLevel
                ? waterLevelState === 'LOW'
                  ? 'text-rose-600 dark:text-rose-300'
                  : waterLevelState === 'HIGH'
                    ? 'text-blue-600 dark:text-blue-300'
                    : waterLevelState === 'NORMAL'
                      ? 'text-emerald-600 dark:text-emerald-300'
                      : 'text-gray-900 dark:text-gray-100'
                : 'text-gray-900 dark:text-gray-100'}`}>
                {isWaterLevel ? (waterLevelState || 'UNKNOWN') : formatMetric(latestValue, config.unit)}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {isWaterLevel
                  ? 'LOW=red · NORMAL=green · HIGH=blue'
                  : (trend !== null && !Number.isNaN(trend) ? `${trend > 0 ? '+' : ''}${trend.toFixed(config.precision ?? 1)}${config.unit ?? ''} vs prev` : 'Awaiting history')}
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

      {!showPausedNotice && (
        <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/40">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Realtime Telemetry Graphs</h4>
          {chartData.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">Awaiting history data from /api/sensors/history?limit=50</div>
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
