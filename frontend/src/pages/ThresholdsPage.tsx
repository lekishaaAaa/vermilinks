import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import DarkModeToggle from '../components/DarkModeToggle';

type Thresholds = {
  temperature: { warning: number; critical: number };
  humidity: { warning: number; critical: number };
  moisture: { warning: number; critical: number };
  ph: { min: number; max: number };
  ec: { max: number };
  batteryLevel: { warning: number; critical: number };
  waterLevel: { min: number };
};

export default function ThresholdsPage() {
  const { user, isAuthenticated } = useAuth();
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'admin') return;
    loadThresholds();
  }, [isAuthenticated, user]);

  async function loadThresholds() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data?.thresholds) {
          setThresholds(data.data.thresholds);
        }
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function saveThresholds() {
    if (!thresholds) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/settings/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thresholds),
      });
      if (res.ok) {
        setMessage('Thresholds updated successfully');
      } else {
        setMessage('Failed to update thresholds');
      }
    } catch (e) {
      setMessage('Error updating thresholds');
    } finally {
      setSaving(false);
    }
  }

  if (!isAuthenticated || user?.role !== 'admin') {
    return <Navigate to="/admin/login" replace />;
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!thresholds) {
    return <div className="min-h-screen flex items-center justify-center">Error loading thresholds</div>;
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-4 z-30 mb-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between p-4 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm shadow">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Threshold Management</h1>
          <DarkModeToggle />
        </div>
      </header>

      <main className="max-w-4xl mx-auto">
        <div className="p-6 rounded-xl bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm shadow border border-white/50 dark:border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Alert Thresholds</h2>
          {message && (
            <div className="mb-4 p-3 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
              {message}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-md font-medium text-gray-700 dark:text-gray-200 mb-3">External Temperature (°C)</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Warning:</label>
                  <input
                    type="number"
                    value={thresholds.temperature.warning}
                    onChange={e => setThresholds(prev => prev ? { ...prev, temperature: { ...prev.temperature, warning: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Critical:</label>
                  <input
                    type="number"
                    value={thresholds.temperature.critical}
                    onChange={e => setThresholds(prev => prev ? { ...prev, temperature: { ...prev.temperature, critical: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Humidity thresholds removed */}

            <div>
              <h3 className="text-md font-medium text-gray-700 dark:text-gray-200 mb-3">Moisture (%)</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Warning:</label>
                  <input
                    type="number"
                    value={thresholds.moisture.warning}
                    onChange={e => setThresholds(prev => prev ? { ...prev, moisture: { ...prev.moisture, warning: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Critical:</label>
                  <input
                    type="number"
                    value={thresholds.moisture.critical}
                    onChange={e => setThresholds(prev => prev ? { ...prev, moisture: { ...prev.moisture, critical: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-md font-medium text-gray-700 dark:text-gray-200 mb-3">pH</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Min:</label>
                  <input
                    type="number"
                    step="0.1"
                    value={thresholds.ph.min}
                    onChange={e => setThresholds(prev => prev ? { ...prev, ph: { ...prev.ph, min: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Max:</label>
                  <input
                    type="number"
                    step="0.1"
                    value={thresholds.ph.max}
                    onChange={e => setThresholds(prev => prev ? { ...prev, ph: { ...prev.ph, max: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-md font-medium text-gray-700 dark:text-gray-200 mb-3">EC (mS/cm)</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Max:</label>
                  <input
                    type="number"
                    step="0.1"
                    value={thresholds.ec.max}
                    onChange={e => setThresholds(prev => prev ? { ...prev, ec: { ...prev.ec, max: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-md font-medium text-gray-700 dark:text-gray-200 mb-3">Battery Level (%)</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Warning:</label>
                  <input
                    type="number"
                    value={thresholds.batteryLevel.warning}
                    onChange={e => setThresholds(prev => prev ? { ...prev, batteryLevel: { ...prev.batteryLevel, warning: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Critical:</label>
                  <input
                    type="number"
                    value={thresholds.batteryLevel.critical}
                    onChange={e => setThresholds(prev => prev ? { ...prev, batteryLevel: { ...prev.batteryLevel, critical: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-md font-medium text-gray-700 dark:text-gray-200 mb-3">Water Level (%)</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm w-16">Min:</label>
                  <input
                    type="number"
                    value={thresholds.waterLevel.min}
                    onChange={e => setThresholds(prev => prev ? { ...prev, waterLevel: { ...prev.waterLevel, min: +e.target.value } } : null)}
                    className="px-2 py-1 rounded border bg-white/80 dark:bg-gray-700/60 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <button
              onClick={saveThresholds}
              disabled={saving}
              className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Thresholds'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
