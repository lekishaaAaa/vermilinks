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
        displayValue: formatValue(value, card.unit),
      };
    });
  }, [telemetry, lastTelemetry]);

  return (
    <div className="mt-6 grid grid-cols-5 gap-5" style={{ gridTemplateColumns: 'repeat(5,1fr)', gap: 20 }}>
      {cardValues.map((card) => (
        <div key={card.key} className="rounded-lg border border-gray-100 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{card.displayValue}</p>
        </div>
      ))}
    </div>
  );
};

export default SensorOverview;