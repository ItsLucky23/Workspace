//? Files in this folder are auto-loaded and merged into the `functions` parameter
//? that every API and sync handler receives. Each file's exports show up as
//? `functions.<filename>.<exportName>`.
//?
//? Edit `db.ts` / `redis.ts` / `session.ts` / `sentry.ts` to customize framework
//? defaults for your own handlers. Add new files (like this one) for project
//? helpers. Subfolders nest under their own key (so `functions/billing/stripe.ts`
//? becomes `functions.billing.stripe.<exportName>`).
//?
//? Hot-reload picks up changes automatically. Generated `Functions` typing in
//? `src/_sockets/apiTypes.generated.ts` is refreshed on save.
//?
//? For framework-wide overrides (session storage, error tracking, auth, etc.)
//? prefer `register<X>Adapter()` calls or hooks — see
//? `node_modules/@luckystack/core/CLAUDE.md` and
//? `docs/luckystack/ARCHITECTURE_EXTENSION_POINTS.md`. Edits in this folder only
//? affect your own handlers via the injected `functions` parameter.
export const getServerTime = (): string => new Date().toISOString();
