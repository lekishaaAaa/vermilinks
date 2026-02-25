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
