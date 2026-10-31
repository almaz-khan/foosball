/**
 * Wall-clock time in an org's time zone, without a date library: dates are
 * stored as instants and shown, entered and filtered in the org's zone, so a
 * server-rendered page reads the same for everyone at the table.
 */

export const DEFAULT_TIME_ZONE = 'Europe/Prague';

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();

function wall(date: Date, zone: string): Wall & { second: number } {
  let f = partsFormat.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormat.set(zone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** How far the zone's clock is ahead of UTC at that instant, in ms. */
function offset(date: Date, zone: string): number {
  const w = wall(date, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

/** The instant the zone's clock shows this wall time. In a DST gap, the moment just after. */
export function fromWall(w: Wall, zone: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const first = guess - offset(new Date(guess), zone);
  const second = guess - offset(new Date(first), zone);
  return new Date(second);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `2026-10-31` as the start of that day in the zone; null if it isn't a date. */
export function parseDay(value: string | null | undefined, zone: string): Date | null {
  const m = DATE.exec(value ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!validDay(y, mo, d)) return null;
  return fromWall({ year: y, month: mo, day: d, hour: 0, minute: 0 }, zone);
}

/** The start of the day after `value`: the exclusive end of an inclusive "to" date. */
export function parseDayEnd(value: string | null | undefined, zone: string): Date | null {
  const m = DATE.exec(value ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!validDay(y, mo, d)) return null;
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return fromWall({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0 }, zone);
}

/** An `<input type="datetime-local">` value (`2026-10-31T14:05`) in the zone; null if empty or invalid. */
export function parseDateTime(value: string | null | undefined, zone: string): Date | null {
  const m = DATE_TIME.exec(value ?? '');
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (!validDay(y, mo, d) || h > 23 || mi > 59) return null;
  return fromWall({ year: y, month: mo, day: d, hour: h, minute: mi }, zone);
}

function validDay(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const PERIODS = ['month', 'year', 'all'] as const;
export type PeriodName = (typeof PERIODS)[number];

/** When the current calendar month or year began in the zone; null for all time. */
export function periodStart(period: PeriodName, zone: string, now: Date = new Date()): Date | null {
  if (period === 'all') return null;
  const w = wall(now, zone);
  return fromWall({ year: w.year, month: period === 'month' ? w.month : 1, day: 1, hour: 0, minute: 0 }, zone);
}

/** The value an `<input type="datetime-local">` shows for this instant in the zone. */
export function toDateTimeInput(date: Date | null, zone: string): string {
  if (!date) return '';
  const w = wall(date, zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** The value an `<input type="date">` shows for this instant in the zone. */
export function toDateInput(date: Date, zone: string): string {
  const w = wall(date, zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** "Today 14:05", "Yesterday 09:12", "Mon 27 Oct, 14:05", "27 Oct 2025, 14:05". */
export function formatWhen(date: Date, zone: string, now: Date = new Date()): string {
  const w = wall(date, zone);
  const today = wall(now, zone);
  const time = `${pad(w.hour)}:${pad(w.minute)}`;
  const dayNumber = (x: Wall) => Date.UTC(x.year, x.month - 1, x.day) / 86_400_000;
  const daysAgo = dayNumber(today) - dayNumber(w);
  if (daysAgo === 0) return `Today ${time}`;
  if (daysAgo === 1) return `Yesterday ${time}`;
  // Spelled out here rather than by Intl, whose abbreviations differ between
  // ICU versions ("Sep" / "Sept"): the same instant always reads the same.
  const weekday = daysAgo > 1 && daysAgo < 7 ? `${WEEKDAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()]} ` : '';
  const year = w.year !== today.year ? ` ${w.year}` : '';
  return `${weekday}${w.day} ${MONTHS[w.month - 1]}${year}, ${time}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 min", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
}

/** "31 Oct 2026", in the zone. */
export function formatDay(date: Date, zone: string): string {
  const w = wall(date, zone);
  return `${w.day} ${MONTHS[w.month - 1]} ${w.year}`;
}
