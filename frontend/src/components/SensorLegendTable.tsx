import React from 'react';

const SensorLegendTable: React.FC = () => {
  const rows = [
    { sensor: 'External Temperature', range: '21–30 °C', meaning: 'Optimal worm environment', tone: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-200' },
    { sensor: 'Humidity', range: '60–80 %', meaning: 'Ideal microbial activity', tone: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-200' },
    { sensor: 'Soil Temperature', range: '20–30 °C', meaning: 'Supports vermicomposting', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200' },
    { sensor: 'Soil Moisture', range: '40–80 %', meaning: 'Prevents dry bedding', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200' },
    { sensor: 'Water Level', range: 'LOW / NORMAL / HIGH', meaning: 'Reservoir refill indicator', tone: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-200' },
  ];

  return (
    <section className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/85 dark:bg-gray-900/65 p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm uppercase tracking-wide text-primary-600 dark:text-primary-300 font-semibold">Sensor legend</p>
        <h2 className="text-xl font-bold text-espresso-900 dark:text-white">How to read the sensor values</h2>
        <span className="inline-flex items-center rounded-full border border-coffee-200 dark:border-gray-700 px-3 py-1 text-xs font-semibold text-espresso-600 dark:text-gray-300 bg-white/70 dark:bg-gray-900/50 w-fit">
          Reference guide
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-coffee-100 dark:border-gray-800 bg-white/70 dark:bg-gray-900/40">
        <table className="min-w-full text-sm">
          <thead className="bg-coffee-50 dark:bg-gray-800/80">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Sensor</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Normal Range</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const striped = index % 2 === 0
                ? 'bg-white/70 dark:bg-gray-900/30'
                : 'bg-coffee-50/40 dark:bg-gray-900/55';

              return (
                <tr key={row.sensor} className={`border-t border-coffee-100 dark:border-gray-800 transition-colors hover:bg-primary-50/60 dark:hover:bg-gray-800/60 ${striped}`}>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-semibold">{row.sensor}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${row.tone}`}>
                      {row.range}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{row.meaning}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default SensorLegendTable;
