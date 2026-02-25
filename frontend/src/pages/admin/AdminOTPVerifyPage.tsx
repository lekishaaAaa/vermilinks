import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, KeyRound } from 'lucide-react';
import DarkModeToggle from '../../components/DarkModeToggle';
import { useAuth } from '../../contexts/AuthContext';
import { getSession, resendOtp, verifyOtp } from '../../services/adminAuthService';
import { clearPendingOtpState, loadPendingOtpState, savePendingOtpState } from '../../utils/pendingOtp';

interface LocationState {
  email?: string;
  delivery?: string | null;
  expiresAt?: string | null;
}

const AdminOTPVerifyPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth, isAuthenticated } = useAuth();
  const locationState = (location.state as LocationState) || {};
  const storedOtpState = useMemo(() => loadPendingOtpState(), []);
  const initialEmail = locationState.email || storedOtpState?.email || '';
  const initialExpiresAt = locationState.expiresAt || storedOtpState?.expiresAt || null;
  const [email] = useState<string>(initialEmail);
  const [delivery, setDelivery] = useState<string | null>(locationState.delivery ?? storedOtpState?.delivery ?? null);
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(initialExpiresAt);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const [resendRemaining, setResendRemaining] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(() => {
    if (!initialExpiresAt) return 0;
    const diff = new Date(initialExpiresAt).getTime() - Date.now();
    return diff > 0 ? diff : 0;
  });

  const formattedEmail = useMemo(() => email.trim(), [email]);
  const otpIsExpired = useMemo(() => Boolean(otpExpiresAt && remainingMs <= 0), [otpExpiresAt, remainingMs]);

  const formatCountdown = (ms: number) => {
    const totalSeconds = Math.max(Math.ceil(ms / 1000), 0);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!formattedEmail) {
      navigate('/admin/login', { replace: true });
    }
  }, [formattedEmail, navigate]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!otpExpiresAt) {
      setRemainingMs(0);
      return undefined;
    }

    const interval = window.setInterval(() => {
      const diff = new Date(otpExpiresAt).getTime() - Date.now();
      setRemainingMs(diff > 0 ? diff : 0);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [otpExpiresAt]);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const isFormValid = otp.trim().length === 6 && /^\d{6}$/.test(otp.trim());

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isFormValid || isSubmitting || !formattedEmail) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await verifyOtp(formattedEmail, otp.trim());
      const token = response?.data?.token;
      const refreshToken = response?.data?.refreshToken;

      if (!token || !refreshToken) {
        setError('Unexpected response from the server.');
        return;
      }

      let user = response?.data?.user || null;
      try {
        const sessionResp = await getSession(token);
        if (sessionResp?.data?.user) {
          user = sessionResp.data.user;
        }
      } catch (sessionErr) {
        console.debug('OTP session probe failed', sessionErr instanceof Error ? sessionErr.message : sessionErr);
      }

      if (typeof setAuth === 'function') {
        if (user) {
          setAuth(token, user, { refreshToken });
        } else {
          setAuth(token, undefined, { refreshToken });
        }
      }

      clearPendingOtpState();
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to verify the code. Please try again.';
      setError(message);
      setOtp('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!formattedEmail || isResending || resendCooldown > 0) {
      return;
    }

    setError(null);
    setInfoMessage(null);
    setIsResending(true);

    try {
      const response = await resendOtp(formattedEmail);
      const nextDelivery = response?.data?.delivery ?? null;
      const nextExpires = response?.data?.expiresAt ?? null;
      const rateLimit = response?.data?.rateLimit;

      setDelivery(nextDelivery);
      if (nextExpires) {
        setOtpExpiresAt(nextExpires);
        const diff = new Date(nextExpires).getTime() - Date.now();
        setRemainingMs(diff > 0 ? diff : 0);
      }

      savePendingOtpState({
        email: formattedEmail,
        delivery: nextDelivery,
        expiresAt: nextExpires,
      });

      if (rateLimit) {
        if (typeof rateLimit.remaining === 'number') {
          setResendRemaining(rateLimit.remaining);
        }
        if (rateLimit.retryAfterSeconds) {
          setResendCooldown(Math.max(Math.ceil(rateLimit.retryAfterSeconds), 0));
        }
        if (rateLimit.locked && rateLimit.retryAfterMs && !rateLimit.retryAfterSeconds) {
          setResendCooldown(Math.max(Math.ceil(rateLimit.retryAfterMs / 1000), 0));
        }
      } else {
        setResendRemaining(null);
        setResendCooldown(0);
      }

      if (response?.message) {
        setInfoMessage(response.message);
      } else {
        setInfoMessage('A new verification code has been issued.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to resend the code. Please try again.';
      setError(message);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-coffee-100 to-primary-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <DarkModeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-coffee-200 bg-white px-8 py-10 shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-espresso-900 dark:text-white">Verify OTP</h1>
              <p className="mt-2 text-sm text-espresso-600 dark:text-gray-300">
                Enter the 6-digit code we sent to {formattedEmail || 'your email'}.
              </p>
              {otpExpiresAt && (
                <p className="mt-1 text-xs font-medium text-primary-700 dark:text-primary-300">
                  {otpIsExpired ? 'Code expired. Please request a new one.' : `Code expires in ${formatCountdown(remainingMs)}.`}
                </p>
              )}
            {delivery === 'email_failed' && (
              <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-300">
                Email delivery failed. Check the backend logs for the one-time code.
              </p>
            )}
          </div>

          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-6 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200"
            >
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          )}

          {infoMessage && !error && (
            <div
              role="status"
              aria-live="polite"
              className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-200"
            >
              {infoMessage}
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="otp" className="block text-sm font-medium text-espresso-700 dark:text-gray-300">
                One-Time Passcode
              </label>
              <div className="relative mt-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <KeyRound className="h-5 w-5 text-coffee-400 dark:text-gray-400" />
                </div>
                <input
                  id="otp"
                  name="otp"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoFocus
                  required
                  value={otp}
                  onChange={(event) => {
                    const value = event.target.value.replace(/[^0-9]/g, '');
                    setOtp(value);
                    if (error) setError(null);
                  }}
                  className="block w-full rounded-lg border border-coffee-300 bg-white py-2 pl-11 pr-3 text-gray-900 shadow-sm placeholder:text-espresso-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-400"
                  placeholder="Enter 6-digit code"
                />
              </div>
              <p className="mt-2 text-xs text-espresso-500 dark:text-gray-400">
                The code expires in a few minutes. Request a new one if the countdown reaches zero.
              </p>
            </div>

            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="group relative flex w-full items-center justify-center gap-2 rounded-full bg-[#c81e36] px-6 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#b2182e] focus:outline-none focus:ring-2 focus:ring-[#b2182e] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-white"></span>
                  Verifying...
                </span>
              ) : (
                'Verify OTP'
              )}
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={!formattedEmail || isResending || resendCooldown > 0}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-coffee-300 px-6 py-3 text-sm font-semibold text-espresso-700 transition-colors duration-200 hover:border-coffee-400 hover:text-espresso-900 focus:outline-none focus:ring-2 focus:ring-coffee-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:text-white"
            >
              {isResending ? 'Resending…' : resendCooldown > 0 ? `Resend Available In ${resendCooldown}s` : 'Resend Code'}
            </button>
            {typeof resendRemaining === 'number' && (
              <p className="text-center text-xs text-espresso-500 dark:text-gray-400">
                Resends remaining in this window: {Math.max(resendRemaining, 0)}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminOTPVerifyPage;
