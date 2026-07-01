# Workspaces — Build Log

> **Lees dit eerst bij verdergaan.** Dit is de levende voortgangsstatus van het bouwprogramma ([`BUILD_PROGRAM.md`](./BUILD_PROGRAM.md)). De uitvoerende AI **leest** de "Volgende actie", doet die stap volgens het uitvoeringsmodel, en **werkt daarna dit bestand bij** (vink af, verzet de pointer, append een logregel).

**Laatst bijgewerkt:** 2026-07-01 (Fase 1: backend + read/write-path END-TO-END getest tegen echte Mongo via echte HTTP — seed/snapshot/control-API bewezen)
**Huidige fase:** 1 — Basisplatform (backend + read/write-path E2E-getest tegen echte Mongo; schermen-rewire + resterende ops volgen)
**Volgende actie:** de **15 schermen rewiren** van `_data/seed` → de `useWorkspaces()`-context (mechanisch — de Provider levert de live snapshot-data al) + browser-verify; de **~16 resterende control-ops** in de Conductor implementeren (invite/remove-member/sprint/bulk/gitlab/etc.). **Developer-note:** elke nieuwe `_api`-route heeft `export const validation = 'relaxed'` nodig (framework devkit-validator-bug, lesson 0002). Rollback: t/m `59ff8b7`.

> Statuswaarden per stap: `todo` → `done` (gebouwd) → `verified` (Opus-verificatie groen). Een fase is af als alle stappen `verified` zijn.

---

## Status

### Fase 0 — Bootstrap & volledig schema
- [x] 0.1 Repo bootstrap — `verified` (port + hooks + CLAUDE.md-graft + deps; splat→framework-native routes; build groen; UI geverifieerd op `/workspaces` via chrome-devtools MCP)
- [x] 0.2 Volledig Prisma-schema — `verified` (27 modellen: `04b §6–§11`-bodies letterlijk + §13 field-sweep + §2 nieuwe modellen; composite types voor stage-config; geen §18-deferred leaks; `prisma validate`+`generate` groen; adversariële Opus-verify *ship-ready*; ADR `0001` vastgelegd)
- [ ] **Fase 0 verificatie (Opus)** — `todo`

### Fase 1 — Basisplatform (geen AI)
- [x] **1.0 Foundation + data-seam** — `E2E-verified` (tegen echte Mongo via echte HTTP): schema `db push`, demo-seeder, bootstrap-on-first-login, read-snapshot, `useWorkspaceData()`-Provider, control-API (create-workspace/save-env/change-role persisteren). Tenant-laag + Conductor. Resteert: schermen-rewire + de overige control-ops: `types.ts §15`-backfill (canonical shapes mirroren het schema); tenant-laag (`server/tenant/` — `runInTenant`/`tenantDb $extends`/per-workspace Redis-formatter, boot-wired); frozen **control-API-contract** (`_functions/controlApi.ts`); **Conductor-referentie-slice** (in-process serial writer, ADR 0002) + `control_v1`-route + `bootstrapWorkspace()`. OAuth-login werkt al (user-getest).
- [ ] 1.1 Auth/login — `todo` (OAuth ✓; SSH-key terminal-gate + account-UI-wiring resteert)
- [ ] 1.2 Workspaces — `todo`
- [ ] 1.3 Invites via email — `todo`
- [ ] 1.4 RBAC volledig — `todo`
- [ ] 1.5 Workspace-settings surface — `todo`
- [ ] 1.6 Bord & tickets (zonder AI) — `todo`
- [ ] **Fase 1 verificatie (Opus)** — `todo`

### Fase 2 — AI + pipeline + hulp-AI + image-builder
- [ ] 2.0 P0.5 CLI-billing-spike (GATE) — `todo`
- [ ] 2.1 Orchestrator + Conductor + SessionManager — `todo`
- [ ] 2.2 Structured channel + hooks — `todo`
- [ ] 2.3 Container-runtime — `todo`
- [ ] 2.4 Image-builder per instance — `todo`
- [ ] 2.5 Pipeline-systeem werkend — `todo`
- [ ] 2.6 Hulp-AI + notifications + question-forwarding — `todo`
- [ ] **Fase 2 verificatie (Opus)** — `todo`

### Fase 3 — Tool-modules
- [ ] 3.0 Gedeeld tool-raamwerk — `todo`
- [ ] 3.1 Interviewer — `todo`
- [ ] 3.2 Designer Studio — `todo`
- [ ] 3.3 Marketing (setup only) — `todo`
- [ ] 3.4 Document Studio — `todo`
- [ ] **Fase 3 verificatie (Opus)** — `todo`

---

## Logboek (append-only — nieuwste onderaan)

- 2026-06-15 — Bouwprogramma + log opgesteld in de handoff. Nog geen code gebouwd. Volgende: Fase 0, stap 0.1 in een verse `@luckystack/*`-repo.
- 2026-07-01 — Stap 0.2: volledig V1 Prisma-schema (`prisma/schema.prisma`, 27 modellen) gebouwd + geverifieerd. `04b §6–§11`-bodies veld-voor-veld overgenomen; §13 field-sweep compleet; §2-nieuwe modellen (CarryOver/Handoff/QuestionSet/WorkspaceTrigger/AgentSession) present; rijke stage-config als composite `type`s; losse ObjectId-refs (cascade+tenant app-enforced). 0 §18-deferred leaks (adversariële Opus-verify: *ship-ready*). Ontwerpkeuzes → ADR `docs/decisions/0001-workspaces-v1-schema-shape.md`. `validate`+`generate`+`vite build` groen (offline; `db push` = latere Lane-B developer-actie). Volgende: Fase 0-verificatie (Opus) → Fase 1.1 Auth; los: `types.ts §15`-backfill + i18n-migratie.
- 2026-07-01 — Stap 0.1 (deels): deze verse `@luckystack/*`-repo IS de doelrepo. Gedaan: `src/workspaces/` (140 files incl. `_docs/`) gekopieerd; `server/hooks/workspacesTerminal.ts` overgezet + geregistreerd in de `luckystack/server/`-overlay (naast `registerNotificationHooks`); de 9 Workspaces-invarianten + read-order + 4 lanes in root `CLAUDE.md` § User Project Rules gegraft (i.p.v. de template pure te overschrijven — behoudt de framework-tooling). Bewuste afwijking: de `useWorkspaceData()`-seam NIET aangelegd in 0.1 — dat is Lane B's grootste refactor (15 files, MIGRATION §4) en heeft pas zin mét Prisma/socket-backing; het prototype draait al op dummy-data via directe `_data/seed`-imports (= 0.1-acceptatie). Geblokkeerd: build valt op 3 ontbrekende deps (`motion`, `@xterm/xterm`, `@xterm/addon-fit`) + server-dep `node-pty`. Volgende: developer installeert deps + start server; dan build-groen + UI-verify → `verified`.
