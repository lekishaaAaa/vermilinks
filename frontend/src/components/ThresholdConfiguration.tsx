import React, { useState, useEffect, useCallback } from 'react';
import { Save, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import api from '../services/api';

type MetricKey = 'temperature' | 'humidity' | 'moisture' | 'ec';

interface MetricThreshold {
  min: number;
  max: number;
  warning: number;
  critical: number;
}

interface PhThreshold {
  minWarning: number;
  minCritical: number;
  maxWarning: number;
  maxCritical: number;
}

interface Thresholds {
  temperature: MetricThreshold;
  humidity: MetricThreshold;
  moisture: MetricThreshold;
  ph: PhThreshold;
  ec: MetricThreshold;
}

interface ThresholdConfigurationProps {
  onThresholdsChange?: (thresholds: Thresholds) => void;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  temperature: { min: 18, max: 30, warning: 30, critical: 35 },
  humidity: { min: 40, max: 70, warning: 65, critical: 75 },
  moisture: { min: 30, max: 60, warning: 35, critical: 25 },
  ph: { minWarning: 6.0, minCritical: 5.5, maxWarning: 7.5, maxCritical: 8.0 },
  ec: { min: 0, max: 5000, warning: 2000, critical: 3000 },
};

const cloneDefaults = (): Thresholds => ({
  temperature: { ...DEFAULT_THRESHOLDS.temperature },
  humidity: { ...DEFAULT_THRESHOLDS.humidity },
  moisture: { ...DEFAULT_THRESHOLDS.moisture },
  ph: { ...DEFAULT_THRESHOLDS.ph },
  ec: { ...DEFAULT_THRESHOLDS.ec },
});

const metricFriendlyName: Record<MetricKey, string> = {
  temperature: 'temperature',
  humidity: 'humidity',
  moisture: 'moisture',
  ec: 'ec',
};

export const ThresholdConfiguration: React.FC<ThresholdConfigurationProps> = ({ onThresholdsChange }) => {
  const [thresholds, setThresholds] = useState<Thresholds>(() => cloneDefaults());

  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const toNumber = useCallback((value: unknown, fallback: number): number => {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }, []);

  const normalizeMetric = useCallback((incoming: any, defaults: MetricThreshold): MetricThreshold => ({
    min: toNumber(incoming?.min, defaults.min),
    max: toNumber(incoming?.max, defaults.max),
    warning: toNumber(incoming?.warning, defaults.warning),
    critical: toNumber(incoming?.critical, defaults.critical),
  }), [toNumber]);

  const normalizePh = useCallback((incoming: any, defaults: PhThreshold): PhThreshold => ({
    minWarning: toNumber(incoming?.minWarning, defaults.minWarning),
    minCritical: toNumber(incoming?.minCritical, defaults.minCritical),
    maxWarning: toNumber(incoming?.maxWarning, defaults.maxWarning),
    maxCritical: toNumber(incoming?.maxCritical, defaults.maxCritical),
  }), [toNumber]);

  useEffect(() => {
    loadThresholds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadThresholds = async () => {
    setLoading(true);
    try {
      const response = await api.get('/settings');
      if (response?.data?.success) {
        const data = response.data;
        const rawThresholds = data?.data?.thresholds || data?.thresholds || {};
        const next: Thresholds = {
          temperature: normalizeMetric(rawThresholds.temperature, DEFAULT_THRESHOLDS.temperature),
          humidity: normalizeMetric(rawThresholds.humidity, DEFAULT_THRESHOLDS.humidity),
          moisture: normalizeMetric(rawThresholds.moisture, DEFAULT_THRESHOLDS.moisture),
          ph: normalizePh(rawThresholds.ph, DEFAULT_THRESHOLDS.ph),
          ec: normalizeMetric(rawThresholds.ec, DEFAULT_THRESHOLDS.ec),
        };
        setThresholds(next);
        setLastSaved(new Date());
        setHasChanges(false);
        setErrors([]);
      } else {
        setErrors(['Unable to load thresholds. Please try again.']);
      }
    } catch (error) {
      console.error('Failed to load thresholds:', error);
      setErrors(['Unable to load thresholds. Please try again.']);
    } finally {
      setLoading(false);
    }
  };

  const handleMetricChange = (sensor: MetricKey, field: keyof MetricThreshold, value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    setThresholds(prev => ({
      ...prev,
      [sensor]: {
        ...prev[sensor],
        [field]: value,
      },
    }));
    setHasChanges(true);
  };

  const handlePhChange = (field: keyof PhThreshold, value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    setThresholds(prev => ({
      ...prev,
      ph: {
        ...prev.ph,
        [field]: value,
      },
    }));
    setHasChanges(true);
  };

  const validateThresholds = useCallback((payload: Thresholds): string[] => {
    const errors: string[] = [];

    const bounds: Record<MetricKey, { min: number; max: number }> = {
      temperature: { min: -50, max: 100 },
      humidity: { min: 0, max: 100 },
      moisture: { min: 0, max: 100 },
      ec: { min: 0, max: 10000 },
    };

    (Object.keys(bounds) as MetricKey[]).forEach((metric) => {
      const config = payload[metric];
      const { min, max, warning, critical } = config;
      const range = bounds[metric];

      if (min >= max) {
        errors.push(`${metricFriendlyName[metric]}: min must be lower than max`);
      }
      if (min < range.min || min > range.max) {
        errors.push(`${metricFriendlyName[metric]}: min must be between ${range.min} and ${range.max}`);
      }
      if (max < range.min || max > range.max) {
        errors.push(`${metricFriendlyName[metric]}: max must be between ${range.min} and ${range.max}`);
      }
      if (warning < range.min || warning > range.max) {
        errors.push(`${metricFriendlyName[metric]}: warning must be between ${range.min} and ${range.max}`);
      }
      if (critical < range.min || critical > range.max) {
        errors.push(`${metricFriendlyName[metric]}: critical must be between ${range.min} and ${range.max}`);
      }

      if (metric === 'moisture') {
        if (critical >= warning) {
          errors.push('moisture: critical must be lower than warning');
        }
      } else if (critical <= warning) {
        errors.push(`${metricFriendlyName[metric]}: critical must be higher than warning`);
      }
    });

    const { minWarning, minCritical, maxWarning, maxCritical } = payload.ph;
    const phValues = [minWarning, minCritical, maxWarning, maxCritical];
    phValues.forEach((value) => {
      if (value < 0 || value > 14) {
        errors.push('ph: values must be between 0 and 14');
      }
    });
    if (minCritical >= minWarning) {
      errors.push('ph: minimum critical must be lower than minimum warning');
    }
    if (maxCritical <= maxWarning) {
      errors.push('ph: maximum critical must be higher than maximum warning');
    }
    if (!(minCritical < minWarning && minWarning < maxWarning && maxWarning < maxCritical)) {
      errors.push('ph: thresholds must follow minCritical < minWarning < maxWarning < maxCritical');
    }

    return errors;
  }, []);

  const handleSave = async () => {
    const validation = validateThresholds(thresholds);
    if (validation.length > 0) {
      setErrors(validation);
      return;
    }

    setSaving(true);
    setErrors([]);
    try {
      const response = await api.put('/settings/thresholds', {
        thresholds: {
          temperature: thresholds.temperature,
          humidity: thresholds.humidity,
          moisture: thresholds.moisture,
          ph: thresholds.ph,
          ec: thresholds.ec,
        },
      });

      if (response?.data?.success) {
        setLastSaved(new Date());
        setHasChanges(false);
        onThresholdsChange?.(thresholds);
        setErrors([]);
      } else {
        const body = response?.data;
        const serverErrors: string[] = Array.isArray(body?.errors) ? body.errors.map((err: any) => (typeof err === 'string' ? err : err?.msg || JSON.stringify(err))) : [];
        const message = body?.message ? [body.message] : [];
        const combined = [...message, ...serverErrors];
        setErrors(combined.length > 0 ? combined : ['Failed to save thresholds. Please try again.']);
      }
    } catch (error) {
      console.error('Failed to save thresholds:', error);
      const message = (error as any)?.response?.data?.message || 'Failed to save thresholds. Please try again.';
      const serverErrors: string[] = Array.isArray((error as any)?.response?.data?.errors)
        ? (error as any).response.data.errors.map((err: any) => (typeof err === 'string' ? err : err?.msg || JSON.stringify(err)))
        : [];
      const combined = [message, ...serverErrors].filter(Boolean);
      setErrors(combined.length > 0 ? combined : ['Failed to save thresholds. Please try again.']);
    } finally {
      setSaving(false);
    }
  };

  const sensorConfigs: Array<{ key: MetricKey; label: string; unit: string; description: string; step: string }> = [
    {
      key: 'temperature',
      label: 'External Temperature',
      unit: '°C',
      description: 'Optimal range: 18-30°C',
      step: '0.1',
    },
    {
      key: 'humidity',
      label: 'Humidity',
      unit: '%',
      description: 'Optimal range: 40-70%',
      step: '1',
    },
    {
      key: 'moisture',
      label: 'Soil Moisture',
      unit: '%',
      description: 'Optimal range: 30-60%',
      step: '1',
    },
    {
      key: 'ec',
      label: 'EC (Conductivity)',
      unit: 'µS/cm',
      description: 'Electrical conductivity',
      step: '1',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            Threshold & Rules Configuration
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Configure sensor thresholds for automatic alerts and monitoring
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={loadThresholds}
            className="px-3 py-2 text-sm rounded-md border bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            disabled={loading}
            title="Refresh thresholds"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-1" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      {hasChanges && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-md">
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mr-2" />
            <span className="text-sm text-yellow-800 dark:text-yellow-200">
              You have unsaved changes. Click "Save Changes" to apply them.
            </span>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-md">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5" />
            <div className="text-sm text-rose-700 dark:text-rose-200 space-y-1">
              {errors.map((error, index) => (
                <div key={index}>{error}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6">
        {sensorConfigs.map((config) => (
          <div key={config.key as string} className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-medium text-gray-800 dark:text-gray-200">
                  {config.label}
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {config.description}
                </p>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-500 dark:text-gray-400">Current Range</div>
                <div className="font-medium text-gray-800 dark:text-gray-200">
                  {thresholds[config.key].min} - {thresholds[config.key].max} {config.unit}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Min Value ({config.unit})
                </label>
                <input
                  type="number"
                  step={config.step}
                  value={thresholds[config.key].min}
                  onChange={(e) => handleMetricChange(config.key as MetricKey, 'min', parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Max Value ({config.unit})
                </label>
                <input
                  type="number"
                  step={config.step}
                  value={thresholds[config.key].max}
                  onChange={(e) => handleMetricChange(config.key as MetricKey, 'max', parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Warning Threshold ({config.unit})
                </label>
                <input
                  type="number"
                  step={config.step}
                  value={thresholds[config.key].warning}
                  onChange={(e) => handleMetricChange(config.key as MetricKey, 'warning', parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Critical Threshold ({config.unit})
                </label>
                <input
                  type="number"
                  step={config.step}
                  value={thresholds[config.key].critical}
                  onChange={(e) => handleMetricChange(config.key as MetricKey, 'critical', parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-700 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-md">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Alert Logic:</span>
                <div className="flex items-center space-x-4">
                  <span className="text-green-600">
                    <CheckCircle className="w-4 h-4 inline mr-1" />
                    Normal: {thresholds[config.key].min} - {thresholds[config.key].max}
                  </span>
                  <span className="text-yellow-600">
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    Warning: {config.key === 'moisture' ? `≤ ${thresholds[config.key].warning}` : `≥ ${thresholds[config.key].warning}`}
                  </span>
                  <span className="text-red-600">
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    Critical: {config.key === 'moisture' ? `≤ ${thresholds[config.key].critical}` : `≥ ${thresholds[config.key].critical}`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h4 className="font-medium text-gray-800 dark:text-gray-200 mb-4">pH Thresholds</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Minimum Warning (pH)
            </label>
            <input
              type="number"
              step="0.1"
              value={thresholds.ph.minWarning}
              onChange={(e) => handlePhChange('minWarning', parseFloat(e.target.value))}
              className="w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Minimum Critical (pH)
            </label>
            <input
              type="number"
              step="0.1"
              value={thresholds.ph.minCritical}
              onChange={(e) => handlePhChange('minCritical', parseFloat(e.target.value))}
              className="w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Maximum Warning (pH)
            </label>
            <input
              type="number"
              step="0.1"
              value={thresholds.ph.maxWarning}
              onChange={(e) => handlePhChange('maxWarning', parseFloat(e.target.value))}
              className="w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Maximum Critical (pH)
            </label>
            <input
              type="number"
              step="0.1"
              value={thresholds.ph.maxCritical}
              onChange={(e) => handlePhChange('maxCritical', parseFloat(e.target.value))}
              className="w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-700 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-md">
        <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">
          Alert Behavior
        </h4>
        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
          <li>• Alerts are triggered automatically when sensor readings exceed thresholds</li>
          <li>• Critical alerts are sent immediately via configured notification channels</li>
          <li>• Warning alerts are logged but may have different notification settings</li>
          <li>• Threshold changes take effect immediately after saving</li>
        </ul>
      </div>
    </div>
  );
};