export type ActuatorState = {
  pump: boolean
  valve1: boolean
  valve2: boolean
  valve3: boolean
}

export type DeviceState = ActuatorState & {
  float?: 'HIGH' | 'LOW' | null
  online?: boolean
  lastSeen?: string | null
  requestId?: string | null
  source?: string | null
  ts?: string | null
}

export type TelemetrySnapshot = {
  tempC?: number | null
  humidity?: number | null
  soil?: number | null
  waterTempC?: number | null
  ts?: string | null
}

export type PendingCommand = {
  requestId: string
  status: string
  createdAt?: string | null
}

export type LatestPayload = {
  telemetry: TelemetrySnapshot | null
  deviceState: DeviceState | null
  pendingCommand: PendingCommand | null
}

export type AlertItem = {
  _id: string
  deviceId?: string | null
  type: string
  level: string
  message: string
  active: boolean
  acknowledged: boolean
  createdAt?: string
  lastSeen?: string | null
}

export type ThresholdConfig = {
  temperatureLow: number
  temperatureCriticalLow: number
  temperatureHigh: number
  temperatureCriticalHigh: number
  humidityLow: number
  humidityHigh: number
}

const resolveBaseUrl = () => {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  return raw && raw.trim().length > 0 ? raw.trim() : ''
}

const API_BASE = resolveBaseUrl()

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return response.json() as Promise<T>
}

export const fetchLatest = async (): Promise<LatestPayload> => {
  const response = await fetch(`${API_BASE}/api/latest`, {
    credentials: 'include',
  })
  const payload = await handleResponse<{ success: boolean; data: LatestPayload }>(response)
  return payload.data
}

export const sendControl = async (state: ActuatorState): Promise<{ requestId: string }> => {
  const response = await fetch(`${API_BASE}/api/control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(state),
  })
  const payload = await handleResponse<{ success: boolean; data?: { requestId?: string } }>(response)
  const requestId = payload.data?.requestId
  if (!requestId) {
    throw new Error('Missing requestId from control response')
  }
  return { requestId }
}

export const fetchAlerts = async (activeOnly = true): Promise<AlertItem[]> => {
  const response = await fetch(`${API_BASE}/api/alerts?active=${activeOnly ? 'true' : 'false'}`, {
    credentials: 'include',
  })
  const payload = await handleResponse<{ success: boolean; data: AlertItem[] }>(response)
  return payload.data
}

export const acknowledgeAlert = async (id: string): Promise<AlertItem> => {
  const response = await fetch(`${API_BASE}/api/alerts/${id}`, {
    method: 'PATCH',
    credentials: 'include',
  })
  const payload = await handleResponse<{ success: boolean; data: AlertItem }>(response)
  return payload.data
}

export const clearAlerts = async (): Promise<number> => {
  const response = await fetch(`${API_BASE}/api/alerts`, {
    method: 'DELETE',
    credentials: 'include',
  })
  const payload = await handleResponse<{ success: boolean; data: { cleared: number } }>(response)
  return payload.data.cleared
}

export const fetchThresholds = async (): Promise<ThresholdConfig> => {
  const response = await fetch(`${API_BASE}/api/thresholds`, {
    credentials: 'include',
  })
  const payload = await handleResponse<{ success: boolean; data: ThresholdConfig }>(response)
  return payload.data
}

export const updateThresholds = async (next: ThresholdConfig): Promise<ThresholdConfig> => {
  const response = await fetch(`${API_BASE}/api/thresholds`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(next),
  })
  const payload = await handleResponse<{ success: boolean; data: ThresholdConfig }>(response)
  return payload.data
}
