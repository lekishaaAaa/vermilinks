import React, { useEffect, useState } from 'react';
import { sensorService } from '../services/api';
import { formatMetric } from '../utils/metricFormatter';

const CalendarBasedSummary: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [dailySummary, setDailySummary] = useState<Record<string, number | null>>({
    avgTemperature: null,
    avgHumidity: null,
    avgMoisture: null,
    avgSoilTemperature: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadDaily = async () => {
      if (!selectedDate) return;
      setLoading(true);
      setError(null);
      try {
        const start = new Date(`${selectedDate}T00:00:00.000Z`).toISOString();
        const end = new Date(`${selectedDate}T23:59:59.999Z`).toISOString();
        const response = await sensorService.getHistory({ start, end, limit: 2000 });
        const readings = response?.data?.data?.readings || [];

        const average = (values: Array<number | null | undefined>) => {
          const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
          if (!valid.length) return null;
          return valid.reduce((sum, value) => sum + value, 0) / valid.length;
        };

        const stats = {
          avgTemperature: average(readings.map((entry: any) => entry.temperature)),
          avgHumidity: average(readings.map((entry: any) => entry.humidity)),
          avgMoisture: average(readings.map((entry: any) => entry.moisture ?? entry.soil_moisture)),
          avgSoilTemperature: average(readings.map((entry: any) => entry.soilTemperature ?? entry.soil_temperature)),
        };

        if (!mounted) return;
        setDailySummary(stats);
      } catch (err) {
        if (!mounted) return;
        setError('Unable to load daily readings for the selected date.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadDaily();
    const intervalId = window.setInterval(loadDaily, 5000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [selectedDate]);

  return (
    <section className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Daily readings</p>
          <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Calendar-based summary</h2>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
          className="rounded-lg border border-coffee-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-espresso-800 dark:text-gray-100"
        />
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-espresso-500 dark:text-gray-400">Loading daily summary...</p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-300">{error}</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-coffee-100 dark:border-gray-700 p-3">
            <p className="text-xs text-espresso-500 dark:text-gray-400">Avg External Temperature</p>
            <p className="text-lg font-bold text-espresso-900 dark:text-white">{formatMetric(dailySummary?.avgTemperature, '°C')}</p>
          </div>
          <div className="rounded-xl border border-coffee-100 dark:border-gray-700 p-3">
            <p className="text-xs text-espresso-500 dark:text-gray-400">Avg Humidity</p>
            <p className="text-lg font-bold text-espresso-900 dark:text-white">{formatMetric(dailySummary?.avgHumidity, '%')}</p>
          </div>
          <div className="rounded-xl border border-coffee-100 dark:border-gray-700 p-3">
            <p className="text-xs text-espresso-500 dark:text-gray-400">Avg Soil Moisture</p>
            <p className="text-lg font-bold text-espresso-900 dark:text-white">{formatMetric(dailySummary?.avgMoisture, '%')}</p>
          </div>
          <div className="rounded-xl border border-coffee-100 dark:border-gray-700 p-3">
            <p className="text-xs text-espresso-500 dark:text-gray-400">Avg Soil Temperature</p>
            <p className="text-lg font-bold text-espresso-900 dark:text-white">{formatMetric(dailySummary?.avgSoilTemperature, '°C')}</p>
          </div>
        </div>
      )}
    </section>
  );
};

export default CalendarBasedSummary;
