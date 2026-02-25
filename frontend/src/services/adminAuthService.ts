import api, { discoverApi } from './api';

const FALLBACK_API_ROOT = 'https://vermilinks.onrender.com';
const AUTH_REQUEST_TIMEOUT_MS = 70000;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function normalizeRoot(value?: string | null) {
  if (!value) return '';
  return value.replace(/\s+/g, '').replace(/\/?api$/i, '').replace(/\/$/, '');
}

async function postDirect<T>(path: string, payload: Record<string, unknown>, timeoutMs = AUTH_REQUEST_TIMEOUT_MS): Promise<T> {
  const root = normalizeRoot(process.env.REACT_APP_API_URL) || normalizeRoot(FALLBACK_API_ROOT);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${root}/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (data as any)?.message || 'Request failed';
      throw new Error(message);
    }
    return data as T;
  } finally {
    window.clearTimeout(timer);
  }
}

async function callWithFallback<T>(runner: () => Promise<T>): Promise<T> {
  const retryDelays = [1200, 2500];

  try {
    return await runner();
  } catch (error: any) {
    if (!error?.request || error?.response) {
      throw error;
    }

    const fallbackRoot = normalizeRoot(FALLBACK_API_ROOT);
    if (!fallbackRoot) {
      throw error;
    }

    api.defaults.baseURL = `${fallbackRoot}/api`;

    let lastError: any = error;
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        if (attempt > 0) {
          await sleep(retryDelays[attempt - 1]);
        }
        return await runner();
      } catch (retryErr: any) {
        lastError = retryErr;
        if (!retryErr?.request || retryErr?.response) {
          throw retryErr;
        }
      }
    }

    throw lastError;
  }
}

export interface AdminLoginResponse {
  success: boolean;
  message?: string;
  data?: {
    requires2FA?: boolean;
    expiresAt?: string;
    debugCode?: string;
    delivery?: string;
  };
}

export interface AdminVerifyOtpResponse {
  success: boolean;
  message?: string;
  data?: {
    token?: string;
    refreshToken?: string;
    refreshExpiresAt?: string;
    expiresAt?: string;
    sessionId?: number | string | null;
    user?: Record<string, unknown>;
    attemptsRemaining?: number;
    delivery?: string;
  };
}

export interface AdminForgotPasswordResponse {
  success: boolean;
  message?: string;
}

export interface AdminResendOtpResponse {
  success: boolean;
  message?: string;
  data?: {
    expiresAt?: string;
    debugCode?: string;
    delivery?: string;
    rateLimit?: {
      remaining?: number;
      locked?: boolean;
      retryAfterMs?: number;
      retryAfterSeconds?: number;
    };
  };
}

export interface AdminResetPasswordResponse {
  success: boolean;
  message?: string;
}

export interface AdminRefreshResponse {
  success: boolean;
  message?: string;
  data?: {
    token: string;
    expiresAt: string;
    refreshToken: string;
    refreshExpiresAt: string;
    user?: Record<string, unknown>;
  };
}

export interface AdminLogoutResponse {
  success: boolean;
  message?: string;
}

export interface AdminSessionResponse {
  success: boolean;
  message?: string;
  data?: {
    token?: string;
    expiresAt?: string | null;
    refreshExpiresAt?: string | null;
    user?: Record<string, unknown>;
  };
}

function extractMessage(error: any, fallback: string): never {
  if (error?.response?.data?.message) {
    throw new Error(error.response.data.message);
  }
  if (error?.response?.status === 401) {
    throw new Error('Invalid email or password.');
  }
  if (String(error?.code || '').toUpperCase() === 'ECONNABORTED') {
    throw new Error('Server is starting up. Please wait a few seconds and try again.');
  }
  if (error?.request) {
    throw new Error('Unable to reach the server right now. If this is Render free tier cold start, retry in 10-20 seconds.');
  }
  throw new Error(error?.message || fallback);
}

async function ensureApiBase() {
  try {
    const envRoot = normalizeRoot(process.env.REACT_APP_API_URL);
    const fallbackRoot = normalizeRoot(FALLBACK_API_ROOT);
    const isProdBrowser =
      typeof window !== 'undefined' &&
      (process.env.NODE_ENV === 'production' || window.location.protocol === 'https:');

    const candidates = isProdBrowser
      ? Array.from(new Set([envRoot, fallbackRoot].filter(Boolean)))
      : undefined;

    await discoverApi({ timeout: isProdBrowser ? 2000 : 1200, candidates });
  } catch (e) {
    // discovery best-effort; ignore failures
  }
}

export async function login(email: string, password: string): Promise<AdminLoginResponse> {
  await ensureApiBase();
  try {
    const response = await callWithFallback(() =>
      api.post<AdminLoginResponse>('/admin/login', {
        email: email.trim(),
        password,
      }, { timeout: AUTH_REQUEST_TIMEOUT_MS })
    );
    return response.data;
  } catch (error: any) {
    if (error?.request && !error?.response) {
      try {
        return await postDirect<AdminLoginResponse>('/admin/login', {
          email: email.trim(),
          password,
        });
      } catch {
        // fall through to standard extractor
      }
    }
    extractMessage(error, 'Unable to sign in. Please try again.');
  }
}

export async function verifyOtp(email: string, otp: string): Promise<AdminVerifyOtpResponse> {
  await ensureApiBase();
  try {
    const response = await callWithFallback(() =>
      api.post<AdminVerifyOtpResponse>('/admin/verify-otp', {
        email: email.trim(),
        otp: otp.trim(),
      }, { timeout: AUTH_REQUEST_TIMEOUT_MS })
    );
    return response.data;
  } catch (error: any) {
    if (error?.request && !error?.response) {
      try {
        return await postDirect<AdminVerifyOtpResponse>('/admin/verify-otp', {
          email: email.trim(),
          otp: otp.trim(),
        });
      } catch {
        // fall through to standard extractor
      }
    }
    extractMessage(error, 'Unable to verify the code. Please try again.');
  }
}

export async function forgotPassword(email: string): Promise<AdminForgotPasswordResponse> {
  await ensureApiBase();
  try {
    const response = await api.post<AdminForgotPasswordResponse>('/admin/forgot-password', {
      email: email.trim(),
    });
    return response.data;
  } catch (error: any) {
    extractMessage(error, 'Unable to send the reset link. Please try again.');
  }
}

export async function resendOtp(email: string): Promise<AdminResendOtpResponse> {
  await ensureApiBase();
  try {
    const response = await callWithFallback(() =>
      api.post<AdminResendOtpResponse>('/admin/resend-otp', {
        email: email.trim(),
      }, { timeout: AUTH_REQUEST_TIMEOUT_MS })
    );
    return response.data;
  } catch (error: any) {
    if (error?.request && !error?.response) {
      try {
        return await postDirect<AdminResendOtpResponse>('/admin/resend-otp', {
          email: email.trim(),
        });
      } catch {
        // fall through to standard extractor
      }
    }
    extractMessage(error, 'Unable to resend the verification code. Please try again.');
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<AdminResetPasswordResponse> {
  await ensureApiBase();
  try {
    const response = await api.post<AdminResetPasswordResponse>('/admin/reset-password', {
      token: token.trim(),
      password: newPassword,
    });
    return response.data;
  } catch (error: any) {
    extractMessage(error, 'Unable to reset the password. Please try again.');
  }
}

export async function refreshSession(refreshToken: string): Promise<AdminRefreshResponse> {
  await ensureApiBase();
  try {
    const response = await api.post<AdminRefreshResponse>('/admin/refresh', { refreshToken: refreshToken.trim() });
    return response.data;
  } catch (error: any) {
    extractMessage(error, 'Unable to refresh the session. Please log in again.');
  }
}

export async function logoutSession(payload: { refreshToken?: string; token?: string }): Promise<AdminLogoutResponse> {
  await ensureApiBase();
  try {
    const response = await api.post<AdminLogoutResponse>('/admin/logout', payload);
    return response.data;
  } catch (error: any) {
    extractMessage(error, 'Unable to log out at this time.');
  }
}

export async function getSession(token?: string): Promise<AdminSessionResponse> {
  await ensureApiBase();
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const response = await api.get<AdminSessionResponse>('/admin/session', { headers });
    return response.data;
  } catch (error: any) {
    extractMessage(error, 'Unable to validate session.');
  }
}
