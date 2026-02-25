export interface User {
  id: string;
  username?: string;
  email?: string;
  role: 'admin' | 'user';
  lastLogin?: Date | string | null;
  loginCount?: number | null;
  [key: string]: unknown;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  setAuth?: (token: string, user?: any, options?: { refreshToken?: string }) => void;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface SensorData {
  _id?: string;
  deviceId: string;
  temperature?: number;
  humidity?: number;
  moisture?: number;
  soilTemperature?: number;
  ph?: number;
  ec?: number;
  nitrogen?: number;
  phosphorus?: number;
  potassium?: number;
  waterLevel?: number;
  floatSensor?: number | null;
  floatSensorTimestamp?: string | null;
  timestamp?: string | Date;
  status?: 'normal' | 'warning' | 'critical' | string;
  batteryLevel?: number;
  signalStrength?: number;
  actuatorStates?: Record<string, boolean | number | null> | null;
  isOfflineData?: boolean;
  deviceStatus?: string;
  deviceOnline?: boolean;
  isStale?: boolean;
  sampleAgeMs?: number | null;
  sensorSummary?: SensorSummaryItem[];
  lastSeen?: string | null;
}

export interface SensorLogEntry {
  id: number;
  deviceId: string;
  sensorName: string;
  value: number;
  unit?: string | null;
  origin?: string | null;
  recordedAt: string;
  mqttTopic?: string | null;
  rawPayload?: Record<string, unknown> | null;
}

export interface SensorSummaryItem {
  key: string;
  label: string;
  unit?: string | null;
  value: number | Record<string, number | null>;
  timestamp?: string;
}

export interface LatestSnapshot {
  temperature: number | null;
  humidity: number | null;
  soil_moisture: number | null;
  soil_temperature?: number | null;
  ph?: number | null;
  ec?: number | null;
  nitrogen?: number | null;
  phosphorus?: number | null;
  potassium?: number | null;
  water_level?: number | null;
  float_state: number | null;
  battery_level?: number | null;
  signal_strength?: number | null;
  actuator_states?: Record<string, boolean | number | null> | null;
  actuatorStates?: Record<string, boolean | number | null> | null;
  updated_at: string;
}

export interface DeviceSensorSummary {
  deviceId: string;
  deviceStatus: string;
  deviceOnline: boolean;
  lastHeartbeat: string | null;
  latestTimestamp: string | null;
  isStale: boolean;
  sampleAgeMs: number | null;
  sensors: SensorSummaryItem[];
  history: SensorData[];
}

export interface Alert {
  _id: string;
  title?: string;
  type?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical' | string;
  message?: string;
  deviceId?: string;
  sensorData?: Partial<SensorData>;
  isResolved?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  resolvedAt?: string | Date;
  acknowledgedBy?: string;
  acknowledgedAt?: string | Date;
  status?: 'new' | 'read';
}

export interface NotificationItem {
  _id: string;
  type?: string;
  severity?: string;
  message?: string;
  deviceId?: string;
  status?: 'new' | 'read';
  createdAt?: string | Date;
  acknowledgedAt?: string | Date | null;
  acknowledgedBy?: string | null;
  sensorData?: Partial<SensorData>;
  deleted?: boolean;
}

export interface AlertRules {
  temperature: boolean;
  humidity: boolean;
  moisture: boolean;
  ph: boolean;
  system: boolean;
  emailNotifications: boolean;
}

export interface Settings {
  alerts?: AlertRules;
  thresholds: {
    temperature: {
      warning: number;
      critical: number;
    };
    humidity: {
      warning: number;
      critical: number;
    };
    moisture: {
      warning: number;
      critical: number;
    };
    batteryLevel: {
      warning: number;
      critical: number;
    };
    ph: {
      minWarning: number;
      minCritical: number;
      maxWarning: number;
      maxCritical: number;
    };
    ec: {
      warning: number;
      critical: number;
    };
    nitrogen: {
      minWarning: number;
      minCritical: number;
    };
    phosphorus: {
      minWarning: number;
      minCritical: number;
    };
    potassium: {
      minWarning: number;
      minCritical: number;
    };
    waterLevel: {
      critical: number;
    };
  };
  sms: {
    enabled: boolean;
    phoneNumbers: Array<{
      _id: string;
      name: string;
      number: string;
      isActive: boolean;
    }>;
    rateLimitMinutes: number;
  };
  monitoring: {
    dataCollectionInterval: number;
    offlineTimeoutMinutes: number;
    dataRetentionDays: number;
  };
  system: {
    timezone: string;
    autoResolveAlerts: boolean;
    autoResolveTimeMinutes: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  meta?: Record<string, unknown>;
  errors?: string[];
}

export interface PaginationInfo {
  current: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PaginatedResponse<T> extends ApiResponse<{
  items: T[];
  pagination: PaginationInfo;
}> {}

export interface SensorStats {
  avgTemperature: number;
  maxTemperature: number;
  minTemperature: number;
  avgHumidity: number;
  maxHumidity: number;
  minHumidity: number;
  avgMoisture: number;
  maxMoisture: number;
  minMoisture: number;
  count: number;
}

export interface AlertStats {
  summary: {
    total: number;
    resolved: number;
    unresolved: number;
  };
  breakdown: Array<{
    _id: string;
    types: Array<{
      type: string;
      count: number;
    }>;
    total: number;
  }>;
  period: string;
}

export type DevicePortStatus = 'active' | 'inactive' | 'unknown' | string;

export interface DevicePort {
  id?: number;
  device_id?: number;
  port_name: string;
  port_type: string;
  baud_rate?: number | null;
  metadata?: Record<string, any> | null;
  configured_at?: string | null;
  configured_by?: number | null;
  status?: DevicePortStatus;
  known?: boolean;
}

