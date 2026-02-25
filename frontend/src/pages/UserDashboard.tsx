import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Activity, ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import RealtimeTelemetryPanel from '../components/RealtimeTelemetryPanel';
import DarkModeToggle from '../components/DarkModeToggle';
import { useData } from '../contexts/DataContext';
import DataSuppressedNotice from '../components/DataSuppressedNotice';
import { DATA_SUPPRESSED, suppressionReason } from '../utils/dataSuppression';
import { sensorService } from '../services/api';

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleString();
  } catch (err) {
    return value;
  }
};

const UserDashboard: React.FC = () => {
  const {
    latestTelemetry,
    latestSensorData,
    isConnected,
    refreshTelemetry,
    recentAlerts,
    alertSummary,
    groupedAlerts,
    lastFetchAt,
    lastFetchError,
    isLoading,
    telemetryDisabled,
  } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [dailySummary, setDailySummary] = useState<Record<string, number | string | null> | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);

  const condensedAlerts = useMemo(() => {
    if (recentAlerts?.length) {
      return recentAlerts.slice(0, 5);
    }
    const combined = [
      ...(groupedAlerts?.critical || []),
      ...(groupedAlerts?.warning || []),
      ...(groupedAlerts?.info || []),
    ];
    return combined.slice(0, 5);
  }, [recentAlerts, groupedAlerts]);

  const handleRefresh = async () => {
    if (telemetryDisabled) {
      return;
    }
    setRefreshing(true);
    try {
      await refreshTelemetry({ background: true });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const loadDaily = async () => {
      if (!selectedDate) {
        return;
      }
      setDailyLoading(true);
      setDailyError(null);
      try {
        const response = await sensorService.getDaily({ date: selectedDate });
        const payload = response?.data?.data;
        if (!mounted) return;
        setDailySummary((payload && payload.stats) ? payload.stats : {});
      } catch (error) {
        if (!mounted) return;
        setDailySummary(null);
        setDailyError('Unable to load daily readings for the selected date.');
      } finally {
        if (mounted) {
          setDailyLoading(false);
        }
      }
    };
    loadDaily();
    return () => {
      mounted = false;
    };
  }, [selectedDate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-coffee-50 via-white to-primary-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <header className="bg-white/90 dark:bg-gray-900/80 border-b border-coffee-100 dark:border-gray-800 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <Link to="/" className="text-2xl font-bold text-espresso-900 dark:text-white">
              VermiLinks Dashboard
            </Link>
            <p className="text-sm text-espresso-500 dark:text-gray-400">Live telemetry for students, researchers, and guests.</p>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/admin/login" className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-coffee-200 text-sm font-semibold text-espresso-700 hover:bg-coffee-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              <ArrowRight className="h-4 w-4" /> Admin Login
            </Link>
            <DarkModeToggle />
          </div>
        </div>
      </header>

      {DATA_SUPPRESSED ? (
        <main className="max-w-6xl mx-auto px-6 py-10">
          <DataSuppressedNotice title="Public dashboard is offline" instructions={suppressionReason} />
        </main>
      ) : (
      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <section className="bg-white/80 dark:bg-gray-900/70 border border-coffee-100 dark:border-gray-800 rounded-2xl shadow-sm p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Live overview</p>
              <h1 className="text-3xl font-black text-espresso-900 dark:text-white">Community Sensor Dashboard</h1>
              <p className="text-espresso-600 dark:text-gray-300 mt-2 max-w-2xl">
                Monitor temperature, water level, and more in real-time. This dashboard stays read-only so students and guests can safely follow along without admin credentials.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 text-sm text-espresso-600 dark:text-gray-300">
              <span>Last update: <strong>{formatTimestamp(lastFetchAt)}</strong></span>
              {lastFetchError ? (
                <span className="text-red-600 dark:text-red-300">{lastFetchError}</span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-300">Connection {isConnected ? 'healthy' : 'pending data'}</span>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || telemetryDisabled}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border ${(refreshing || telemetryDisabled) ? 'cursor-not-allowed border-gray-200 text-gray-400' : 'border-primary-200 text-primary-700 hover:bg-primary-50'}`}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh data
              </button>
            </div>
          </div>
        </section>

        <RealtimeTelemetryPanel
          latest={latestTelemetry}
          history={latestSensorData}
          isConnected={isConnected}
          onRefresh={handleRefresh}
          refreshing={refreshing || isLoading}
          telemetryDisabled={telemetryDisabled}
        />

        <section className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Daily readings</p>
              <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Calendar-based summary</h2>
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="rounded-lg border border-coffee-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-espresso-800 dark:text-gray-100"
            />
          </div>
          {dailyLoading ? (
            <p className="mt-4 text-sm text-espresso-500 dark:text-gray-400">Loading daily summary...</p>
          ) : dailyError ? (
            <p className="mt-4 text-sm text-red-600 dark:text-red-300">{dailyError}</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-coffee-100 dark:border-gray-700 p-3">
                <p className="text-xs text-espresso-500 dark:text-gray-400">Avg Temperature</p>
                <p className="text-lg font-bold text-espresso-900 dark:text-white">{dailySummary?.avgTemperature ?? '-'}</p>
              </div>
              <div className="rounded-xl border border-coffee-100 dark:border-gray-700 p-3">
                <p className="text-xs text-espresso-500 dark:text-gray-400">Avg Humidity</p>
                <p className="text-lg font-bold text-espresso-900 dark:text-white">{dailySummary?.avgHumidity ?? '-'}</p>
              </div>
              <div className="rounded-xl border border-coffee-100 dark:border-gray-700 p-3">
                <p className="text-xs text-espresso-500 dark:text-gray-400">Avg Moisture</p>
                <p className="text-lg font-bold text-espresso-900 dark:text-white">{dailySummary?.avgMoisture ?? '-'}</p>
              </div>
              <div className="rounded-xl border border-coffee-100 dark:border-gray-700 p-3">
                <p className="text-xs text-espresso-500 dark:text-gray-400">Avg Soil Temp</p>
                <p className="text-lg font-bold text-espresso-900 dark:text-white">{dailySummary?.avgSoilTemperature ?? '-'}</p>
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Alert summary</p>
                <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">System Health</h2>
              </div>
              <Activity className="h-8 w-8 text-primary-600 dark:text-primary-300" />
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-900/20 p-4">
                <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-300">{alertSummary.critical ?? 0}</p>
                <p className="text-xs uppercase tracking-wide text-emerald-600 dark:text-emerald-200">Critical</p>
              </div>
              <div className="rounded-xl border border-amber-100 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-900/20 p-4">
                <p className="text-3xl font-bold text-amber-700 dark:text-amber-300">{alertSummary.warning ?? 0}</p>
                <p className="text-xs uppercase tracking-wide text-amber-600 dark:text-amber-200">Warnings</p>
              </div>
              <div className="rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-900/20 p-4">
                <p className="text-3xl font-bold text-blue-700 dark:text-blue-200">{alertSummary.info ?? 0}</p>
                <p className="text-xs uppercase tracking-wide text-blue-600 dark:text-blue-200">Info</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-espresso-500 dark:text-gray-400">
              Last alert logged: <strong>{formatTimestamp(alertSummary.lastAlertAt)}</strong>
            </p>
          </div>

          <div className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Recent events</p>
                <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Latest Alerts</h2>
              </div>
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            </div>
            {condensedAlerts.length === 0 ? (
              <p className="mt-6 text-sm text-espresso-500 dark:text-gray-400">No alerts yet. Sensors are within acceptable ranges.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {condensedAlerts.map((alert, index) => (
                  <li key={(alert as any)._id || index} className="rounded-xl border border-coffee-100/80 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-4">
                    <p className="text-sm font-semibold text-espresso-800 dark:text-gray-100">
                      {alert?.title || alert?.type || 'Sensor Alert'}
                    </p>
                    <p className="text-xs text-espresso-500 dark:text-gray-400">{alert?.message || 'Threshold exceeded'}</p>
                    <p className="text-xs text-espresso-400 dark:text-gray-500 mt-1">{formatTimestamp(alert?.createdAt as string)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="bg-white/80 dark:bg-gray-900/70 border border-coffee-100 dark:border-gray-800 rounded-2xl p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-xl font-bold text-espresso-900 dark:text-white">Need deeper control?</h3>
            <p className="text-sm text-espresso-600 dark:text-gray-300">Administrators can access actuator controls, OTA commands, and audit logs via the secure portal.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/" className="inline-flex items-center gap-2 rounded-full border border-coffee-200 px-4 py-2 text-sm font-semibold text-espresso-700 hover:bg-coffee-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              <ArrowLeft className="h-4 w-4" /> Back to site
            </Link>
            <Link to="/admin/login" className="inline-flex items-center gap-2 rounded-full bg-[#c81e36] px-4 py-2 text-sm font-semibold text-white shadow hover:bg-[#b2182e]">
              Go to Admin <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
      )}
    </div>
  );
};

export default UserDashboard;
