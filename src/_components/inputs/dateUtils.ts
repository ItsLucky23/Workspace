//? Native, dependency-free date + timezone helpers for the DatePicker.
//? Calendar-grid math is done on UTC-based Dates (timezone-independent, so no
//? DST surprises while stepping days/months); converting a wall-clock day/time
//? in a target IANA timezone to a real UTC instant uses Intl offset resolution
//? with one refinement pass so DST transition days resolve correctly.

export interface CalendarDay {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

export const getBrowserTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const partsToRecord = (parts: Intl.DateTimeFormatPart[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
};

/** Offset (ms) to add to an instant to get its wall-clock time in `timeZone`. */
export const tzOffsetMs = (instant: Date, timeZone: string): number => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = partsToRecord(dtf.formatToParts(instant));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
};

/** Resolve a wall-clock day + time in `timeZone` to a real UTC instant. */
export const zonedToUtc = (day: CalendarDay, hour: number, minute: number, timeZone: string): Date => {
  const guess = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  const offset1 = tzOffsetMs(new Date(guess), timeZone);
  const provisional = guess - offset1;
  const offset2 = tzOffsetMs(new Date(provisional), timeZone);
  const instant = offset2 === offset1 ? provisional : guess - offset2;
  return new Date(instant);
};

/** Read an instant's wall-clock day + time in `timeZone`. */
export const utcToZoned = (instant: Date, timeZone: string): { day: CalendarDay; hour: number; minute: number } => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map = partsToRecord(dtf.formatToParts(instant));
  return {
    day: { year: Number(map.year), month: Number(map.month), day: Number(map.day) },
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
};

export const todayInZone = (timeZone: string): CalendarDay => utcToZoned(new Date(), timeZone).day;

const dayToUtcDate = (day: CalendarDay): Date => new Date(Date.UTC(day.year, day.month - 1, day.day));
const utcDateToDay = (dt: Date): CalendarDay => ({
  year: dt.getUTCFullYear(),
  month: dt.getUTCMonth() + 1,
  day: dt.getUTCDate(),
});

export const addDays = (day: CalendarDay, amount: number): CalendarDay => {
  const dt = dayToUtcDate(day);
  dt.setUTCDate(dt.getUTCDate() + amount);
  return utcDateToDay(dt);
};

export const addMonths = (day: CalendarDay, amount: number): CalendarDay => {
  const dt = dayToUtcDate(day);
  const targetMonth = dt.getUTCMonth() + amount;
  dt.setUTCMonth(targetMonth);
  return utcDateToDay(dt);
};

/** Negative if a<b, 0 if equal, positive if a>b. */
export const compareDay = (a: CalendarDay, b: CalendarDay): number => {
  if (a.year === b.year && a.month === b.month) return a.day - b.day;
  if (a.year === b.year) return a.month - b.month;
  return a.year - b.year;
};

export const isSameDay = (a: CalendarDay | null, b: CalendarDay | null): boolean =>
  a !== null && b !== null && compareDay(a, b) === 0;

export const isBetweenDay = (target: CalendarDay, start: CalendarDay, end: CalendarDay): boolean =>
  compareDay(target, start) > 0 && compareDay(target, end) < 0;

/** 0=Sunday … 6=Saturday for a calendar day. */
export const weekdayOf = (day: CalendarDay): number => dayToUtcDate(day).getUTCDay();

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The 6×7 grid (42 cells) covering `month`, padded with the tail of the
 * previous month and head of the next, starting the week on `weekStartsOn`.
 */
export const buildMonthGrid = (year: number, month: number, weekStartsOn: number): CalendarDay[] => {
  const first: CalendarDay = { year, month, day: 1 };
  const firstWeekday = weekdayOf(first);
  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
};

/** Localised short weekday labels ordered from `weekStartsOn`. */
export const weekdayLabels = (locale: string, weekStartsOn: number): string[] => {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 2024-01-07 is a Sunday (UTC) — a stable anchor for weekday names.
  return Array.from({ length: 7 }, (_, i) => {
    const dow = (weekStartsOn + i) % 7;
    return fmt.format(new Date(Date.UTC(2024, 0, 7 + dow)));
  });
};

export const formatMonthTitle = (year: number, month: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));

export const formatDayValue = (
  instant: Date,
  timeZone: string,
  locale: string,
  withTime: boolean,
): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(instant);

export interface RangePreset {
  /** Stable id. */
  id: string;
  /** Display label (caller-supplied — keeps copy out of the component). */
  label: string;
  /** Days back from today (inclusive). 30 → today and the previous 29 days. */
  days?: number;
  /** Months back from today (alternative to days). */
  months?: number;
}

/** The default relative-range presets (labels supplied by the caller for i18n). */
export const DEFAULT_PRESET_SPECS: { id: string; days?: number; months?: number }[] = [
  { id: "last7", days: 7 },
  { id: "last30", days: 30 },
  { id: "last60", days: 60 },
  { id: "last90", days: 90 },
  { id: "last6months", months: 6 },
  { id: "lastyear", months: 12 },
];

/** Resolve a preset to a {start,end} calendar-day range ending today (in zone). */
export const resolvePreset = (preset: RangePreset, timeZone: string): { start: CalendarDay; end: CalendarDay } => {
  const end = todayInZone(timeZone);
  if (preset.months !== undefined) {
    return { start: addDays(addMonths(end, -preset.months), 1), end };
  }
  const days = preset.days ?? 1;
  return { start: addDays(end, -(days - 1)), end };
};
