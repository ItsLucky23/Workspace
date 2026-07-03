# Workspaces `/goal` — voortgangsrapport (10 van 14)

> **Laatst bijgewerkt:** 2026-07-03 · **Branch:** `main` (lokaal, **NIET gepusht**) · **Author:** ItsLucky23 (geen co-author)
> **Voor:** een one-glance overzicht als je thuiskomt — wat werkt, wat nog niet volledig live-getest is, en wat ik nog van jou nodig heb.

---

## TL;DR

- **10 van de 14 items zijn af, verwerkt en getest.** Elk item is per stuk gecommit (waterfall): bouw → verify → test → ADR → branch-log → commit.
- **Alles staat lokaal op `main`, niets gepusht** (zoals afgesproken). Elke commit is van author *ItsLucky23*, zonder Claude co-author.
- **Volledige verificatieronde (zojuist) is groen:**
  - `server-tsc` 0 · `front-tsc` 0 · `eslint` 0 (over álle toegevoegde files) · `ai:lint` 0 invariant-violations
  - **Integration-suite: 30/30 test-files groen** (elk nieuw item bracht een eigen test mee)
  - Backend boot schoon · `/healthz` + `/readyz` + `/metrics` → 200 · browser: board/usage/pipeline renderen, console schoon, socket connected
- **Nog te doen: 4 items** — #10 (forge-uitbreiding), #14 (editor-losse-eindjes), #15 (multi-instance Deel B), #7 (self-host installer + DR). Zie onder + de aparte `REMAINING_WORK.md`.

---

## Wat er af is (10 items)

| # | Item | Commit | Wat het doet | Status |
|---|------|--------|--------------|--------|
| 13 | Ticket-priority + notificatie-voorkeuren | `f5fa55e` | `priority` op tickets (urgent = hotfix-tier), notificatie-prefs | ✅ werkt · ⚠️ zie blocker 1 |
| 12 | CapacityManager hard-cap | `d6e66a6` | Atomic ZSET-Lua admission-queue, urgent forceert erlangs (approval blijft) | ✅ logica getest · ⚠️ container-pad = Docker |
| 9 | Echte git-merge | `b3a7192` | Branch→target via merge-worktree, conflict-abort, `git revert` rollback, merge vereist ≥1 approval | ✅ logica getest · ⚠️ bare-repo-pad = git/Docker |
| 1 | Watchdog + resumeAll crash-recovery | `48462eb` | Idle/stuck-detectie, resume-on-boot | ✅ getest (pure + DB) |
| 11 | In-container pty-agent | `d0567a8` | Durable scrollback-ring, crash-resume, TCP line-JSON relay | ✅ logica getest · ⚠️ live = Docker |
| 17 | Client-gaten dichten | `c3fffcf` | needs-input "Send" → antwoordt écht aan de AI, realtime presence, echte usage-cijfers | ✅ getest + browser |
| 16 | Kosten-/token-tracking | `9489097` | Token-schatting per turn, alleen tónen (geen harde stop) | ✅ getest + browser |
| 5 | Observability | `829313a` | Structured logging, `/metrics` (Prometheus), `/healthz`, flow-insights | ✅ getest + browser + endpoints 200 |
| 2 | Automation / plugin-engine | `3f778b9` | WorkspaceTrigger + ActionExecutor (approval-gate) + AgentRole-registry + cron | ✅ getest + **browser end-to-end** (trigger vuurde → notificatie) |
| 4 | Token self-handoff | `c13b71d` | Budget → handoff → reset → reload, PreCompact-backstop | ✅ getest + browser (budget-UI persisteert) · ⚠️ live PTY-reset = Docker |

*(Elke commit heeft een bijbehorende `docs/decisions/00NN-*.md` ADR + branch-log-entry.)*

---

## Wat 100% werkt (headless bewijsbaar)

Alle **business-logica en data-flows** zijn end-to-end getest tegen de echte Mongo/Redis en via de UI:

- Priority-flow, capacity-admission (atomic), merge-logica (conflict/rollback), watchdog-classificatie, spend-aggregatie, insights-berekening, automation-triggers (matching/debounce/dedupe/approval-gate/cron), handoff (parse/budget/record/reset/reload).
- **Realtime + UI**: board, pipeline (incl. de nieuwe Automation-panel + Context-budget-input), usage-page (StatCards), needs-input-antwoord, presence — allemaal renderen + de writes lopen via de control-plane (single-writer, B-23) en persisteren aantoonbaar in de DB.
- **Observability-endpoints**: `/healthz`, `/readyz`, `/metrics` geven live 200.

## Wat gebouwd + gewired is, maar alleen met Docker/live volledig te e2e-testen

De **logica** hiervan is getest; het **container-/PTY-/bare-git-pad** draait pas met Docker up en een echte engine-run:

- **#11 pty-agent** — draait ín de ticket-container; de scrollback/crash-resume-logica is getest, de live PTY-relay heeft een draaiende container nodig.
- **#4 live handoff** — de `/clear`-reset (verse claude-sessie) + reload draait pas met Docker + een sessie die écht over budget gaat. Parse/budget/record/reload zijn wél headless getest.
- **#9 echte merge in de bare repo** en **#12 container-capacity** — logica getest; het echte git-merge- resp. container-admission-pad vereist de git-server/Docker.

> Dit is geen "onaf", maar "de deterministische kern is bewezen; de laatste integratie-stap tegen Docker/git heb ik headless niet kunnen forceren". Zodra Docker + een engine-run live zijn, is dit een kwestie van één smoke-test per item.

---

## ⚠️ Wat ik nog van JOU nodig heb

1. **Docker draaiend** (met `WS_DOCKER_BIN` gezet) — om #11/#4-live/#9/#12 het container-/PTY-pad te laten smoke-testen. Nu is dat pad gebouwd + unit/integration-getest, maar niet live gedraaid.
2. **Beslissing framework-bug (#13, blocker 1 hieronder)** — de notificatie-prefs *tonen* werkt, maar *opslaan* botst op een framework-bug in `@luckystack/core`. Wil je (a) dat ik 'm in de framework-packages fix (staat dat deze repo toe?), (b) een consumer-side workaround, of (c) laten liggen?
3. **Beslissingen voor de resterende items** (details in `REMAINING_WORK.md`):
   - **#10 forge**: welke forge eerst — GitHub-forge, de built-in git-server, en/of GitLab-webhook-ingest? Heb je een test-GitHub/GitLab-instantie + token dat ik mag gebruiken?
   - **#7 self-host installer**: op welke doel-omgeving moet de from-scratch install draaien+getest worden? (dit kan de dev-setup verstoren — vandaar als laatste.)
4. **Optioneel**: een `SENTRY_DSN` als je de error-tracking live wil (nu inactief — benigne).

---

## Bekende blockers / limitaties

1. **Framework `validateType`-recursie (blokkeert notificatie-pref SAVE, #13).** Een geneste `|` binnen een object-type (optionele boolean `undefined|false|true`) triggert een union-branch die tot depth-64 recurseert in `@luckystack/core`. Raakt bestaande toggles ook. **Niet fixbaar vanuit deze consumer-repo** (geen `packages/`). Gemeld in ADR 0019. → beslissing 2 hierboven.
2. **Engine-advance broadcast een realtime-delta niet** (bekende follow-up, niet van mij): als de engine een ticket naar de volgende stage schuift, komt dat pas na refetch binnen — er is een framework sync-emit-API voor nodig (bundle-intern).
3. **Andere AI actief in dezelfde repo** — ik heb alleen mijn eigen files gestaged; z'n WIP (`caddyRoutes.ts` e.d.) staat los en blokkeert mijn tsc/lint niet.

---

## Verificatie-commando's (om zelf te herhalen)

```bash
npx tsc -p tsconfig.server.json --noEmit   # server-tsc → 0
npx tsc -p tsconfig.json --noEmit          # front-tsc → 0
npm run ai:lint                            # invariant-linter → 0
node scripts/runWsTests.mjs integration    # 30/30 test-files
curl -s localhost:80/healthz               # {"status":"ok"}
```

Zie **`REMAINING_WORK.md`** (zelfde map) voor de 4 resterende items in detail.
