import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw, Search, Filter, Trash2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import DarkModeToggle from '../../components/DarkModeToggle';
import { sensorLogService } from '../../services/api';
import { PaginationInfo, SensorLogEntry } from '../../types';

interface Filters {
  search: string;
  deviceId: string;
  sensor: string;
  category: 'all' | 'environmental' | 'device';
  origin: string;
  start: string;
  end: string;
}

const defaultFilters: Filters = {
  search: '',
  deviceId: '',
  sensor: '',
  category: 'environmental',
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

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
        category: filters.category,
        origin: filters.origin || undefined,
        search: filters.search || undefined,
        start: filters.start || undefined,
        end: filters.end || undefined,
      });

      const payload = response?.data?.data;
      if (payload) {
        setLogs(payload.items || []);
        setPagination(payload.pagination || null);
        setSelectedIds(new Set());
      } else {
        setLogs([]);
        setPagination(null);
        setSelectedIds(new Set());
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
  }, [filters.deviceId, filters.sensor, filters.category, filters.origin, filters.search, filters.start, filters.end, page, limit]);

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
    const rows = logs.map((log) => {
      const payload = (log.rawPayload && typeof log.rawPayload === 'object') ? log.rawPayload as Record<string, unknown> : {};
      const sensorKey = (log.sensorName || '').toString().toLowerCase();
      const row: Record<string, string | number | null> = {
        timestamp: new Date(log.recordedAt).toISOString(),
        device_id: log.deviceId,
        temperature: payload.temperature as number ?? null,
        humidity: payload.humidity as number ?? null,
        soil_temperature: payload.soil_temperature as number ?? null,
        soil_moisture: payload.soil_moisture as number ?? null,
        water_level: payload.water_level as number ?? null,
        float_state: payload.float_state as string ?? null,
      };

      if (sensorKey === 'temperature') row.temperature = log.value;
      if (sensorKey === 'humidity') row.humidity = log.value;
      if (sensorKey === 'soil_temperature' || sensorKey === 'soiltemperature') row.soil_temperature = log.value;
      if (sensorKey === 'soil_moisture' || sensorKey === 'moisture') row.soil_moisture = log.value;
      if (sensorKey === 'water_level' || sensorKey === 'waterlevel') row.water_level = log.value;
      if (sensorKey === 'float_state' || sensorKey === 'floatsensor') row.float_state = String(log.value);

      return row;
    });

    const header = ['timestamp', 'device_id', 'temperature', 'humidity', 'soil_temperature', 'soil_moisture', 'water_level', 'float_state'];
    const csvRows = rows.map((row) => header.map((field) => `"${String(row[field] ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sensor-logs-${new Date().toISOString().slice(0, 19)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    if (!logs.length) {
      return;
    }
    const rows = logs.map((log) => {
      const payload = (log.rawPayload && typeof log.rawPayload === 'object') ? log.rawPayload as Record<string, unknown> : {};
      return {
        timestamp: new Date(log.recordedAt).toISOString(),
        device_id: log.deviceId,
        temperature: payload.temperature ?? (log.sensorName === 'temperature' ? log.value : null),
        humidity: payload.humidity ?? (log.sensorName === 'humidity' ? log.value : null),
        soil_temperature: payload.soil_temperature ?? ((log.sensorName === 'soil_temperature' || log.sensorName === 'soilTemperature') ? log.value : null),
        soil_moisture: payload.soil_moisture ?? ((log.sensorName === 'soil_moisture' || log.sensorName === 'moisture') ? log.value : null),
        water_level: payload.water_level ?? ((log.sensorName === 'water_level' || log.sensorName === 'waterLevel') ? log.value : null),
        float_state: payload.float_state ?? ((log.sensorName === 'float_state' || log.sensorName === 'floatSensor') ? String(log.value) : null),
      };
    });

    const sheet = XLSX.utils.json_to_sheet(rows, {
      header: ['timestamp', 'device_id', 'temperature', 'humidity', 'soil_temperature', 'soil_moisture', 'water_level', 'float_state'],
    });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Sensor Logs');
    XLSX.writeFile(book, `sensor-logs-${new Date().toISOString().slice(0, 19)}.xlsx`);
  };

  const handleExportPdf = () => {
    if (!logs.length) {
      return;
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const rows = logs.map((log) => {
      const payload = (log.rawPayload && typeof log.rawPayload === 'object') ? log.rawPayload as Record<string, unknown> : {};
      return [
        new Date(log.recordedAt).toISOString(),
        log.deviceId,
        String(payload.temperature ?? (log.sensorName === 'temperature' ? log.value : '')),
        String(payload.humidity ?? (log.sensorName === 'humidity' ? log.value : '')),
        String(payload.soil_temperature ?? ((log.sensorName === 'soil_temperature' || log.sensorName === 'soilTemperature') ? log.value : '')),
        String(payload.soil_moisture ?? ((log.sensorName === 'soil_moisture' || log.sensorName === 'moisture') ? log.value : '')),
        String(payload.water_level ?? ((log.sensorName === 'water_level' || log.sensorName === 'waterLevel') ? log.value : '')),
        String(payload.float_state ?? ((log.sensorName === 'float_state' || log.sensorName === 'floatSensor') ? log.value : '')),
      ];
    });

    const headers = ['timestamp', 'device_id', 'temperature', 'humidity', 'soil_temperature', 'soil_moisture', 'water_level', 'float_state'];
    doc.setFontSize(12);
    doc.text('VermiLinks Sensor Logs Export', 40, 32);
    autoTable(doc, {
      startY: 48,
      head: [headers],
      body: rows,
      styles: {
        fontSize: 8,
        cellPadding: 4,
      },
      headStyles: {
        fillColor: [30, 41, 59],
      },
      margin: { left: 24, right: 24 },
      tableWidth: 'auto',
    });

    doc.save(`sensor-logs-${new Date().toISOString().slice(0, 19)}.pdf`);
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

  const allSelected = logs.length > 0 && logs.every((log) => selectedIds.has(log.id));
  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(logs.map((log) => log.id)));
  };

  const toggleSelectRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (!selectedIds.size) {
      return;
    }
    const ids = Array.from(selectedIds)
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!ids.length) {
      setError('Provide valid sensor log IDs');
      return;
    }
    const confirmed = window.confirm(`Delete ${selectedIds.size} selected log(s)? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    setBulkDeleting(true);
    setError(null);
    try {
      await sensorLogService.bulkRemove(ids);
      await fetchLogs();
    } catch (err: any) {
      const status = Number(err?.response?.status || 0);
      if ([404, 405, 410].includes(status)) {
        const outcomes = await Promise.allSettled(ids.map((id) => sensorLogService.remove(id)));
        const failed = outcomes.filter((result) => result.status === 'rejected').length;
        await fetchLogs();
        if (failed > 0) {
          setError(`Deleted ${ids.length - failed}/${ids.length} selected logs. Some entries could not be removed.`);
        }
      } else {
        setError(err?.response?.data?.message || err?.message || 'Failed to delete selected logs');
      }
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDeleteAllLogs = async () => {
    setDeleteAllLoading(true);
    setError(null);
    try {
      await sensorLogService.removeAll();
      setShowDeleteAllModal(false);
      await fetchLogs();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to delete all logs');
    } finally {
      setDeleteAllLoading(false);
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
        <section className="rounded-2xl border border-white/60 bg-white/85 p-6 shadow-xl shadow-rose-100/30 backdrop-blur dark:border-gray-800/60 dark:bg-gray-900/70">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Filter panel</p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Search & Filters</h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                placeholder="Search device, sensor, origin, or payload"
                value={filters.search}
                onChange={(event) => handleFilterChange('search', event.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white/90 py-2.5 pl-9 pr-3 text-sm text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
              />
            </div>
            <input
              type="text"
              placeholder="Device ID"
              value={filters.deviceId}
              onChange={(event) => handleFilterChange('deviceId', event.target.value)}
              className="min-w-[160px] rounded-xl border border-gray-200 bg-white/90 px-3 py-2.5 text-sm text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
            />
            <select
              value={filters.sensor}
              onChange={(event) => handleFilterChange('sensor', event.target.value)}
              className="min-w-[160px] rounded-xl border border-gray-200 bg-white/90 px-3 py-2.5 text-sm text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
            >
              <option value="">Any sensor</option>
              {sensorOptions.map((sensor) => (
                <option key={sensor} value={sensor}>{sensor}</option>
              ))}
            </select>
            <select
              value={filters.category}
              onChange={(event) => handleFilterChange('category', event.target.value as Filters['category'])}
              className="min-w-[180px] rounded-xl border border-gray-200 bg-white/90 px-3 py-2.5 text-sm text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
            >
              <option value="environmental">Environmental Sensors</option>
              <option value="device">Device Metrics</option>
              <option value="all">All Categories</option>
            </select>
            <select
              value={filters.origin}
              onChange={(event) => handleFilterChange('origin', event.target.value)}
              className="min-w-[160px] rounded-xl border border-gray-200 bg-white/90 px-3 py-2.5 text-sm text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
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
            <div className="space-y-1 min-w-[220px]">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Start Date</label>
              <input
                type="datetime-local"
                value={filters.start}
                onChange={(event) => handleFilterChange('start', event.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white/90 px-3 py-2.5 text-sm text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
              />
            </div>
            <div className="space-y-1 min-w-[220px]">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">End Date</label>
              <input
                type="datetime-local"
                value={filters.end}
                onChange={(event) => handleFilterChange('end', event.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white/90 px-3 py-2.5 text-sm text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100"
              />
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-white/60 bg-white/90 p-4 shadow-lg shadow-rose-100/20 backdrop-blur dark:border-gray-800/60 dark:bg-gray-900/80">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={fetchLogs}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              <Filter className="h-4 w-4" />
              Clear Filters
            </button>
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={selectedIdList.length === 0 || bulkDeleting || loading}
            >
              <Trash2 className="h-4 w-4" />
              {bulkDeleting ? 'Deleting…' : `Delete Selected (${selectedIdList.length})`}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteAllModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!logs.length || loading}
            >
              <Trash2 className="h-4 w-4" />
              Delete All Logs
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-500"
              disabled={!logs.length}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500"
              disabled={!logs.length}
            >
              <Download className="h-4 w-4" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-600"
              disabled={!logs.length}
            >
              <Download className="h-4 w-4" />
              Export PDF
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-white/60 bg-white/90 shadow-lg shadow-rose-100/30 backdrop-blur dark:border-gray-800/60 dark:bg-gray-900/80 overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800 bg-white/70 dark:bg-gray-900/60">
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Log summary</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{pagination?.total ?? 0}</p>
            </div>
            <div className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 px-3 py-1 text-sm text-gray-600 dark:text-gray-300">
              Page {page} of {totalPages}
            </div>
          </div>

          {error && (
            <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="max-h-[70vh] overflow-auto bg-white/40 dark:bg-gray-900/20">
            <table className="min-w-full divide-y divide-gray-100 text-sm text-gray-700 dark:divide-gray-800 dark:text-gray-200">
              <thead className="sticky top-0 z-10 bg-gray-50/95 text-xs uppercase tracking-wider text-gray-500 dark:bg-gray-900/95 dark:text-gray-400 backdrop-blur">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">Timestamp</th>
                  <th className="px-4 py-3 text-left font-semibold">Device</th>
                  <th className="px-4 py-3 text-left font-semibold">Sensor</th>
                  <th className="px-4 py-3 text-left font-semibold">Category</th>
                  <th className="px-4 py-3 text-left font-semibold">Value</th>
                  <th className="px-4 py-3 text-left font-semibold">Origin</th>
                  <th className="px-4 py-3 text-left font-semibold">Topic</th>
                  <th className="px-4 py-3 text-left font-semibold">Payload</th>
                  <th className="px-4 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                      Fetching logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                      No sensor logs found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  logs.map((log, rowIndex) => {
                    const isExpanded = expandedRow === log.id;
                    return (
                      <React.Fragment key={log.id}>
                        <tr className={`${rowIndex % 2 === 0 ? 'bg-white/90 dark:bg-gray-900/35' : 'bg-gray-50/70 dark:bg-gray-900/55'} hover:bg-primary-50/50 dark:hover:bg-gray-800/70 transition-colors`}>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(log.id)}
                              onChange={() => toggleSelectRow(log.id)}
                              aria-label={`Select log ${log.id}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                            {formatTimestamp(log.recordedAt)}
                          </td>
                          <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{log.deviceId}</td>
                          <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{log.sensorName}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${log.category === 'Device Metrics' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
                              {log.category || 'Environmental Sensors'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-50">
                            {log.value}
                            {log.unit ? <span className="ml-1 text-xs text-gray-500">{log.unit}</span> : null}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {log.origin || 'n/a'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{log.mqttTopic || '—'}</td>
                          <td className="px-4 py-3">
                            {log.rawPayload ? (
                              <button
                                type="button"
                                onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                                className="inline-flex items-center rounded-full border border-primary-200 dark:border-primary-800 px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/30"
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
                            <td colSpan={10} className="bg-gray-50/80 px-4 py-3 text-xs text-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
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

      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delete all sensor logs?</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This will permanently remove all sensor log records. This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteAllModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-200"
                disabled={deleteAllLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAllLogs}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                disabled={deleteAllLoading}
              >
                {deleteAllLoading ? 'Deleting…' : 'Delete All Logs'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SensorLogsPage;
