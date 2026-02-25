import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  ApiResponse,
  PaginatedResponse,
  SensorData,
  SensorLogEntry,
  Alert,
  Settings,
  AlertRules,
  SensorStats,
  AlertStats,
  NotificationItem,
  DeviceSensorSummary,
  LatestSnapshot,
} from '../types';

// Create axios instance with base configuration
// Build a normalized API base URL. Users may set REACT_APP_API_URL with or without
// a trailing '/api'. Normalize to avoid accidentally producing '/api/api' in requests.
const RAW_API_ROOT = (process.env.REACT_APP_API_URL || 'https://vermilinks.onrender.com').toString();
// Remove any trailing slashes and any repeated '/api' segments to avoid producing '/api/api'
const API_ROOT = RAW_API_ROOT.replace(/(\/api)+\/?$/i, '').replace(/\/+$/,'');
export const API_BASE_URL = API_ROOT;
const api: AxiosInstance = axios.create({
  // prefer IPv4 loopback in dev to avoid browsers resolving 'localhost' to ::1 (IPv6)
  baseURL: API_ROOT + '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  // explicit: do not send cookies by default for token-based auth; this also makes browser CORS behavior clearer
  withCredentials: false,
});

const ADMIN_REFRESH_EXCLUDED_PATHS = ['/admin/login', '/admin/verify-otp', '/admin/refresh', '/admin/logout'];
const SESSION_ENDPOINTS = ['/admin/session', '/auth/verify'];
let refreshPromise: Promise<any> | null = null;
let sessionProbePromise: Promise<boolean> | null = null;

function safeStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

function getStoredRefreshToken(): string | null {
  const storage = safeStorage();
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem('adminRefreshToken') || storage.getItem('refreshToken');
  } catch {
    return null;
  }
}

function persistTokens(data: { token: string; refreshToken?: string; user?: any; expiresAt?: string }) {
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem('token', data.token);
    storage.setItem('adminToken', data.token);
    if (data.refreshToken) {
      storage.setItem('adminRefreshToken', data.refreshToken);
    }
    if (data.user) {
      const serialized = JSON.stringify(data.user);
      storage.setItem('user', serialized);
      storage.setItem('adminUser', serialized);
    }
    if (data.expiresAt) {
      storage.setItem('tokenExpiresAt', data.expiresAt);
    }
  } catch (err) {
    console.warn('persistTokens storage warning', err && ((err as any).message || err));
  }
}

function clearStoredTokens() {
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  ['token', 'adminToken', 'user', 'adminUser', 'adminRefreshToken', 'tokenExpiresAt'].forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      // ignore per-key failures
    }
  });
  if ((api.defaults.headers as any).Authorization) {
    delete (api.defaults.headers as any).Authorization;
  }
}

function shouldAttemptRefresh(config: any): boolean {
  if (!config || config._retry) {
    return false;
  }
  const url = (config.url || '').toString();
  if (!url) {
    return false;
  }
  return !ADMIN_REFRESH_EXCLUDED_PATHS.some((path) => url.includes(path));
}

const isSessionEndpoint = (url: string | undefined | null) => {
  if (!url) return false;
  return SESSION_ENDPOINTS.some((endpoint) => url.includes(endpoint));
};

async function confirmActiveSession(authHeader: string) {
  if (sessionProbePromise) {
    return sessionProbePromise;
  }

  const probeHeaders = {
    Authorization: authHeader,
  };
  const probeConfig: any = {
    headers: probeHeaders,
    __authProbe: true,
  };

  const runProbe = async () => {
    try {
      const resp = await api.get('/admin/session', probeConfig);
      if (resp?.data?.success) {
        return true;
      }
    } catch (sessionErr: any) {
      const status = sessionErr?.response?.status;
      if (status !== 401 && status !== 403) {
        // For network/server errors we still fall back to /auth/verify below
      }
    }

    try {
      const verifyResp = await api.get('/auth/verify', probeConfig);
      return Boolean(verifyResp?.data?.success);
    } catch (verifyErr) {
      return false;
    }
  };

  sessionProbePromise = runProbe().finally(() => {
    sessionProbePromise = null;
  });

  return sessionProbePromise;
}

async function triggerTokenRefresh() {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    return null;
  }
  if (!refreshPromise) {
    refreshPromise = api
      .post('/admin/refresh', { refreshToken })
      .then((resp) => {
        const data = resp?.data?.data;
        if (data?.token && data?.refreshToken) {
          persistTokens(data);
          (api.defaults.headers as any).Authorization = `Bearer ${data.token}`;
          return data;
        }
        return null;
      })
      .catch((err) => {
        clearStoredTokens();
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Try to discover a reachable API base by probing health endpoints.
// Returns { ok: boolean, baseURL?: string, message?: string }
export async function discoverApi(options?: { candidates?: string[]; timeout?: number }) {
  const timeout = options?.timeout ?? 2500;
  const candidates = options?.candidates ?? (() => {
    const envRoot = (process.env.REACT_APP_API_URL || '').toString();
  const normalized = envRoot.replace(/(\/api)+\/?$/i, '').replace(/\/+$/,'');
    // include current configured base plus common dev ports
    const list = [] as string[];
    if (normalized) list.push(normalized);
    list.push('https://vermilinks.onrender.com');
    list.push('http://127.0.0.1:5000');
    list.push('http://127.0.0.1:8000');
  list.push('http://127.0.0.1:10000');
    list.push('http://localhost:5000');
    list.push('http://localhost:8000');
  list.push('http://localhost:10000');
    return Array.from(new Set(list));
  })();

  for (const root of candidates) {
    const testUrl = root.replace(/\/+$/,'') + '/api/health';
    try {
      const resp = await axios.get(testUrl, { timeout });
      if (resp && resp.status >= 200 && resp.status < 300) {
        // update api baseURL
        api.defaults.baseURL = root.replace(/\/+$/,'') + '/api';
        return { ok: true, baseURL: api.defaults.baseURL };
      }
    } catch (e) {
      // continue to next candidate
    }
  }
  return { ok: false, message: 'No reachable API host found' };
}

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle common errors
api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error) => {
    const status = error.response?.status;
    const originalRequest: any = error.config || {};

    if (originalRequest?.__authProbe) {
      return Promise.reject(error);
    }

    if (status === 401 && shouldAttemptRefresh(originalRequest)) {
      try {
        const refreshed = await triggerTokenRefresh();
        if (refreshed?.token) {
          originalRequest._retry = true;
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${refreshed.token}`;
          return api(originalRequest);
        }
      } catch (refreshErr) {
        // fall through to clearing tokens below
      }
    }

    if (status === 401) {
      const headerAuth = originalRequest?.headers?.Authorization || originalRequest?.headers?.authorization;
      const hadAuthHeader = Boolean(headerAuth);

      if (hadAuthHeader && !isSessionEndpoint(originalRequest?.url)) {
        const sessionStillValid = await confirmActiveSession(headerAuth).catch(() => false);
        if (sessionStillValid) {
          return Promise.reject(error);
        }
      }

      if (hadAuthHeader) {
        clearStoredTokens();
        if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
          try {
            window.dispatchEvent(new CustomEvent('auth:expired'));
          } catch (eventErr) {
            console.warn('auth:expired dispatch failed', eventErr && ((eventErr as any).message || eventErr));
          }
        }
      }
    }

    return Promise.reject(error);
  }
);

// API service methods
export const authService = {
  login: (credentials: { username: string; password: string }) =>
    api.post<ApiResponse<{ token: string; user: any }>>('/auth/login', credentials),
  
  verify: () =>
    api.get<ApiResponse<{ user: any }>>('/auth/verify'),
};

// Admin-specific login helper that talks to /api/admin/login and returns a simple shape
// Admin-specific login helper that talks to /api/admin/login and returns a simple shape
// Use the configured `api` instance whose baseURL already contains the '/api' prefix.
export const adminAuthService = {
  loginAdmin: async (email: string, password: string) => {
    const normalizeRoot = (value?: string | null) => {
      if (!value) return '';
      return value.replace(/\s+/g, '').replace(/\/?api$/i, '').replace(/\/$/, '');
    };

    let discoveryBase = '';
    try {
      const result = await discoverApi({ timeout: 1500 });
      if (result.ok && result.baseURL) {
        discoveryBase = result.baseURL;
      }
    } catch (e) {
      // ignore discovery errors, candidates below cover defaults
    }

    const candidateRoots = new Set<string>();
    const pushCandidate = (value?: string | null) => {
      const normalized = normalizeRoot(value);
      if (normalized) candidateRoots.add(normalized);
    };

    pushCandidate(process.env.REACT_APP_API_URL);
    pushCandidate(discoveryBase);
    pushCandidate(api.defaults.baseURL);
  pushCandidate('http://127.0.0.1:5000');
  pushCandidate('http://127.0.0.1:8000');
  pushCandidate('http://127.0.0.1:10000');
  pushCandidate('http://localhost:5000');
  pushCandidate('http://localhost:8000');
  pushCandidate('http://localhost:10000');

    const roots = Array.from(candidateRoots);
    let networkIssueDetected = false;
    let serverErrorMessage: string | null = null;

    for (const root of roots) {
      try {
        const base = `${root.replace(/\/$/, '')}/api`;
        api.defaults.baseURL = base;
        const health = await api.get('/health', { timeout: 2000 }).catch(() => null);
        if (health && health.data && health.data.success === false) {
          // backend reported unhealthy; attempt login regardless to surface proper error
        }

        const payload = { email: email.trim().toLowerCase(), password };
        const resp = await api.post('/admin/login', payload, { timeout: 8000 });

        if (resp?.data) {
          if (resp.data.success) {
            return resp.data;
          }
          // Backend may include success=false with a message (e.g., validation errors)
          return resp.data;
        }

        return { success: false, message: 'Invalid username or password.' };
      } catch (err: any) {
        if (err?.response) {
          if (err.response.status === 401) {
            return { success: false, message: 'Invalid username or password.' };
          }
          if (err.response.status >= 500) {
            serverErrorMessage = err.response.data?.message || 'Internal server error';
            continue;
          }
          return { success: false, message: err.response.data?.message || 'Login failed' };
        }

        const lower = (err?.code || err?.message || '').toString().toLowerCase();
        const networkIssues = ['econnrefused', 'enotfound', 'etimedout', 'network error', 'failed to fetch', 'networkrequestfailed', 'net::'];
        if (networkIssues.some(keyword => lower.includes(keyword))) {
          networkIssueDetected = true;
          continue; // try the next candidate host
        }

        serverErrorMessage = err?.message || 'Unable to connect to server. Please try again.';
      }
    }

    if (networkIssueDetected) {
      return { success: false, message: 'Server offline. Please check if the backend is running.' };
    }

    if (serverErrorMessage) {
      return { success: false, message: serverErrorMessage };
    }

    return { success: false, message: 'Unable to connect to server. Please try again.' };
  }
};

export const sensorService = {
  getSensorData: (params?: {
    page?: number;
    limit?: number;
    deviceId?: string;
    startDate?: string;
    endDate?: string;
  }) =>
    api.get<PaginatedResponse<SensorData>>('/sensors/data', { params }),
  
  getLatestData: async (deviceId?: string): Promise<LatestSnapshot | null> => {
    try {
      const response = await api.get<LatestSnapshot>('/sensors/latest', {
        params: deviceId ? { deviceId } : undefined,
        validateStatus: (status) => [200, 204].includes(status),
      });
      if (response.status === 204) {
        return null;
      }
      return response.data ?? null;
    } catch (error) {
      throw error;
    }
  },
  
  getStats: (params?: {
    deviceId?: string;
    startDate?: string;
    endDate?: string;
  }) =>
    api.get<ApiResponse<SensorStats>>('/sensors/stats', { params }),

  getHistory: (params?: { deviceId?: string; limit?: number; start?: string; end?: string }) =>
    api.get<ApiResponse<{ deviceId: string; readings: SensorData[] }>>('/sensors/history', { params }),

  getDaily: (params: { date: string; deviceId?: string }) =>
    api.get<ApiResponse<{
      date: string;
      deviceId: string;
      stats: Record<string, number | string | null>;
      actuatorActivity: Array<Record<string, any>>;
    }>>('/sensors/daily', { params }),
  
  submitData: (data: Omit<SensorData, '_id'>) =>
    api.post<ApiResponse<SensorData>>('/sensors/data', data),
};

export const sensorLogService = {
  list: (params?: {
    page?: number;
    limit?: number;
    deviceId?: string;
    sensor?: string;
    origin?: string;
    search?: string;
    start?: string;
    end?: string;
  }) => api.get<PaginatedResponse<SensorLogEntry>>('/sensor-logs', { params }),
  remove: (id: number | string) =>
    api.delete<ApiResponse<{ deleted: number; id: number }>>(`/sensor-logs/${encodeURIComponent(id)}`),
};

export const alertService = {
  getAlerts: (params?: {
    page?: number;
    limit?: number;
    type?: string;
    severity?: string;
    isResolved?: boolean;
    deviceId?: string;
  }) =>
    api.get<PaginatedResponse<Alert>>('/alerts', { params }),

  getRecentAlerts: (limit?: number) =>
    api.get<ApiResponse<Alert[]>>('/alerts/recent', {
      params: limit ? { limit } : undefined,
    }),

  getLatestAlerts: () =>
    api.get<ApiResponse<Alert[]>>('/alerts/latest'),

  getActiveAlerts: (params?: { deviceId?: string; severity?: string; limit?: number; sort?: 'asc' | 'desc' }) =>
    api.get<ApiResponse<Alert[]>>('/alerts/active', { params }),

  createAlert: (alertData: {
    type: 'sensor' | 'connectivity' | 'threshold' | 'device_offline' | 'other';
    message: string;
    timestamp?: string;
  }) =>
    api.post<ApiResponse<Alert>>('/alerts', alertData),

  markAsRead: (alertId: string) =>
    api.patch<ApiResponse<Alert>>(`/alerts/${alertId}`),

  resolveAlert: (alertId: string) =>
    api.put<ApiResponse<Alert>>(`/alerts/${alertId}/resolve`),

  acknowledgeAlert: (alertId: string) =>
    api.put<ApiResponse<Alert>>(`/alerts/${alertId}/acknowledge`),

  resolveAll: (payload?: { deviceId?: string }) =>
    api.put<ApiResponse<{ resolved: number }>>('/alerts/resolve-all', payload),

  // Aggregated summary of active alerts by severity buckets
  getSummary: async () => {
    const response = await api.get<{ critical: number; warning: number; info: number }>('/alerts/summary');
    return response.data;
  },

  // Clear all active alerts
  clearAll: async () => {
    const response = await api.delete<{ ok: boolean; resolved: number }>('/alerts/clear');
    return response.data;
  },

  getStats: (params?: {
    period?: 'day' | 'week' | 'month';
    deviceId?: string;
  }) =>
    api.get<ApiResponse<AlertStats>>('/alerts/stats', { params }),
};

export const notificationService = {
  list: (params?: { status?: 'new' | 'read'; limit?: number }) =>
    api.get<ApiResponse<NotificationItem[]>>('/notifications', { params }),

  stats: () =>
    api.get<ApiResponse<{ total: number; unread: number; resolved: number }>>('/notifications/stats'),

  markAsRead: (notificationId: string) =>
    api.patch<ApiResponse<NotificationItem>>(`/notifications/${notificationId}/mark-read`),

  markAsUnread: (notificationId: string) =>
    api.patch<ApiResponse<NotificationItem>>(`/notifications/${notificationId}/mark-unread`),

  remove: (notificationId: string) =>
    api.delete<ApiResponse<NotificationItem>>(`/notifications/${notificationId}`),
};

export const deviceService = {
  list: () => api.get<ApiResponse<any[]>>('/devices'),
  getSensors: (deviceId: string, params?: { limit?: number }) =>
    api.get<ApiResponse<DeviceSensorSummary>>(`/devices/${encodeURIComponent(deviceId)}/sensors`, { params }),
};

export const settingsService = {
  getSettings: () =>
    api.get<ApiResponse<Settings>>('/settings'),
  
  updateSettings: (settings: Partial<Settings>) =>
    api.put<ApiResponse<Settings>>('/settings', settings),

  getAlertRules: () =>
    api.get<ApiResponse<AlertRules>>('/settings/alerts'),

  updateAlertRules: (alerts: AlertRules) =>
    api.put<ApiResponse<AlertRules>>('/settings/alerts', { alerts }),
  
  addPhoneNumber: (phoneData: { name: string; number: string }) =>
    api.post<ApiResponse<Settings>>('/settings/phone-numbers', phoneData),
  
  removePhoneNumber: (phoneId: string) =>
    api.delete<ApiResponse<Settings>>(`/settings/phone-numbers/${phoneId}`),
  
  testSMS: (phoneNumber: string, message: string) =>
    api.post<ApiResponse<any>>('/settings/test-sms', { phoneNumber, message }),
};

export const systemService = {
  getHealth: () =>
    api.get<ApiResponse<{ status: string; timestamp: string }>>('/health'),
  
  getSystemInfo: () =>
    api.get<ApiResponse<{
      version: string;
      uptime: number;
      memory: any;
      database: any;
    }>>('/system/info'),
};

export default api;

// Auto-run discovery at module import to set a reachable API baseURL early.
(async function autoDiscover() {
  try {
    const disco = await discoverApi({ timeout: 1200 });
    if (disco.ok) {
      console.log('api: auto-discovered API host', disco.baseURL);
    } else {
      console.debug('api: auto-discovery did not find a reachable API');
    }
  } catch (e: any) {
    console.debug('api: auto-discovery error', (e && (e.message || String(e))) || String(e));
  }
})();
