import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchLatest, sendControl, DeviceStatePayload } from '../services/iotControl';
import { socket as sharedSocket } from '../socket';

const initialState = {
  pump: false,
  valve1: false,
  valve2: false,
  valve3: false,
};

const ActuatorControls: React.FC = () => {
  const [deviceState, setDeviceState] = useState<DeviceStatePayload | null>(null);
  const [desiredState, setDesiredState] = useState(initialState);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const floatLow = useMemo(() => (deviceState?.float || '').toString().toUpperCase() === 'LOW', [deviceState?.float]);

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
      const latest = await fetchLatest();
      if (latest?.deviceState) {
        applyDeviceState(latest.deviceState);
        setOnline(Boolean((latest.deviceState as any).online));
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

    sharedSocket.on('actuator:state', handleState);
    return () => {
      sharedSocket.off('actuator:state', handleState);
    };
  }, [applyDeviceState]);

  const handleToggle = async (key: keyof typeof initialState) => {
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

    setDesiredState(nextState);
    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await sendControl(nextState);
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

  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-6 shadow dark:border-gray-800 dark:bg-gray-900/60">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Actuator Controls</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Commands apply only after ESP32-A confirms the new state.</p>
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
        {(['pump', 'valve1', 'valve2', 'valve3'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => handleToggle(key)}
            disabled={loading || (key === 'pump' && floatLow) || !online}
            className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${loading || !online ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-500' : desiredState[key] ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200'}`}
          >
            <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{key === 'pump' ? 'Pump' : key.replace('valve', 'Valve ')}</span>
            <span className="text-xl font-bold">{formatStatus(desiredState[key])}</span>
            {key === 'pump' && floatLow && (
              <span className="text-xs text-rose-600 dark:text-rose-300">Pump locked (float LOW)</span>
            )}
          </button>
        ))}
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
