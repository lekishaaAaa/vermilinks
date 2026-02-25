import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import ActuatorControls from '../components/ActuatorControls'
import DarkModeToggle from '../components/DarkModeToggle'
import {
  acknowledgeAlert,
  clearAlerts,
  fetchAlerts,
  fetchThresholds,
  updateThresholds,
} from '../services/iotControl'
import type { AlertItem, ThresholdConfig } from '../services/iotControl'

const defaultThresholds: ThresholdConfig = {
  temperatureLow: 18,
  temperatureCriticalLow: 15,
  temperatureHigh: 32,
  temperatureCriticalHigh: 35,
  humidityLow: 45,
  humidityHigh: 75,
}

const severityClass = (level: string) => {
  const normalized = level.toLowerCase()
  if (normalized === 'critical') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200'
  if (normalized === 'high') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
  if (normalized === 'low') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
}

const AdminDashboard = () => {
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [loadingAlerts, setLoadingAlerts] = useState(false)
  const [thresholds, setThresholds] = useState<ThresholdConfig>(defaultThresholds)
  const [savingThresholds, setSavingThresholds] = useState(false)
  const [thresholdError, setThresholdError] = useState<string | null>(null)

  const activeAlerts = useMemo(() => alerts.filter((alert) => alert.active), [alerts])

  const loadAlerts = async () => {
    setLoadingAlerts(true)
    try {
      const data = await fetchAlerts(true)
      setAlerts(data)
    } finally {
      setLoadingAlerts(false)
    }
  }

  const loadThresholds = async () => {
    try {
      const data = await fetchThresholds()
      setThresholds(data)
      setThresholdError(null)
    } catch (error) {
      setThresholds(defaultThresholds)
      setThresholdError('Unable to load thresholds. Using defaults.')
    }
  }

  useEffect(() => {
    loadAlerts()
    loadThresholds()
  }, [])

  const handleAcknowledge = async (id: string) => {
    await acknowledgeAlert(id)
    await loadAlerts()
  }

  const handleClearAll = async () => {
    await clearAlerts()
    await loadAlerts()
  }

  const handleThresholdChange = (field: keyof ThresholdConfig, value: string) => {
    setThresholds((prev) => ({ ...prev, [field]: Number(value) }))
  }

  const handleThresholdSave = async () => {
    setSavingThresholds(true)
    try {
      const updated = await updateThresholds(thresholds)
      setThresholds(updated)
      setThresholdError(null)
    } catch (error) {
      setThresholdError('Failed to save thresholds. Check backend.')
    } finally {
      setSavingThresholds(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-coffee-50 via-white to-primary-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <header className="bg-white/90 dark:bg-gray-900/80 border-b border-coffee-100 dark:border-gray-800 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <Link to="/" className="text-2xl font-bold text-espresso-900 dark:text-white">
              VermiLinks Admin
            </Link>
            <p className="text-sm text-espresso-500 dark:text-gray-400">Actuators, alerts, and thresholds.</p>
          </div>
          <div className="flex items-center gap-4">
            <DarkModeToggle />
            <Link to="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-coffee-200 text-sm font-semibold text-espresso-700 hover:bg-coffee-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              <ArrowLeft className="h-4 w-4" /> Back to site
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <section className="bg-white/80 dark:bg-gray-900/70 border border-coffee-100 dark:border-gray-800 rounded-2xl shadow-sm p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Control center</p>
              <h1 className="text-3xl font-black text-espresso-900 dark:text-white">Admin Dashboard</h1>
              <p className="text-espresso-600 dark:text-gray-300 mt-2 max-w-2xl">
                Manage actuator states and review critical alerts in real time.
              </p>
            </div>
            <button
              type="button"
              onClick={loadAlerts}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-primary-200 text-primary-700 hover:bg-primary-50"
            >
              <RefreshCw className={`h-4 w-4 ${loadingAlerts ? 'animate-spin' : ''}`} />
              Refresh alerts
            </button>
          </div>
        </section>

        <ActuatorControls />

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Alerts</p>
                <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Active Alerts</h2>
              </div>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-300"
              >
                Clear all
              </button>
            </div>
            {activeAlerts.length === 0 ? (
              <p className="mt-4 text-sm text-espresso-500 dark:text-gray-400">No active alerts.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {activeAlerts.map((alert) => (
                  <li key={alert._id} className="rounded-xl border border-coffee-100/80 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-espresso-800 dark:text-gray-100">{alert.message}</p>
                        <p className="text-xs text-espresso-500 dark:text-gray-400">{alert.type}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityClass(alert.level)}`}>
                        {alert.level}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-espresso-500 dark:text-gray-400">
                      <span>{alert.lastSeen ? new Date(alert.lastSeen).toLocaleString() : 'Just now'}</span>
                      <button
                        type="button"
                        onClick={() => handleAcknowledge(alert._id)}
                        className="text-emerald-700 hover:text-emerald-800 dark:text-emerald-200"
                      >
                        Acknowledge
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Thresholds</p>
                <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Alert Configuration</h2>
              </div>
            </div>
            {thresholdError && (
              <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{thresholdError}</p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-espresso-600 dark:text-gray-300">
                Temp Low (C)
                <input
                  className="mt-2 w-full rounded-lg border border-coffee-200 bg-white px-3 py-2 text-sm text-espresso-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                  type="number"
                  value={thresholds.temperatureLow}
                  onChange={(event) => handleThresholdChange('temperatureLow', event.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-espresso-600 dark:text-gray-300">
                Temp Critical Low (C)
                <input
                  className="mt-2 w-full rounded-lg border border-coffee-200 bg-white px-3 py-2 text-sm text-espresso-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                  type="number"
                  value={thresholds.temperatureCriticalLow}
                  onChange={(event) => handleThresholdChange('temperatureCriticalLow', event.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-espresso-600 dark:text-gray-300">
                Temp High (C)
                <input
                  className="mt-2 w-full rounded-lg border border-coffee-200 bg-white px-3 py-2 text-sm text-espresso-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                  type="number"
                  value={thresholds.temperatureHigh}
                  onChange={(event) => handleThresholdChange('temperatureHigh', event.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-espresso-600 dark:text-gray-300">
                Temp Critical High (C)
                <input
                  className="mt-2 w-full rounded-lg border border-coffee-200 bg-white px-3 py-2 text-sm text-espresso-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                  type="number"
                  value={thresholds.temperatureCriticalHigh}
                  onChange={(event) => handleThresholdChange('temperatureCriticalHigh', event.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-espresso-600 dark:text-gray-300">
                Humidity Low (%)
                <input
                  className="mt-2 w-full rounded-lg border border-coffee-200 bg-white px-3 py-2 text-sm text-espresso-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                  type="number"
                  value={thresholds.humidityLow}
                  onChange={(event) => handleThresholdChange('humidityLow', event.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-espresso-600 dark:text-gray-300">
                Humidity High (%)
                <input
                  className="mt-2 w-full rounded-lg border border-coffee-200 bg-white px-3 py-2 text-sm text-espresso-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                  type="number"
                  value={thresholds.humidityHigh}
                  onChange={(event) => handleThresholdChange('humidityHigh', event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={handleThresholdSave}
              disabled={savingThresholds}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#c81e36] px-5 py-2 text-sm font-semibold text-white shadow hover:bg-[#b2182e] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {savingThresholds ? 'Saving...' : 'Save thresholds'}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

export default AdminDashboard
