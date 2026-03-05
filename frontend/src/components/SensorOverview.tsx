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
      return value === 'NORMAL' ? 'normal' : 'alert';
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
    return value >= 400 && value <= 600 ? 'normal' : 'alert';
  }
  return 'neutral';
};

const readCardValue = (cardKey: CardConfig['key'], sample: SensorData | null | undefined): number | string | null => {
  if (!sample) return null;
  switch (cardKey) {
    case 'external_temp':
      return typeof sample.temperature === 'number' ? sample.temperature : null;
    case 'humidity':
      return typeof sample.humidity === 'number' ? sample.humidity : null;
    case 'soil_temp':
      return typeof sample.soilTemperature === 'number' ? sample.soilTemperature : null;
    case 'soil_moisture':
      return typeof sample.moisture === 'number' ? sample.moisture : null;
    case 'water_level': {
      const raw = sample.floatSensor ?? sample.waterLevel;
      if (raw === null || typeof raw === 'undefined') return null;
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) return null;
      if (numeric <= 0) return 'LOW';
      if (numeric >= 2) return 'HIGH';
      return 'NORMAL';
    }
    default:
      return null;
  }
};

const formatValue = (value: number | string | null, unit: string): string => {
  if (value === null || typeof value === 'undefined') {
    return '--';
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

  return (
    <div className="mt-6 grid grid-cols-5 gap-5" style={{ gridTemplateColumns: 'repeat(5,1fr)', gap: 20 }}>
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
  );
};

export default SensorOverview;