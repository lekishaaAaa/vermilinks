import api from './api';

export interface DeviceStatePayload {
  pump: boolean;
  valve1: boolean;
  valve2: boolean;
  valve3: boolean;
  float: string | null;
  float_state?: string | null;
  requestId: string | null;
  source?: string | null;
  ts?: string | null;
  forcePumpOverride?: boolean;
  online?: boolean;
  lastSeen?: string | null;
}

export interface LatestPayload {
  telemetry: any | null;
  deviceState: DeviceStatePayload | null;
  pendingCommand: { requestId: string } | null;
  deviceOnline?: boolean;
  lastSeen?: string | null;
  lastHeartbeat?: string | null;
}

const DEVICE_FRESHNESS_MS = 60000;

const toTimestampMs = (value?: string | null) => {
  if (!value) {
    return NaN;
  }
  return new Date(value).getTime();
};

const isFreshTimestamp = (value?: string | null) => {
  const timestampMs = toTimestampMs(value);
  return Number.isFinite(timestampMs) && (Date.now() - timestampMs) < DEVICE_FRESHNESS_MS;
};

const pickFreshestTimestamp = (...values: Array<string | null | undefined>) => {
  return values.reduce<string | null>((freshest, candidate) => {
    const candidateMs = toTimestampMs(candidate || null);
    const freshestMs = toTimestampMs(freshest);
    if (!Number.isFinite(candidateMs)) {
      return freshest;
    }
    if (!Number.isFinite(freshestMs) || candidateMs > freshestMs) {
      return candidate || null;
    }
    return freshest;
  }, null);
};

export async function fetchLatest() {
  const response = await api.get('/sensors/latest', {
    params: { deviceId: 'esp32A' },
    validateStatus: (status) => [200, 204].includes(status),
  });

  if (response.status === 204) {
    return {
      telemetry: null,
      deviceState: null,
      pendingCommand: null,
      deviceOnline: false,
      lastSeen: null,
      lastHeartbeat: null,
    } as LatestPayload;
  }

  const payload = response?.data || {};
  const deviceState = payload.deviceState ?? null;
  const actuatorLastSeen = pickFreshestTimestamp(
    deviceState?.lastSeen ?? null,
    deviceState?.ts ?? null,
    payload.lastSeen ?? null,
    payload.lastHeartbeat ?? null,
    payload.updated_at ?? null,
    payload.timestamp ?? null,
  );
  const derivedDeviceOnline = Boolean(
    payload.deviceOnline === true ||
    deviceState?.online === true ||
    isFreshTimestamp(deviceState?.lastSeen ?? null) ||
    isFreshTimestamp(deviceState?.ts ?? null) ||
    isFreshTimestamp(actuatorLastSeen)
  );

  return {
    telemetry: payload,
    deviceState,
    pendingCommand: payload.pendingCommand ?? null,
    deviceOnline: derivedDeviceOnline,
    lastSeen: actuatorLastSeen,
    lastHeartbeat: actuatorLastSeen,
  } as LatestPayload;
}

export async function sendControl(desired: { pump: boolean; valve1: boolean; valve2: boolean; valve3: boolean; forcePumpOverride?: boolean }) {
  console.log('Sending actuator command', desired);
  const response = await api.post('/control', desired);
  return response?.data?.data;
}

export async function sendActuatorCommand(payload: {
  device_id?: string;
  deviceId?: string;
  actuator: string;
  state: 'on' | 'off';
  forcePumpOverride?: boolean;
}) {
  try {
    const response = await api.post('/actuators/command', payload);
    return response?.data?.data;
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 404 || status === 410) {
      const actuatorMap: Record<string, keyof Pick<DeviceStatePayload, 'pump' | 'valve1' | 'valve2' | 'valve3'>> = {
        pump: 'pump',
        water_pump: 'pump',
        solenoid_1: 'valve1',
        layer1_solenoid: 'valve1',
        solenoid_2: 'valve2',
        layer2_solenoid: 'valve2',
        solenoid_3: 'valve3',
        layer3_solenoid: 'valve3',
      };
      const key = actuatorMap[(payload.actuator || '').toLowerCase()];
      if (!key) {
        throw error;
      }
      const desired = { pump: false, valve1: false, valve2: false, valve3: false, forcePumpOverride: payload.forcePumpOverride === true };
      desired[key] = payload.state === 'on';
      return sendControl(desired);
    }
    throw error;
  }
}
