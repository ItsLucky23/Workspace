//? Shared compact relative-time formatting for list rows that need to stay readable on narrow screens.
export function timeAgo(input: string | number): string {
  const ms = typeof input === 'number' ? input : Date.parse(input);
  if (Number.isNaN(ms)) return typeof input === 'string' ? input : '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / (60 * 24)), 'day');
}
