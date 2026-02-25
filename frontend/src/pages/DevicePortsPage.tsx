import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Plug, RefreshCw } from 'lucide-react';
import HeaderFrame from '../components/layout/HeaderFrame';
import { DevicePort } from '../types';
import { assignPort, enumeratePorts, listSavedPorts, EnumeratePortsMeta } from '../services/devicePorts';

interface FormState {
  port_name: string;
  port_type: string;
  baud_rate: string;
  sensor_id: string;
  purpose: string;
  notes: string;
}

const ALLOWED_PORT_TYPES = ['UART', 'I2C', 'GPIO', 'SPI', 'OTHER'];

const DevicePortsPage: React.FC = () => {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();

  const [ports, setPorts] = useState<DevicePort[]>([]);
  const [meta, setMeta] = useState<EnumeratePortsMeta & Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [enumerating, setEnumerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedPort, setSelectedPort] = useState<DevicePort | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formState, setFormState] = useState<FormState>({
    port_name: '',
    port_type: ALLOWED_PORT_TYPES[0],
    baud_rate: '',
    sensor_id: '',
    purpose: '',
    notes: '',
  });

  const handleToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timeout);
  }, [toast]);

  const loadPorts = useCallback(async () => {
    if (!deviceId) {
      setError('Device id missing in route');
      setPorts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await enumeratePorts(deviceId);
      setPorts(response.ports);
  setMeta((response.meta || {}) as EnumeratePortsMeta & Record<string, unknown>);
    } catch (primaryError) {
      console.warn('Enumerate ports failed, falling back to saved ports', primaryError);
      setError('Live enumeration unavailable. Showing last saved configuration.');
      try {
  const fallback = await listSavedPorts(deviceId);
        setPorts(fallback);
  setMeta({ fallback: true } as EnumeratePortsMeta & Record<string, unknown>);
      } catch (fallbackError) {
        console.error('Failed to load saved ports', fallbackError);
        setPorts([]);
      }
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    loadPorts();
  }, [loadPorts]);

  const openAssignModal = (port?: DevicePort | null) => {
    const nextPort = port || null;
    setSelectedPort(nextPort);
    setFormState({
      port_name: nextPort?.port_name || '',
      port_type: nextPort?.port_type || ALLOWED_PORT_TYPES[0],
      baud_rate: nextPort?.baud_rate ? String(nextPort.baud_rate) : '',
      sensor_id: nextPort?.metadata?.assignment?.sensor_id ? String(nextPort.metadata.assignment.sensor_id) : '',
      purpose: nextPort?.metadata?.assignment?.purpose || '',
      notes: nextPort?.metadata?.notes || '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedPort(null);
    setFormState({
      port_name: '',
      port_type: ALLOWED_PORT_TYPES[0],
      baud_rate: '',
      sensor_id: '',
      purpose: '',
      notes: '',
    });
  };

  const handleEnumerate = async () => {
    if (!deviceId) return;
    setEnumerating(true);
    try {
      await loadPorts();
      handleToast('success', 'Enumeration request sent.');
    } catch (err) {
      handleToast('error', 'Unable to enumerate ports.');
    } finally {
      setEnumerating(false);
    }
  };

  const updateField = (key: keyof FormState, value: string) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!deviceId) {
      handleToast('error', 'Missing device id');
      return;
    }

    const trimmedName = formState.port_name.trim();
    if (!trimmedName) {
      handleToast('error', 'Port name is required');
      return;
    }

    const payload: Record<string, unknown> = {
      port_name: trimmedName,
      port_type: formState.port_type,
    };

    if (formState.baud_rate) {
      const parsedBaud = Number(formState.baud_rate);
      if (!Number.isFinite(parsedBaud) || parsedBaud <= 0) {
        handleToast('error', 'Baud rate must be a positive number');
        return;
      }
      payload.baud_rate = parsedBaud;
    }

    const assignment: Record<string, unknown> = {};
    if (formState.sensor_id) {
      const numericSensor = Number(formState.sensor_id);
      assignment.sensor_id = Number.isFinite(numericSensor) ? numericSensor : formState.sensor_id;
    }
    if (formState.purpose) {
      assignment.purpose = formState.purpose.trim();
    }
    if (Object.keys(assignment).length > 0) {
      payload.assignment = assignment;
    }

    const metadata: Record<string, unknown> = {};
    if (formState.notes) {
      metadata.notes = formState.notes.trim();
    }
    if (Object.keys(metadata).length > 0) {
      payload.metadata = metadata;
    }

    setSaving(true);
    try {
      const saved = await assignPort(deviceId, payload);
      handleToast('success', `Port ${saved.port_name} saved`);
      closeModal();
      await loadPorts();
    } catch (err) {
      console.error('Failed to save port assignment', err);
      handleToast('error', 'Failed to save port assignment');
    } finally {
      setSaving(false);
    }
  };

  if (!deviceId) {
    return (
      <div className="min-h-screen bg-coffee-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4">
        <div className="max-w-md text-center bg-white dark:bg-gray-800 p-8 rounded-xl shadow">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">Invalid device reference</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">The selected device could not be identified. Return to the admin dashboard and pick a device with a valid numeric id.</p>
          <button
            onClick={() => navigate('/admin/dashboard')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Admin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-coffee-50 dark:bg-gray-900 pb-12">
      <HeaderFrame
        titleSuffix="Configure Ports"
        subtitle="Assign device interfaces to sensors"
        badgeLabel="Admin"
        badgeTone="emerald"
        rightSlot={(
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-coffee-200 bg-white text-sm font-medium text-coffee-700 hover:border-coffee-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              onClick={handleEnumerate}
              disabled={enumerating}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {enumerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Enumerate
            </button>
            <button
              onClick={() => openAssignModal(null)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              <Plug className="w-4 h-4" />
              New Assignment
            </button>
          </div>
        )}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {toast && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              toast.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300'
            }`}
          >
            {toast.message}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            {error}
          </div>
        )}

        <div className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          <p>
            Device ID: <span className="font-medium text-gray-800 dark:text-gray-100">{deviceId}</span>
            {meta && (meta as any).hardwareId ? (
              <span className="ml-2">(Hardware: {(meta as any).hardwareId})</span>
            ) : null}
          </p>
          <p>
            Last enumeration source: {(meta && (meta as any).source) || 'database'}
            {(meta && (meta as any).devicePingable === false) && ' • Device offline'}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500 dark:text-gray-400">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading ports...
          </div>
        ) : ports.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
            <AlertTriangle className="w-10 h-10 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-300">No ports recorded yet.</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Trigger an enumeration or add a manual assignment to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Port Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Baud Rate</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Configured</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Assignment</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {ports.map((port) => {
                  const configuredAt = port.configured_at ? new Date(port.configured_at).toLocaleString() : '—';
                  const assignment = port.metadata?.assignment;
                  const status = (port.status || 'unknown').toString();
                  const statusColor = status === 'active'
                    ? 'text-emerald-600 bg-emerald-600/10'
                    : status === 'inactive'
                      ? 'text-amber-600 bg-amber-600/10'
                      : 'text-gray-600 bg-gray-600/10';
                  return (
                    <tr key={port.port_name} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{port.port_name}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{port.port_type}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                          {status}
                          {status === 'active' ? <CheckCircle2 className="w-3 h-3" /> : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{port.baud_rate || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{configuredAt}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                        {assignment ? (
                          <div>
                            <div>Sensor: {assignment.sensor_id ?? '—'}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{assignment.purpose || '—'}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openAssignModal(port)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                        >
                          Configure
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700">
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                  {selectedPort ? `Update ${selectedPort.port_name}` : 'Assign Port'}
                </h3>
                <button type="button" onClick={closeModal} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col text-sm font-medium text-gray-700 dark:text-gray-300">
                  Port Name
                  <input
                    type="text"
                    value={formState.port_name}
                    onChange={(event) => updateField('port_name', event.target.value)}
                    className="mt-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                    placeholder="UART0"
                    readOnly={Boolean(selectedPort)}
                    required
                  />
                </label>
                <label className="flex flex-col text-sm font-medium text-gray-700 dark:text-gray-300">
                  Port Type
                  <select
                    value={formState.port_type}
                    onChange={(event) => updateField('port_type', event.target.value)}
                    className="mt-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                  >
                    {ALLOWED_PORT_TYPES.map((type) => (
                      <option value={type} key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col text-sm font-medium text-gray-700 dark:text-gray-300">
                  Baud Rate
                  <input
                    type="number"
                    min="1"
                    value={formState.baud_rate}
                    onChange={(event) => updateField('baud_rate', event.target.value)}
                    className="mt-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                    placeholder="9600"
                  />
                </label>
                <label className="flex flex-col text-sm font-medium text-gray-700 dark:text-gray-300">
                  Sensor ID
                  <input
                    type="text"
                    value={formState.sensor_id}
                    onChange={(event) => updateField('sensor_id', event.target.value)}
                    className="mt-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                    placeholder="12"
                  />
                </label>
                <label className="flex flex-col text-sm font-medium text-gray-700 dark:text-gray-300 sm:col-span-2">
                  Purpose / Notes
                  <input
                    type="text"
                    value={formState.purpose}
                    onChange={(event) => updateField('purpose', event.target.value)}
                    className="mt-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                    placeholder="soil moisture probe"
                  />
                </label>
                <label className="flex flex-col text-sm font-medium text-gray-700 dark:text-gray-300 sm:col-span-2">
                  Internal Notes
                  <textarea
                    value={formState.notes}
                    onChange={(event) => updateField('notes', event.target.value)}
                    className="mt-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                    rows={3}
                    placeholder="Optional metadata or calibration notes"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Save Assignment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DevicePortsPage;
