import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLatest, sendControl } from '../services/iotControl'
import type { ActuatorState, DeviceState, PendingCommand } from '../services/iotControl'
import { getSocket } from '../socket'

const defaultState: ActuatorState = {
  pump: false,
  valve1: false,
  valve2: false,
  valve3: false,
}

const buildDefaultDeviceState = (): DeviceState => ({
  pump: false,
  valve1: false,
  valve2: false,
  valve3: false,
  float: null,
  online: false,
  lastSeen: null,
  requestId: null,
  source: null,
  ts: null,
})

const formatStatus = (value: boolean) => (value ? 'On' : 'Off')

const ActuatorControls = () => {
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null)
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null)
  const [confirmedState, setConfirmedState] = useState<ActuatorState>(defaultState)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const pendingTimeoutRef = useRef<number | null>(null)

  const loadLatest = useCallback(async () => {
    try {
      const latest = await fetchLatest()
      setDeviceState(latest.deviceState)
      setPendingCommand(latest.pendingCommand)
      setLoading(Boolean(latest.pendingCommand))
      if (latest.deviceState) {
        setConfirmedState({
          pump: Boolean(latest.deviceState.pump),
          valve1: Boolean(latest.deviceState.valve1),
          valve2: Boolean(latest.deviceState.valve2),
          valve3: Boolean(latest.deviceState.valve3),
        })
      }
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage('Unable to load actuator state.')
    }
  }, [])

  useEffect(() => {
    loadLatest()
  }, [loadLatest])

  useEffect(() => {
    const socket = getSocket()

    const handleState = (payload: DeviceState & { requestId?: string | null }) => {
      setDeviceState((prev) => ({ ...buildDefaultDeviceState(), ...prev, ...payload }))
      setConfirmedState({
        pump: Boolean(payload.pump),
        valve1: Boolean(payload.valve1),
        valve2: Boolean(payload.valve2),
        valve3: Boolean(payload.valve3),
      })

      if (payload.requestId && pendingCommand?.requestId === payload.requestId) {
        setPendingCommand(null)
        setLoading(false)
        setErrorMessage(null)
      }
    }

    const handleStatus = (payload: { deviceId?: string; online?: boolean }) => {
      if (payload.deviceId && payload.deviceId !== 'esp32a') {
        return
      }
      setDeviceState((prev) => ({ ...buildDefaultDeviceState(), ...prev, online: Boolean(payload.online) }))
    }

    socket.on('actuator:state', handleState)
    socket.on('device:status', handleStatus)

    return () => {
      socket.off('actuator:state', handleState)
      socket.off('device:status', handleStatus)
    }
  }, [pendingCommand?.requestId])

  useEffect(() => {
    return () => {
      if (pendingTimeoutRef.current) {
        window.clearTimeout(pendingTimeoutRef.current)
      }
    }
  }, [])

  const handleToggle = async (key: keyof ActuatorState) => {
    if (loading) return
    if (key === 'pump' && floatLow) return

    const nextState = { ...confirmedState, [key]: !confirmedState[key] }
    setLoading(true)
    setErrorMessage(null)

    try {
      const result = await sendControl(nextState)
      setPendingCommand({ requestId: result.requestId, status: 'sent' })

      if (pendingTimeoutRef.current) {
        window.clearTimeout(pendingTimeoutRef.current)
      }
      pendingTimeoutRef.current = window.setTimeout(() => {
        setLoading(false)
        setErrorMessage('No confirmation from device. Please retry.')
      }, 12000)
    } catch (error) {
      setErrorMessage('Failed to send command. Check backend connectivity.')
      setLoading(false)
    } finally {
      // Keep loading until confirmation arrives or timeout triggers.
    }
  }

  const online = deviceState?.online ?? false
  const updatedAt = deviceState?.lastSeen ? new Date(deviceState.lastSeen).toLocaleString() : 'No state yet'
  const floatLow = (deviceState?.float || '').toString().toUpperCase() === 'LOW'

  return (
    <section className="rounded-2xl border border-gray-100 bg-white/80 p-6 shadow dark:border-gray-800 dark:bg-gray-900/60">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Actuator Controls</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Pump and solenoid valve controls now live in the frontend.</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${online ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'}`}>
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {online ? 'Device online' : 'Device offline'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(['pump', 'valve1', 'valve2', 'valve3'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => handleToggle(key)}
            disabled={loading || !online || (key === 'pump' && floatLow)}
            className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${loading || !online ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-500' : confirmedState[key] ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200'}`}
          >
            <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {key === 'pump' ? 'Water Pump' : `Solenoid ${key.replace('valve', '')}`}
            </span>
            <span className="text-xl font-bold">{formatStatus(confirmedState[key])}</span>
            {key === 'pump' && floatLow && (
              <span className="text-xs text-rose-600 dark:text-rose-300">Pump locked (float LOW)</span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400 md:flex-row md:items-center md:justify-between">
        <span>Last update: {updatedAt}</span>
        {pendingCommand?.requestId && (
          <span className="text-amber-600 dark:text-amber-300">Awaiting confirmation: {pendingCommand.requestId}</span>
        )}
      </div>

      {errorMessage && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
          {errorMessage}
        </div>
      )}
    </section>
  )
}

export default ActuatorControls
