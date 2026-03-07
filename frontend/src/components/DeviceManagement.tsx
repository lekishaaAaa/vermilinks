import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { deviceService } from '../services/api';
import { DeviceSensorSummary, SensorSummaryItem } from '../types';

type DeviceStatus = 'online' | 'offline';

interface ManagedDevice {
  id: string;
  deviceId: string;
  name?: string;
  status: DeviceStatus;
  lastSeen: string | null;
  metadata?: Record<string, any> | null;
}

interface DeviceManagementProps {
  onDeviceSelect?: (device: ManagedDevice) => void;
  onDevicesSnapshot?: (devices: ManagedDevice[]) => void;
}

type BackendDevice = {
  id?: number | string;
  deviceId?: string;
  status?: DeviceStatus | string;
  lastHeartbeat?: string | number | Date | null;
  metadata?: Record<string, any> | null;
  name?: string;
};

const generateFallbackId = () => {
  const globalCrypto = typeof globalThis !== 'undefined'
    ? (globalThis.crypto as { randomUUID?: () => string } | undefined)
    : undefined;
  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID();
  }
  return `device-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeDevice = (device: BackendDevice): ManagedDevice => {
  const rawMetadata = (device.metadata && typeof device.metadata === 'object') ? device.metadata : {};
  const metadata = rawMetadata as Record<string, any>;
  const rawLastSeen = device.lastHeartbeat || metadata?.lastHeartbeat || metadata?.lastSeen || null;
  const statusValue = (device.status ?? metadata?.status ?? 'offline');
  const status = String(statusValue).toLowerCase() === 'online' ? 'online' : 'offline';

  let lastSeen: string | null = null;
  if (rawLastSeen instanceof Date) {
    lastSeen = rawLastSeen.toISOString();
  } else if (typeof rawLastSeen === 'number') {
    lastSeen = new Date(rawLastSeen).toISOString();
  } else if (rawLastSeen) {
    lastSeen = String(rawLastSeen);
  }

  return {
    id: String(device.id ?? device.deviceId ?? generateFallbackId()),
    deviceId: String(device.deviceId ?? device.id ?? generateFallbackId()),
    name: metadata?.name || metadata?.label || device.name,
    status,
    lastSeen,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
};

const formatLastSeen = (iso?: string | null): string => {
  if (!iso) return 'No recent heartbeat';
  try {
    return new Date(iso).toLocaleString();
  } catch (error) {
    return String(iso);
  }
};

const formatSensorValue = (item: SensorSummaryItem) => {
  if (typeof item.value === 'number') {
    return `${item.value}${item.unit ? ` ${item.unit}` : ''}`.trim();
  }
  if (item.value && typeof item.value === 'object') {
    const entries = Object.entries(item.value)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key.toUpperCase()}: ${value}`);
    return entries.join(', ') || '—';
  }
  return '—';
};

export const DeviceManagement: React.FC<DeviceManagementProps> = ({ onDeviceSelect, onDevicesSnapshot }) => {
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [sensorSnapshots, setSensorSnapshots] = useState<Record<string, DeviceSensorSummary | undefined>>({});
  const [sensorFetching, setSensorFetching] = useState<Record<string, boolean>>({});
  const selectedDeviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  const loadDevices = useCallback(async (options?: { initial?: boolean }) => {
    const useSpinner = options?.initial ?? false;
    if (useSpinner) setLoading(true); else setRefreshing(true);
    try {
      setError(null);
      const response = await deviceService.list();
      const body = response?.data ?? {};
      const rawList: BackendDevice[] = Array.isArray(body?.data)
        ? (body.data as BackendDevice[])
        : Array.isArray(body)
        ? (body as BackendDevice[])
        : [];
      const normalized = rawList.map((item) => normalizeDevice(item));
      normalized.sort((a, b) => {
        const aTime = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
        const bTime = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        return bTime - aTime;
      });
      setDevices(normalized);
      onDevicesSnapshot?.(normalized);

      const currentSelected = selectedDeviceIdRef.current;
      if (normalized.length === 0) {
        setSelectedDeviceId(null);
      } else if (currentSelected && normalized.some((device) => device.id === currentSelected)) {
        setSelectedDeviceId(currentSelected);
      } else {
        setSelectedDeviceId(normalized[0].id);
      }
    } catch (err) {
      console.error('Failed to load devices:', err);
      setDevices([]);
      setSelectedDeviceId(null);
      setError('Unable to load devices. Please verify the backend connection.');
    } finally {
      if (useSpinner) setLoading(false); else setRefreshing(false);
    }
  }, [onDevicesSnapshot]);

  const updateSensorSnapshot = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    setSensorFetching((prev) => ({ ...prev, [deviceId]: true }));
    try {
      const response = await deviceService.getSensors(deviceId, { limit: 25 });
      const payload = response?.data?.data;
      setSensorSnapshots((prev) => ({ ...prev, [deviceId]: payload }));
    } catch (error) {
      console.warn('Failed to load sensors for device', deviceId, error);
      setSensorSnapshots((prev) => ({ ...prev, [deviceId]: undefined }));
    } finally {
      setSensorFetching((prev) => ({ ...prev, [deviceId]: false }));
    }
  }, []);

  useEffect(() => {
    loadDevices({ initial: true });
    const interval = setInterval(() => loadDevices(), 20000);
    return () => clearInterval(interval);
  }, [loadDevices]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    const target = devices.find((device) => device.id === selectedDeviceId);
    if (!target) return;

    const fetchSnapshot = () => updateSensorSnapshot(target.deviceId);
    fetchSnapshot();
    const interval = setInterval(fetchSnapshot, 15000);
    return () => clearInterval(interval);
  }, [devices, selectedDeviceId, updateSensorSnapshot]);

  const handleDeviceSelect = useCallback((device: ManagedDevice) => {
    setSelectedDeviceId(device.id);
    onDeviceSelect?.(device);
    updateSensorSnapshot(device.deviceId);
  }, [onDeviceSelect, updateSensorSnapshot]);

  const handleDeleteDevice = useCallback(async (device: ManagedDevice) => {
    const confirmed = window.confirm(`Remove device ${device.deviceId} from the system? This also removes stored telemetry snapshots for this device.`);
    if (!confirmed) {
      return;
    }

    setDeletingDeviceId(device.id);
    try {
      await deviceService.remove(device.deviceId);
      setSensorSnapshots((prev) => {
        const next = { ...prev };
        delete next[device.deviceId];
        return next;
      });
      await loadDevices();
    } catch (err) {
      console.error('Failed to delete device:', err);
      setError(`Unable to delete device ${device.deviceId}.`);
    } finally {
      setDeletingDeviceId(null);
    }
  }, [loadDevices]);

  const selectedDevice = useMemo(() => devices.find((device) => device.id === selectedDeviceId) || null, [devices, selectedDeviceId]);
  const selectedSensorLoading = selectedDevice ? sensorFetching[selectedDevice.deviceId] : false;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-600">Loading devices...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Device Management</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Live view of registered sensor hubs</p>
        </div>
        <button
          onClick={() => loadDevices()}
          className="px-3 py-2 text-sm rounded-md border bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          title="Refresh devices"
          disabled={refreshing}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4">
        {devices.map((device) => {
          const isSelected = selectedDeviceId === device.id;
          const snapshot = sensorSnapshots[device.deviceId];
          const sensorCount = snapshot?.sensors?.length ?? 0;

          return (
            <div
              key={device.id}
              className={`p-4 rounded-lg border cursor-pointer transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
              onClick={() => handleDeviceSelect(device)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-full ${device.status === 'online' ? 'bg-green-100 dark:bg-green-900/20' : 'bg-red-100 dark:bg-red-900/20'}`}>
                    {device.status === 'online' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="font-medium text-gray-800 dark:text-gray-200">
                        {device.name || device.deviceId}
                      </h4>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        device.status === 'online' ? 'text-green-600 bg-green-600/10' : 'text-red-600 bg-red-600/10'
                      }`}>
                        {device.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      ID: {device.deviceId} • Last seen: {formatLastSeen(device.lastSeen)}
                    </div>
                  </div>
                </div>

                <div className="text-sm text-gray-600 dark:text-gray-400 text-right">
                  <div>{sensorCount} sensors</div>
                  {snapshot?.latestTimestamp && (
                    <div>Latest: {formatLastSeen(snapshot.latestTimestamp)}</div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteDevice(device);
                    }}
                    disabled={deletingDeviceId === device.id}
                    className="mt-2 inline-flex items-center rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/30"
                  >
                    {deletingDeviceId === device.id ? 'Removing...' : 'Remove Device'}
                  </button>
                </div>
              </div>

              {isSelected && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
                  <div className="flex items-center justify-between mb-3 text-sm">
                    <div className="text-gray-600 dark:text-gray-400">
                      Realtime status: {snapshot?.deviceOnline ? 'Online' : 'Offline'}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSensorSnapshot(device.deviceId);
                      }}
                      className="inline-flex items-center gap-2 px-2 py-1 text-xs rounded-md border bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
                      disabled={sensorFetching[device.deviceId]}
                    >
                      <RefreshCw className={`w-3 h-3 ${sensorFetching[device.deviceId] ? 'animate-spin' : ''}`} />
                      Refresh sensors
                    </button>
                  </div>

                  {selectedSensorLoading && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">Loading sensor readings…</div>
                  )}

                  {!selectedSensorLoading && (!snapshot || (snapshot.sensors?.length ?? 0) === 0) && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">No sensor readings available.</div>
                  )}

                  {!!snapshot?.sensors?.length && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {snapshot.sensors.map((sensor) => (
                        <div key={sensor.key} className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
                          <div className="text-xs uppercase text-gray-500 dark:text-gray-400">{sensor.label}</div>
                          <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                            {formatSensorValue(sensor)}
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            {sensor.timestamp ? formatLastSeen(sensor.timestamp) : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {devices.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No devices found</p>
          <p className="text-sm">Register a device or power on an existing unit to see it here.</p>
        </div>
      )}
    </div>
  );
};

export default DeviceManagement;

