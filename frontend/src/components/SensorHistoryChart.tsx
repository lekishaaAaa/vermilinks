import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { SensorData } from '../types';
import { sensorService } from '../services/api';

type SensorHistoryChartProps = {
  selectedDate: string;
};

const toDateRange = (selectedDate: string) => {
  const date = (selectedDate || '').toString().trim();
  if (!date) {
    return null;
  }

  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
};

const SensorHistoryChart: React.FC<SensorHistoryChartProps> = ({ selectedDate }) => {
  const [readings, setReadings] = useState<SensorData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const range = toDateRange(selectedDate);
      if (!range) {
        if (!mounted) return;
        setReadings([]);
        setError('Invalid date selected.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await sensorService.getHistory({
          start: range.start,
          end: range.end,
          limit: 2000,
        });

        const payload = response?.data?.data;
        const readingsPayload = payload?.readings;
        const list: SensorData[] = Array.isArray(readingsPayload) ? (readingsPayload as SensorData[]) : [];

        if (!mounted) return;
        setReadings(list);
      } catch (err) {
        if (!mounted) return;
        setReadings([]);
        setError('Unable to load sensor history for the selected date.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [selectedDate]);

  const chartData = useMemo(() => {
    return (readings || [])
      .map((reading) => ({
        timestamp: reading.timestamp ? new Date(reading.timestamp).toISOString() : new Date().toISOString(),
        temperature: typeof reading.temperature === 'number' ? reading.temperature : null,
        humidity: typeof reading.humidity === 'number' ? reading.humidity : null,
        moisture: typeof reading.moisture === 'number' ? reading.moisture : null,
        soilTemperature: typeof reading.soilTemperature === 'number' ? reading.soilTemperature : null,
      }))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [readings]);

  const formatTime = (value: string) => {
    try {
      return format(new Date(value), 'HH:mm');
    } catch {
      return value;
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="h-[320px] animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
        {error}
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
        No historical sensor readings found for the selected date.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-base font-semibold text-gray-800 dark:text-gray-100">Daily Sensor History</h3>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tickFormatter={formatTime} />
            <YAxis />
            <Tooltip
              labelFormatter={(value: unknown) => String(value)}
              formatter={(value: number | string) => {
                if (value === undefined || value === null) return '--';
                const numeric = Number(value);
                return Number.isFinite(numeric) ? numeric.toFixed(2) : '--';
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="temperature" name="External Temperature (°C)" stroke="#ef4444" dot={false} connectNulls />
            <Line type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#3b82f6" dot={false} connectNulls />
            <Line type="monotone" dataKey="moisture" name="Soil Moisture (%)" stroke="#10b981" dot={false} connectNulls />
            <Line type="monotone" dataKey="soilTemperature" name="Soil Temperature (°C)" stroke="#a855f7" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SensorHistoryChart;
