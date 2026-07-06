---
id: 0073
title: Tenant-isolation guard via an ai:lint rule (not a full tenantDb fold)
status: accepted
date: 2026-07-06
tags: [security, tenancy, hardening, ai-lint, depth-program]
supersedes: []
depends_on: [0072, 0001]
---

# H1 — a plain-`prisma` read/write on a `workspaceId` model can never silently leak

## Context

`GAP_ANALYSIS.md` cross-cutting #1: `tenantDb`'s loud-fail row-isolation covers only the ~24
core `TENANT_MODELS`. Every newer model (Service/Forge/Environment/CI/Deploy + the ENTIRE content
set — 55 models carry `workspaceId`) lives OUTSIDE that guarantee and relies on hand-written
`workspaceId` filters on a plain `prisma` client. One forgotten filter = a silent cross-tenant
leak; one already existed (`environment.findMany({ status:'live' })`, unscoped).

`DEPTH_PROGRAM.md` H1 offered two branches: (a) fold every `workspaceId` model into `tenantDb`'s
`TENANT_MODELS`, OR (b) an `ai:lint` rule that forbids a plain-`prisma` read/write on a
`workspaceId` model.

## Decision

Chose branch (b) — a new diff-scoped `tenant-scope` `ai:lint` rule — plus fixing the one known
unscoped call.

- **The rule:** in `server/**` code, a `prisma.<model>.<read|write>(…)` on any of the 55
  `workspaceId`-carrying models that does NOT constrain by `workspaceId` on the call line is a
  finding. `tenantDb.*` is exempt (it keys off the literal `prisma.` receiver). A deliberate
  cross-tenant sweep documents itself with `// luckystack-allow tenant-scope: <why>`.
- **The known leak:** `reassertEnvironmentRoutes`'s `environment.findMany` is a leader-gated boot
  self-heal that MUST see every workspace's live envs — marked with the allow-comment (it is a
  correct cross-tenant sweep, not a leak).
- **Verify:** six selftest cases (`npm run ai:lint -- --selftest`, 22/22) assert the rule flags an
  unscoped read/create, passes a `workspaceId`-scoped read, passes `tenantDb.*`, honors the
  suppression, and ignores non-server files. Content-model reads are runtime-unchanged.

## Rejected alternatives

- **Fold all 55 models into `TENANT_MODELS` + switch 163 call sites across 29 files to `tenantDb`.**
  Rejected for this item — a large, risky refactor that would break the legitimate cross-tenant
  sweeps (leader reconciler, boot self-heal, cross-workspace admin reads) unless each is hand-audited.
  The lint guard gives the same "a NEW forgotten filter is caught" guarantee at diff-time without
  touching runtime behaviour. The mechanical legacy call-site migration to `tenantDb` remains an
  OPEN follow-up (it is safe to do incrementally; the guard makes regressions visible meanwhile).
- **A runtime `$extends` guard on the framework `prisma` singleton.** Rejected — it would also
  intercept framework-global tables (`User`/session store) and the legitimate sweeps, and risks
  boot-time breakage across the framework.

## Consequences

- New `tenant-scope` rule in `scripts/lintInvariants.mjs` (report-only by default; opt into blocking
  via `luckystack.invariants.json`). Diff-scoped, so existing legacy call sites are NOT retroactively
  blocked; only newly-added/edited lines are checked. An `--paths` audit surfaces the full legacy
  list (~100 call sites) as the migration backlog.
- OPEN follow-up: incrementally migrate the flagged legacy plain-`prisma` tenant call sites to
  `tenantDb` (or add explicit `workspaceId` filters / allow-comments) so the audit list drains.
