import React, { useMemo, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SensorData } from '../types';
import { io, Socket } from 'socket.io-client';

interface MetricConfig {
  key: keyof SensorData;
  label: string;
  unit?: string;
  precision?: number;
}

const METRICS: MetricConfig[] = [
  { key: 'temperature', label: 'Temperature', unit: '°C', precision: 1 },
  { key: 'humidity', label: 'Humidity', unit: '%', precision: 1 },
  { key: 'moisture', label: 'Soil Moisture', unit: '%', precision: 1 },
  { key: 'soilTemperature', label: 'Soil Temperature', unit: '°C', precision: 1 },
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

interface Props {
  deviceId?: string; // defaults to vermilinks-esp32-a
  initialLatest?: SensorData | null;
  initialHistory?: SensorData[];
  onRefresh?: () => void;
  refreshing?: boolean;
}

export default function RealtimeTelemetryLivePanel({ deviceId = 'vermilinks-esp32-a', initialLatest = null, initialHistory = [], onRefresh, refreshing }: Props) {
  const [liveLatest, setLiveLatest] = useState<SensorData | null>(initialLatest);
  const [liveHistory, setLiveHistory] = useState<SensorData[]>(initialHistory);
  const [socketConnected, setSocketConnected] = useState(false);

  useEffect(() => {
    const SOCKET_URL = (process.env.REACT_APP_BACKEND_URL && process.env.REACT_APP_BACKEND_URL !== '') ? process.env.REACT_APP_BACKEND_URL : window.location.origin;
    const socket: Socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('room:join', { room: `device:${deviceId}` });
    });
    socket.on('disconnect', () => setSocketConnected(false));

    socket.on('sensor:update', (data: any) => {
      if (!data || data.device !== deviceId) return;
      const incoming: SensorData = {
        timestamp: data.timestamp || new Date().toISOString(),
        temperature: typeof data.sensors?.temperature === 'number' ? data.sensors.temperature : undefined,
        humidity: typeof data.sensors?.humidity === 'number' ? data.sensors.humidity : undefined,
        moisture: typeof data.sensors?.moisture === 'number' ? data.sensors.moisture : undefined,
        soilTemperature: typeof data.sensors?.soilTemperature === 'number'
          ? data.sensors.soilTemperature
          : typeof data.sensors?.waterTempC === 'number'
            ? data.sensors.waterTempC
            : undefined,
        ph: typeof data.sensors?.ph === 'number' ? data.sensors.ph : undefined,
        ec: typeof data.sensors?.ec === 'number' ? data.sensors.ec : undefined,
        waterLevel: typeof data.sensors?.float_distance === 'number' ? data.sensors.float_distance : typeof data.sensors?.waterLevel === 'number' ? data.sensors.waterLevel : undefined,
        batteryLevel: typeof data.sensors?.battery === 'number' ? data.sensors.battery : undefined,
        signalStrength: typeof data.sensors?.rssi === 'number' ? data.sensors.rssi : undefined,
        raw: data.sensors,
      } as unknown as SensorData;

      setLiveLatest(incoming);
      setLiveHistory((prev) => [...prev, incoming].slice(-336));
    });

    return (): void => {
      socket.disconnect();
    };
  }, [deviceId]);

  const orderedHistory = useMemo(() => {
    const merged = [...(initialHistory || []), ...liveHistory];
    return merged
      .filter(Boolean)
      .sort((a, b) => (new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()))
      .slice(-336);
  }, [initialHistory, liveHistory]);

  const effectiveLatest = liveLatest;
  const latestTimestamp = effectiveLatest?.timestamp || (orderedHistory.length ? orderedHistory[orderedHistory.length - 1].timestamp : null);
  const metricSummaries = useMemo(() => METRICS.map((metric) => {
    const latestValue = typeof effectiveLatest?.[metric.key] === 'number' ? Number(effectiveLatest?.[metric.key]) : null;
    const series = orderedHistory
      .map((e) => e[metric.key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const prevValue = series.length >= 2 ? series[series.length - 2] : null;
    const trend = latestValue !== null && prevValue !== null ? latestValue - prevValue : null;
    const range = series.length > 0 ? { min: Math.min(...series), max: Math.max(...series) } : null;
    const sparkline = buildSparkline(series.slice(-24));
    return { config: metric, latestValue, trend, range, sparkline };
  }), [effectiveLatest, orderedHistory]);

  return (
    <div className="bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded-xl shadow p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">VermiLinks — {deviceId}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${socketConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            <span className={`h-2 w-2 rounded-full ${socketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            {socketConnected ? 'Live' : 'Disconnected'}
          </span>
          <div className="text-xs text-gray-500">
            Last update: <span className="font-semibold text-gray-700">{formatTimestamp(latestTimestamp)}</span>
          </div>
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${refreshing ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricSummaries.map(({ config, latestValue, trend, range, sparkline }) => (
          <div key={config.key as string} className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{config.label}</span>
              {range && (
                <span>
                  {range.min.toFixed(config.precision ?? 1)}–{range.max.toFixed(config.precision ?? 1)}{config.unit ?? ''}
                </span>
              )}
            </div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {formatValue(latestValue, config.precision, config.unit)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {trend !== null && !Number.isNaN(trend) ? `${trend > 0 ? '+' : ''}${trend.toFixed(config.precision ?? 1)}${config.unit ?? ''} vs prev` : 'Awaiting history'}
            </div>
            <div className="mt-3 flex h-12 items-end gap-1">
              {sparkline.length === 0 ? <div className="text-xs text-gray-400">No recent data</div> : sparkline.map((height, i) => (
                <span key={`${config.key as string}-${i}`} className="w-1 flex-1 rounded-full bg-emerald-400/70" style={{ height }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
