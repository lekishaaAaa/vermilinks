import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, AlertCircle, ArrowRight } from 'lucide-react';
import DarkModeToggle from '../../components/DarkModeToggle';
import { login as loginAdmin } from '../../services/adminAuthService';
import { useAuth } from '../../contexts/AuthContext';
import { clearPendingOtpState, savePendingOtpState } from '../../utils/pendingOtp';

const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFormValid = email.trim().length > 0 && password.trim().length > 0;

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    clearPendingOtpState();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isFormValid || isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await loginAdmin(email, password);

      if (response?.data?.requires2FA) {
        const delivery = response?.data?.delivery ?? null;
        const expiresAt = response?.data?.expiresAt || null;

        savePendingOtpState({
          email: email.trim(),
          delivery,
          expiresAt,
        });

        navigate('/admin/verify-otp', {
          state: { email: email.trim(), delivery, expiresAt },
          replace: true,
        });
        return;
      }

      if (response?.success) {
        clearPendingOtpState();
        navigate('/admin/dashboard');
        return;
      }

      setError(response?.message || 'Unexpected response from the server.');
    } catch (err) {
      clearPendingOtpState();
      const message = err instanceof Error ? err.message : 'Unable to sign in. Please try again.';
      setError(message);
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-coffee-100 to-primary-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <DarkModeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 border border-coffee-200 dark:border-gray-700 rounded-2xl shadow-xl px-8 py-10">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-espresso-900 dark:text-white">Admin Login</h1>
            <p className="mt-2 text-sm text-espresso-600 dark:text-gray-300">
              Sign in with your administrator email and password.
            </p>
          </div>

          {error && (
            <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200" role="alert" aria-live="assertive">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-espresso-700 dark:text-gray-300">
                Email
              </label>
              <div className="relative mt-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Mail className="h-5 w-5 text-coffee-400 dark:text-gray-400" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError(null);
                  }}
                  className="block w-full rounded-lg border border-coffee-300 bg-white py-2 pl-11 pr-3 text-gray-900 shadow-sm placeholder:text-espresso-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-400"
                  placeholder="admin@example.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-espresso-700 dark:text-gray-300">
                Password
              </label>
              <div className="relative mt-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-5 w-5 text-coffee-400 dark:text-gray-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError(null);
                  }}
                  className="block w-full rounded-lg border border-coffee-300 bg-white py-2 pl-11 pr-3 text-gray-900 shadow-sm placeholder:text-espresso-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-400"
                  placeholder="Enter your password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="group relative flex w-full items-center justify-center gap-2 rounded-full bg-[#c81e36] px-6 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#b2182e] focus:outline-none focus:ring-2 focus:ring-[#b2182e] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-white"></span>
                  Signing in...
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4" />
                  Sign in
                </>
              )}
            </button>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => navigate('/admin/forgot-password', { state: { email: email.trim() } })}
                className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200"
              >
                Forgot Password?
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminLoginPage;
