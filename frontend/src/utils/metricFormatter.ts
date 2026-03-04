export function formatMetric(value: number | string | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === '') {
    return '--';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '--';
  }
  const formatted = numeric.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}
