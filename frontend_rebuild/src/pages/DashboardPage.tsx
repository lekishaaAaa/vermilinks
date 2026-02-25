import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import ActuatorControls from '../components/ActuatorControls'
import DarkModeToggle from '../components/DarkModeToggle'
import { fetchAlerts } from '../services/iotControl'
import type { AlertItem } from '../services/iotControl'

const DashboardPage = () => {
  const [alerts, setAlerts] = useState<AlertItem[]>([])

  useEffect(() => {
    const loadAlerts = async () => {
      try {
        const data = await fetchAlerts(true)
        setAlerts(data.slice(0, 6))
      } catch (error) {
        setAlerts([])
      }
    }
    loadAlerts()
  }, [])
  return (
    <div className="min-h-screen bg-gradient-to-br from-coffee-50 via-white to-primary-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <header className="bg-white/90 dark:bg-gray-900/80 border-b border-coffee-100 dark:border-gray-800 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <Link to="/" className="text-2xl font-bold text-espresso-900 dark:text-white">
              VermiLinks Dashboard
            </Link>
            <p className="text-sm text-espresso-500 dark:text-gray-400">Live telemetry and actuator control center.</p>
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
              <h1 className="text-3xl font-black text-espresso-900 dark:text-white">System Overview</h1>
              <p className="text-espresso-600 dark:text-gray-300 mt-2 max-w-2xl">
                Monitor sensor telemetry and command the water pump and solenoid valve directly from this dashboard.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 text-sm text-espresso-600 dark:text-gray-300">
              <span>Last update: <strong>Awaiting backend</strong></span>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-primary-200 text-primary-700 hover:bg-primary-50"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh data
              </button>
            </div>
          </div>
        </section>

        <ActuatorControls />

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Telemetry</p>
                <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Sensors</h2>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Waiting for data
              </span>
            </div>
            <p className="mt-4 text-sm text-espresso-500 dark:text-gray-400">
              Live telemetry cards will appear once the sensor API is connected.
            </p>
          </div>

          <div className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">System status</p>
                <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Hardware Health</h2>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Monitoring
              </span>
            </div>
            <p className="mt-4 text-sm text-espresso-500 dark:text-gray-400">
              This panel will summarize device status once backend health checks are wired up.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Alerts</p>
              <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Latest Warnings</h2>
            </div>
            <span className="text-xs text-espresso-500 dark:text-gray-400">Read-only</span>
          </div>
          {alerts.length === 0 ? (
            <p className="mt-4 text-sm text-espresso-500 dark:text-gray-400">No active alerts.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {alerts.map((alert) => (
                <li key={alert._id} className="rounded-xl border border-coffee-100/80 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-4">
                  <p className="text-sm font-semibold text-espresso-800 dark:text-gray-100">{alert.message}</p>
                  <p className="text-xs text-espresso-500 dark:text-gray-400">{alert.level} • {alert.type}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white/80 dark:bg-gray-900/70 border border-coffee-100 dark:border-gray-800 rounded-2xl p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-xl font-bold text-espresso-900 dark:text-white">Ready to expand?</h3>
            <p className="text-sm text-espresso-600 dark:text-gray-300">Add irrigation schedules, alerts, and data exports when the backend is ready.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/" className="inline-flex items-center gap-2 rounded-full border border-coffee-200 px-4 py-2 text-sm font-semibold text-espresso-700 hover:bg-coffee-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              <ArrowLeft className="h-4 w-4" /> Back to site
            </Link>
            <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-full bg-[#c81e36] px-4 py-2 text-sm font-semibold text-white shadow hover:bg-[#b2182e]">
              Stay in dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}

export default DashboardPage
