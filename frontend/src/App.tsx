/* eslint-disable unicode-bom */
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';

// Import components
import HomePage from './pages/HomePage';
import ContactPage from './pages/ContactPage';
import AdminDashboard from './pages/AdminDashboard';
import DevicePortsPage from './pages/DevicePortsPage';
import LogsPage from './pages/LogsPage';
import ThresholdsPage from './pages/ThresholdsPage';
import AdminLoginPage from './pages/admin/AdminLoginPage';
import AdminOTPVerifyPage from './pages/admin/AdminOTPVerifyPage';
import AdminForgotPasswordPage from './pages/admin/AdminForgotPasswordPage';
import AdminResetPasswordPage from './pages/admin/AdminResetPasswordPage';
import AlertsPage from './pages/admin/Alerts';
import SensorLogsPage from './pages/admin/SensorLogsPage';
import UserDashboard from './pages/UserDashboard';

// Import context providers
import { AuthProvider } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import { DarkModeProvider } from './contexts/DarkModeContext';
import { ToastProvider } from './contexts/ToastContext';

// Import components
import ProtectedRoute from './components/ProtectedRoute';
import OnboardingTour from './components/OnboardingTour';
import ToastContainer from './components/ToastContainer';
import tourSteps from './components/OnboardingTour/tourConfig';

function App() {
  return (
    <DarkModeProvider>
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <Router>
              <div className="App">
                <OnboardingTour steps={tourSteps} />
                <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/dashboard" element={<UserDashboard />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/login" element={<Navigate to="/admin/login" replace />} />
                {/* Public admin authentication routes */}
                <Route path="/admin/login" element={<AdminLoginPage />} />
                <Route path="/admin/verify-otp" element={<AdminOTPVerifyPage />} />
                <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
                <Route path="/admin/reset-password" element={<AdminResetPasswordPage />} />
                <Route path="/admin" element={<ProtectedRoute adminOnly><Navigate to="/admin/dashboard" replace /></ProtectedRoute>} />
                {/* Explicit dashboard path kept for compatibility */}
                <Route path="/admin/dashboard" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
                <Route path="/admin/alerts" element={<ProtectedRoute adminOnly><AlertsPage /></ProtectedRoute>} />
                <Route path="/admin/sensor-logs" element={<ProtectedRoute adminOnly><SensorLogsPage /></ProtectedRoute>} />
                <Route path="/admin/devices/:deviceId/ports" element={<ProtectedRoute adminOnly><DevicePortsPage /></ProtectedRoute>} />
                {/* dev-only debug route removed */}
                <Route path="/logs" element={<ProtectedRoute adminOnly><LogsPage /></ProtectedRoute>} />
                <Route path="/thresholds" element={<ProtectedRoute adminOnly><ThresholdsPage /></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" />} />
                </Routes>
                <ToastContainer />
              </div>
            </Router>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>
    </DarkModeProvider>
  );
}export default App;
