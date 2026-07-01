# Workspaces — Build Program (gefaseerd, ultracode-uitvoerbaar)

> Dit is het **uitvoerbare bouwprogramma** voor Workspaces. Het vertaalt de design-corpus (`src/workspaces/_docs/`) + de tool-bouwplannen (`build-plans/`) naar fases en stappen die een AI met **ultracode** kan uitvoeren. Status + voortgang staan in **[`BUILD_LOG.md`](./BUILD_LOG.md)** — lees dat eerst als je verdergaat.
>
> **Bouwdoel:** een **verse repo** die `@luckystack/*` installeert (zie `src/workspaces/_docs/PORT_MANIFEST.md` + `MIGRATION.md`). Dit is GEEN bouw binnen de framework-monorepo.

---

## Uitvoeringsmodel (hoe je elke stap draait)

Elke stap is een **ultracode-workflow** met een vaste lus:

1. **Bulk-bouw — Haiku-agents.** Fan-out van Haiku-agents die het werk uit de stap-spec produceren (entiteiten, routes, componenten, tests), elk gegrond in de genoemde bron-docs. Waves van 3 om de rate-limit te ontwijken.
2. **Verificatie — Opus-agent.** Eén Opus-agent leest de diff + de **acceptatiecriteria** van de stap en levert een lijst **misses/fouten** (niet-gehaalde criteria, bugs, afwijkingen van de bouwplannen/locked decisions).
3. **Herstel — nieuwe Haiku-agents.** Verse Haiku-agents fixen alleen de gevonden misses. Daarna **herverifiëren** (terug naar 2) tot de Opus-verificatie groen is.
4. **Log bijwerken.** Markeer de stap in `BUILD_LOG.md` (`done` / `verified`) en append een logregel.

**Model-policy (getrapt — bevestigd 2026-06-15):**

| Werk | Model |
|---|---|
| Scaffolding, CRUD, UI-uit-spec, tests, docs, mechanische codegen | **Haiku** (default) |
| Engine/integratie: PTY-sessies, Conductor, container-runtime, RBAC-enforcement, codegen-injectie | **Sonnet** |
| Verificatie na elke stap/fase + architectuur-gevoelige beslissingen | **Opus** |

> Token-bewust: standaard Haiku; escaleer naar Sonnet alleen waar de stap dat aangeeft. Opus alleen voor verify (kort, gericht). Een fase is pas "klaar" als de Opus-verificatie groen is.

**Per-stap spec-formaat:** *Doel · Lees (bron-docs) · Model · Ultracode-recept · Acceptatie · Verificatie.*

---

## Fase 0 — Bootstrap & volledig schema (geen features)

Doel: een werkende verse repo met het **complete datamodel** en de contracten, zodat latere fases geen migratie-churn hebben.

- **0.1 — Repo bootstrap.** Lees: `PORT_MANIFEST.md`, `SETUP_AND_PREREQUISITES.md`, `MIGRATION.md`, `REPO_CLAUDE.template.md`. Model: Haiku. Recept: verse repo, `@luckystack/*` installeren, `src/workspaces/` + `server/hooks/workspacesTerminal.ts` overzetten, `REPO_CLAUDE.template.md` → root `CLAUDE.md`, `useWorkspaceData()`-seam aanleggen (`MIGRATION.md`). Acceptatie: repo build + de prototype-UI draait op dummy-data. Verificatie: Opus checkt dat niets uit de framework per ongeluk gekopieerd is (PORT_MANIFEST).
- **0.2 — Volledig Prisma-schema.** Lees: `04_DATA_MODEL.md`, `04b_DATA_MODEL_ADDENDA.md`, + de `## Datamodel`-secties van **alle** `build-plans/*.md`. Model: Sonnet. Recept: één schema met **alle** entiteiten voor alle fases — auth/User, Workspace/Membership/Role/Permission, Ticket/Board/Sprint, Pipeline/Stage/Preset, `AgentSession`, Signal/Suggestion/QuestionSet, Skill(`surface`), ModuleManifest/WorkspaceModule/ModuleArtifact/TicketArtifactLink, InterviewSession/InterviewCard, MarketingAssetRequest, Document-entiteiten, `InstanceImage`, Notification, Budget, AuditEntry. Acceptatie: `prisma migrate` slaagt, types gegenereerd, `types.ts` ↔ schema 1:1. Verificatie: Opus kruist elk bouwplan-datamodel tegen het schema (niets vergeten).

**Fase 0 verificatie (Opus):** repo bootstrapt, schema compleet & gemigreerd, prototype draait.

---

## Fase 1 — Basisplatform, nog GEEN AI

Doel: login, workspaces, invites, **volledige RBAC + settings**, en een werkend bord met tickets — alles zonder AI.

- **1.1 — Auth/login.** Lees: `features/17_ACCOUNT_AND_AUTH.md`. Model: Haiku. Recept: `@luckystack/login` wiren (registreren/login/sessie). Acceptatie: registreren + inloggen werkt. Verificatie: Opus + auth-sweep.
- **1.2 — Workspaces.** Lees: `features/01_WORKSPACE_SETUP.md`. Model: Haiku. Recept: workspace CRUD + aanmaak-flow. Acceptatie: workspace aanmaken/openen/wisselen.
- **1.3 — Invites via email.** Lees: `features/16_MEMBERS_AND_RBAC.md` + framework `@luckystack/email`. Model: Haiku. Recept: lid uitnodigen per email + accept-flow. Acceptatie: e-mail-invite → join werkt.
- **1.4 — RBAC volledig.** Lees: `features/16_MEMBERS_AND_RBAC.md`, `CONTROL_API.md` (§RBAC/`preApiExecute`), + de RBAC-noten in **alle** build-plans. Model: **Sonnet**. Recept: de **volledige permissie-catalogus voor álle komende fases** + rollen + enforcement op `preApiExecute`. Acceptatie: permissies afgedwongen; rollen toekenbaar. Verificatie: Opus checkt dekking tegen elke fase + auth-sweep.
- **1.5 — Workspace-settings surface (volledig).** Lees: `features/16/19` + de settings-noten in alle build-plans + `00-framework.md` (modules-toggle). Model: Haiku. Recept: **alle** settings-secties scaffolden (members/RBAC, modules aan/uit, integraties-slot, budget, container/instance) — leeg waar de feature later komt, maar de plek staat er. Acceptatie: elke sectie aanwezig + navigeerbaar.
- **1.6 — Bord & tickets (zonder AI).** Lees: `features/12_BOARD_AND_KANBAN.md`, `13_BACKLOG_AND_SPRINTS.md`. Model: Haiku. Recept: ticket CRUD + kanban-move + backlog/sprints (geen pipeline/AI). Acceptatie: tickets aanmaken/verslepen op een bord.

**Fase 1 verificatie (Opus):** registreren→login→workspace→invite→RBAC→settings→tickets op bord werkt end-to-end, zonder AI. → misses → Haiku-refix → herverifieer.

---

## Fase 2 — AI + pipeline + hulp-AI + image-builder

> **Gate:** start met de **P0.5 CLI-billing-spike** vóór enig container/PTY-werk.

- **2.0 — P0.5 spike (GATE).** Lees: `P0_CLI_SPIKE.md`. Model: Sonnet. Recept: bevestig subscription-billing op interactieve PTY, `type:http`-hooks, `/clear` vs `/compact`, per-turn-usage, `--resume`-na-crash, managed-token-projectie. Acceptatie: spike groen. **Blokkeert 2.1+ tot groen.**
- **2.1 — Orchestrator + Conductor + SessionManager.** Lees: `01_ARCHITECTURE.md`, `07_ORCHESTRATOR.md`, `02b_PROTOCOL_ADDENDA.md`, `08_DEPLOYMENT.md`. Model: **Sonnet**. Recept: deterministische kern (Conductor = enige schrijver), SessionManager (PTY-eigenaar + watchdog), leased orchestrator. Acceptatie: een PTY-sessie spawnen/teardownen onder de Conductor. Verificatie: Opus + `TESTING_STRATEGY.md` (event-log race, VERB_REGISTRY-conformance).
- **2.2 — Structured channel + hooks.** Lees: `02_PROTOCOL_AND_FLOW.md`, `02b_PROTOCOL_ADDENDA.md`. Model: Sonnet. Recept: verb-surface (GEEN nieuwe verbs), hook-ingress, signal-log. Acceptatie: agent→Conductor verbs end-to-end.
- **2.3 — Container-runtime.** Lees: `07b_CONTAINER_RUNTIME.md`. Model: **Sonnet**. Recept: drie-laags images, per-ticket/stage isolatie, hardening, CapacityManager, egress-proxy. Acceptatie: een stage draait in een container met de hardening-table actief.
- **2.4 — Image-builder per instance.** Lees: **`build-plans/05-image-builder.md`**. Model: Sonnet. Recept: Stack-wizard + template-catalogus + AI-Dockerfile-voorstel (`propose_suggestion`) + Admin-accept + Conductor-build + preview forward-auth. Acceptatie: template-stack bouwt + health-check; AI-voorstel vereist Admin-accept (LOCKED grens). Verificatie: Opus checkt dat AI nooit autonoom bouwt.
- **2.5 — Pipeline-systeem werkend.** Lees: `features/02_PIPELINE_PRESETS.md`, `03_BUILD_PHASE.md`, `GOLDEN_PLAN_STAGE.md`, `03_AUTOMATION_AND_PLUGINS.md`, `features/15_SOURCES_MANAGEMENT.md`. Model: Sonnet (engine) + Haiku (UI). Recept: pipeline-editor (stages editen), presets, skills toevoegen, docs toevoegen, links/carry-over; Stage-Agents voeren tickets uit met echte AI. Acceptatie: een ticket loopt door bewerkbare stages, AI-gedreven, in containers.
- **2.6 — Hulp-AI (Assistant) + notifications + question-forwarding.** Lees: `features/11_WORKSPACE_AI_PANEL.md`, `09_QUESTIONS_IN_TICKETS.md`, `18_NOTIFICATIONS.md`, `additions/05_answer_queue.md`, `CLIENT_AND_PUSH.md`. Model: Haiku (UI) + Sonnet (wiring). Recept: per-user Assistant-chat, notifications/reminders, `request_input`/QuestionSet → answer-queue → push; AI kan vragen naar de gebruiker forwarden. Acceptatie: Assistant chat + een AI-vraag bereikt de gebruiker (ook via push) + antwoord stroomt terug.

**Fase 2 verificatie (Opus):** ticket → bewerkbare pipeline → echte PTY-AI in container → Assistant + notifications + question-forward → AI-voorgestelde stack met Admin-accept. → misses → Haiku-refix → herverifieer.

---

## Fase 3 — Tool-modules

> Bouwvolgorde binnen de fase: **framework → Interviewer → Designer → Marketing-setup → Document.** Lees per stap het bijbehorende bouwplan + `build-plans/DECISIONS.md` (bindend) + `build-plans/INDEX.md`.

- **3.0 — Gedeeld tool-raamwerk.** Lees: `build-plans/00-framework.md`. Model: Sonnet. Recept: `ModuleManifest`+`registerModule()`, `WorkspaceModule` aan/uit, vrije mappenboom, Skill `surface`-filter, `ModuleArtifact`-store, artifact→ticket live-reference + picker. Acceptatie: een dummy-module verschijnt/verdwijnt via de settings-toggle; artifact koppelt aan een ticket.
- **3.1 — Interviewer (eerste tool).** Lees: `build-plans/01-interviewer.md`. Model: Haiku (UI) + Sonnet (reasoner-wiring). Recept: eigen pagina, one-shot reasoner → **korte batches** vragen+ideekaarten (`batchSize` 6, "wil je nog door?", resumable), phone-first stepper, make-ticket prefilled, history, kosten-melding, push bij klaar. Acceptatie: een sessie levert een batch, je beantwoordt, vraagt door of pauzeert/hervat, maakt er een ticket van.
- **3.2 — Designer Studio.** Lees: `build-plans/02-designer.md`. Model: Haiku (UI) + Sonnet (gen/preview-wiring). Recept: N codebase-bewuste varianten (preview+code), screenshot via always-on main-preview-server (opt-in), streaming, refine-lus, design-systeem als token-diff, artifacts + ticket-link. Acceptatie: skills selecteren → varianten → opslaan → koppelen.
- **3.3 — Marketing (V1 = setup only).** Lees: `build-plans/03-marketing.md`. Model: Haiku. Recept: pagina + folders + marketing-skill-config + aanvraagformulier-skelet (generatie disabled/V2) + pipeline-context-selector + Playwright-capture via pipeline-terminal + 1 media-API-slot. Acceptatie: skelet compleet, generatie zichtbaar "V2".
- **3.4 — Document Studio.** Lees: `build-plans/04-document.md` (incl. §"Harde grens"). Model: Haiku (UI) + Sonnet (omzetter-wiring). Recept: upload + generatie van PDF/Word/Excel/PPT via deterministische omzetter (LibreOffice/pandoc/ffmpeg in sandbox), round-trip, document-skills, grounding+citaties, niveau/toon-controls. **Geen anti-detectie-modus.** Acceptatie: een document genereert + downloadt; upload-parse in sandbox; geen "omzeil-detectie"-functie aanwezig.

**Fase 3 verificatie (Opus):** elke tool-module aan/uit via settings, output gekoppeld aan tickets; Document respecteert de harde grens. → misses → Haiku-refix → herverifieer.

---

## Wat dit programma NIET dekt (bewust)

Internet-facing exposure als default, container-registry/multi-host, de geparkeerde multi-provider/per-module-provider build, video-generatie (Marketing V2), en de HORIZON-additions. Deze komen pas na de drie fases en krijgen dan een eigen plan.
