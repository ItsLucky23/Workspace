import { faCalendarDays, faChevronLeft, faChevronRight, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  FieldShell,
  FieldSize,
  FIELD_SIZES,
  inputBoxClass,
  useErrorPulse,
  useShake,
} from "./fieldShell";
import { FloatingPanel, useFloatingLayer } from "./floatingLayer";
import TextField from "./TextField";
import {
  CalendarDay,
  DEFAULT_PRESET_SPECS,
  RangePreset,
  addDays,
  addMonths,
  buildMonthGrid,
  compareDay,
  formatDayValue,
  formatMonthTitle,
  getBrowserTimeZone,
  isBetweenDay,
  isSameDay,
  resolvePreset,
  todayInZone,
  utcToZoned,
  weekdayLabels,
  weekdayOf,
  zonedToUtc,
} from "./dateUtils";

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

interface DatePickerBaseProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  size?: FieldSize;
  disabled?: boolean;
  className?: string;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** IANA timezone the value is interpreted/displayed in. Default: browser zone. */
  timeZone?: string;
  /** BCP-47 locale for month/weekday names + value formatting. Default: browser locale. */
  locale?: string;
  /** 0=Sunday … 6=Saturday. Default 1 (Monday). */
  weekStartsOn?: number;
  /** Add hour/minute selection. Default false. */
  withTime?: boolean;
  minDate?: Date;
  maxDate?: Date;
  /** Show a clear (×) button. Default true. */
  clearable?: boolean;
  clearLabel?: string;
  todayLabel?: string;
  /** Range mode only: relative-range presets. Defaults to last 7/30/60/90 days, 6 months, 1 year. */
  presets?: RangePreset[];
  /** Labels for the start/end time fields in range + withTime mode. */
  startLabel?: string;
  endLabel?: string;
}

export type DatePickerProps = DatePickerBaseProps & (
  | { mode?: "single"; value: Date | null; onChange: (value: Date | null) => void }
  | { mode: "range"; value: DateRange; onChange: (value: DateRange) => void }
);

const DEFAULT_PRESET_LABELS: Record<string, string> = {
  last7: "Last 7 days",
  last30: "Last 30 days",
  last60: "Last 60 days",
  last90: "Last 90 days",
  last6months: "Last 6 months",
  lastyear: "Last year",
};

const getBrowserLocale = (): string =>
  (typeof navigator !== "undefined" && navigator.language) || "en";

const defaultPresets = (): RangePreset[] =>
  DEFAULT_PRESET_SPECS.map((spec) => ({ ...spec, label: DEFAULT_PRESET_LABELS[spec.id] ?? spec.id }));

interface CalendarProps {
  viewYear: number;
  viewMonth: number;
  weekStartsOn: number;
  locale: string;
  selectedStart: CalendarDay | null;
  selectedEnd: CalendarDay | null;
  hoverDay: CalendarDay | null;
  today: CalendarDay;
  minDay: CalendarDay | null;
  maxDay: CalendarDay | null;
  onPrev: () => void;
  onNext: () => void;
  onPick: (day: CalendarDay) => void;
  onHover: (day: CalendarDay | null) => void;
}

const dayKeyOf = (d: CalendarDay): string => `${String(d.year)}-${String(d.month)}-${String(d.day)}`;

function Calendar(props: CalendarProps) {
  const grid = useMemo(
    () => buildMonthGrid(props.viewYear, props.viewMonth, props.weekStartsOn),
    [props.viewYear, props.viewMonth, props.weekStartsOn],
  );
  const labels = useMemo(() => weekdayLabels(props.locale, props.weekStartsOn), [props.locale, props.weekStartsOn]);

  const rangeEnd = props.selectedEnd ?? (props.selectedStart && props.hoverDay && compareDay(props.hoverDay, props.selectedStart) > 0 ? props.hoverDay : null);

  const gridRef = useRef<HTMLDivElement>(null);
  const [focusedDay, setFocusedDay] = useState<CalendarDay>(() => props.selectedStart ?? props.today);

  //? Move DOM focus to the active day button whenever the keyboard cursor moves
  //? (roving tabindex). Mirrors the focus management in dropdownInternals.tsx.
  useEffect(() => {
    const target = gridRef.current?.querySelector(`[data-day="${dayKeyOf(focusedDay)}"]`);
    if (target instanceof HTMLElement) target.focus();
  }, [focusedDay]);

  const moveFocus = (deltaDays: number): void => {
    const next = addDays(focusedDay, deltaDays);
    if (next.year !== props.viewYear || next.month !== props.viewMonth) {
      if (compareDay(next, { year: props.viewYear, month: props.viewMonth, day: 1 }) < 0) props.onPrev();
      else props.onNext();
    }
    setFocusedDay(next);
    props.onHover(next);
  };

  const handleGridKeyDown = (event: React.KeyboardEvent): void => {
    const offsetInWeek = (weekdayOf(focusedDay) - props.weekStartsOn + 7) % 7;
    const focusedDisabled =
      (props.minDay ? compareDay(focusedDay, props.minDay) < 0 : false) ||
      (props.maxDay ? compareDay(focusedDay, props.maxDay) > 0 : false);

    switch (event.key) {
      case "ArrowLeft": { event.preventDefault(); moveFocus(-1); break;
      }
      case "ArrowRight": { event.preventDefault(); moveFocus(1); break;
      }
      case "ArrowUp": { event.preventDefault(); moveFocus(-7); break;
      }
      case "ArrowDown": { event.preventDefault(); moveFocus(7); break;
      }
      case "Home": { event.preventDefault(); moveFocus(-offsetInWeek); break;
      }
      case "End": { event.preventDefault(); moveFocus(6 - offsetInWeek); break;
      }
      case "PageUp": { event.preventDefault(); props.onPrev(); setFocusedDay(addMonths(focusedDay, -1)); break;
      }
      case "PageDown": { event.preventDefault(); props.onNext(); setFocusedDay(addMonths(focusedDay, 1)); break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (!focusedDisabled) props.onPick(focusedDay);
        break;
      }
      default: { break;
      }
    }
  };

  return (
    <div className="w-64 select-none">
      <div className="flex items-center justify-between mb-2">
        <button type="button" aria-label="Previous month" onClick={props.onPrev} className="w-7 h-7 flex items-center justify-center rounded-md text-common hover:bg-container2 hover:text-title transition-colors cursor-pointer">
          <FontAwesomeIcon icon={faChevronLeft} className="text-xs" />
        </button>
        <div className="text-sm font-semibold text-title">{formatMonthTitle(props.viewYear, props.viewMonth, props.locale)}</div>
        <button type="button" aria-label="Next month" onClick={props.onNext} className="w-7 h-7 flex items-center justify-center rounded-md text-common hover:bg-container2 hover:text-title transition-colors cursor-pointer">
          <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1" aria-hidden="true">
        {labels.map((labelText) => (
          <div key={labelText} className="h-7 flex items-center justify-center text-[11px] font-medium text-muted">{labelText}</div>
        ))}
      </div>

      <div ref={gridRef} className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => { props.onHover(null); }}>
        {grid.map((day) => {
          const inMonth = day.month === props.viewMonth;
          const isStart = isSameDay(day, props.selectedStart);
          const isEnd = isSameDay(day, props.selectedEnd);
          const isToday = isSameDay(day, props.today);
          const isFocused = isSameDay(day, focusedDay);
          const inRange = props.selectedStart && rangeEnd ? isBetweenDay(day, props.selectedStart, rangeEnd) : false;
          const isEndpoint = isStart || isEnd;
          const belowMin = props.minDay ? compareDay(day, props.minDay) < 0 : false;
          const aboveMax = props.maxDay ? compareDay(day, props.maxDay) > 0 : false;
          const disabled = belowMin || aboveMax;

          const base = "h-8 w-full flex items-center justify-center text-sm transition-colors outline-none";
          const monthTone = inMonth ? "text-title" : "text-disabled";
          const todayRing = isToday ? "ring-1 ring-primary/50" : "";
          let tone = `${monthTone} hover:bg-container2 cursor-pointer rounded-md ${todayRing}`;
          if (disabled) tone = "text-disabled cursor-not-allowed";
          else if (isEndpoint) tone = "bg-primary text-title-primary font-semibold cursor-pointer rounded-md";
          else if (inRange) tone = "bg-primary/15 text-title cursor-pointer";
          const focusRing = isFocused ? "ring-2 ring-focus-ring rounded-md" : "";

          return (
            <button
              key={dayKeyOf(day)}
              type="button"
              data-day={dayKeyOf(day)}
              tabIndex={isFocused ? 0 : -1}
              aria-label={formatDayValue(zonedToUtc(day, 0, 0, "UTC"), "UTC", props.locale, false)}
              aria-pressed={isEndpoint}
              disabled={disabled}
              onKeyDown={handleGridKeyDown}
              onClick={() => { props.onPick(day); }}
              onMouseEnter={() => { props.onHover(day); }}
              className={`${base} ${tone} ${focusRing}`}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Timezone-aware date (and optional time) picker with single + range modes,
 * relative-range presets, and a smooth anchored popover. Native Intl only —
 * no date library. All copy is supplied via props.
 */
export default function DatePicker(props: DatePickerProps) {
  const {
    label,
    description,
    error,
    required = false,
    size = "md",
    disabled = false,
    className = "",
    placeholder = "",
    timeZone: timeZoneProp,
    locale: localeProp,
    weekStartsOn = 1,
    withTime = false,
    minDate,
    maxDate,
    clearable = true,
    clearLabel = "Clear",
    todayLabel = "Today",
    startLabel = "Start",
    endLabel = "End",
    presets,
  } = props;

  //? Resolve in the body (not as call-expression param defaults — those re-run
  //? every render and trip react-x/no-unstable-default-props). Strings, so cheap.
  const timeZone = timeZoneProp ?? getBrowserTimeZone();
  const locale = localeProp ?? getBrowserLocale();

  const isRange = props.mode === "range";
  const controller = useFloatingLayer({ placement: "bottom", align: "start", closeOnOutsideClick: true });
  const { ref: shakeRef, shake } = useShake<HTMLDivElement>();
  useErrorPulse(error, shake);

  // Derive the current selection (in the target zone) from the controlled value.
  const startInstant = isRange ? props.value.start : props.value;
  const endInstant = isRange ? props.value.end : null;
  const startZoned = startInstant ? utcToZoned(startInstant, timeZone) : null;
  const endZoned = endInstant ? utcToZoned(endInstant, timeZone) : null;
  const selectedStart = startZoned?.day ?? null;
  const selectedEnd = endZoned?.day ?? null;

  const today = todayInZone(timeZone);
  const minDay = minDate ? utcToZoned(minDate, timeZone).day : null;
  const maxDay = maxDate ? utcToZoned(maxDate, timeZone).day : null;

  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const anchor = selectedStart ?? today;
    return { year: anchor.year, month: anchor.month };
  });
  const [hoverDay, setHoverDay] = useState<CalendarDay | null>(null);

  const emitSingle = (value: Date | null) => { if (props.mode !== "range") props.onChange(value); };
  const emitRange = (value: DateRange) => { if (props.mode === "range") props.onChange(value); };

  const dayToInstant = (day: CalendarDay, hour: number, minute: number): Date =>
    zonedToUtc(day, withTime ? hour : 0, withTime ? minute : 0, timeZone);

  const handlePick = (day: CalendarDay) => {
    if (!isRange) {
      emitSingle(dayToInstant(day, startZoned?.hour ?? 0, startZoned?.minute ?? 0));
      controller.close();
      return;
    }
    // range: start a new range, or complete the open one.
    if (!selectedStart || selectedEnd) {
      emitRange({ start: dayToInstant(day, startZoned?.hour ?? 0, startZoned?.minute ?? 0), end: null });
      return;
    }
    const ordered = compareDay(day, selectedStart) < 0;
    const startDay = ordered ? day : selectedStart;
    const endDay = ordered ? selectedStart : day;
    emitRange({
      start: dayToInstant(startDay, startZoned?.hour ?? 0, startZoned?.minute ?? 0),
      end: dayToInstant(endDay, endZoned?.hour ?? (withTime ? 23 : 0), endZoned?.minute ?? (withTime ? 59 : 0)),
    });
    setHoverDay(null);
  };

  const handlePreset = (preset: RangePreset) => {
    const { start, end } = resolvePreset(preset, timeZone);
    emitRange({
      start: dayToInstant(start, 0, 0),
      end: dayToInstant(end, withTime ? 23 : 0, withTime ? 59 : 0),
    });
    setView({ year: end.year, month: end.month });
  };

  const updateTime = (which: "start" | "end", hour: number, minute: number) => {
    const safeHour = Math.max(0, Math.min(23, hour));
    const safeMinute = Math.max(0, Math.min(59, minute));
    if (!isRange) {
      if (!selectedStart) return;
      emitSingle(dayToInstant(selectedStart, safeHour, safeMinute));
      return;
    }
    const startDay = selectedStart;
    const endDay = selectedEnd;
    if (which === "start" && startDay) {
      emitRange({
        start: zonedToUtc(startDay, safeHour, safeMinute, timeZone),
        end: endInstant,
      });
    } else if (which === "end" && endDay) {
      emitRange({ start: startInstant, end: zonedToUtc(endDay, safeHour, safeMinute, timeZone) });
    }
  };

  const handleClear = () => {
    if (isRange) emitRange({ start: null, end: null });
    else emitSingle(null);
  };

  const handleToday = () => {
    setView({ year: today.year, month: today.month });
    if (!isRange) {
      emitSingle(dayToInstant(today, startZoned?.hour ?? 0, startZoned?.minute ?? 0));
      controller.close();
    }
  };

  const triggerText = useMemo((): string => {
    if (isRange) {
      if (startInstant && endInstant) {
        return `${formatDayValue(startInstant, timeZone, locale, withTime)} – ${formatDayValue(endInstant, timeZone, locale, withTime)}`;
      }
      if (startInstant) return `${formatDayValue(startInstant, timeZone, locale, withTime)} – …`;
      return "";
    }
    return startInstant ? formatDayValue(startInstant, timeZone, locale, withTime) : "";
  }, [isRange, startInstant, endInstant, timeZone, locale, withTime]);

  const sizing = FIELD_SIZES[size];
  const hasValue = Boolean(startInstant);
  const resolvedPresets = presets ?? defaultPresets();

  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      required={required}
      size={size}
      className={className}
    >
      <div ref={controller.triggerRef} className="relative">
        <div ref={shakeRef} className={inputBoxClass({ size, hasError: Boolean(error), disabled })}>
          <FontAwesomeIcon icon={faCalendarDays} className={`${sizing.icon} text-muted shrink-0`} />
          <button
            type="button"
            disabled={disabled}
            onClick={() => { controller.toggle(); }}
            aria-haspopup="dialog"
            aria-expanded={controller.isOpen}
            className={`min-w-0 flex-1 text-left truncate bg-transparent outline-none ${hasValue ? "text-title" : "text-muted"} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            {triggerText || placeholder}
          </button>
          {clearable && hasValue && !disabled && (
            <button type="button" tabIndex={-1} aria-label={clearLabel} onClick={handleClear} className={`flex items-center justify-center text-muted hover:text-title transition-colors cursor-pointer ${sizing.icon} shrink-0`}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>

        <FloatingPanel controller={controller} className="p-3">
          <div className="flex gap-3">
            {isRange && (
              <div className="flex flex-col gap-1 w-32 border-r border-container1-border pr-3">
                {resolvedPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => { handlePreset(preset); }}
                    className="text-left text-sm px-2 py-1.5 rounded-md text-common hover:bg-container2 hover:text-title transition-colors cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <Calendar
                viewYear={view.year}
                viewMonth={view.month}
                weekStartsOn={weekStartsOn}
                locale={locale}
                selectedStart={selectedStart}
                selectedEnd={selectedEnd}
                hoverDay={hoverDay}
                today={today}
                minDay={minDay}
                maxDay={maxDay}
                onPrev={() => { setView((v) => { const p = addMonths({ year: v.year, month: v.month, day: 1 }, -1); return { year: p.year, month: p.month }; }); }}
                onNext={() => { setView((v) => { const n = addMonths({ year: v.year, month: v.month, day: 1 }, 1); return { year: n.year, month: n.month }; }); }}
                onPick={handlePick}
                onHover={setHoverDay}
              />

              {withTime && (
                <div className="flex flex-col gap-2 border-t border-container1-border pt-3">
                  <TimeRow
                    label={isRange ? startLabel : undefined}
                    hour={startZoned?.hour ?? 0}
                    minute={startZoned?.minute ?? 0}
                    disabled={!selectedStart}
                    onChange={(h, m) => { updateTime("start", h, m); }}
                  />
                  {isRange && (
                    <TimeRow
                      label={endLabel}
                      hour={endZoned?.hour ?? 0}
                      minute={endZoned?.minute ?? 0}
                      disabled={!selectedEnd}
                      onChange={(h, m) => { updateTime("end", h, m); }}
                    />
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button type="button" onClick={handleToday} className="text-sm text-primary hover:text-primary-hover transition-colors cursor-pointer">{todayLabel}</button>
                {clearable && hasValue && (
                  <button type="button" onClick={handleClear} className="text-sm text-common hover:text-title transition-colors cursor-pointer">{clearLabel}</button>
                )}
              </div>
            </div>
          </div>
        </FloatingPanel>
      </div>
    </FieldShell>
  );
}

interface TimeRowProps {
  label?: string;
  hour: number;
  minute: number;
  disabled: boolean;
  onChange: (hour: number, minute: number) => void;
}

function TimeRow({ label, hour, minute, disabled, onChange }: TimeRowProps) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-muted w-10 shrink-0">{label}</span>}
      <div className="w-16">
        <TextField
          type="number"
          size="sm"
          min={0}
          max={23}
          showStepper={false}
          disabled={disabled}
          value={String(hour).padStart(2, "0")}
          onChange={(v) => { onChange(Number(v) || 0, minute); }}
          aria-label="Hours"
        />
      </div>
      <span className="text-muted">:</span>
      <div className="w-16">
        <TextField
          type="number"
          size="sm"
          min={0}
          max={59}
          showStepper={false}
          disabled={disabled}
          value={String(minute).padStart(2, "0")}
          onChange={(v) => { onChange(hour, Number(v) || 0); }}
          aria-label="Minutes"
        />
      </div>
    </div>
  );
}
