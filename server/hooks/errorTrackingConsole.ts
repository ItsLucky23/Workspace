//? Error-tracking OBSERVABILITY adapter (@luckystack/error-tracking). Registers a CONSOLE `ErrorTracker`
//? so we can SEE at runtime exactly what the framework routes to error-tracking — every captured exception /
//? message / identity / span — WITHOUT needing a Sentry/PostHog DSN. `enableErrorTrackingAutoInstrumentation`
//? wires the framework's hook subscribers (preApiExecute/postApiExecute/preSyncFanout/…) so the adapter also
//? receives request-lifecycle identity + span events, not just manual captures.
//?
//? This is a DEV/diagnostics adapter. In production, register a real backend adapter (`createSentryAdapter` /
//? `createPostHogAdapter`) alongside or instead — every capture fans out to ALL registered trackers, so a
//? per-adapter throw never breaks the chain. Set SENTRY_DSN / POSTHOG_KEY to add those.

import { appendErrorTracker, resolveEnvKey, type ErrorTracker, type ErrorTrackerContext, type ErrorTrackerUser } from '@luckystack/core';
import { enableErrorTrackingAutoInstrumentation } from '@luckystack/error-tracking';

//? Trim a context to a one-line summary so the console isn't flooded with deep objects.
function brief(context?: ErrorTrackerContext): string {
  if (!context) return '';
  const keys = Object.keys(context);
  return keys.length > 0 ? ` · ctx{${keys.join(',')}}` : '';
}

//? A console-logging ErrorTracker — the "what does error-tracking see?" window at runtime.
const consoleTracker: ErrorTracker = {
  name: 'console-observability',
  captureException: (error: unknown, context?: ErrorTrackerContext) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.log(`[error-track] EXCEPTION ${message}${brief(context)}`);
  },
  captureMessage: (message: string, level: 'info' | 'warning' | 'error' | 'fatal', context?: ErrorTrackerContext) => {
    console.log(`[error-track] MESSAGE [${level}] ${message}${brief(context)}`);
  },
  setUser: (user: ErrorTrackerUser | null) => {
    console.log(`[error-track] setUser ${user ? (user.id ?? user.email ?? 'anon') : '(cleared)'}`);
  },
  setContext: (key: string, context: ErrorTrackerContext | null) => {
    console.log(`[error-track] setContext ${key}${context ? brief(context) : ' (cleared)'}`);
  },
};

//? Register the console tracker + wire the framework hook subscribers. `appendErrorTracker` accumulates
//? (dedupes by name), so a later `createSentryAdapter(...)` registration coexists with this one.
export function registerConsoleErrorTracker(): void {
  appendErrorTracker(consoleTracker);
  enableErrorTrackingAutoInstrumentation();
  if (resolveEnvKey() !== 'production') {
    console.log('[error-track] console observability adapter active — set SENTRY_DSN/POSTHOG_KEY to add a real backend');
  }
}
