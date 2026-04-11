import React, { useMemo } from 'react';
import { SensorData } from '../types';

type CardConfig = {
  key: 'external_temp' | 'humidity' | 'soil_temp' | 'soil_moisture' | 'water_level';
  label: string;
  unit: string;
};

const cards: CardConfig[] = [
  { key: 'external_temp', label: 'External Temperature', unit: '°C' },
  { key: 'humidity', label: 'Humidity', unit: '%' },
  { key: 'soil_temp', label: 'Soil Temperature', unit: '°C' },
  { key: 'soil_moisture', label: 'Soil Moisture', unit: '%' },
  { key: 'water_level', label: 'Water Level', unit: '' },
];

type LayerMetrics = {
  layer: 1 | 2 | 3;
  moisture: number | null;
  temperature: number | null;
  status: 'normal' | 'warning' | 'critical' | 'unknown';
  moistureBand: 'LOW' | 'NORMAL' | 'HIGH' | 'NO_DATA';
  temperatureBand: 'LOW' | 'NORMAL' | 'HIGH' | 'NO_DATA';
};

interface SensorOverviewProps {
  telemetry: SensorData | null;
  lastTelemetry: SensorData | null;
}

const getCardStatus = (cardKey: CardConfig['key'], value: number | string | null): 'normal' | 'alert' | 'neutral' => {
  if (value === null || typeof value === 'undefined') {
    return 'neutral';
  }
  if (cardKey === 'water_level') {
    if (typeof value === 'string') {
      return value === 'SAFE' ? 'normal' : 'alert';
    }
    return value > 0 && value < 2 ? 'normal' : 'alert';
  }
  if (typeof value !== 'number') {
    return 'neutral';
  }
  if (cardKey === 'external_temp') {
    return value >= 21 && value <= 30 ? 'normal' : 'alert';
  }
  if (cardKey === 'humidity') {
    return value >= 60 && value <= 80 ? 'normal' : 'alert';
  }
  if (cardKey === 'soil_temp') {
    return value >= 20 && value <= 30 ? 'normal' : 'alert';
  }
  if (cardKey === 'soil_moisture') {
    return value >= 30 && value <= 70 ? 'normal' : 'alert';
  }
  return 'neutral';
};

const classifyMoistureBand = (moisture: number | null): LayerMetrics['moistureBand'] => {
  if (typeof moisture !== 'number') return 'NO_DATA';
  if (moisture < 30) return 'LOW';
  if (moisture > 70) return 'HIGH';
  return 'NORMAL';
};

const classifyTemperatureBand = (temperature: number | null): LayerMetrics['temperatureBand'] => {
  if (typeof temperature !== 'number') return 'NO_DATA';
  if (temperature < 20) return 'LOW';
  if (temperature > 35) return 'HIGH';
  return 'NORMAL';
};

const readCardValue = (cardKey: CardConfig['key'], sample: SensorData | null | undefined): number | string | null => {
  if (!sample) return null;
  switch (cardKey) {
    case 'external_temp':
      return typeof sample.ambientTemperature === 'number'
        ? sample.ambientTemperature
        : (typeof sample.temperature === 'number' ? sample.temperature : null);
    case 'humidity':
      return typeof sample.ambientHumidity === 'number'
        ? sample.ambientHumidity
        : (typeof sample.humidity === 'number' ? sample.humidity : null);
    case 'soil_temp':
      return typeof sample.soilTemperature === 'number' ? sample.soilTemperature : null;
    case 'soil_moisture':
      return typeof sample.moisture === 'number' ? sample.moisture : null;
    case 'water_level': {
      if (typeof sample.floatStatus === 'string' && sample.floatStatus.trim()) {
        const normalized = sample.floatStatus.trim().toUpperCase();
        if (normalized === 'NORMAL') return 'SAFE';
        return normalized;
      }
      const raw = sample.floatSensor ?? sample.waterLevel;
      if (raw === null || typeof raw === 'undefined') return null;
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) return null;
      if (numeric <= 0) return 'LOW';
      if (numeric >= 2) return 'HIGH';
      return 'SAFE';
    }
    default:
      return null;
  }
};

const classifyLayerHealth = (
  moistureBand: LayerMetrics['moistureBand'],
  temperatureBand: LayerMetrics['temperatureBand'],
): LayerMetrics['status'] => {
  const hasMoisture = moistureBand !== 'NO_DATA';
  const hasTemperature = temperatureBand !== 'NO_DATA';
  if (!hasMoisture && !hasTemperature) {
    return 'unknown';
  }
  if (moistureBand === 'HIGH' || temperatureBand === 'HIGH') {
    return 'critical';
  }
  if (moistureBand === 'LOW' || temperatureBand === 'LOW') {
    return 'warning';
  }
  return 'normal';
};

const normalizeLayer = (layer: 1 | 2 | 3, telemetry: SensorData | null, lastTelemetry: SensorData | null): LayerMetrics => {
  const readMoisture = (sample: SensorData | null) => {
    if (!sample) return null;
    const key = layer === 1 ? sample.soilMoistureLayer1 : layer === 2 ? sample.soilMoistureLayer2 : sample.soilMoistureLayer3;
    if (typeof key === 'number') {
      return key;
    }
    return typeof sample.moisture === 'number' ? sample.moisture : null;
  };
  const readTemperature = (sample: SensorData | null) => {
    if (!sample) return null;
    const key = layer === 1 ? sample.soilTemperatureLayer1 : layer === 2 ? sample.soilTemperatureLayer2 : sample.soilTemperatureLayer3;
    if (typeof key === 'number') {
      return key;
    }
    return typeof sample.soilTemperature === 'number' ? sample.soilTemperature : null;
  };

  const moisture = readMoisture(telemetry) ?? readMoisture(lastTelemetry);
  const temperature = readTemperature(telemetry) ?? readTemperature(lastTelemetry);
  const moistureBand = classifyMoistureBand(moisture);
  const temperatureBand = classifyTemperatureBand(temperature);
  return {
    layer,
    moisture,
    temperature,
    status: classifyLayerHealth(moistureBand, temperatureBand),
    moistureBand,
    temperatureBand,
  };
};

const formatValue = (value: number | string | null, unit: string): string => {
  if (value === null || typeof value === 'undefined') {
    return 'No Data';
  }
  if (typeof value === 'string') {
    return value;
  }
  const rounded = Number.isInteger(value) ? value.toString() : value.toFixed(2);
  return unit ? `${rounded}${unit}` : rounded;
};

const SensorOverview: React.FC<SensorOverviewProps> = ({ telemetry, lastTelemetry }) => {
  const cardValues = useMemo(() => {
    return cards.map((card) => {
      const value = readCardValue(card.key, telemetry) ?? readCardValue(card.key, lastTelemetry);
      return {
        ...card,
        status: getCardStatus(card.key, value),
        displayValue: formatValue(value, card.unit),
      };
    });
  }, [telemetry, lastTelemetry]);

  const layerMetrics = useMemo(() => {
    return [
      normalizeLayer(1, telemetry, lastTelemetry),
      normalizeLayer(2, telemetry, lastTelemetry),
      normalizeLayer(3, telemetry, lastTelemetry),
    ];
  }, [telemetry, lastTelemetry]);

  const compartmentMetrics = useMemo(() => {
    const readMetric = (key: 'ambientTemperature' | 'ambientHumidity') => {
      const current = telemetry && typeof telemetry[key] === 'number' ? (telemetry[key] as number) : null;
      const fallback = lastTelemetry && typeof lastTelemetry[key] === 'number' ? (lastTelemetry[key] as number) : null;
      return current ?? fallback;
    };

    return {
      ambientTemperature: readMetric('ambientTemperature'),
      ambientHumidity: readMetric('ambientHumidity'),
    };
  }, [telemetry, lastTelemetry]);

  return (
    <div className="mt-6 space-y-4">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-5" style={{ gap: 20 }}>
        {cardValues.map((card) => (
          <div key={card.key} className="rounded-lg border border-gray-100 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-900/50">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  card.status === 'normal'
                    ? 'bg-emerald-500'
                    : card.status === 'alert'
                      ? 'bg-rose-500'
                      : 'bg-gray-400'
                }`}
                aria-label={`${card.label} status indicator`}
              />
            </div>
            <p
              className={`mt-2 text-2xl font-semibold ${
                card.status === 'normal'
                  ? 'text-emerald-600 dark:text-emerald-300'
                  : card.status === 'alert'
                    ? 'text-rose-600 dark:text-rose-300'
                    : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {card.displayValue}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-100 bg-white/70 p-4 dark:border-gray-800 dark:bg-gray-900/50">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Compost Layer Health</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Layer temperature + moisture assessment</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {layerMetrics.map((layer) => {
            const badgeClass = layer.status === 'normal'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
              : layer.status === 'warning'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
                : layer.status === 'critical'
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';

            const layerLabel = layer.layer === 1
              ? 'Layer 1 (Top)'
              : layer.layer === 2
                ? 'Layer 2 (Middle)'
                : 'Layer 3 (Bottom)';

            const issueSummary = layer.status === 'unknown'
              ? 'No Data'
              : layer.status === 'normal'
                ? 'Normal'
                : [
                  layer.moistureBand !== 'NORMAL' && layer.moistureBand !== 'NO_DATA'
                    ? `Moisture ${layer.moistureBand}`
                    : null,
                  layer.temperatureBand !== 'NORMAL' && layer.temperatureBand !== 'NO_DATA'
                    ? `Temperature ${layer.temperatureBand}`
                    : null,
                ].filter(Boolean).join(' • ');

            return (
              <div key={`layer-${layer.layer}`} className="rounded-lg border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{layerLabel}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${badgeClass}`}>
                    {layer.status}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-200">Moisture: {formatValue(layer.moisture, '%')}</p>
                <p className="text-sm text-gray-700 dark:text-gray-200">Temperature: {formatValue(layer.temperature, '°C')}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{issueSummary || 'No Data'}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Ambient</p>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">Temperature: {formatValue(compartmentMetrics.ambientTemperature, '°C')}</p>
          <p className="text-sm text-gray-700 dark:text-gray-200">Humidity: {formatValue(compartmentMetrics.ambientHumidity, '%')}</p>
        </div>
      </div>
    </div>
  );
};

export default SensorOverview;