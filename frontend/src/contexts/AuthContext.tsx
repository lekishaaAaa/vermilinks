import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User, AuthContextType } from '../types';
import api, { authService, discoverApi } from '../services/api';
import { logoutSession } from '../services/adminAuthService';

const resolveStorage = (): Storage | null => {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      return window.localStorage;
    }
  } catch (error) {
    // Storage unavailable (SSR/test environment)
  }
  return null;
};

const storageRemoveMany = (keys: string[]) => {
  const storage = resolveStorage();
  if (!storage) return;
  keys.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      // ignore per-key failures
    }
  });
};

const storageGet = (key: string): string | null => {
  const storage = resolveStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const storageSet = (key: string, value: string) => {
  const storage = resolveStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // ignore storage write failures (e.g., quota exceeded)
  }
};

const normalizeUser = (raw: any): User | null => {
  if (!raw) return null;
  try {
    const idSource = raw.id ?? raw._id ?? raw.email ?? raw.username;
    const id = idSource ? idSource.toString() : 'admin-local';
    const username = raw.username || raw.email || raw.name || 'Administrator';
    const email = raw.email || undefined;
    const role: User['role'] = raw.role === 'user' ? 'user' : 'admin';
    return {
      ...raw,
      id,
      username,
      email,
      role,
    } as User;
  } catch (err) {
    console.debug('AuthContext: failed to normalize user payload', err instanceof Error ? err.message : err);
    return null;
  }
};

const persistUser = (user: User | null) => {
  if (!user) return;
  const serialized = JSON.stringify(user);
  storageSet('user', serialized);
  storageSet('adminUser', serialized);
};

const fallbackUserForToken = (payload?: Partial<User> & { email?: string | null }): User => {
  const idSource = payload?.id ?? payload?.email ?? 'admin-local';
  return {
    id: idSource ? idSource.toString() : 'admin-local',
    username: payload?.username || payload?.email || 'Administrator',
    email: payload?.email || undefined,
    role: payload?.role === 'user' ? 'user' : 'admin',
  };
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      // Try to discover a reachable API host early so health checks and login
      // use the correct backend baseURL (helps when backend runs on port 5000)
      try {
        const disco = await discoverApi({ timeout: 1500 });
        if (disco?.ok) {
          console.log('AuthContext: discovered API host at startup', disco.baseURL);
        } else {
          console.debug('AuthContext: no API discovered at startup');
        }
      } catch (e: any) {
        console.debug('AuthContext: discovery failed at startup', (e && (e.message || String(e))) || String(e));
      }

      const storedToken = storageGet('token') || storageGet('adminToken');
      const storedRefreshToken = storageGet('adminRefreshToken');
      const storedUserRaw = storageGet('user') || storageGet('adminUser');
      let parsedUser: User | null = null;
      if (storedUserRaw) {
        try {
          parsedUser = normalizeUser(JSON.parse(storedUserRaw));
        } catch (err) {
          parsedUser = null;
        }
      }

      const tryAdminSessionVerification = async (): Promise<boolean> => {
        if (!storedToken) return false;
        try {
          api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
          const response = await api.get('/admin/session');
          if (response?.data?.success && response.data.data?.user) {
            const adminUser = normalizeUser(response.data.data.user) || fallbackUserForToken(response.data.data.user);
            setToken(storedToken);
            setUser(adminUser);
            persistUser(adminUser);
            console.log('✅ Admin session restored');
            return true;
          }
        } catch (err) {
          if (storedRefreshToken) {
            try {
              const refreshResp = await api.post('/admin/refresh', { refreshToken: storedRefreshToken });
              const payload = refreshResp?.data?.data;
              if (payload?.token) {
                storageSet('token', payload.token);
                storageSet('adminToken', payload.token);
                if (payload.refreshToken) storageSet('adminRefreshToken', payload.refreshToken);
                (api.defaults.headers as any).Authorization = `Bearer ${payload.token}`;
                setToken(payload.token);

                let refreshedUser = normalizeUser(payload.user);
                if (!refreshedUser) {
                  try {
                    const sessionResp = await api.get('/admin/session');
                    if (sessionResp?.data?.data?.user) {
                      refreshedUser = normalizeUser(sessionResp.data.data.user);
                    }
                  } catch (sessionErr) {
                    console.debug('Admin refresh session lookup failed', sessionErr instanceof Error ? sessionErr.message : sessionErr);
                  }
                }

                const finalUser = refreshedUser || fallbackUserForToken(payload.user);
                setUser(finalUser);
                persistUser(finalUser);
                console.log('✅ Admin session refreshed on startup');
                return true;
              }
            } catch (refreshErr) {
              console.warn('Admin refresh on startup failed', refreshErr && (refreshErr as any).message);
            }
          }
        }
        return false;
      };

      let restored = false;
      if (storedToken) {
        restored = await tryAdminSessionVerification();
      }

      if (!restored && storedToken) {
        try {
          api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
          const verifyResp = await api.get('/auth/verify');
          if (verifyResp?.data?.success && verifyResp.data.data?.user) {
            const userData = normalizeUser(verifyResp.data.data.user) || fallbackUserForToken(verifyResp.data.data.user);
            setToken(storedToken);
            setUser(userData);
            persistUser(userData);
            storageSet('token', storedToken);
            console.log('✅ Token verified on startup for user', userData.username || userData.id);
            restored = true;
          } else {
            throw new Error('Token verify failed');
          }
        } catch (e: any) {
          const looksLikeLocalDevToken = typeof storedToken === 'string' && storedToken.startsWith('local-dev-token-');
          if (looksLikeLocalDevToken && parsedUser) {
            try {
              setToken(storedToken);
              setUser(parsedUser);
              (api.defaults.headers as any).Authorization = `Bearer ${storedToken}`;
              console.log('✅ Using stored development token on startup for user', parsedUser.username || parsedUser.id);
              restored = true;
            } catch (parseErr) {
              // fall through to cleanup below
            }
          }

          if (!restored) {
            console.warn('Stored token verify failed, clearing local auth:', e && (e.message || String(e)));
            storageRemoveMany(['token', 'user', 'adminToken', 'adminUser', 'adminRefreshToken', 'tokenExpiresAt']);
            delete api.defaults.headers.common['Authorization'];
            setToken(null);
            setUser(null);
          }
        }
      }

      setIsLoading(false);
    };

    init();
  }, []);

const login = async (username: string, password: string): Promise<{ success: boolean; message?: string }> => {
    const maxAttempts = 3;
    let attempt = 0;
    let lastError: any = null;
    setIsLoading(true);

    // First, check server health to avoid generic network errors
    try {
      await api.get('/health');
    } catch (healthError: any) {
      // Attempt discovery if direct health check failed (helps when backend runs on a different port)
      try {
        const disco = await discoverApi({ timeout: 1500 });
        if (disco.ok) {
          console.log('AuthContext.login: discovered API host after health failure', disco.baseURL);
          // try health again once
          try {
            await api.get('/health', { timeout: 3000 });
          } catch (e) {
            setIsLoading(false);
            return { success: false, message: 'Server offline. Please check if the backend is running.' };
          }
        } else {
          setIsLoading(false);
          if (healthError.code === 'ECONNREFUSED' || healthError.code === 'ENOTFOUND' || healthError.code === 'ETIMEDOUT') {
            return { success: false, message: 'Server offline. Please check if the backend is running.' };
          }
          return { success: false, message: 'Unable to connect to server. Please try again.' };
        }
      } catch (discErr) {
        setIsLoading(false);
        return { success: false, message: 'Unable to connect to server. Please try again.' };
      }
    }

    // Attempt login with retry logic
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const resp = await authService.login({ username, password });
        if (resp?.data?.success && resp.data.data) {
          const newToken = resp.data.data.token;
          const userDataRaw = resp.data.data.user;
          const normalizedUser = normalizeUser(userDataRaw) || fallbackUserForToken(userDataRaw);
          setToken(newToken);
          setUser(normalizedUser);
          storageSet('token', newToken);
          persistUser(normalizedUser);
          (api.defaults.headers as any).Authorization = `Bearer ${newToken}`;
          setIsLoading(false);
          return { success: true };
        }

        const backendMessage = resp?.data?.message || 'Invalid credentials';
        setIsLoading(false);
        return { success: false, message: backendMessage };
      } catch (err: any) {
        lastError = err;

        // Handle specific error types
        if (err.response?.status === 401) {
          setIsLoading(false);
          return { success: false, message: 'Invalid username or password' };
        }

        if (err.response?.status === 503) {
          setIsLoading(false);
          return { success: false, message: 'Server temporarily unavailable. Please try again later.' };
        }

        // Network error - retry if attempts remaining
        if ((err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') && attempt < maxAttempts) {
          console.warn(`Login attempt ${attempt} failed, retrying in 2s...`, err.message);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        // Final attempt failed
        if (attempt >= maxAttempts) {
          break;
        }
      }
    }

    // All attempts failed
    setIsLoading(false);
    const errorMessage = lastError?.response?.data?.message ||
                        (lastError?.code === 'ECONNREFUSED' || lastError?.code === 'ENOTFOUND' ? 'Network error. Please check your connection.' : 'Login failed. Please try again.');
    return { success: false, message: errorMessage };
  };

  const logout = useCallback(async () => {
    const refreshToken = storageGet('adminRefreshToken');
    const currentToken = storageGet('token') || storageGet('adminToken');
    if (refreshToken || currentToken) {
      logoutSession({ refreshToken: refreshToken || undefined, token: currentToken || undefined })
        .catch((err) => {
          console.debug('logout session API warning', err && (err as any).message ? (err as any).message : err);
        });
    }

    setUser(null);
    setToken(null);
    // clear both token keys used in different flows
    storageRemoveMany(['token', 'adminToken', 'user', 'adminUser', 'adminRefreshToken', 'tokenExpiresAt']);
    try {
      // axios instances sometimes have headers.common; other mocks may set headers directly.
      const anyApi: any = api;
      if (anyApi && anyApi.defaults && anyApi.defaults.headers) {
        if (anyApi.defaults.headers.common && anyApi.defaults.headers.common['Authorization']) {
          delete anyApi.defaults.headers.common['Authorization'];
        }
        if (anyApi.defaults.headers['Authorization']) {
          delete anyApi.defaults.headers['Authorization'];
        }
      }
    } catch (e) {
      // ignore if api shape is unexpected in tests
    }
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => {
      logout();
    };
    window.addEventListener('auth:expired', handleAuthExpired);
    return () => {
      window.removeEventListener('auth:expired', handleAuthExpired);
    };
  }, [logout]);

  useEffect(() => {
    if (isLoading || !token || user) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const resp = await api.get('/admin/session');
        const sessionUser = normalizeUser(resp?.data?.data?.user);
        if (!cancelled && sessionUser) {
          setUser(sessionUser);
          persistUser(sessionUser);
        }
      } catch (err) {
        console.debug('AuthContext: session hydrate skipped', err instanceof Error ? err.message : err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, token, user]);

  const setAuth = (newToken: string, newUser?: any, options?: { refreshToken?: string }) => {
    setToken(newToken);
    const normalizedUser = normalizeUser(newUser || null);
    if (normalizedUser) {
      setUser(normalizedUser);
      persistUser(normalizedUser);
    } else if (!user) {
      const fallback = fallbackUserForToken(newUser);
      setUser(fallback);
      persistUser(fallback);
    }

    try {
      storageSet('token', newToken);
      storageSet('adminToken', newToken);
      if (options?.refreshToken) {
        storageSet('adminRefreshToken', options.refreshToken);
      }
      (api.defaults.headers as any).Authorization = `Bearer ${newToken}`;
    } catch (e) {
      // ignore storage errors
    }
  };

  const value: AuthContextType = {
    user,
    token,
    login,
    logout,
    setAuth,
    isLoading,
    isAuthenticated: Boolean(token),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
