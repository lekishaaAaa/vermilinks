const ALERT_LABEL_OVERRIDES: Record<string, string> = {
  pump_emergency_shutdown: 'Pump Emergency Shutdown',
  water_reservoir_low: 'Water Reservoir Low',
  sensor_out_of_range: 'Sensor Threshold Warning',
};

export const formatAlertLabel = (value?: string | null): string => {
  if (!value) {
    return 'Alert';
  }
  const normalized = value.toString().trim().toLowerCase();
  if (!normalized) {
    return 'Alert';
  }
  if (ALERT_LABEL_OVERRIDES[normalized]) {
    return ALERT_LABEL_OVERRIDES[normalized];
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};
