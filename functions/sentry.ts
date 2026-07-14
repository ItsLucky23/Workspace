//? Framework-default shim. Re-exports Sentry helpers from @luckystack/error-tracking
//? so they show up as `functions.sentry.<name>` inside every API + sync handler.
//?
//? Edit this file to wrap Sentry calls — add custom tags, sampling, scrubbing
//? logic. Your edits affect calls via `functions.sentry.X` in your own handlers.
//?
//? Framework-internal error-tracking is now hook-based (see
//? `node_modules/@luckystack/error-tracking/docs/auto-instrumentation.md`).
//? Editing this shim does NOT change the framework's automatic `setSentryUser`
//? / `startSpan` wiring on the API + sync hot paths.
//?
//? For framework-wide error-tracker override: use `registerErrorTracker()` or
//? `registerErrorTrackers([])` from @luckystack/error-tracking. That registry is
//? consumed by the auto-instrumentation and any custom `captureException` calls.
//? Re-export via module-specifier (`export … from`) so the codegen can
//? resolve real types at compile time. See `functions/redis.ts` for the
//? rationale.
export {
  initializeSentry,
  captureException,
  captureMessage,
  setSentryUser,
  startSpan,
} from '@luckystack/error-tracking';
export { default } from '@luckystack/error-tracking';
