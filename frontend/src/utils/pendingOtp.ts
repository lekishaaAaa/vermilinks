const STORAGE_KEY = 'vermilinks:pending-admin-otp';

export interface PendingOtpState {
  email: string;
  expiresAt?: string | null;
  delivery?: string | null;
  issuedAt?: string | null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const resolveStorage = (): StorageLike | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    if (window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch (err) {
    // fall back to localStorage if sessionStorage is unavailable (Safari private mode, etc.)
  }
  try {
    if (window.localStorage) {
      return window.localStorage;
    }
  } catch (err) {
    return null;
  }
  return null;
};

export const savePendingOtpState = (state: PendingOtpState): void => {
  const storage = resolveStorage();
  if (!storage) return;
  const payload: PendingOtpState = {
    email: state.email.trim().toLowerCase(),
    expiresAt: state.expiresAt ?? null,
    delivery: state.delivery ?? null,
    issuedAt: state.issuedAt ?? new Date().toISOString(),
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // ignore serialization errors
  }
};

export const loadPendingOtpState = (): PendingOtpState | null => {
  const storage = resolveStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOtpState;
    if (!parsed || !parsed.email) return null;
    return parsed;
  } catch (err) {
    return null;
  }
};

export const clearPendingOtpState = (): void => {
  const storage = resolveStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (err) {
    // ignore removal failures
  }
};
