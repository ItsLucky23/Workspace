# Findings index

> Every AI scan / findings-set / analysis lives in a date-led subfolder here
> (`<YYYY-MM-DD>-<slug>/`), each with its own `README.md` status ledger. See
> `docs/FINDINGS_PROTOCOL.md` for the rules. This index lists them all so open
> items are never lost during a cleanup.

Last updated: 2026-07-16

| Date | Folder | Topic | Items | Rollup status |
| --- | --- | --- | --- | --- |
| 2026-07-16 | [2026-07-16-v070-ci-publish-readiness/](./2026-07-16-v070-ci-publish-readiness/) | v0.7.0 CI publication: cross-platform lock closure and provenance publish | 2 | 1 in-progress · 1 fixed |
| 2026-07-16 | [2026-07-16-v070-npm-audit-readiness/](./2026-07-16-v070-npm-audit-readiness/) | v0.7.0 npm audit readiness: three moderate OpenTelemetry nodes + one low esbuild advisory | 2 | 0 open · 2 fixed |
| 2026-07-16 | [2026-07-16-v066-vitest-core-alias-handoff/](./2026-07-16-v066-vitest-core-alias-handoff/) | Validate v0.6.6 consumer handoff: Vite core alias breaks server-side Vitest imports | 2 | 0 open · 2 fixed |
| 2026-07-16 | [2026-07-16-v070-orm-runtime-readiness/](./2026-07-16-v070-orm-runtime-readiness/) | v0.7.0 evidence audit: Prisma/MikroORM/Drizzle × Node/Bun | 5 | 0 open · 4 fixed · 1 wontfix |
| 2026-07-16 | [2026-07-16-npm-vs-bun-benchmark/](./2026-07-16-npm-vs-bun-benchmark/) | npm+node vs Bun benchmark (runtime, HTTP, install) | — | analysis (no defects) — Bun 1.83× faster on realistic HTTP; install winner depends on clean vs repeat |
| 2026-07-16 | [2026-07-16-unpushed-branch-review/](./2026-07-16-unpushed-branch-review/) | Review of all unpushed commits + working-tree changes | 7 | 0 open · 7 fixed |
| 2026-07-15 | [2026-07-15-scaffold-e2e/](./2026-07-15-scaffold-e2e/) | Real-registry scaffold + install e2e (`npm run e2e:verdaccio`) | 1 | 0 open · 1 fixed |
| 2026-07-15 | [2026-07-15-type-generation/](./2026-07-15-type-generation/) | Wire-type lie + ORM degradation — **projection shipped, T1/T2/T11/T14 all closed** | 18 | 0 open · 11 fixed · 3 wontfix · 2 informational · 1 false-positive · 1 superseded |
| 2026-07-15 | [2026-07-15-bun-feasibility/](./2026-07-15-bun-feasibility/) | Bun runtime + PM + **router WS proxy** — runtime, PM, all 4 databases verified on both runtimes; router proxies WS on node, refuses on bun (upstream) | 22 | 0 open · 20 fixed · 1 wontfix · 1 mitigated |
| 2026-07-02 | [2026-07-02-security/](./2026-07-02-security/) | Security & correctness scan (10 agents, full codebase) | 13 | 0 open · 10 fixed · 3 wontfix |

> Product/runtime/audit release-readiness findings are terminal. Publication finding
> CI-01 remains in progress until corrected Linux CI and the provenance publish confirm
> the repaired cross-platform lockfile.

> **Rollups drift.** This table claimed "5 open" for type-generation (actually 0, since 2026-07-15)
> and "1 open" for scaffold-e2e (fixed the same day) until 2026-07-16. A stale rollup is worse than
> no rollup: it is what a later cleanup reads to decide what is safe to delete. Re-tally from the
> folder's own ledger whenever you touch a row — the per-item status lines are the source of truth,
> this table is a convenience.

<!--
Add a row per findings-folder, e.g.:
| 2026-07-14 | 2026-07-14-security/ | Security scan | 12 | 3 open · 9 fixed |
Rollup status = a quick tally (open / in-progress / terminal) from that folder's ledger.
-->
