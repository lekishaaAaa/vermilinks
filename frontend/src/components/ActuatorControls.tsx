import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchLatest, sendActuatorCommand, DeviceStatePayload } from '../services/iotControl';

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
const DEVICE_FRESHNESS_MS = 60000;
const COMMAND_PENDING_TIMEOUT_MS = 3000;
const FAILSAFE_REFRESH_MS = 5000;
const RAPID_TOGGLE_DEBOUNCE_MS = 400;
const ACTUATOR_REFRESH_INTERVAL_MS = 2000;

const isDeviceFresh = (timestamp?: string | null) => {
  if (!timestamp) {
    return false;
  }
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? (Date.now() - parsed) < DEVICE_FRESHNESS_MS : false;
};

const ActuatorControls: React.FC = () => {
  const [deviceState, setDeviceState] = useState<DeviceStatePayload | null>(null);
  const [optimisticState, setOptimisticState] = useState<typeof initialState | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [controlMode, setControlMode] = useState<'automatic' | 'manual'>('manual');
  const [forcePumpOverride, setForcePumpOverride] = useState(false);
  const lastCommandAtRef = useRef(0);

  const floatLow = useMemo(() => {
    const value = deviceState?.float_state ?? deviceState?.float ?? null;
    return (value || '').toString().toUpperCase() === 'LOW';
  }, [deviceState?.float, deviceState?.float_state]);

  const displayState = useMemo(() => {
    if (optimisticState) {
      return optimisticState;
    }
    return {
      pump: Boolean(deviceState?.pump),
      valve1: Boolean(deviceState?.valve1),
      valve2: Boolean(deviceState?.valve2),
      valve3: Boolean(deviceState?.valve3),
    };
  }, [deviceState?.pump, deviceState?.valve1, deviceState?.valve2, deviceState?.valve3, optimisticState]);

  const applyOnlineStatus = useCallback((timestamp?: string | null) => {
    setOnline(isDeviceFresh(timestamp));
    if (timestamp) {
      setLastUpdated(timestamp);
    }
  }, []);

  const applyDeviceState = useCallback((payload: DeviceStatePayload | null) => {
    if (!payload) {
      return;
    }

    setDeviceState(payload);
    setOptimisticState(null);

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
    } else if (payload.source) {
      setErrorMessage(null);
    }
    if (payload.forcePumpOverride === true) {
      setForcePumpOverride(true);
    }
  }, [pendingRequestId]);

  const loadLatest = useCallback(async () => {
    try {
      const latest = await fetchLatest();

      const lastSeen = latest?.lastSeen ?? latest?.lastHeartbeat ?? latest?.deviceState?.ts ?? latest?.telemetry?.updated_at ?? latest?.telemetry?.timestamp ?? null;
      applyOnlineStatus(lastSeen);

      if (latest?.deviceState) {
        applyDeviceState(latest.deviceState);
      }
      if (pendingRequestId && latest?.pendingCommand?.requestId === pendingRequestId) {
        setPendingRequestId(latest.pendingCommand.requestId);
        setLoading(true);
      } else {
        setPendingRequestId(null);
        setLoading(false);
        setOptimisticState(null);
      }
    } catch (error) {
      setErrorMessage('Unable to load actuator state.');
      setLoading(false);
    }
  }, [applyDeviceState, applyOnlineStatus, pendingRequestId]);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadLatest();
    }, ACTUATOR_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadLatest]);

  useEffect(() => {
    if (!pendingRequestId) {
      return undefined;
    }

    const unlockTimer = window.setTimeout(() => {
      setLoading(false);
      setPendingRequestId(null);
      setOptimisticState(null);
      loadLatest().catch(() => null);
    }, COMMAND_PENDING_TIMEOUT_MS);

    const failsafeTimer = window.setTimeout(() => {
      loadLatest().catch(() => null);
    }, FAILSAFE_REFRESH_MS);

    return () => {
      window.clearTimeout(unlockTimer);
      window.clearTimeout(failsafeTimer);
    };
  }, [loadLatest, pendingRequestId]);

  const handleToggle = async (key: keyof typeof initialState) => {
    if (controlMode !== 'manual') {
      return;
    }
    const now = Date.now();
    if ((now - lastCommandAtRef.current) < RAPID_TOGGLE_DEBOUNCE_MS) {
      return;
    }
    if (loading) {
      return;
    }
    if (key === 'pump' && floatLow && !forcePumpOverride) {
      return;
    }

    lastCommandAtRef.current = now;

    const nextState = {
      ...displayState,
      [key]: !displayState[key],
    };

    setOptimisticState(nextState);

    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await sendActuatorCommand({
        device_id: ACTUATOR_DEVICE_ID,
        actuator: ACTUATOR_COMMAND_MAP[key],
        state: nextState[key] ? 'on' : 'off',
        forcePumpOverride: key === 'pump' ? forcePumpOverride : false,
      });
      if (result?.requestId) {
        setPendingRequestId(result.requestId);
      } else {
        setOptimisticState(null);
        setLoading(false);
        setErrorMessage('Command dispatched but no confirmation ID returned.');
        loadLatest().catch(() => null);
      }
    } catch (error: any) {
      setOptimisticState(null);
      setLoading(false);
      setErrorMessage(error?.response?.data?.message || 'Failed to send command.');
      loadLatest().catch(() => null);
    }
  };

  const formatStatus = (value: boolean) => (value ? 'On' : 'Off');
  const getToggleDisabled = (key: keyof typeof initialState) => {
    return loading || controlMode !== 'manual' || !online;
  };

  const getHelperText = (key: keyof typeof initialState) => {
    if (controlMode !== 'manual') {
      return 'Disabled in Automatic Mode';
    }
    if (!online) {
      return 'Unavailable while device is offline';
    }
    if (key === 'pump' && floatLow && !forcePumpOverride) {
      return 'Pump locked until force override is enabled';
    }
    if (key === 'pump' && floatLow && forcePumpOverride) {
      return 'Force override armed: pump may run while float is LOW';
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
          {forcePumpOverride && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
              Pump Override Armed
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">Pump Override</p>
            <p className="text-xs md:text-sm">
              Normal safety keeps the pump OFF while the float is LOW. Enable override only when you intentionally want manual pump control despite a low float reading.
            </p>
          </div>
          <label className="inline-flex items-center gap-3 text-xs font-semibold md:text-sm">
            <input
              type="checkbox"
              checked={forcePumpOverride}
              onChange={(event) => {
                const nextChecked = event.target.checked;
                if (nextChecked) {
                  const confirmed = window.confirm('Force pump override will allow manual pump control even while the float reads LOW. Continue?');
                  if (!confirmed) {
                    return;
                  }
                }
                setForcePumpOverride(nextChecked);
              }}
              disabled={controlMode !== 'manual' || !online || loading}
              className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            Enable force pump override
          </label>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(['pump', 'valve1', 'valve2', 'valve3'] as const).map((key) => {
          const disabled = getToggleDisabled(key);
          const checked = displayState[key];

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
