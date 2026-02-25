import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Database, Radio, RefreshCw, Server, Wifi } from 'lucide-react';
import api, { alertService, deviceService, sensorService } from '../services/api';
import { getSocket } from '../socket';
import { useData } from '../contexts/DataContext';

type ServiceStatus = 'online' | 'offline' | 'degraded' | 'unknown' | 'connected' | 'ok' | 'warning' | 'pending' | 'initializing' | 'starting' | 'stale' | 'success' | string;

type DiagnosticsState = {
  collectedAt: string | null;
  health: {
    apiStatus: ServiceStatus;
    databaseStatus: ServiceStatus;
    version: string | null;
    environment: string | null;
    latencyMs: number | null;
  };
  devices: {
    total: number;
    online: number;
    offline: number;
    lastHeartbeat: string | null;
    lastEvent: {
      deviceId: string;
      status: ServiceStatus;
      receivedAt: string;
      heartbeat?: string | null;
    } | null;
  };
  alerts: {
    active: number;
    acknowledged: number;
    critical: number;
    lastAlertAt: string | null;
  };
  telemetry: {
    deviceId: string | null;
    timestamp: string | null;
    ageSeconds: number | null;
  };
};

const HEALTHY_STATUSES = new Set<string>(['online', 'connected', 'ready', 'healthy', 'up', 'ok', 'success']);
const WARNING_STATUSES = new Set<string>(['degraded', 'warning', 'pending', 'initializing', 'starting', 'stale', 'syncing']);

const DEFAULT_STATE: DiagnosticsState = {
  collectedAt: null,
  health: {
    apiStatus: 'unknown',
    databaseStatus: 'unknown',
    version: null,
    environment: null,
    latencyMs: null,
  },
  devices: {
    total: 0,
    online: 0,
    offline: 0,
    lastHeartbeat: null,
    lastEvent: null,
  },
  alerts: {
    active: 0,
    acknowledged: 0,
    critical: 0,
    lastAlertAt: null,
  },
  telemetry: {
    deviceId: null,
    timestamp: null,
    ageSeconds: null,
  },
};

const normalizeStatus = (value: unknown, fallback: ServiceStatus = 'unknown'): ServiceStatus => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') {
    return value ? 'online' : 'offline';
  }
  if (typeof value === 'number') {
    return value > 0 ? 'online' : 'offline';
  }
  const str = value.toString().trim();
  if (!str) return fallback;
  return str.toLowerCase();
};

const isHealthyStatus = (status: string): boolean => HEALTHY_STATUSES.has(status);

const ensureIsoString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
  }
  const parsed = new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const formatRelativeTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
};

const formatTimestampDetail = (iso?: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${formatRelativeTime(iso)} · ${date.toLocaleString()}`;
};

const formatAge = (seconds: number | null): string => {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const toBadgeTone = (status: string) => {
  if (!status || status === 'unknown') {
    return {
      wrapper: 'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300',
      dot: 'bg-gray-400',
    };
  }
  if (isHealthyStatus(status)) {
    return {
      wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200',
      dot: 'bg-emerald-500',
    };
  }
  if (WARNING_STATUSES.has(status)) {
    return {
      wrapper: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200',
      dot: 'bg-amber-500',
    };
  }
  return {
    wrapper: 'border-red-200 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200',
    dot: 'bg-red-500',
  };
};

const StatusBadge: React.FC<{ label: string; status: ServiceStatus }> = ({ label, status }) => {
  const normalized = normalizeStatus(status);
  const tone = toBadgeTone(normalized);
  const display = normalized === 'ok'
    ? 'OK'
    : normalized.charAt(0).toUpperCase() + normalized.slice(1);

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone.wrapper}`}>
      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
      {label}: {display}
    </span>
  );
};

export const SystemDiagnostics: React.FC = () => {
  const { telemetryDisabled } = useData();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [socketMeta, setSocketMeta] = useState<{ lastEvent: string | null; lastError: string | null; attempts: number }>({
    lastEvent: null,
    lastError: null,
    attempts: 0,
  });

  const mountedRef = useRef(true);
  const pollRef = useRef<number | undefined>(undefined);
  const isInitialRef = useRef(true);
  const stateRef = useRef<DiagnosticsState>(DEFAULT_STATE);

  useEffect(() => {
    stateRef.current = diagnostics;
  }, [diagnostics]);

  const fetchDiagnostics = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    if (isInitialRef.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    const previous = stateRef.current;
    const nextState: DiagnosticsState = {
      collectedAt: previous.collectedAt,
      health: { ...previous.health },
      devices: { ...previous.devices },
      alerts: { ...previous.alerts },
      telemetry: { ...previous.telemetry },
    };

    const missing: string[] = [];

    try {
      const started = Date.now();
      const resp = await api.get('/health');
      const payload = resp?.data || {};
      const latency = Date.now() - started;

      const apiStatus = normalizeStatus(
        payload?.ok === true ? 'online' :
        payload?.ok === false ? 'offline' :
        payload?.status ?? payload?.state ?? payload?.health,
        'unknown'
      );
      const databaseStatus = normalizeStatus(
        payload?.db ?? payload?.database?.status ?? payload?.databaseStatus,
        'unknown'
      );

      nextState.health = {
        apiStatus,
        databaseStatus,
        version: payload?.version ? String(payload.version) : null,
        environment: payload?.env ? String(payload.env) : null,
        latencyMs: Number.isFinite(latency) ? latency : null,
      };
    } catch (err) {
      missing.push('API health');
      nextState.health = {
        apiStatus: 'offline',
        databaseStatus: 'unknown',
        version: null,
        environment: null,
        latencyMs: null,
      };
    }

    try {
      const resp = await deviceService.list();
      const devices = Array.isArray(resp?.data?.data)
        ? resp.data.data
        : Array.isArray(resp?.data)
          ? resp.data
          : [];

      let online = 0;
      let latestHeartbeat = 0;

      devices.forEach((device: any) => {
        const status = normalizeStatus(device?.status ?? device?.deviceStatus ?? device?.online);
        if (isHealthyStatus(status)) {
          online += 1;
        }
        const heartbeatIso = ensureIsoString(device?.lastHeartbeat ?? device?.last_heartbeat ?? device?.timestamp ?? device?.updatedAt);
        if (heartbeatIso) {
          const ms = new Date(heartbeatIso).getTime();
          if (Number.isFinite(ms) && ms > latestHeartbeat) {
            latestHeartbeat = ms;
          }
        }
      });

      nextState.devices = {
        total: devices.length,
        online,
        offline: Math.max(devices.length - online, 0),
        lastHeartbeat: latestHeartbeat ? new Date(latestHeartbeat).toISOString() : null,
        lastEvent: previous.devices.lastEvent,
      };
    } catch (err) {
      missing.push('devices');
    }

    try {
      // Use new summary endpoint for counts
      const [summaryResp, recentResp] = await Promise.all([
        alertService.getSummary().catch(() => null),
        alertService.getRecentAlerts(1).catch(() => null),
      ]);

      const summary = (summaryResp || {}) as { critical?: number; warning?: number; info?: number };
      const critical = Number(summary?.critical ?? 0);
      const warning = Number(summary?.warning ?? 0);
      const info = Number(summary?.info ?? 0);
      const activeTotal = critical + warning + info;

      let lastAlertAt: string | null = null;
      const recent = Array.isArray(recentResp?.data?.data) ? recentResp!.data!.data![0] as any : null;
      if (recent) {
        lastAlertAt = ensureIsoString(recent.createdAt || (recent as any).timestamp || recent.updatedAt) || null;
      }

      nextState.alerts = {
        active: activeTotal,
        acknowledged: 0, // Summary does not include acknowledged count
        critical,
        lastAlertAt,
      };
    } catch (err) {
      missing.push('alerts');
    }

    if (telemetryDisabled) {
      nextState.telemetry = {
        deviceId: null,
        timestamp: null,
        ageSeconds: null,
      };
    } else {
      try {
        const snapshot = await sensorService.getLatestData();
        const timestampIso = ensureIsoString(snapshot?.updated_at ?? null);
        const deviceId = snapshot ? 'vermilinks-esp32' : null;

        let ageSeconds: number | null = null;
        if (timestampIso) {
          const ms = Date.now() - new Date(timestampIso).getTime();
          if (Number.isFinite(ms) && ms >= 0) {
            ageSeconds = Math.round(ms / 1000);
          }
        }

        nextState.telemetry = {
          deviceId: deviceId ? String(deviceId) : null,
          timestamp: timestampIso,
          ageSeconds,
        };
      } catch (err) {
        missing.push('telemetry');
      }
    }

    nextState.collectedAt = new Date().toISOString();

    if (!mountedRef.current) {
      return;
    }

    setDiagnostics(prev => ({
      collectedAt: nextState.collectedAt,
      health: { ...nextState.health },
      devices: { ...nextState.devices },
      alerts: { ...nextState.alerts },
      telemetry: { ...nextState.telemetry },
    }));

    setError(missing.length ? `Partial update missing: ${missing.join(', ')}` : null);

    if (isInitialRef.current) {
      isInitialRef.current = false;
    }
    setLoading(false);
    setRefreshing(false);
  }, [telemetryDisabled]);

  useEffect(() => {
    mountedRef.current = true;
    fetchDiagnostics();
    pollRef.current = window.setInterval(fetchDiagnostics, 10000);

    return () => {
      mountedRef.current = false;
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
  }, [fetchDiagnostics]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      return;
    }

    const updateSocketState = () => {
      setSocketState(socket.connected ? 'connected' : 'disconnected');
    };

    const handleConnect = () => {
      setSocketState('connected');
      const now = new Date().toISOString();
      setSocketMeta(prev => ({ ...prev, lastEvent: now, lastError: null, attempts: 0 }));
    };

    const handleDisconnect = (reason?: string) => {
      setSocketState('disconnected');
      const now = new Date().toISOString();
      setSocketMeta(prev => ({ ...prev, lastEvent: now, lastError: reason || prev.lastError }));
    };

    const handleConnectError = (error: Error) => {
      setSocketMeta(prev => ({ ...prev, lastError: error?.message || 'Socket error' }));
    };

    const handleReconnectAttempt = (attempt: number) => {
      setSocketMeta(prev => ({ ...prev, attempts: attempt }));
    };

    const handleDeviceStatus = (payload: any) => {
      const deviceId = payload?.deviceId ?? payload?.device_id ?? payload?.id ?? payload?.name ?? 'unknown-device';
      const status = normalizeStatus(payload?.status ?? payload?.deviceStatus ?? payload?.online ?? 'unknown');
      const heartbeat = ensureIsoString(
        payload?.lastHeartbeat ??
        payload?.last_heartbeat ??
        payload?.heartbeat ??
        payload?.timestamp ??
        payload?.updatedAt ??
        payload?.createdAt
      );
      const receivedAt = new Date().toISOString();

      setDiagnostics(prev => ({
        ...prev,
        devices: {
          ...prev.devices,
          lastHeartbeat: heartbeat || prev.devices.lastHeartbeat,
          lastEvent: {
            deviceId: String(deviceId),
            status,
            receivedAt,
            heartbeat: heartbeat || prev.devices.lastHeartbeat,
          },
        },
      }));
      setSocketMeta(prev => ({ ...prev, lastEvent: receivedAt }));
    };

    const handleAlertTrigger = async () => {
      // Refresh alert summary quickly when an alert fires or clears
      try {
        const summary = await alertService.getSummary();
        const critical = Number(summary?.critical ?? 0);
        const warning = Number(summary?.warning ?? 0);
        const info = Number(summary?.info ?? 0);
        const activeTotal = critical + warning + info;
        setDiagnostics(prev => ({
          ...prev,
          alerts: {
            active: activeTotal,
            acknowledged: 0,
            critical,
            lastAlertAt: new Date().toISOString(),
          },
        }));
      } catch (e) {
        // ignore transient errors
      }
    };

    const handleTelemetryUpdate = (payload: any) => {
      const deviceId = payload?.deviceId ?? payload?.device_id ?? payload?.id ?? null;
      const ts = ensureIsoString(payload?.timestamp || payload?.receivedAt || payload?.createdAt || payload?.updatedAt);
      let ageSeconds: number | null = null;
      if (ts) {
        const ms = Date.now() - new Date(ts).getTime();
        if (Number.isFinite(ms) && ms >= 0) ageSeconds = Math.round(ms / 1000);
      }
      setDiagnostics(prev => ({
        ...prev,
        telemetry: {
          deviceId: deviceId ? String(deviceId) : prev.telemetry.deviceId,
          timestamp: ts || prev.telemetry.timestamp,
          ageSeconds: ageSeconds !== null ? ageSeconds : prev.telemetry.ageSeconds,
        },
      }));
    };

    updateSocketState();
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.io?.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('device:status', handleDeviceStatus);
    socket.on('device_status', handleDeviceStatus);
    socket.on('deviceHeartbeat', handleDeviceStatus);
    socket.on('device_heartbeat', handleDeviceStatus);
  socket.on('alert:trigger', handleAlertTrigger);
  socket.on('telemetry:update', handleTelemetryUpdate);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.io?.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('device:status', handleDeviceStatus);
      socket.off('device_status', handleDeviceStatus);
      socket.off('deviceHeartbeat', handleDeviceStatus);
      socket.off('device_heartbeat', handleDeviceStatus);
      socket.off('alert:trigger', handleAlertTrigger);
      socket.off('telemetry:update', handleTelemetryUpdate);
    };
  }, []);

  const { health, devices, alerts, telemetry, collectedAt } = diagnostics;

  const headerSubtext = useMemo(() => {
    if (!collectedAt) {
      return 'Awaiting first heartbeat…';
    }
    return `Updated ${formatRelativeTime(collectedAt)}`;
  }, [collectedAt]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Live System Diagnostics</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Backend health, ESP32 heartbeats, and alert status at a glance.</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{headerSubtext}</p>
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs text-amber-600 dark:text-amber-400">{error}</span>
          )}
          <button
            type="button"
            onClick={fetchDiagnostics}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${loading ? 'opacity-95 saturate-75' : ''}`}>
        <section className="rounded-xl border border-gray-100 bg-white/80 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
              <Server className="h-5 w-5" />
              <span className="text-sm font-semibold">Infrastructure Health</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge label="API" status={health.apiStatus} />
              <StatusBadge label="Database" status={health.databaseStatus} />
              <StatusBadge label="Socket" status={socketState} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <span className="flex items-center gap-2"><Activity className="h-4 w-4" />API latency</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{health.latencyMs != null ? `${health.latencyMs}ms` : '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <span className="flex items-center gap-2"><Database className="h-4 w-4" />Environment</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{health.environment ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <span className="flex items-center gap-2"><Wifi className="h-4 w-4" />Socket last event</span>
              <span className="text-right text-xs text-gray-500 dark:text-gray-400">{socketMeta.lastEvent ? formatTimestampDetail(socketMeta.lastEvent) : '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Last error</span>
              <span className="text-right text-xs text-gray-500 dark:text-gray-400">{socketMeta.lastError ?? '—'}</span>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white/80 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
              <Radio className="h-5 w-5" />
              <span className="text-sm font-semibold">Device Fleet</span>
            </div>
            <StatusBadge label="Online" status={devices.online > 0 ? 'online' : 'offline'} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Online</div>
              <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-300">{devices.online}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">of {devices.total} registered nodes</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Offline</div>
              <div className="text-2xl font-semibold text-rose-600 dark:text-rose-300">{devices.offline}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">requires follow-up</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Last heartbeat</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">{devices.lastHeartbeat ? formatTimestampDetail(devices.lastHeartbeat) : '—'}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Recent event</div>
              {devices.lastEvent ? (
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  <span className="font-semibold text-gray-800 dark:text-gray-100">{devices.lastEvent.deviceId}</span> → {devices.lastEvent.status}
                  <br />
                  {formatTimestampDetail(devices.lastEvent.receivedAt)}
                </div>
              ) : (
                <div className="text-xs text-gray-600 dark:text-gray-400">No live updates yet</div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white/80 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm font-semibold">Alert Load</span>
            </div>
            <StatusBadge label="Active" status={alerts.active > 0 ? 'warning' : 'online'} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Active alerts</div>
              <div className="text-2xl font-semibold text-amber-600 dark:text-amber-300">{alerts.active}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Critical</div>
              <div className="text-2xl font-semibold text-red-600 dark:text-red-300">{alerts.critical}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Acknowledged</div>
              <div className="text-xl font-semibold text-emerald-600 dark:text-emerald-300">{alerts.acknowledged}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Last alert</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">{alerts.lastAlertAt ? formatTimestampDetail(alerts.lastAlertAt) : '—'}</div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white/80 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
              <Activity className="h-5 w-5" />
              <span className="text-sm font-semibold">Telemetry Stream</span>
            </div>
            <StatusBadge label="Freshness" status={telemetry.ageSeconds !== null && telemetry.ageSeconds <= 60 ? 'online' : telemetry.ageSeconds !== null && telemetry.ageSeconds <= 300 ? 'warning' : telemetry.ageSeconds !== null ? 'offline' : 'unknown'} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Last device</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{telemetry.deviceId ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Sample age</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{formatAge(telemetry.ageSeconds)}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Timestamp</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">{telemetry.timestamp ? formatTimestampDetail(telemetry.timestamp) : '—'}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Reconnect attempts</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{socketMeta.attempts}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SystemDiagnostics;
