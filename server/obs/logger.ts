//? Structured logging (#5) — a tiny LogContext that emits ONE JSON object per line (ts + level +
//? msg + arbitrary context fields), so logs are grep-/ship-able (Loki/ELK) instead of free-text.
//? Wraps the framework `getLogger()` so it still flows through the console pipeline. A LogContext
//? carries base fields (e.g. workspaceId, ticketId, requestId) that every child log inherits, and
//? `.child()` adds more — so an engine turn or an HTTP request logs a consistent, filterable trail.

import { getLogger } from '@luckystack/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

//? Build the single JSON line. `now` is injected so tests are deterministic. Undefined fields are
//? dropped so the line stays tidy. Never throws — a bad field can't break logging.
export function formatLogLine(level: LogLevel, msg: string, fields: LogFields, nowIso: string): string {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) { if (v !== undefined) clean[k] = v; }
  return JSON.stringify({ ts: nowIso, level, msg, ...clean });
}

export interface LogContext {
  child: (extra: LogFields) => LogContext;
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
}

//? Create a structured logger carrying `base` fields. `now` defaults to the wall clock but is
//? injectable for tests. Levels route to the matching framework logger method.
export function createLogContext(base: LogFields = {}, now: () => Date = () => new Date()): LogContext {
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    const line = formatLogLine(level, msg, { ...base, ...fields }, now().toISOString());
    const logger = getLogger();
    if (level === 'error') logger.error(line);
    else if (level === 'warn') logger.warn(line);
    else logger.info(line);
  };
  return {
    child: (extra) => createLogContext({ ...base, ...extra }, now),
    debug: (msg, fields) => { emit('debug', msg, fields); },
    info: (msg, fields) => { emit('info', msg, fields); },
    warn: (msg, fields) => { emit('warn', msg, fields); },
    error: (msg, fields) => { emit('error', msg, fields); },
  };
}

//? The process-wide root logger (instance id stamped so multi-instance logs disambiguate).
export const rootLog = createLogContext({ instance: process.env.WS_INSTANCE_ID ?? 'single' });
