import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw, Search, Filter, Trash2 } from 'lucide-react';
import DarkModeToggle from '../../components/DarkModeToggle';
import { sensorLogService } from '../../services/api';
import { PaginationInfo, SensorLogEntry } from '../../types';

interface Filters {
  search: string;
  deviceId: string;
  sensor: string;
  origin: string;
  start: string;
  end: string;
}

const defaultFilters: Filters = {
  search: '',
  deviceId: '',
  sensor: '',
  origin: '',
  start: '',
  end: '',
};

const ORIGIN_OPTIONS = [
  { label: 'Any origin', value: '' },
  { label: 'MQTT', value: 'mqtt' },
  { label: 'ESP32 HTTP', value: 'esp32_http' },
  { label: 'ESP32 Batch', value: 'esp32_batch' },
];

const SensorLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<SensorLogEntry[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [sensorOptions, setSensorOptions] = useState<string[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const limit = 25;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await sensorLogService.list({
        page,
        limit,
        deviceId: filters.deviceId || undefined,
        sensor: filters.sensor || undefined,
        origin: filters.origin || undefined,
        search: filters.search || undefined,
        start: filters.start || undefined,
        end: filters.end || undefined,
      });

      const payload = response?.data?.data;
      if (payload) {
        setLogs(payload.items || []);
        setPagination(payload.pagination || null);
      } else {
        setLogs([]);
        setPagination(null);
      }

      const metaSensors = response?.data?.meta?.sensors;
      if (Array.isArray(metaSensors) && metaSensors.length > 0) {
        setSensorOptions(metaSensors);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Unable to load sensor logs');
      setLogs([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [filters.deviceId, filters.sensor, filters.origin, filters.search, filters.start, filters.end, page, limit]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters(defaultFilters);
    setPage(1);
  };

  const handleExport = () => {
    if (!logs.length) {
      return;
    }
    const header = ['"Timestamp"', '"Device"', '"Sensor"', '"Value"', '"Origin"', '"Topic"', '"Raw"'];
    const rows = logs.map((log) => {
      const row = [
        new Date(log.recordedAt).toISOString(),
        log.deviceId,
        log.sensorName,
        `${log.value}${log.unit ? ` ${log.unit}` : ''}`,
        log.origin || '',
        log.mqttTopic || '',
        log.rawPayload ? JSON.stringify(log.rawPayload) : '',
      ];
      return row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sensor-logs-${new Date().toISOString().slice(0, 19)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = pagination?.pages ?? 1;
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const visibleOrigins = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.origin).filter(Boolean))) as string[];
  }, [logs]);

  const formatTimestamp = (value: string) => {
    try {
      return new Date(value).toLocaleString();
    } catch (err) {
      return value;
    }
  };

  const handleDelete = async (log: SensorLogEntry) => {
    if (!log?.id) {
      return;
    }
    const confirmed = window.confirm(`Delete sensor log ${log.id}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setDeletingId(log.id);
    setError(null);
    try {
      await sensorLogService.remove(log.id);
      await fetchLogs();
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Failed to delete sensor log';
      setError(message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-coffee-50 to-white dark:from-gray-900 dark:to-gray-950">
      <header className="sticky top-0 z-40 border-b border-white/40 bg-white/70 backdrop-blur dark:border-gray-800/60 dark:bg-gray-900/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Administrator</p>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Sensor Logs</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/dashboard"
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:text-white"
            >
              ← Back to dashboard
            </Link>
            <DarkModeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <section className="rounded-2xl border border-white/60 bg-white/80 p-6 shadow-xl shadow-rose-100/30 backdrop-blur dark:border-gray-800/60 dark:bg-gray-900/70">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                placeholder="Search device, sensor, origin, or payload"
                value={filters.search}
                onChange={(event) => handleFilterChange('search', event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white/80 py-2 pl-9 pr-3 text-sm text-gray-800 shadow-inner focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
              />
            </div>
            <input
              type="text"
              placeholder="Device ID"
              value={filters.deviceId}
              onChange={(event) => handleFilterChange('deviceId', event.target.value)}
              className="min-w-[160px] rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-800 shadow-inner focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
            />
            <select
              value={filters.sensor}
              onChange={(event) => handleFilterChange('sensor', event.target.value)}
              className="min-w-[160px] rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-800 shadow-inner focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
            >
              <option value="">Any sensor</option>
              {sensorOptions.map((sensor) => (
                <option key={sensor} value={sensor}>{sensor}</option>
              ))}
            </select>
            <select
              value={filters.origin}
              onChange={(event) => handleFilterChange('origin', event.target.value)}
              className="min-w-[160px] rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-800 shadow-inner focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
            >
              {ORIGIN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              {visibleOrigins
                .filter((origin) => !ORIGIN_OPTIONS.find((option) => option.value === origin))
                .map((origin) => (
                  <option key={origin} value={origin}>{origin}</option>
                ))}
            </select>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Start</label>
              <input
                type="datetime-local"
                value={filters.start}
                onChange={(event) => handleFilterChange('start', event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-800 focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">End</label>
              <input
                type="datetime-local"
                value={filters.end}
                onChange={(event) => handleFilterChange('end', event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-800 focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
              />
            </div>
            <div className="flex items-end gap-3">
              <button
                type="button"
                onClick={fetchLogs}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <Filter className="h-4 w-4" />
                Clear
              </button>
            </div>
            <div className="flex items-end justify-end gap-3">
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary-500"
                disabled={!logs.length}
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-white/60 bg-white/90 shadow-lg shadow-rose-100/30 backdrop-blur dark:border-gray-800/60 dark:bg-gray-900/80">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Total logs</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{pagination?.total ?? 0}</p>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Page {page} of {totalPages}
            </div>
          </div>

          {error && (
            <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm text-gray-700 dark:divide-gray-800 dark:text-gray-200">
              <thead className="bg-gray-50/70 text-xs uppercase tracking-wider text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-left">Sensor</th>
                  <th className="px-4 py-3 text-left">Value</th>
                  <th className="px-4 py-3 text-left">Origin</th>
                  <th className="px-4 py-3 text-left">Topic</th>
                  <th className="px-4 py-3 text-left">Payload</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                      Fetching logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                      No sensor logs found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const isExpanded = expandedRow === log.id;
                    return (
                      <React.Fragment key={log.id}>
                        <tr className="hover:bg-gray-50/70 dark:hover:bg-gray-800/60">
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                            {formatTimestamp(log.recordedAt)}
                          </td>
                          <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{log.deviceId}</td>
                          <td className="px-4 py-3">{log.sensorName}</td>
                          <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-50">
                            {log.value}
                            {log.unit ? <span className="ml-1 text-xs text-gray-500">{log.unit}</span> : null}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {log.origin || 'n/a'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{log.mqttTopic || '—'}</td>
                          <td className="px-4 py-3">
                            {log.rawPayload ? (
                              <button
                                type="button"
                                onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                                className="text-xs font-semibold text-primary-600 hover:underline dark:text-primary-300"
                              >
                                {isExpanded ? 'Hide JSON' : 'View JSON'}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">n/a</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => handleDelete(log)}
                              disabled={deletingId === log.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-900/30"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {deletingId === log.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && log.rawPayload && (
                          <tr>
                            <td colSpan={8} className="bg-gray-50/70 px-4 py-3 text-xs text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">
                              <pre className="overflow-x-auto rounded-lg bg-gray-900/90 p-3 text-[11px] text-gray-100">
                                {JSON.stringify(log.rawPayload, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-6 py-4 text-sm dark:border-gray-800">
            <div className="text-gray-500 dark:text-gray-400">
              Showing {(pagination && pagination.current && pagination.limit)
                ? `${(pagination.current - 1) * pagination.limit + 1}–${Math.min(pagination.current * pagination.limit, pagination.total)}`
                : '0'} of {pagination?.total ?? 0}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => canPrev && setPage((prev) => Math.max(1, prev - 1))}
                disabled={!canPrev}
                className="rounded-lg border border-gray-200 px-3 py-1 text-sm font-medium text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
              >
                Previous
              </button>
              <span className="text-gray-500 dark:text-gray-400">Page {page} / {totalPages}</span>
              <button
                type="button"
                onClick={() => canNext && setPage((prev) => prev + 1)}
                disabled={!canNext}
                className="rounded-lg border border-gray-200 px-3 py-1 text-sm font-medium text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default SensorLogsPage;
