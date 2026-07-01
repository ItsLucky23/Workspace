//? LuckyStack scaffold-template selection rules — CONSUMER-EDITABLE.
//?
//? @luckystack/devkit auto-loads this file in DEV (only) before the first
//? template injection. It decides which template a newly-created EMPTY file
//? under `src/` receives. Edit it freely:
//?   - remove a rule to drop that behavior,
//?   - change a predicate to re-target it,
//?   - add brand-new template kinds with `registerTemplateKind`.
//? Delete this whole file to fall back to devkit's built-in defaults.
//?
//? A rule = `{ kind, match(ctx), priority? }`. The first matching rule wins,
//? evaluated by descending `priority` (ties: newest registration first).
//? `ctx` = { filePath, fileKind, hasPairedServer, srcRelativePath }, where
//? `fileKind` is one of: 'api' | 'sync_server' | 'sync_client' | 'page'.
//?
//? Template CONTENT for each kind is resolved, in order:
//?   1. .luckystack/templates/<kind>.template.ts(x)  <- edit these to change content
//?   2. a registerTemplate('<kind>', '...') string override
//?   3. devkit's bundled default                      <- delete the file in (1) to use this

import {
  clearTemplateRules,
  registerTemplateRule,
  // registerTemplateKind, // <- uncomment to add custom kinds (see the example at the bottom)
} from '@luckystack/devkit';

//? Which page paths get the dashboard layout (sidebar + login guard) vs. the
//? plain page. This is the exact regex devkit ships as its default — inlined
//? here so you can SEE and EDIT it directly instead of it being hidden behind
//? an imported constant. It matches any path containing one of these segments:
//?
//?   src/admin/page.tsx       -> dashboard   (matches /admin)
//?   src/dashboard/page.tsx   -> dashboard
//?   src/settings/team/page.tsx -> dashboard (matches /settings)
//?   src/billing/page.tsx     -> dashboard
//?   src/account/page.tsx     -> dashboard
//?   src/profile/page.tsx     -> dashboard
//?   src/about/page.tsx       -> plain       (no match -> falls to page_plain)
//?   src/page.tsx (home)      -> plain
//?
//? Add a segment (e.g. `|reports`) or swap the whole regex for your own — e.g.
//? `/\/app\//` to only treat pages under `src/app/` as dashboard pages.
const DASHBOARD_PATH_PATTERN = /\/(admin|dashboard|settings|billing|account|profile)(\/|$)/;

//? Start from a clean slate so THIS file is the single source of truth for the
//? selection logic. Comment this line out to KEEP devkit's built-in defaults
//? and only ADD/override rules below.
clearTemplateRules();

// --- API routes (src/<page>/_api/<name>_v<N>.ts) ---
registerTemplateRule({ kind: 'api', priority: 10, match: (ctx) => ctx.fileKind === 'api' });

// --- Sync events (src/<page>/_sync/<name>_(server|client)_v<N>.ts) ---
registerTemplateRule({ kind: 'sync_server', priority: 10, match: (ctx) => ctx.fileKind === 'sync_server' });
registerTemplateRule({ kind: 'sync_client_paired', priority: 10, match: (ctx) => ctx.fileKind === 'sync_client' && ctx.hasPairedServer });
registerTemplateRule({ kind: 'sync_client_standalone', priority: 10, match: (ctx) => ctx.fileKind === 'sync_client' && !ctx.hasPairedServer });

// --- Pages (src/<path>/page.tsx) ---
//? Pages whose path matches DASHBOARD_PATH_PATTERN (defined + documented at the
//? top of this file) get the dashboard layout (sidebar + login guard);
//? everything else gets the plain page. Edit the pattern above, or add your own
//? page kinds below.
registerTemplateRule({
  kind: 'page_dashboard',
  priority: 10,
  match: (ctx) => ctx.fileKind === 'page' && DASHBOARD_PATH_PATTERN.test(ctx.filePath.replaceAll('\\', '/').toLowerCase()),
});
//? Catch-all for pages — lowest priority so the dashboard rule is tried first.
registerTemplateRule({ kind: 'page_plain', priority: 0, match: (ctx) => ctx.fileKind === 'page' });

// --- Example: add a custom template kind ---
//? 1. Create `.luckystack/templates/page_marketing.template.tsx` (copy page_plain as a start).
//? 2. Uncomment the `registerTemplateKind` import above and the block below.
// registerTemplateKind('page_marketing', {
//   priority: 20, // higher than page_dashboard/page_plain so it wins for matching pages
//   match: (ctx) => ctx.fileKind === 'page' && ctx.filePath.replaceAll('\\', '/').includes('/marketing/'),
// });
