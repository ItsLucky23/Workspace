# Workspaces — Build Log

> **Lees dit eerst bij verdergaan.** Dit is de levende voortgangsstatus van het bouwprogramma ([`BUILD_PROGRAM.md`](./BUILD_PROGRAM.md)). De uitvoerende AI **leest** de "Volgende actie", doet die stap volgens het uitvoeringsmodel, en **werkt daarna dit bestand bij** (vink af, verzet de pointer, append een logregel).

**Laatst bijgewerkt:** 2026-07-01 (0.1 code-port + wiring gedaan; geblokkeerd op dep-install + build-verify)
**Huidige fase:** 0 — Bootstrap (0.1 in uitvoering)
**Volgende actie:** Developer: `npm install motion @xterm/xterm @xterm/addon-fit node-pty` (node-pty = native, Windows-buildtools) → dan `npm run build` groen → server starten → prototype-UI op `/workspaces` verifiëren.

> Statuswaarden per stap: `todo` → `done` (gebouwd) → `verified` (Opus-verificatie groen). Een fase is af als alle stappen `verified` zijn.

---

## Status

### Fase 0 — Bootstrap & volledig schema
- [~] 0.1 Repo bootstrap — `in uitvoering` (code-port + hook-wiring + CLAUDE.md-graft done; wacht op dep-install + build-groen + UI-verify)
- [ ] 0.2 Volledig Prisma-schema — `todo`
- [ ] **Fase 0 verificatie (Opus)** — `todo`

### Fase 1 — Basisplatform (geen AI)
- [ ] 1.1 Auth/login — `todo`
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
- 2026-07-01 — Stap 0.1 (deels): deze verse `@luckystack/*`-repo IS de doelrepo. Gedaan: `src/workspaces/` (140 files incl. `_docs/`) gekopieerd; `server/hooks/workspacesTerminal.ts` overgezet + geregistreerd in de `luckystack/server/`-overlay (naast `registerNotificationHooks`); de 9 Workspaces-invarianten + read-order + 4 lanes in root `CLAUDE.md` § User Project Rules gegraft (i.p.v. de template pure te overschrijven — behoudt de framework-tooling). Bewuste afwijking: de `useWorkspaceData()`-seam NIET aangelegd in 0.1 — dat is Lane B's grootste refactor (15 files, MIGRATION §4) en heeft pas zin mét Prisma/socket-backing; het prototype draait al op dummy-data via directe `_data/seed`-imports (= 0.1-acceptatie). Geblokkeerd: build valt op 3 ontbrekende deps (`motion`, `@xterm/xterm`, `@xterm/addon-fit`) + server-dep `node-pty`. Volgende: developer installeert deps + start server; dan build-groen + UI-verify → `verified`.
