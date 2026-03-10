import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchLatest, sendActuatorCommand, DeviceStatePayload } from '../services/iotControl';
import { deviceService } from '../services/api';
import { socket as sharedSocket } from '../socket';

const initialState = {
  pump: false,
  valve1: false,
  valve2: false,
  valve3: false,
};

const ACTUATOR_COMMAND_MAP: Record<keyof typeof initialState, string> = {
  pump: 'pump',
  valve1: 'solenoid_1',
  valve2: 'solenoid_2',
  valve3: 'solenoid_3',
};

const ACTUATOR_LABEL_MAP: Record<keyof typeof initialState, string> = {
  pump: 'Pump (Layer 4 Reservoir)',
  valve1: 'Layer 1 Solenoid',
  valve2: 'Layer 2 Solenoid',
  valve3: 'Layer 3 Solenoid',
};

const ACTUATOR_DEVICE_ID = 'esp32A';

const normalizeDeviceId = (value?: string | null) => (value || '').toString().trim().toLowerCase();

const isActuatorDeviceStatusPayload = (payload: any) => {
  return normalizeDeviceId(payload?.deviceId || payload?.device_id) === ACTUATOR_DEVICE_ID.toLowerCase();
};

const ActuatorControls: React.FC = () => {
  const [deviceState, setDeviceState] = useState<DeviceStatePayload | null>(null);
  const [desiredState, setDesiredState] = useState(initialState);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [controlMode, setControlMode] = useState<'automatic' | 'manual'>('manual');

  const floatLow = useMemo(() => (deviceState?.float || '').toString().toUpperCase() === 'LOW', [deviceState?.float]);

  const applyOnlineStatus = useCallback((nextOnline: boolean, timestamp?: string | null) => {
    setOnline(Boolean(nextOnline));
    if (timestamp) {
      setLastUpdated(timestamp);
    }
  }, []);

  const applyDeviceState = useCallback((payload: DeviceStatePayload | null) => {
    if (!payload) {
      return;
    }

    setDeviceState(payload);
    setDesiredState({
      pump: Boolean(payload.pump),
      valve1: Boolean(payload.valve1),
      valve2: Boolean(payload.valve2),
      valve3: Boolean(payload.valve3),
    });

    if (payload.ts) {
      setLastUpdated(payload.ts);
    }

    if (payload.requestId && pendingRequestId === payload.requestId) {
      setPendingRequestId(null);
      setLoading(false);
      setErrorMessage(null);
    }

    if (payload.source === 'safety_override') {
      setErrorMessage('Safety override applied. Pump disabled by float sensor.');
    }
  }, [pendingRequestId]);

  const loadLatest = useCallback(async () => {
    try {
      const [latest, statusResponse] = await Promise.all([
        fetchLatest(),
        deviceService.getStatus(),
      ]);

      const statusEntry = (statusResponse?.data?.devices || []).find((device) => {
        return normalizeDeviceId(device?.device_id) === ACTUATOR_DEVICE_ID.toLowerCase();
      });

      applyOnlineStatus(Boolean(statusEntry?.online), statusEntry?.last_seen || null);

      if (latest?.deviceState) {
        applyDeviceState(latest.deviceState);
      }
      if (latest?.pendingCommand?.requestId) {
        setPendingRequestId(latest.pendingCommand.requestId);
        setLoading(true);
      }
    } catch (error) {
      setErrorMessage('Unable to load actuator state.');
    }
  }, [applyDeviceState]);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    if (!sharedSocket) {
      return undefined;
    }

    const handleState = (payload: DeviceStatePayload) => {
      applyDeviceState(payload);
    };

    const handleDeviceStatus = (payload: any) => {
      if (!isActuatorDeviceStatusPayload(payload)) {
        return;
      }

      const statusTimestamp = payload?.lastHeartbeat || payload?.last_seen || payload?.updatedAt || null;
      applyOnlineStatus(Boolean(payload?.online ?? ((payload?.status || '').toString().toLowerCase() === 'online')), statusTimestamp);
    };

    sharedSocket.on('actuator:state', handleState);
    sharedSocket.on('device:status', handleDeviceStatus);
    sharedSocket.on('device_status', handleDeviceStatus);
    sharedSocket.on('deviceHeartbeat', handleDeviceStatus);
    return () => {
      sharedSocket.off('actuator:state', handleState);
      sharedSocket.off('device:status', handleDeviceStatus);
      sharedSocket.off('device_status', handleDeviceStatus);
      sharedSocket.off('deviceHeartbeat', handleDeviceStatus);
    };
  }, [applyDeviceState, applyOnlineStatus]);

  const handleToggle = async (key: keyof typeof initialState) => {
    if (controlMode !== 'manual') {
      return;
    }
    if (loading) {
      return;
    }
    if (key === 'pump' && floatLow) {
      return;
    }

    const nextState = {
      ...desiredState,
      [key]: !desiredState[key],
    };

    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await sendActuatorCommand({
        device_id: ACTUATOR_DEVICE_ID,
        actuator: ACTUATOR_COMMAND_MAP[key],
        state: nextState[key] ? 'on' : 'off',
      });
      if (result?.requestId) {
        setPendingRequestId(result.requestId);
      } else {
        setLoading(false);
        setErrorMessage('Command dispatched but no confirmation ID returned.');
      }
    } catch (error: any) {
      setLoading(false);
      setErrorMessage(error?.response?.data?.message || 'Failed to send command.');
    }
  };

  const formatStatus = (value: boolean) => (value ? 'On' : 'Off');
  const getToggleDisabled = (key: keyof typeof initialState) => {
    return loading || controlMode !== 'manual' || (key === 'pump' && floatLow) || !online;
  };

  const getHelperText = (key: keyof typeof initialState) => {
    if (controlMode !== 'manual') {
      return 'Disabled in Automatic Mode';
    }
    if (!online) {
      return 'Unavailable while device is offline';
    }
    if (key === 'pump' && floatLow) {
      return 'Pump locked (float LOW)';
    }
    if (loading) {
      return 'Awaiting device confirmation';
    }
    return 'Ready for manual control';
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-6 shadow dark:border-gray-800 dark:bg-gray-900/60">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Actuator Controls</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Commands apply only after ESP32-A confirms the new state.</p>
          <div className="mt-2 inline-flex rounded-full border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800/70">
            <button
              type="button"
              onClick={() => setControlMode('automatic')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                controlMode === 'automatic'
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
              }`}
            >
              Automatic Mode
            </button>
            <button
              type="button"
              onClick={() => setControlMode('manual')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                controlMode === 'manual'
                  ? 'bg-[#c81e36] text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
              }`}
            >
              Manual Mode
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ${online ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'}`}>
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {online ? 'ESP32-A online' : 'ESP32-A offline'}
          </span>
          {floatLow && (
            <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
              Float LOW
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(['pump', 'valve1', 'valve2', 'valve3'] as const).map((key) => {
          const disabled = getToggleDisabled(key);
          const checked = desiredState[key];

          return (
            <div
              key={key}
              className={`rounded-xl border px-4 py-4 transition ${disabled ? 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40' : checked ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/40'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{ACTUATOR_LABEL_MAP[key]}</p>
                  <p className={`mt-2 text-xl font-bold ${disabled ? 'text-gray-400 dark:text-gray-500' : checked ? 'text-emerald-700 dark:text-emerald-200' : 'text-gray-800 dark:text-gray-100'}`}>
                    {formatStatus(checked)}
                  </p>
                  <p className={`mt-2 text-xs ${key === 'pump' && floatLow && controlMode === 'manual' ? 'text-rose-600 dark:text-rose-300' : disabled ? 'text-gray-500 dark:text-gray-400' : 'text-gray-600 dark:text-gray-300'}`}>
                    {getHelperText(key)}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  aria-label={`${ACTUATOR_LABEL_MAP[key]} ${checked ? 'on' : 'off'}`}
                  onClick={() => handleToggle(key)}
                  disabled={disabled}
                  className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition ${disabled ? 'cursor-not-allowed border-gray-300 bg-gray-200 dark:border-gray-700 dark:bg-gray-800' : checked ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 bg-gray-300 dark:border-gray-600 dark:bg-gray-700'}`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-7' : 'translate-x-1'}`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400 md:flex-row md:items-center md:justify-between">
        <span>Last update: {lastUpdated ? new Date(lastUpdated).toLocaleString() : 'No state yet'}</span>
        {pendingRequestId && (
          <span className="text-amber-600 dark:text-amber-300">Awaiting confirmation: {pendingRequestId}</span>
        )}
      </div>

      {errorMessage && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
          {errorMessage}
        </div>
      )}
    </div>
  );
};

export default ActuatorControls;
