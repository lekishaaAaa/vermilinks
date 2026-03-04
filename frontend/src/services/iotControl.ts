import api from './api';

export interface DeviceStatePayload {
  pump: boolean;
  valve1: boolean;
  valve2: boolean;
  valve3: boolean;
  float: string | null;
  requestId: string | null;
  source?: string | null;
  ts?: string | null;
}

export interface LatestPayload {
  telemetry: any | null;
  deviceState: DeviceStatePayload | null;
  pendingCommand: { requestId: string } | null;
}

export async function fetchLatest() {
  const response = await api.get('/latest');
  return response?.data?.data as LatestPayload;
}

export async function sendControl(desired: { pump: boolean; valve1: boolean; valve2: boolean; valve3: boolean }) {
  const response = await api.post('/control', desired);
  return response?.data?.data;
}

export async function sendActuatorCommand(payload: {
  device_id?: string;
  deviceId?: string;
  actuator: string;
  state: 'on' | 'off';
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
      const desired = { pump: false, valve1: false, valve2: false, valve3: false };
      desired[key] = payload.state === 'on';
      return sendControl(desired);
    }
    throw error;
  }
}
