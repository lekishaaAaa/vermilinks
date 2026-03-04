import React from 'react';

type AlertLike = {
  _id?: string;
  id?: string | number;
  type?: string;
  title?: string;
  message?: string;
  createdAt?: string;
};

export const formatAlertName = (alertType?: string): string => {
  if (!alertType) return 'Alert';
  return alertType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const formatTimestamp = (value?: string) => {
  if (!value) return 'Unknown time';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

interface RecentAlertsProps {
  alerts: AlertLike[];
}

const RecentAlerts: React.FC<RecentAlertsProps> = ({ alerts }) => {
  return (
    <div className="rounded-2xl border border-coffee-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6 shadow-sm">
      <h2 className="text-2xl font-bold text-espresso-900 dark:text-white">Latest Alerts</h2>
      {alerts.length === 0 ? (
        <p className="mt-6 text-sm text-espresso-500 dark:text-gray-400">No alerts yet. Sensors are within acceptable ranges.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {alerts.map((alert, index) => (
            <li key={String(alert._id || alert.id || index)} className="rounded-xl border border-coffee-100/80 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-4">
              <p className="text-sm font-semibold text-espresso-800 dark:text-gray-100">
                {formatAlertName(alert?.type || alert?.title || 'alert')}
              </p>
              <p className="text-xs text-espresso-500 dark:text-gray-400">{alert?.message || 'Threshold exceeded'}</p>
              <p className="text-xs text-espresso-400 dark:text-gray-500 mt-1">{formatTimestamp(alert?.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RecentAlerts;
