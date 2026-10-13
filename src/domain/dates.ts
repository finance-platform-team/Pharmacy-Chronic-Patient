// Day + short month only (e.g. "12 Oct"), no year. Reads the date part of
// the value directly instead of going through Date parsing, so a UTC midnight
// value can't slip to the previous day in a timezone behind UTC.
export function formatDayMonth(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.split('T')[0].split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
