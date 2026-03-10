import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchLatest, sendControl, DeviceStatePayload } from '../services/iotControl';

const initialState = {
  pump: false,
  valve1: false,
  valve2: false,
  valve3: false,
};

type ActuatorKey = keyof typeof initialState;
type ActuatorViewState = typeof initialState;

type PendingActuatorState = {
  requestId: string | null;
  desired: boolean;
  lockUntil: number;
  expiresAt: number;
};

type PendingOverrideState = {
  requestId: string | null;
  desired: boolean;
  lockUntil: number;
  expiresAt: number;
};

type PendingActuatorsMap = Partial<Record<ActuatorKey, PendingActuatorState>>;

const ACTUATOR_LABEL_MAP: Record<ActuatorKey, string> = {
  pump: 'Pump (Layer 4 Reservoir)',
  valve1: 'Layer 1 Solenoid',
  valve2: 'Layer 2 Solenoid',
  valve3: 'Layer 3 Solenoid',
};

const DEVICE_FRESHNESS_MS = 60000;
const COMMAND_PENDING_TIMEOUT_MS = 3000;
const FAILSAFE_REFRESH_MS = 5000;
const RAPID_TOGGLE_DEBOUNCE_MS = 400;
const ACTUATOR_REFRESH_INTERVAL_MS = 2000;

const toActuatorViewState = (payload?: Partial<DeviceStatePayload> | null): ActuatorViewState => ({
  pump: Boolean(payload?.pump),
  valve1: Boolean(payload?.valve1),
  valve2: Boolean(payload?.valve2),
  valve3: Boolean(payload?.valve3),
});

const isDeviceFresh = (timestamp?: string | null) => {
  if (!timestamp) {
    return false;
  }
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? (Date.now() - parsed) < DEVICE_FRESHNESS_MS : false;
};

const ActuatorControls: React.FC = () => {
  const [deviceState, setDeviceState] = useState<DeviceStatePayload | null>(null);
  const [backendActuatorState, setBackendActuatorState] = useState<ActuatorViewState>(initialState);
  const [pendingActuators, setPendingActuators] = useState<PendingActuatorsMap>({});
  const [pendingOverride, setPendingOverride] = useState<PendingOverrideState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [controlMode, setControlMode] = useState<'automatic' | 'manual'>('manual');
  const [forcePumpOverride, setForcePumpOverride] = useState(false);
  const lastCommandAtRef = useRef(0);
  const pendingActuatorsRef = useRef<PendingActuatorsMap>({});
  const pendingOverrideRef = useRef<PendingOverrideState | null>(null);

  const setPendingOverrideState = useCallback((next: PendingOverrideState | null) => {
    pendingOverrideRef.current = next;
    setPendingOverride(next);
  }, []);

  const updatePendingActuatorsState: (updater: (current: PendingActuatorsMap) => PendingActuatorsMap) => void = useCallback((updater) => {
    const next = updater(pendingActuatorsRef.current);
    pendingActuatorsRef.current = next;
    setPendingActuators(next);
  }, []);

  useEffect(() => {
    pendingActuatorsRef.current = pendingActuators;
  }, [pendingActuators]);

  useEffect(() => {
    pendingOverrideRef.current = pendingOverride;
  }, [pendingOverride]);

  const floatLow = useMemo(() => {
    const value = deviceState?.float_state ?? deviceState?.float ?? null;
    return (value || '').toString().toUpperCase() === 'LOW';
  }, [deviceState?.float, deviceState?.float_state]);

  const displayState = useMemo(() => {
    return {
      pump: pendingActuators.pump?.desired ?? backendActuatorState.pump,
      valve1: pendingActuators.valve1?.desired ?? backendActuatorState.valve1,
      valve2: pendingActuators.valve2?.desired ?? backendActuatorState.valve2,
      valve3: pendingActuators.valve3?.desired ?? backendActuatorState.valve3,
    };
  }, [backendActuatorState, pendingActuators]);

  const displayForcePumpOverride = pendingOverride?.desired ?? forcePumpOverride;

  const pendingRequestIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(pendingActuators).forEach((entry) => {
      if (entry?.requestId) {
        ids.add(entry.requestId);
      }
    });
    if (pendingOverride?.requestId) {
      ids.add(pendingOverride.requestId);
    }
    return Array.from(ids);
  }, [pendingActuators, pendingOverride]);

  const commandPending = pendingRequestIds.length > 0 || Object.keys(pendingActuators).length > 0 || Boolean(pendingOverride);

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

    setDeviceState((current) => ({
      ...(current || {}),
      ...payload,
    }));

    const polledActuatorState = toActuatorViewState(payload);
    setBackendActuatorState(polledActuatorState);

    if (payload.ts) {
      setLastUpdated(payload.ts);
    }

    if (typeof payload.forcePumpOverride === 'boolean') {
      setForcePumpOverride(payload.forcePumpOverride);
    }

    const normalizedSource = (payload.source || '').toString().toLowerCase();
    const safetyOverrideApplied = normalizedSource === 'safety_override' || normalizedSource === 'safety';

    updatePendingActuatorsState((current: PendingActuatorsMap) => {
      const next = { ...current };
      (Object.keys(next) as ActuatorKey[]).forEach((key) => {
        if (polledActuatorState[key] === next[key]?.desired) {
          delete next[key];
        }
      });
      return next;
    });

    const currentPendingOverride = pendingOverrideRef.current;
    const sameOverrideRequest = Boolean(
      currentPendingOverride?.requestId &&
      payload.requestId &&
      currentPendingOverride.requestId === payload.requestId
    );
    const overrideConfirmed =
      typeof payload.forcePumpOverride === 'boolean' &&
      Boolean(payload.forcePumpOverride) === currentPendingOverride?.desired;
    if (!currentPendingOverride) {
      setPendingOverrideState(null);
    } else if (overrideConfirmed) {
      setPendingOverrideState(null);
    } else {
      setPendingOverrideState(currentPendingOverride);
    }

    if (safetyOverrideApplied && !Boolean(payload.forcePumpOverride) && !(currentPendingOverride?.desired && !sameOverrideRequest)) {
      setErrorMessage('Safety override applied. Pump disabled by float sensor.');
    } else if (payload.source && !currentPendingOverride?.desired) {
      setErrorMessage(null);
    }
  }, [setPendingOverrideState, updatePendingActuatorsState]);

  const loadLatest = useCallback(async () => {
    try {
      const latest = await fetchLatest();

      const lastSeen = latest?.lastSeen ?? latest?.lastHeartbeat ?? latest?.deviceState?.ts ?? latest?.telemetry?.updated_at ?? latest?.telemetry?.timestamp ?? null;
      applyOnlineStatus(lastSeen);

      if (latest?.deviceState) {
        applyDeviceState(latest.deviceState);
      }
    } catch (error) {
      setErrorMessage('Unable to load actuator state.');
    }
  }, [applyDeviceState, applyOnlineStatus]);

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
    const actuatorEntries = Object.entries(pendingActuators) as Array<[ActuatorKey, PendingActuatorState]>;
    if (actuatorEntries.length === 0 && !pendingOverride) {
      return undefined;
    }

    const timers: number[] = [];

    actuatorEntries.forEach(([key, entry]) => {
      timers.push(window.setTimeout(() => {
        updatePendingActuatorsState((current: PendingActuatorsMap) => {
          if (!pendingActuatorsRef.current[key]) {
            return pendingActuatorsRef.current;
          }
          const next = { ...pendingActuatorsRef.current };
          delete next[key];
          return next;
        });
        setErrorMessage('Device confirmation timed out. Refreshed last known actuator state.');
        loadLatest().catch(() => null);
      }, Math.max(0, entry.expiresAt - Date.now())));
    });

    if (pendingOverride) {
      timers.push(window.setTimeout(() => {
        setPendingOverrideState(null);
        setErrorMessage('Force override confirmation timed out. Refreshed last known actuator state.');
        loadLatest().catch(() => null);
      }, Math.max(0, pendingOverride.expiresAt - Date.now())));
    }

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [loadLatest, pendingActuators, pendingOverride, setPendingOverrideState, updatePendingActuatorsState]);

  const handleToggle = async (key: ActuatorKey) => {
    if (controlMode !== 'manual') {
      return;
    }

    const now = Date.now();
    if ((now - lastCommandAtRef.current) < RAPID_TOGGLE_DEBOUNCE_MS) {
      return;
    }
    if (pendingActuatorsRef.current[key]) {
      return;
    }
    if (key === 'pump' && floatLow && !displayForcePumpOverride) {
      return;
    }

    lastCommandAtRef.current = now;

    const nextState = {
      ...displayState,
      [key]: !displayState[key],
    };

    updatePendingActuatorsState((current: PendingActuatorsMap) => ({
      ...current,
      [key]: {
        requestId: null,
        desired: nextState[key],
        lockUntil: now + COMMAND_PENDING_TIMEOUT_MS,
        expiresAt: now + FAILSAFE_REFRESH_MS,
      },
    }));
    setErrorMessage(null);

    try {
      const result = await sendControl({
        ...nextState,
        forcePumpOverride: displayForcePumpOverride,
      });
      if (result?.requestId) {
        updatePendingActuatorsState((current: PendingActuatorsMap) => {
          const entry = current[key];
          if (!entry) {
            return current;
          }
          return {
            ...current,
            [key]: {
              ...entry,
              requestId: result.requestId,
            },
          };
        });
      } else {
        updatePendingActuatorsState((current: PendingActuatorsMap) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        setErrorMessage('Command dispatched but no confirmation ID returned.');
        loadLatest().catch(() => null);
      }
    } catch (error: any) {
      updatePendingActuatorsState((current: PendingActuatorsMap) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setErrorMessage(error?.response?.data?.message || 'Failed to send command.');
      loadLatest().catch(() => null);
    }
  };

  const handleOverrideToggle = async (nextChecked: boolean) => {
    if (controlMode !== 'manual' || !online) {
      return;
    }

    const now = Date.now();
    if ((now - lastCommandAtRef.current) < RAPID_TOGGLE_DEBOUNCE_MS) {
      return;
    }
    if (pendingOverrideRef.current) {
      return;
    }

    if (nextChecked) {
      const confirmed = window.confirm('Force pump override will allow manual pump control even while the float reads LOW. Continue?');
      if (!confirmed) {
        return;
      }
    }

    lastCommandAtRef.current = now;
    const nextPendingOverride: PendingOverrideState = {
      requestId: null,
      desired: nextChecked,
      lockUntil: now + COMMAND_PENDING_TIMEOUT_MS,
      expiresAt: now + FAILSAFE_REFRESH_MS,
    };
    setPendingOverrideState(nextPendingOverride);
    setErrorMessage(null);

    try {
      const result = await sendControl({
        ...displayState,
        forcePumpOverride: nextChecked,
      });
      if (result?.requestId) {
        setPendingOverrideState({
          ...nextPendingOverride,
          requestId: result.requestId,
        });
      } else {
        setPendingOverrideState(null);
        setErrorMessage('Command dispatched but no confirmation ID returned.');
        loadLatest().catch(() => null);
      }
    } catch (error: any) {
      setPendingOverrideState(null);
      setErrorMessage(error?.response?.data?.message || 'Failed to send command.');
      loadLatest().catch(() => null);
    }
  };

  const formatStatus = (value: boolean) => (value ? 'On' : 'Off');

  const isActuatorPending = (key: ActuatorKey) => Boolean(pendingActuators[key]);
  const isActuatorLockActive = (key: ActuatorKey) => {
    const entry = pendingActuators[key];
    return Boolean(entry && Date.now() < entry.lockUntil);
  };

  const getToggleDisabled = (key: ActuatorKey) => {
    if (controlMode !== 'manual' || !online) {
      return true;
    }
    if (isActuatorPending(key)) {
      return true;
    }
    if (key === 'pump' && floatLow && !displayForcePumpOverride) {
      return true;
    }
    return false;
  };

  const getHelperText = (key: ActuatorKey) => {
    if (controlMode !== 'manual') {
      return 'Disabled in Automatic Mode';
    }
    if (!online) {
      return 'Unavailable while device is offline';
    }
    if (isActuatorPending(key)) {
      return isActuatorLockActive(key)
        ? 'Control locked during the 3 second command window'
        : 'Awaiting ESP32 state confirmation';
    }
    if (key === 'pump' && floatLow && !displayForcePumpOverride) {
      return 'Pump locked until force override is enabled';
    }
    if (key === 'pump' && floatLow && displayForcePumpOverride) {
      return 'Force override armed: pump may run while float is LOW';
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
          {displayForcePumpOverride && (
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
              checked={displayForcePumpOverride}
              onChange={(event) => {
                handleOverrideToggle(event.target.checked).catch(() => null);
              }}
              disabled={controlMode !== 'manual' || !online || Boolean(pendingOverride)}
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
        {pendingRequestIds.length > 0 && (
          <span className="text-amber-600 dark:text-amber-300">Awaiting confirmation: {pendingRequestIds[0]}</span>
        )}
        {pendingRequestIds.length === 0 && commandPending && (
          <span className="text-amber-600 dark:text-amber-300">Awaiting command acknowledgement from backend</span>
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
