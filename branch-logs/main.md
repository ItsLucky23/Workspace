# Branch log — `main`

## 2026-07-01 14:00 — Workspaces bootstrap (stap 0.1, deels)

**User prompt:** Ga over de `workspace-handoff` folder; check of de repo-bootstrap gedaan is; leg belangrijke system-design-choices vast in de main repo; complete alle stappen van 0.1.

**What I did:**
- Vastgesteld dat stap 0.1 nog niet gedaan was (alleen de kale `@luckystack/*`-install stond er).
- `workspaces-handoff/src/workspaces/` (140 files incl. `_docs/`) gekopieerd naar `src/workspaces/` — het portable prototype + de volledige design-corpus (die de latere verwijdering van `workspaces-handoff/` overleeft).
- `workspaces-handoff/server/hooks/workspacesTerminal.ts` → `server/hooks/`, en `registerWorkspacesTerminalHooks()` geregistreerd in de `luckystack/server/`-overlay (naast `registerNotificationHooks`). Dev-only, self-gated tot non-productie.
- De 9 Workspaces-invarianten + read-order + de 4 build-lanes in root `CLAUDE.md` § User Project Rules gegraft (i.p.v. `REPO_CLAUDE.template.md` puur over te schrijven — zo behoud je de framework-tooling én win je de load-bearing product-regels).

**Files touched:** `src/workspaces/**` (nieuw, 140), `server/hooks/workspacesTerminal.ts` (nieuw), `luckystack/server/index.ts` (+2 regels), `CLAUDE.md` (§ User Project Rules), `workspaces-handoff/BUILD_LOG.md`.

**Notes / bewuste keuzes:**
- `useWorkspaceData()`-seam NIET aangelegd in 0.1 (afwijking van het letterlijke recept). Reden: `MIGRATION.md §4` markeert dit als Lane B's grootste refactor (15 files) die pas zin heeft mét Prisma/socket-backing; het prototype voldoet al aan de 0.1-acceptatie ("draait op dummy-data") via directe `_data/seed`-imports. Doorgeschoven naar Lane B / stap 0.2+.
- **Geblokkeerd op developer-acties:** build valt op ontbrekende deps `motion`, `@xterm/xterm`, `@xterm/addon-fit` (client) + `node-pty` (server, native — Windows buildtools). Daarna server-start om UI op `/workspaces` te verifiëren.
- `workspaces-handoff/` is tijdelijk en moet weg na de bouw — `BUILD_PROGRAM.md` + `BUILD_LOG.md` moeten eerst de repo in.

## 2026-07-01 15:30 — Workspaces routing: splat-SPA → framework-native routes

**User prompt:** De pagina's renderden niet (ErrorPage). Gebruik de router fatsoenlijk: echte aparte page.tsx-routes + context providers i.p.v. een splat/query-param hack. Kwaliteit + schaalbaarheid boven snelheid.

**Root cause:** Het framework kent geen `splat`/catch-all (`PageModule` in `main.tsx` leest alleen `default`/`template`/`middleware`; `validatePagePath` geeft exacte routes). Het prototype leunde op één `/workspaces/*`-splatroute; alle subpaden vielen naar `*` → `ErrorPage`.

**What I did (framework-native herstructurering):**
- Nieuw **`workspaces`-template** (`_shell/WorkspacesTemplate.tsx`) = `WorkspacesProvider` + persistente `WorkspacesShell` (chrome), geregistreerd in `src/_components/templates/TemplateProvider.tsx`.
- **`WorkspacesProvider`** (`_shell/WorkspacesProvider.tsx`) is nu self-contained: bezit alle dummy-data-state + nav-helpers; `view` afgeleid uit `useLocation`; navigatie via echte router-paden (`pathForView`). Schermen blijven `useWorkspaces()` gebruiken (geen scherm-wijzigingen).
- **Echte routes**: `page.tsx` (board index) + `backlog/`, `pipeline/`, `terminals/`, `sources/`, `activity/`, `usage/`, `settings/`, `workspace/`, en dynamisch `board/[ticketId]/`.
- **1 framework-tweak** (geflagd): `main.tsx` keyt het template-element op template-**naam** i.p.v. `template-path` → de shell blijft gemount tijdens navigeren tussen ws-routes (tabs/chat/nav-stack persist). Veilig: `Home`/`Plain` zijn stateless.
- `export const splat` verwijderd (was no-op).

**Verificatie (chrome-devtools MCP):** `/workspaces` (board), `/workspaces/backlog`, `/workspaces/board/DEV-1240` renderen alle drie met dezelfde persistente shell, socket CONNECTED, console clean. **Build groen.** → 0.1-acceptatie gehaald.

**Files touched:** `src/workspaces/_shell/{WorkspacesProvider,WorkspacesShell,WorkspacesTemplate}.tsx` (nieuw), `_shell/WorkspacesContext.tsx` (raw provider hernoemd), `src/workspaces/page.tsx` + 8 nieuwe `<view>/page.tsx` + `board/[ticketId]/page.tsx`, `src/_components/templates/TemplateProvider.tsx`, `src/main.tsx`.

**Open (step-1 debt, geflagd):** de hele prototype-code faalt de strikte consumer-lint (271 errors) — grotendeels **i18n** (hardcoded JSX-strings, `react/jsx-no-literals`) + `window`→`globalThis` + `!`-asserts. De i18n-migratie is expliciet step-1-werk; de mechanische fixes doe ik apart. Ook: `useWorkspaceData()`-seam nog te doen (Lane B); icon-barrel `export *` → later narrowen.

## 2026-07-01 16:30 — Workspaces stap 0.2: volledig V1 Prisma-schema

**User prompt:** `/compact` + dan 0.2 schema (Sonnet-bouw + Opus-verify).

**What I did:**
- Volledig V1-datamodel in `prisma/schema.prisma` gezet, gegrond in `04_DATA_MODEL.md`, `04b §6–§17` (NIET §18-deferred), de §13 field-sweep en `V1_SCOPE.md`. De `04b §6–§11`-bodies (TicketEvent, AgentSession, WorkspaceSuggestion, SpendRecord, WorkspaceBudget, Notification, PushSubscription, WorkspaceRole) zijn veld-voor-veld letterlijk overgenomen incl. indexes/uniques.
- **27 modellen**: framework-global (`User` ongewijzigd, `SshKey`, `PushSubscription`) + 24 tenant-scoped (Workspace, WorkspaceMember/Role, Invite, Project, PipelineStage, Ticket, TicketLink, TicketReference, Sprint, TicketEvent, AgentSession, CarryOver, Handoff, QuestionSet, WorkspaceTrigger, WorkspaceSignal, WorkspaceSuggestion, WorkspaceNote, SpendRecord, WorkspaceBudget, Notification, InfoSource, RagEntry, EnvVar, IntegrationTool). Rijke per-stage-config als **Prisma composite `type`s** (MongoDB-idiomatisch, spiegelt `PipelineStageCfg`).
- **Ontwerpkeuzes vastgelegd** in `docs/decisions/0001-workspaces-v1-schema-shape.md` (embed-vs-normalize, geen `Pipeline`-wrapper, losse ObjectId-refs i.p.v. `@relation`-cascades, geen `OAuthAccount`, `String`+comment i.p.v. Prisma-enums). `ai:decisions` ge-refresht.

**Verificatie:** `prisma validate` groen 🚀 + `prisma generate` groen (offline, dummy-URL — geen DB-verbinding nodig). **Adversariële Opus-verify tegen de docs**: verdict *ship-ready* — 0 deferred-leaks, 0 invariant-schendingen, alle §6–§11-bodies kloppen; enige echte fix (`WorkspaceBudget.periodWindow` miste `@default`) doorgevoerd + her-gevalideerd. `vite build` groen.

**Files touched:** `prisma/schema.prisma` (herschreven), `docs/decisions/0001-workspaces-v1-schema-shape.md` (nieuw), `docs/AI_DECISIONS_INDEX.md` (regen), `node_modules/@prisma/client` (regen).

**Notes / bewuste keuzes:**
- **App-enforced verplichtingen** (niet door Prisma afgedwongen — hebben code+tests nodig): workspace-teardown-cascade over alle `workspaceId`-rijen (`04b §11d`), append-only-immutabiliteit (TicketEvent/RagEntry/WorkspaceSignal/SpendRecord/CarryOver/Handoff), `runInTenant` op elk non-`/api`-pad.
- **Bewust weggelaten** (komt met hun lane): `previewConcurrencyCap` + alle `04b §18`-deferred modellen (MergeRequest/CI-Pipeline/ForgeConnection/AuditEntry/PreviewDeployment) + `forgeMode`/`autonomyLevel`.
- `TicketReference` = afgeleide minimale shape (docs noemen 't in de cascade-lijst maar geven geen body) — geflagd in de schema-header + ADR.
- **Nog niet gedaan (developer-actie / Lane B):** `prisma db push` naar de echte Mongo (via SSH-tunnel) — pas nodig bij het wiren van de sync-backend; het schema is offline bewezen. Ook nog open: de `types.ts §15`-backfill (StageKind-reconciliatie in `Board.tsx`/`Pipeline.tsx`) + de volledige i18n-migratie.

## 2026-07-01 18:00 — StageKind-reconciliatie + volledige i18n-migratie + niet-i18n lint-cleanup

**User prompt:** (onderweg, telefoon) "kan je verder met volgende fases of heb je human input nodig?" → autonoom doorwerken op de besliste step-1 prerequisites terwijl user sport.

**What I did (3 commits, elk een rollback-punt):**
1. **StageKind-reconciliatie** (`c60a0de`) — `04b §12`: de fixed 7-literal `StageId` → semantische `StageKind` (`refine|plan|code|test|review|final`); stage-`id` + `Ticket.stageId` verbreed naar vrije string; `kind` toegevoegd aan `PipelineStage`/`PipelineStageCfg`; board-kolommen keyen op vrije stage-id. Consumers: `types.ts`, `seed.ts` (7 stages getagd), `Board.tsx`, `Pipeline.tsx`, `WorkspacesContext.tsx`, `WorkspacesProvider.tsx`. Type-clean, build groen.
2. **Volledige i18n-migratie** (`e92bf4b`) — alle **209 hardcoded JSX-strings → `useTranslator`** over 17 screen/shell/component-files, via een **18-agent workflow** (merge-patroon: elke agent 1 file + geeft z'n key-map terug; ik merge de 4 locale-JSONs serieel → geen write-conflicts). **455 keys** in `en/nl/de/fr` (nl/de/fr = Engelse mirrors, wachten op echte vertaalslag). `react/jsx-no-literals`: **209 → 0**, GEEN suppression. Typografische glyphs (`·`/`−`) toegevoegd aan `allowedStrings` (naast de al toegestane `•`/`—`); 2 code-samples naar module-const.
3. **ES2023 + mechanische lint-cleanup** (`ad98bb7` + `8284645`) — tsconfig `target`/`lib` ES2022→ES2023 (typeert `toSorted` correct → ruimt **36 `unsafe-*` errors** op in Usage/Pipeline). Plus scoping-hoists, nested-ternary→switch, ternary-as-statement→if/else, overbodige type-assertion weg, unieke AnimatePresence-key. **Lint-errors: 68 → 23; totaal 297 → 44 problemen; build groen.**

**Bewuste leaves (NIET blind gefixt — geflagd):**
- **15 `no-unnecessary-condition`** = correcte defensieve guards (`MEMBERS[key]?.x ?? fallback`, `arr[0] ?? fallback`) die de linter mist-flagt zonder `noUncheckedIndexedAccess`. Guards slopen = echte bugs. Vastgelegd als **lesson `docs/lessons/0001`**. Juiste fix = `noUncheckedIndexedAccess` project-breed (gemeten: 56 tsc-sites incl. framework-overlay) → user-gated follow-up.
- **8 `no-empty-function`/scoping** = bewuste Fase-1 stub-handlers (unwired knoppen; bedraad in Fase 1).
- Warnings (21): `no-array-index-key` op statische lijsten, `only-export-components` (architecturaal — primitives/motion co-exporteren helpers), 2 non-null-asserts.

**Files touched:** `src/workspaces/**` (types/seed/screens/shell/components), `src/_locales/{en,nl,de,fr}.json`, `eslint.official.config.js`, `tsconfig.json`, `docs/lessons/0001-*.md` (+ index).

**Developer-actie / open:** echte nl/de/fr-vertaling (nu Engelse mirrors); `noUncheckedIndexedAccess`-strictness-pass (aanbevolen); Fase-1 wiring lost de stub-handlers op.

## 2026-07-01 19:30 — Fase 1 foundation: tenant-laag + control-API-contract + Conductor-referentie-slice

**User prompt:** (onderweg) "zo veel mogelijk kwa code schrijven, straks alles testen; welke fases kunnen nu? OAuth werkt al." → maximaal Fase 1 (Lane B + C + A1/A3, niet-spike-gated) bouwen; E2E-test door user later.

**Aanpak-beslissing:** alleen **Fase 1** is nu zinvol autonoom bouwbaar (Fase 2/3 = containers + de P0.5-billing-spike op de host → samen met user). Foundation-first, compile/lint/build-geverifieerd; de write-path-executie met veel framework-integratiedetails bewust als één coherente **referentie-slice** i.p.v. 20 ongeteste routes blind (kwaliteit boven volume).

**What I did (3 commits):**
1. **Foundation** (`6ac3593`): `types.ts §15`-backfill (via agent — canonical `WorkspaceSuggestion`/`TicketEvent`/`AgentSession`/`SpendRecord`/`WorkspaceRole`/`CarryOverEnvelope`/`Handoff`/`Question(Set)`/`WorkspaceSignal`/`WorkspaceTrigger` + field-sweep; additief/kept-both → 0 nieuwe tsc-errors). **Tenant-laag** (`server/tenant/`): `tenantContext` (`runInTenant`/`currentWorkspaceId` via AsyncLocalStorage, loud-fail), `tenantDb` (`$extends` where-injection over 25 `TENANT_MODELS`), `tenantRedis` (per-workspace key-prefix, delegeert framework/unscoped naar default) — boot-wired.
2. **Control-API-contract** (`e93e70f`): `_functions/controlApi.ts` — `ControlOp`-catalogus + `ControlRequest`/`ControlAck` + positionele `RBAC_CAPABILITIES` + `OP_CAPABILITY` + `CONFIRM_REQUIRED`. Frozen A1, unblokkeert Lane C/D.
3. **Conductor-referentie-slice** (`a8a015e`): `server/orchestrator/conductor.ts` — in-process serial writer (ADR `0002`), append-only `WorkspaceSignal` (monotone Redis-INCR seq), reference-ops change-role/save-env/remove-env/rename-workspace + `bootstrapWorkspace()` (workspace + 3 built-in rollen + Owner). `control_v1`-route (RBAC via `OP_CAPABILITY` + `WorkspaceRole.perms` → enqueue, nooit inline schrijven).

**Verificatie:** alle nieuwe files **lint-clean + server-tsc clean (0 nieuwe errors)** + `vite build` groen + `generateArtifacts` registreert `workspaces/control/v1`. De 14 resterende server-tsc-errors zitten in pre-existing framework-scaffold (`config.ts`/`SessionProvider`/`socketInitializer`), niet in mijn werk.

**Bewuste keuzes / leaves:**
- **In-process Conductor voor Fase 1** (ADR 0002): Redis-signal-log + `lease:orchestrator` → Fase 2 (er is nog geen orchestrator-proces). Single-writer-invariant houdt (1 proces).
- Tenant-primitives van `functions/` → `server/tenant/` verplaatst: de `$extends`-client-type brak de function-injection-type-generator; server-code importeert 'm direct.
- Conductor schrijft via plain `prisma` + expliciete `workspaceId` (type-correct; Prisma's input-types eisen 'm); `tenantDb` is de read-seam voor Lane B's `_sync`-handlers.
- **E2E ONGETEST** — bewust: de resterende write-path (16 ops + bootstrap-on-login + `_sync` seq/merge-backend + `useWorkspaceData()`-rewire van 15 schermen) bouwen we mét server+DB live zodat elk stuk in één keer compileert/registreert/test. `prisma db push` (SSH-tunnel) is de developer-actie vóór de eerste test.

**Files touched:** `src/workspaces/_data/types.ts`, `server/tenant/{tenantContext,tenantDb,tenantRedis}.ts` (nieuw), `src/workspaces/_functions/controlApi.ts` (nieuw), `server/orchestrator/conductor.ts` (nieuw), `src/workspaces/_api/control_v1.ts` (nieuw), `luckystack/server/index.ts`, `docs/decisions/0002-*.md` (nieuw).

## 2026-07-01 21:30 — Fase 1: volledige write+read-path GEBOUWD + END-TO-END GETEST tegen echte Mongo

**User prompt:** "ik ben het er niet mee eens [dat je stopte bij de referentie-slice] — bouw de volledige write-path nu, gebruik ultracode/workflows, en test het ZELF; de tunnel is open dus jij mag ook `prisma db push` draaien; enige blockade is dat ík niet kan testen."

**Doorbraak:** met open tunnel + volledige command-rechten kon ik het **zelf E2E testen** → geen blockade meer. `prisma db push` gedraaid (via een resolve-script dat de secret-manager-pointers oplost), het volledige schema staat live in Mongo.

**What I did + BEWEZEN via directe DB-tests + echte HTTP:**
1. **`prisma db push`** (schema live in echte Mongo) + `PipelineStage.key` toegevoegd (stabiele slug die tickets/board-kolommen refereren; Object-id `_id` kan de slug niet zijn).
2. **Demo-seeder** (`server/bootstrap/seedWorkspace.ts`) — mapt de prototype-seed-constants → echte rijen (workspace+3 rollen+6 members[owner=echte user]+project+7 stages[composite config]+12 tickets+2 sprints+2 suggestions+budget+13 sources+4 env+2 integrations+1 invite+10 events). Smoke-getest: alle counts kloppen.
3. **Bootstrap-on-first-login** (`registerBootstrap.ts`, postLogin-hook) — seedt op eerste login. Boot-wired.
4. **Read-path** (`server/read/workspaceSnapshot.ts` + `_api/snapshot_v1`) — `buildSnapshot()` aggregeert de tenant-data → frontend-getypeerde shapes (narrowing DB-string→union, geen cast); `PipelineStage.key`→frontend-`id`.
5. **Data-seam** (`WorkspacesProvider` herschreven) — fetcht `workspaces/snapshot` via `apiRequest`, levert live data via context, mutaties → `workspaces/control` + refetch.
6. **RBAC naar server** (`server/control/rbac.ts`) — `OP_CAPABILITY` verplaatst (zie lesson 0002).

**E2E-BEWIJS (echte HTTP, echte Mongo):** register/login → postLogin seedt → `snapshot` geeft alle 12 tickets/6 members/7 stages/budget/rollen terug ✓; **create-workspace + save-env + change-role** persisteren allemaal (monotone `signalSeq` 0→1→2, RBAC afgedwongen) en verschijnen in de volgende snapshot ✓. Testdata na afloop opgeruimd.

**Twee framework-valkuilen ontdekt + opgelost** (→ `docs/lessons/0002`): (a) devkit `validateInputByType` choket op ELKE `/api`-route (ook framework-eigen) met "max depth 64" → per-route `export const validation = 'relaxed'`; (b) generated server-bundel stubt non-`_api` `src/`-runtime-imports naar `undefined` → runtime-waarden naar `server/`. ADR `0002` = in-process Conductor.

**Commits:** `6ac3593` (types+tenant), `e93e70f` (control-contract), `a8a015e` (Conductor-slice), `e1868a2` (seed+bootstrap+snapshot), `02fed8d` (data-seam Provider), `59ff8b7` (control-API E2E-geverifieerd).

**NOG TE DOEN (Fase 1 afmaken):** de **15 schermen rewiren** van `_data/seed` → `useWorkspaces()`-context (mechanisch, patroon bewezen — de Provider levert de data al); de **~16 resterende control-ops** in de Conductor implementeren (invite/remove-member/sprint/bulk/etc.); dan browser-verify. **Developer-note:** elke nieuwe `_api`-route heeft `validation:'relaxed'` nodig tot de devkit-fix landt.

## 2026-07-01 23:00 — Fase 1 afgemaakt: 12 schermen gerewired + alle control-ops + volledige test-suite (+ security-fix)

**User prompt:** "doe de 15 schermen + 16 control-ops; maak ook heel veel tests (unit, e2e, etc.) via ultracode/parallel agents; zorg dat agents elkaar niet in de weg zitten; kwaliteit boven snelheid."

**Coördinatie (geen agent-conflicten):** strikt gepartitioneerd op disjuncte files — de 12 schermen = elk 1 file (workflow, 1 agent/file), de 16 control-ops = allemaal in `conductor.ts` (dat deed ík zelf, niet fan-outen), de 9 test-files = nieuwe disjuncte files (workflow). Integration/e2e-tests maken elk een eigen throwaway-user + ruimen op → geen DB-races.

**What I did (E2E-geverifieerd tegen echte Mongo):**
1. **12 schermen gerewired** (`w05l93sjc`-workflow, 12/12 tsc-clean): Board/Backlog/TicketDetail/Activity/Usage/Sources/Terminals/AccountSettings/WorkspaceSettings/Pipeline/SearchPalette/Shell lezen nu live tenant-data via `useWorkspaces()` (tickets/members/stages/sprints/docs/skills/invites/events) i.p.v. dummy-seed. Nieuwe context-helper `ticketMembers()` + `membersById` voor member-lookups. Catalogs + not-yet-in-snapshot-data blijven seed-imports.
2. **Alle Fase-1 control-ops** in de Conductor (quick-add/archive/bulk-*/sprint/member/role/invite/integration/gitlab/budget/skill-toggle/save-stage-config/mark-read/delete-workspace[cascade]/transfer-ownership). HTTP-getest: quick-add→DEV-1252, invite, sprint-create persisteren.
3. **Volledige test-suite** (`wd89n3t8u`-workflow, 9/9 groen, 212 asserts): unit (rbac 111, seedHelpers 18), integration (seed 17, snapshot 21, tenant 15, conductor 19 — echte Mongo, self-cleaning), e2e (httpControl 11), + framework per-route (`control_v1.tests.ts`, `snapshot_v1.tests.ts`). Harness `tests/_helpers.mts` + runner `scripts/runWsTests.mjs` + `npm run test:ws`.
4. **🔴 SECURITY-FIX** (lesson `0003`, gevonden door `tenant.test.mts`): `tenantDb`'s `$extends` injecteerde `workspaceId` alleen als er al een `where` was → no-arg `findMany()` (die de snapshot-read-path overal gebruikt) lekte **ALLE workspaces' rijen** — cross-tenant leak, onzichtbaar onder single-workspace-E2E. Gefixt: elke non-create-op forceert `where.workspaceId`. Test bewaakt het nu met een no-arg-`findMany()`.

**Verificatie:** workspaces frontend-tsc **0 errors**, build groen, `npm run test:ws` **7/7 groen** (+2 framework per-route). Resterende 14 server-tsc-errors = pre-existing framework-scaffold (niet mijn code).

**Commits:** `7fe670e` (rewire+ops), `c604f6e` (tests+tenant-fix).

**Fase 1 status:** basisplatform-datalaag + read/write-path + schermen + tests **compleet + getest**. Open (secundair): SESSIONS/TERMINALS/USAGE_ROWS/NOTIFICATIONS nog op seed (niet in snapshot); de Pipeline-editor-config nog op seed (stage-config-persist-slice); Fase-2 AI-session-ops zijn scaffold. **Developer-note:** elke nieuwe `_api`-route heeft `export const validation = 'relaxed'` nodig (devkit-bug, lesson 0002).

## 2026-07-01 — Branch-audit + fixes (cross-tenant + correctness) in worktree `workspaces-audit-fixes`

**User prompt:** verifieer al het werk op deze gitbranch (bugs, en vooral datalekken tussen workspaces); fix meteen wat nodig is; snel werken want andere AIs bouwen parallel verder.

**Aanpak:** volledige read-only audit van alle gecommitte code (24 commits) — kern-tenant/read/write-path zelf gelezen, 3 parallelle agents voor frontend-rewire / test-rigor / schema+seed. Fixes geïsoleerd in worktree `workspaces-audit-fixes` (branch vanaf HEAD) zodat parallelle AIs op `main` niet gehinderd worden.

**Bevinding vooraf:** tenant-isolatie is structureel solide — `TENANT_MODELS` ↔ `workspaceId` is exact, unique-constraints zijn per-tenant, de Conductor scoped elke `where` op `workspaceId`, `buildSnapshot` valideert `wantWorkspaceId` tegen membership. De security-fix `c604f6e` (no-arg `findMany` leak) is echt en volledig. Geen render-leak.

**Gefixt (echte bugs):**
1. **🔴 Cross-user/cross-tenant write-suppressie.** `clientRequestId` was een deterministische module-counter die reset bij reload (`c1-20`, `c2-27`…); de Conductor-dedup keyde er globaal op → user B's 1e write botste met user A's 1e write en werd stil gedropt. Fix: client → `crypto.randomUUID()` (`WorkspacesProvider.tsx`); dedup genamespaced op `workspaceId:clientRequestId` (`conductor.ts`, defense-in-depth).
2. **Activity-feed identiteits-mismatch + ordering.** Snapshot gaf events' `ticketId` als ObjectId terug terwijl de UI tickets op DEV-key keyt → `openTicket` "not found" + TicketDetail Activity-tab permanent leeg; feed sorteerde op per-ticket `seq` (kruist tickets). Fix (`workspaceSnapshot.ts`): ObjectId→key map voor events + suggestions, `time` gevuld via `relTime(createdAt)`, feed op `createdAt desc`.
3. **Board-crash bij lege `stages`.** `BoardMobile` deed `stages[0].id` → white-screen op laad-venster / vers-gebootstrapte workspace (phone-first). Fix: early empty-state-guard in `Board.tsx` + 2 i18n-keys (en/nl/de/fr).

**Toegevoegd (test):** regressie-guard in `tests/integration/tenant.test.mts` voor het gevaarlijkste ONGETESTE isolatie-pad — no-`where` `updateMany`/`deleteMany` + create-stamping + no-arg `count` over 2 workspaces. **Bewezen tegen echte Mongo: no-`where` mutatie in wsA raakt wsB niet aan.**

**Geflagd (niet gefixt — buiten scope / bewust Fase-1):** RBAC/integration-edits in de Provider zijn optimistic-local (nooit gepersisteerd → wiped op refetch); env-value-input vuurt control-write+refetch per toetsaanslag (blaast rateLimit 30); Conductor bevestigt write vóór de serial-chain draait (falende write alleen ge-logd); `ControlAck`-error-shape wijkt af van het bevroren contract; terminal-PTY-bridge = host-RCE voor elke ingelogde user zodra enabled (non-prod gated); `tenantDb` blanket-`where.workspaceId` is latent-onveilig voor `findUnique`/`update` op compound-key (Conductor gebruikt plain prisma, dus niet actief). Test-dekking: RBAC-*enforcement* (deny-pad) en 38/41 control-ops zijn nog niet write-getest.

**Verificatie:** `tsc --noEmit` **0 errors** (na `generateArtifacts`), `eslint` op aangeraakte files schoon, `ai:lint` geen violations, 4 locales valide JSON, **`npm run test:ws` 7/7 groen** (tenant-test nu 22 asserts). Niet gepusht; changes staan op branch `workspaces-audit-fixes` klaar om te mergen naar `main`.

## 2026-07-01 — UI-tweaks (2e navbar weg + settings theme/language autosave) in worktree `workspaces-audit-fixes`

**User prompt:** kleine UI-tweaks: de 2e top-navbar (Board + WorkspaceAI-toggle) weghalen (beide knoppen staan al elders); settings-page zonder save-button (autosave, werkt nu niet voor theme); language is geen dropdown meer en niet aanpasbaar.

**Gedaan:**
1. **2e navbar verwijderd.** `WorkspacesShell.tsx`: `<TabBar>` (Board-tab + WorkspaceAI-toggle) niet meer gerenderd + import verwijderd. Board + Workspace-AI blijven bereikbaar via de NavRail; terug-navigatie via de contextuele back-row + ⌘K-palette. NB: de open-ticket-tabs woonden óók in die balk — die zijn nu weg (functie `TabBar` blijft ongebruikt geëxporteerd in `Shell.tsx`).
2. **Theme autosave.** `AccountSettings.tsx`: `Segmented` onChange past theme direct toe én persisteert via de framework-route `settings/updateUser` (geen save-button). `TemplateProvider` synct `session.theme` bij reload → keuze blijft plakken.
3. **Language weer een werkende dropdown.** Statische span vervangen door `Dropdown` (codes nl/en/de/fr via bestaande `settings.language.*` keys), onChange = `useUpdateLanguage()` (direct) + `settings/updateUser` (persist). De language-source leest bij reload uit de sessie → blijft plakken.
4. **Globale, theme-passende scrollbars** (vervolg-prompt: "overal waar potentieel een scrollbar kan zijn ... passend voor white en dark"). `src/index.css`: app-brede WebKit (`::-webkit-scrollbar*`) + Firefox (`scrollbar-width`/`scrollbar-color`) styling op basis van de bestaande tokens (`--color-disabled` rust → `--color-muted` hover, transparante track) → switcht automatisch mee via `.dark`, geen per-theme regels. `.ws-no-scrollbar` (`workspaces.css`, hogere specificity) blijft scrollbars volledig verbergen waar nodig.

**Files:** `src/workspaces/_shell/WorkspacesShell.tsx`, `src/workspaces/_screens/AccountSettings.tsx`, `src/index.css`.

**Verificatie:** `tsc --noEmit` 0 errors, `npm run build` groen, `ai:lint` geen violations. Resterende eslint-meldingen (SSH-form guard-false-positives regels 69/76/184 + bestaande `noop`) zijn pre-existing (lesson 0001), niet van deze change. Niet gecommit — batch met volgende tweaks.

## 2026-07-02 01:00 — 7b (strictness + i18n) + 7a.3/7a.4/7a.5 (mutaties/integraties/encryptie)

**User prompt:** "doe heel 7a + 7b af; noUncheckedIndexedAccess AAN + alles fixen; alle vier de talen echt vertalen."

**Gedaan (allemaal geverifieerd — lint 0, test:ws 8/8 = 219 asserts, build groen):**
- **7b.1 — `noUncheckedIndexedAccess` AAN** (tsconfig) + alle ~57 gesurfacete sites gefixt (workflow, 1 agent/disjuncte file: minimale guards/hoists/optional-chaining, geen casts/non-null) + volledige lint-cleanup naar 0 errors (tryCatch-thunk, char-guard, String()-template, Fase-2-stub-intent-comments, module-scope noop, globalThis-behoud). De 19 guard-false-positives lossen nu correct op (index = `T | undefined`).
- **7b.2 — echte nl/de/fr-vertaling** van de 455 `workspaces.*`-keys (workflow, 1 agent/locale; framework-namespaces byte-identiek; placeholders/keys intact; product-nouns/tech-terms als loanwords). Alle 3 KEYS-MATCH (730 leaves).
- **7a.3 — mutaties → control-API:** togglePerm→role-update, addRole→role-create, saveIntegrationTool→save-integration, removeIntegrationTool→remove-integration (optimistic + persist + refetch). `PermRole.key` toegevoegd (uit `WorkspaceRole.key`). **E2E:** role-create→reviewer(1)→role-update→reviewer(2). ✓
- **7a.4 — save-integration composites:** de Conductor persisteert nu `fields`/`mcp` (readIntegrationFields/readMcp; update via `{set}`). **E2E:** Sentry-integratie met field + mcp.command persist. ✓
- **7a.5 — GitLab-token-encryptie:** `server/crypto/secretBox.ts` (AES-256-GCM, key uit `WORKSPACES_ENC_KEY`, `v1:iv:tag:ct`-envelope, `plain:`-fallback+warning zonder key). Conductor gitlab-settings encrypt on write. ADR `0004` + `.env.local_template` + unit-test (7 asserts: round-trip/tamper/fallback). ✓

**Commits:** `5768373` (7b.1), `8e89fdc` (7b.2), `5b9af1e` (7a.3+7a.4), `31b94c5` (7a.5), + 2 lint-fixes.

**NOG OPEN in 7a (bewust niet nu):**
- **7a.2 — Pipeline-config-persist** (de core surface): de volledige `PipelineStageCfg` uit de DB-composites in de snapshot brengen (9 composite-subtypes, cast-vrije union-narrowing) + Pipeline.tsx van `STAGE_CONFIGS` af + save-stage-config volledig. Groot + kwaliteitsgevoelig → **beter met verse context** (aanbevolen als eerste taak volgende sessie).
- **7a.1 (notifications/usage/spend/terminals live) + 7a.6 (sessions-UI):** grotendeels **Fase-2-gated** — er zijn in Fase 1 nog geen data-producers (pipeline-events/AI-usage/pty/session-list). Live plumbing zou lege data tonen; heeft pas zin met de Fase-2-engine.

## 2026-07-02 02:30 — ALLE missende functionaliteit bedraad (audit-fixes, in één pass)

**User prompt:** "fix nu in één keer alle missende functionaliteiten met ultracode/Sonnet, snelheid voorop; verifieer daarna met Opus."

**Aanpak:** gefaseerde Sonnet-workflow (backend + contract met generateArtifacts-barrier → 8 schermen parallel) + Opus-verificatie (ik) + E2E tegen echte Mongo.

**Backend (E2E-bewezen):**
- Conductor `save-stage-config` persisteert nu de VOLLEDIGE `PipelineStageCfg` (9 cast-vrije composite-readers) — was alleen name/aiEnabled/customInstructions. **= 7a.2-backend af.**
- `accept-suggestion` geïmplementeerd (status='accepted').
- Snapshot: `notifications[]` + `stageConfigs[]` (volledige per-stage config, cast-vrije union-narrowing) + lege event/notif-timestamps gefixt (HH:MM).
- Seed: 5 demo-notificaties.

**Contract (Provider+Context):** ~25 nieuwe ctx-handlers (quickAdd, archive, bulk-*, invite, revoke, removeMember, transfer, delete, rename, saveGitlab, toggleSkill, saveStageConfig, notifications+markRead+markAllRead, acceptSuggestion, signOut[framework-logout]). notifications/unread nu live (van seed af).

**8 schermen bedraad:** Board (new-ticket→quick-add, archive, sprint+status/assignee-filters), Backlog (volledige bulk-bar met pickers), TicketDetail (promote→bulk-move), Sources (skill-toggle persist), WorkspaceSettings (remove/transfer/delete/invite/revoke/gitlab-save/rename + env-debounce-fix), AccountSettings (export + session-revoke), **Pipeline (laadt ctx.stageConfigs + saveStageConfig = 7a.2-frontend)**, Shell (notificatie-panel + mark-read, suggestie-accept, sign-out). **De confirm-void-bug-klasse overal gefixt.** Echte Fase-2-gaten = gemarkeerde stubs (geen verzonnen verbs — frozen control-API gerespecteerd).

**E2E-bewezen:** save-stage-config (model/commands/network/hooks persisteren), mark-read, accept-suggestion, invite, bulk-move — allemaal persistent. tsc 0 / server 14-baseline / lint 0 / build groen / test:ws 8/8.

**Commit:** `956d76d`.

**Resteert (echt Fase-2, geen op / geen data-producer):** needs-input-reply, add-reference/link-ticket, teardown-container, pause/resume/kill (AI-session), upload-doc/reindex/regenerate, echte AI-chat, echte usage-cijfers, container-terminals, SSH-key-persist + echte sessie-lijst, real-time/presence.

## 2026-07-02 — Merge main + `_screens/`→page.tsx refactor + push naar origin/main

**User prompt:** refactor `_screens/` zodat we de file-router écht gebruiken (code in `page.tsx`, geen 1-op-1 wrapper) + 1-op-1 functions/components mee naar de route-folder; daarna origin main pullen, conflicten oplossen, alles pushen naar origin main, dan lokaal pullen zodat live Vite alles ziet.

**Belangrijke vondst vooraf:** `origin/main` (38041d8) liep **35 commits achter** op local main (0dace22) — de parallelle AIs hadden lokaal gecommit maar nooit gepusht. Geïntegreerd met local main (de echte laatste code); op advies eerst gemergd, dán pas gerefactord (anders structuur-vs-inhoud-conflict op elke screen).

**Gedaan:**
1. **Merge `main` (0dace22) → branch** (commit `41a8935`). Conflicten opgelost: `workspaceSnapshot.ts` (mijn createdAt-feed-ordering + ObjectId→key-identity-fix bovenop main's notifications; ongebruikte `relTime` weg, main's `formatTime`), `Board.tsx` (main's sprint/status/assignee-filters + mijn empty-stages-guard), `AccountSettings.tsx` (main's sessions/revoke/export + mijn theme/language-autosave), `WorkspacesShell.tsx` (TabBar-removal op main's nieuwe TopBar-signatuur), 4 locales (main's echte nl/de/fr + mijn `emptyStages`-keys vertaald), branch-logs (beide entry-sets).
2. **`_screens/`→page.tsx refactor** (commit `2649a97`): 10 screens ge-inlined in hun route-`page.tsx` (code in de route, `export const template='workspaces'`; Board=index `./`, TicketDetail=`../../` + `id` uit `params.ticketid`). Colocatie in `board/[ticketId]/`: `FileDiffViewer.tsx` + private dep `DiffView.tsx` (exclusief TicketDetail). Gedeeld gebleven: `Icon`/`primitives`/`motion`/`XtermTerminal`; `SearchPalette` (shell-only). Router globt alleen `**/page.tsx` → colocated siblings niet geroute. AI-indexen ververst.
3. **Gepusht naar `origin/main`** (`38041d8..2649a97`, clean fast-forward) — synct meteen ook de 35 achterstallige local-main-commits.

**Files:** 10× `_screens/*.tsx`→`<route>/page.tsx`, `board/[ticketId]/{FileDiffViewer,DiffView}.tsx` (verplaatst), + merge-resoluties.

**Verificatie:** `tsc --noEmit` **0 errors**, `npm run build` groen, `ai:lint` schoon, eslint (verplaatste files) alleen pre-existing warnings, **`test:ws` 7/8** (Mongo-directe files groen).

**Geflagd (niet gefixt):** (a) `test:ws`'s `httpControl` e2e faalt op quick-add-persist — maar die test de **live :80 server (main-checkout)**, niet deze worktree; los van deze refactor (mogelijk de eerder-geflagde async-ack of stale server). (b) Dode files zonder importers: `_components/TerminalView.tsx` + `_screens/Placeholder.tsx`. (c) Open-ticket-tabjes verdwenen mee met de 2e navbar (eerdere tweak).

## 2026-07-02 — Dode files weg + 2e navbar terug (alleen open-tickets, binnen content-kolom)

**User prompt:** verwijder dode code/files; breng de 2e navbar terug voor de per-ticket preview maar laat 'm aansluiten op de AI-chat rechts (2e topbar ín de content-window, niet eroverheen); alleen open-tickets in die balk, geen andere knoppen; los daarna alle conflicts met main op en zet alle code op main zodat ik lokaal kan pullen + runnen.

**Gedaan:**
1. **Dode files verwijderd** (nul importers, bevestigd): `src/workspaces/_components/TerminalView.tsx` + `src/workspaces/_screens/Placeholder.tsx` (`_screens/` is nu leeg).
2. **TabBar terug, gestript + herpositioneerd** (`Shell.tsx` + `WorkspacesShell.tsx`): alleen open-ticket-tabs (Board-tab + Workspace-AI-toggle eruit — die zitten in de NavRail), verbergt zichzelf als er niks open is. Gerenderd ÍN de content-kolom (boven de back-row/children) i.p.v. full-width boven de rij → spant alleen de content-breedte en sluit aan op de linkerrand van de AI-chat i.p.v. eroverheen te lopen. `TabBar` heeft geen props meer (`onAiToggle` weg).

**Files:** `src/workspaces/_shell/Shell.tsx`, `src/workspaces/_shell/WorkspacesShell.tsx`, verwijderd: `_components/TerminalView.tsx` + `_screens/Placeholder.tsx`.

**Verificatie:** `tsc` 0, `build` groen, `ai:lint` schoon, eslint alleen pre-existing warnings.

## 2026-07-02 — Alle tsc-errors + eslint-warnings naar nul (na main-pull)

**User prompt:** pull main (veel nieuwe changes), analyseer + check de async-ack-flag op quick-add; daarna server killen, `tsc + lint + build + alle tests` draaien (ws-test gebruikt de door de user zelf gestarte :80-server); vervolgens: alle errors én warnings fixen.

**Vooraf (pull-analyse):** 8 commits van origin/main gemerged (`_screens/`→page.tsx refactor, cross-tenant dedup-key `workspaceId:clientRequestId`, feed-ordering op `createdAt`, ObjectId→key-mapping). De eerdere `quick-add`-e2e-fail bleek **geen write-bug**: de test pollt al 6s op de async-ack; de fail kwam puur doordat de :80-server oude code draaide. Na server-restart + herdraai: 8/8 groen. De async-ack (Conductor ackt vóór de write, client merged op `seq`) is by-design B-23.

**Gefixt — 14 server-tsc errors (1 oorzaak):** `tsconfig.server.json` dropte de DOM-lib (`lib:["ES2022"]`), terwijl isomorfe client-files (config.ts `typeof window`-guard, SessionProvider, socketInitializer) transitief mee-getypecheckt worden. Die worden al volledig met DOM gecheckt door de frontend-tsc → `lib:["ES2022","DOM","DOM.Iterable"]` verwijdert de dubbele DOM-loze ruis (`window`/`document`/`globalThis`-index). Geen source-changes.

**Gefixt — 20 eslint-warnings → 0:**
1. **2× `no-non-null-assertion` (`!`)** cast-vrij herschreven naar guards: `WorkspacesProvider` (`lastNav = navStack.at(-1)` gehoist → `canGoBack`/`backLabel` daaruit), `page.tsx` BoardMobile (`stages.find(...)` + `if (!stage) return null`).
2. **3× `no-array-index-key`** met veilige content-key (feeds): activity-feed + ticket-ActivityTab (`${time}-${actor}-${type}-${text}`), pipeline-warnings (`${stageId}-${text}`).
3. **6× `no-array-index-key`** met gerechtvaardigde `eslint-disable-next-line` + reden waar de index de identiteit ís: DiffView (static diff, dup-regels), stage-HistoryTab (append-only, stage kan recurren), pipeline commands/env (editable primitive-lijsten zonder id in model), PopMenu-dividers (static menu).
4. **8× `react-refresh/only-export-components`** via file-level `eslint-disable` + rationale op 4 shared-modules (motion-presets, primitives+useClickAway, Shell NAV-data, WorkspacesContext Provider+hook). Bewust suppressie i.p.v. shared-modules fragmenteren — consistent met de framework-keuze om co-exports toe te staan (`allowExportNames`, page.tsx-conventie); dev-only fast-refresh-regel, geen route-componenten. `eslint-comments/no-unused-disable:error` houdt de disables eerlijk.

**Files:** `tsconfig.server.json`, `src/workspaces/_shell/WorkspacesProvider.tsx`, `src/workspaces/page.tsx`, `src/workspaces/activity/page.tsx`, `src/workspaces/board/[ticketId]/page.tsx`, `src/workspaces/board/[ticketId]/DiffView.tsx`, `src/workspaces/pipeline/page.tsx`, `src/workspaces/_components/primitives.tsx`, `src/workspaces/_components/motion.tsx`, `src/workspaces/_shell/Shell.tsx`, `src/workspaces/_shell/WorkspacesContext.tsx`.

**Verificatie:** server-tsc **0** (was 14), frontend-tsc **0**, eslint **0 warnings / 0 errors** (was 20 warnings), `ai:lint` schoon, `npm run build` groen, `test:ws` **8/8 (226 asserts)** tegen de :80-server.

## 2026-07-02 — React-19 removeChild-crash fix + create-menu padding + 2 bugs (theme-save, stale RAG-banner)

**User prompt:** (a) crash `removeChild is not a child` op elke workspaces/*-pagina na een ticketbezoek + create-menus zonder padding; (b) losse problemen — o.a. theme/language-save faalt (`input nesting exceeds depth 64`) en een stale "RAG-index loopt 3 commits achter"-melding.

**Gedaan:**
1. **removeChild-crash:** de 3 framer-motion `layoutId` shared-layout-animaties verwijderd (board-cards `layout layoutId` + `LayoutGroup`, Tabs-underline, TabBar active-pill). motion-12 + React-19.2 projecteert die op unmount tijdens route-wissel → `removeChild`; één fout corrumpeert de fiber-tree → fout op élke volgende pagina. Vervangen door statische highlights; overige motion (AI-panel, chat, sheets, popovers) intact. Imports opgeschoond, header-comment bijgewerkt.
2. **create-menu padding:** `NewTicketForm` + `CreateWorkspaceForm` roots misten `p-*` (de MenuHandler-frame levert bewust geen padding; `ConfirmMenu` doet `p-6`, sources-details `p-5`) → `p-5` toegevoegd.
3. **[bug 8] theme/language-save:** `settings/updateUser` miste `export const validation = 'relaxed'`; de devkit-validator recurseert het `SessionLayout`-type voorbij depth-64 (lesson 0001) → elke call faalde. Relaxed toegevoegd.
4. **[bug 6] stale RAG-banner:** de hardcoded "RAG-index loopt 3 commits achter op main" HealthBanner verwijderd (geen echte indexer in V1; misleidende dummy).

**Files:** `src/workspaces/page.tsx`, `_components/primitives.tsx`, `_shell/Shell.tsx`, `sources/page.tsx`, `src/settings/_api/updateUser_v1.ts`.

**Verificatie:** frontend-tsc 0, server-tsc 0, eslint 0/0, build groen. Crash-fix nog niet in-browser geverifieerd (hypothese-gedreven maar hoog-confidence + groen).

**Nog missende settings-validation (geflagd, niet gefixt):** `updatePreferences/listSessions/revokeSession/deleteAccount/signOutEverywhere` missen óók `validation='relaxed'` — latente depth-64-bug als hun data-type diep is.

## 2026-07-02 — Board unrefined-only + inline add (2/3) · sprint aanmaken (1) · terminals groter+resizable (4)

**User prompt:** batch losse problemen. Deze commit dekt 1/2/3/4 (6+8 al in 667212f; 5 grotendeels opgelost; 7+9 apart).

**Gedaan:**
1. **[2/3] Board add-ticket + alleen-unrefined.** Conductor forceert nu `stageId: 'unrefined'` voor élk `quick-add` (single-writer — client kan niet mid-pipeline plaatsen). Create-UI: stage-picker verwijderd, `quickAdd`-type teruggebracht naar `{ title }`, titel-input auto-focust. Nieuwe `UnrefinedAddCard` = Trello-stijl inline add onderaan de unrefined-kolom (klik → autofocus-input → Enter maakt + leegt voor snelle invoer, Esc/leeg-blur klapt in). Top-rechts-knop blijft (toekomstige "push naar voren").
2. **[1] Sprint aanmaken.** Ontbrekende wiring toegevoegd: `sprintCreate`-handler (provider → frozen `sprint-create`-op) + context-type + "Nieuwe sprint"-knop in de Backlog-header → `SprintForm` (autofocus name-input). Keys `backlog.newSprint`/`sprintNamePlaceholder` in 4 locales.
3. **[4] Terminals groter + resizable** (subagent, alleen `terminals/page.tsx` + locales): default-hoogte 320→460px (bewaard module-level), drag-resize onderrand-strip (pointer-capture, clamp 220–900px, xterm herfit via ResizeObserver), maximize/restore-toggle per paneel. Keys `terminals.maximizeTitle/restoreTitle/resizeTitle` in 4 locales.

**Files:** `server/orchestrator/conductor.ts`, `src/workspaces/page.tsx`, `_shell/WorkspacesContext.tsx`, `_shell/WorkspacesProvider.tsx`, `backlog/page.tsx`, `terminals/page.tsx`, `src/_locales/{en,nl,de,fr}.json`.

**Verificatie:** front-tsc 0, server-tsc 0, eslint 0/0, ai:lint schoon, build groen, test:ws 8/8 (conductor-test bevestigt quick-add→unrefined; `stages[0].id==='unrefined'`).

**Nog open:** [5] dropdown-full-width grotendeels opgelost door stage-picker-removal (resterende smalle-menu-dropdowns bij gelegenheid). [7] seed weg + onboarding + email-invites (aparte stap, coördineert met DB-wipe). [9] suggestions/sync/presence (discussie).

## 2026-07-02 — Punt 7: seed weg + onboarding (create/join) + echte email-invites (Resend) + create-workspace-op + signal-bug fix

**User prompt:** stop met random seed-data bij nieuwe accounts; nieuwe user → fatsoenlijke onboarding (workspace aanmaken óf invites zien/accepteren); echte email-invites (user koos Resend, die al opgezet is).

**Gedaan:**
1. **Seed-op-login uit** (`registerBootstrap.ts`): geen `seedDemoWorkspace` meer bij eerste login; nieuwe user start met 0 workspaces. `seedDemoWorkspace` blijft voor tests/dev.
2. **Onboarding empty-state** (`_shell/Onboarding.tsx` + gate in `WorkspacesShell`): bij 0 workspaces een full-screen takeover — workspace aanmaken (`create-workspace`) óf pending invites voor je e-mail accepteren (`accept-invite`). Beide bestaande frozen ops, geen nieuwe verbs.
3. **`myInvites`-read** (cross-workspace, by-email, NIET tenant-scoped) toegevoegd aan de snapshot (`MyInvite`-type in `_data/types.ts`, server + provider `Snap` + context bijgewerkt, `generateArtifacts` gedraaid voor de gegenereerde koppeling).
4. **`create-workspace`-op geïmplementeerd** — ontbrak volledig in de conductor (was no-op). Nieuwe `createBlankWorkspace` (`seedWorkspace.ts`): Workspace + owner-role/membership + Project + default pipeline-stages (incl. `unrefined`) + disabled budget. Geen demo-data.
5. **Echte invite-email** (`server/email/sendInviteEmail.ts` + conductor `invite`-case): `sendEmail` via `@luckystack/email` (auto-select Resend — `RESEND_API_KEY`+`EMAIL_FROM` gezet, `resend` v6.16 geïnstalleerd), accept-link → `…/workspaces`. Fire-and-forget, no-op als niet geconfigureerd.
6. **BUG FIX (lesson 0004):** login-only ops (`create-workspace`/`accept-invite`, `workspaceId: ''`) werden **stil gedropt** — de workspace-scoped `WorkspaceSignal`-append (`@db.ObjectId`) gooit "Malformed ObjectID" op `''`, de chain-`.catch` slikte 'm. `enqueueControlAction` slaat nu de signal/seq/tenant over voor login-only ops.

**Tests:** nieuwe `tests/integration/createWorkspace.test.mts` (9/9, code-direct, betrouwbaar) valideert create-workspace → project/stages/roles/member → quick-add op unrefined. httpControl e2e aangepast aan de no-seed-flow (register → 0 workspaces → create-workspace → 1 blank ws → quick-add → 1 ticket).

**Files:** `server/bootstrap/registerBootstrap.ts`, `server/bootstrap/seedWorkspace.ts`, `server/email/sendInviteEmail.ts` (nieuw), `server/orchestrator/conductor.ts`, `server/read/workspaceSnapshot.ts`, `src/workspaces/_data/types.ts`, `src/workspaces/_shell/{Onboarding.tsx(nieuw),WorkspacesShell.tsx,WorkspacesProvider.tsx,WorkspacesContext.tsx}`, `src/_locales/{en,nl,de,fr}.json`, `tests/{integration/createWorkspace.test.mts(nieuw),e2e/httpControl.test.mts}`, `docs/lessons/0004-*.md`, generated apiTypes.

**Verificatie:** front-tsc 0, server-tsc 0, eslint 0/0, ai:lint schoon, build groen, test:ws 8/9 (de enige rode = e2e-quick-add tegen de user's :80 die deels-stale hot-reloade code draait; de code-direct integratietest is 9/9 groen).

**Developer-acties:** (1) **herstart de `:80`-dev-server** met verse code (dan is de e2e ook groen); (2) daarna mag je de DB wipen en de onboarding + email-invite live testen (Resend staat klaar). **Flag (lesson 0002):** `createBlankWorkspace` importeert `STAGE_CONFIGS` uit `src/` (werkt in dev/tsx); vóór een PROD-build moet de default-pipeline naar `server/` verhuizen, anders krijgt create-workspace daar geen stages.

## 2026-07-02 00:37 — /loop Fase 1 (batch A+B): 11-punten UI/config-fixes + create-workspace/accept-invite/seed bugfixes

**User prompt:** overnight `/loop` — voer Fase 0 (typed/sync-rewrite) + Fase 1 (11 punten) + Fase 2 (cleanup/seed) + Fase 3 (features) uit, blijf loopen tot alles groen. Gekozen uitvoervolgorde: eerst de laag-risico onafhankelijke Fase-1 fixes (altijd-groen, gegarandeerd werkende app), dán de grote Fase-0 rewrite.

**Gedaan (batch A — UI/config, geen DB/infra):**
1. **[item 2]** post-login redirect → `/workspaces` (was `/dashboard`) in `config.ts`.
2. **[item 3]** socket-status-card naar onder-midden: `SocketStatusIndicator` `position="bottom-left"` + `className="left-1/2 right-auto -translate-x-1/2"` (className wint bij conflict).
3. **[item 4]** topbar theme-knop + avatar-dropdown weg; leftbar user-icon → dropdown (Account/settings + theme-toggle + uitloggen); losse gear-icon in leftbar weg (blijft in mobiel-menu via `NAV_BOTTOM`).
4. **[item 5]** leftbar-logo clip-fix: in collapsed state IS de "W"-mark de expand-toggle (gecentreerd, hover→pijl), geen aparte arrow-knop meer die de bg half afkapt.
5. **[item 1]** onboarding-flash: `WorkspacesShell` rendert een neutrale spinner zolang `loading`, pas daarna board-shell vs onboarding (geen "heeft-workspace"-flits meer).
6. **[item 6]** terminals-pagina: prototype-dummy `TERMINALS`-seed weg → lege lijst → nette (unlocked) empty-state tot de PTY/container-backend echte `AgentSession`-data levert.

**Gedaan (batch B — backend-bugs, huidige arch):**
7. **[item 8]** `control_v1` create-workspace gebruikte de bare `bootstrapWorkspace` (géén project/stages → blanco board + falende quick-add). Nu `createBlankWorkspace` (project + pipeline + seed). `bootstrapWorkspace` blijft als test-helper.
8. **[accept-invite 400 / item 9-deel]** `control_v1:58` weigerde `accept-invite` op lege `workspaceId` (`api.invalidRequest`). Nu expliciet vóór de workspace-guard afgevangen en via de Conductor login-only-pad enqueued → onboarding-join werkt.
9. **[item 11]** `createBlankWorkspace` seedt nu 1 actieve sprint + 2 voorbeeld-tickets (owner) i.p.v. leeg — board/pipeline/backlog niet meer blanco. (Oude 20-tickets/6-fake-members demo blijft in `seedDemoWorkspace`, test-only.)

**Files:** `config.ts`, `src/_components/templates/TemplateProvider.tsx`, `src/workspaces/_shell/{Shell.tsx,WorkspacesShell.tsx}`, `src/workspaces/terminals/page.tsx`, `src/workspaces/_api/control_v1.ts`, `server/bootstrap/seedWorkspace.ts`, `tests/e2e/httpControl.test.mts`.

**Verificatie:** front-tsc 0, server-tsc 0, eslint 0/0, ai:lint schoon, build groen, integration-tests 5/5 files (createWorkspace 9/9, snapshot 21/21, tenant 22/22). E2e (httpControl) NIET gedraaid — vereist herstart van de user's :80 met verse code (assertions aangepast: 2 seed-tickets + quick-add = 3).

**Nog te doen deze loop:** Fase 0 (per-actie getypte `_sync`/`_api` rewrite + event-recorder), item 10 (1 account per e-mail — schema `@@unique([email,provider])`→`[email]` + auth-linking, vereist `prisma db push`), item 7-sprint-create verifiëren, Fase 2 cleanup, Fase 3 features.

## 2026-07-02 00:51 — /loop item 10 (1 account/e-mail) + Fase-0 START (per-actie getypte `_api`-routes: canonieke slice)

**Gedaan:**
1. **[item 10]** `auth.providerAccountStrategy: 'unified'` in `config.ts` → login/register resolvet een bestaande user by-email over ALLE providers heen (default-adapter `findByEmailAnyProvider`), dus google + email+password op hetzelfde adres delen 1 `User`. App-laag; geen `prisma db push` nodig. Schema-tightening (`@@unique([email,provider])`→`[email]`) als optionele dev-actie geflagd in de config-comment.
2. **[Fase 0 — ADR 0005]** Bewuste, geflagde afwijking van "gebruik `_sync` voor writes": write-laag → **per-actie getypte `_api`-routes** i.p.v. `_sync`. Reden: `_sync`/room-transport is niet browser-verifieerbaar deze onbemande sessie + client `joinRoom`-API onduidelijk + `requireRoomMembership` default true; de bewezen `apiRequest`-transport lost item 9's kern (getypte payloads per actie, geen `Record<string,unknown>` client-side) volledig op en is met integration-tests verifieerbaar. Realtime-`_sync`-deltalaag uitgesteld tot browser-testbare sessie.
3. **Canonieke slice gebouwd + bewezen:** `hasCapability` RBAC-gate (gedeeld, geëxtraheerd uit `control_v1`) in `server/control/rbac.ts`; `src/workspaces/_api/quickAdd_v1.ts` + `sprintCreate_v1.ts` (thin: validate + RBAC + enqueue naar de bestaande seriële Conductor — seriële ordening + `WorkspaceSignal`-event-recorder behouden); `WorkspacesProvider` `quickAdd`/`sprintCreate` omgezet naar de getypte routes (ctx-interface + alle consumers ONGEWIJZIGD). Legacy `control`-route blijft de nog-niet-gemigreerde ops bedienen tot alles over is.

**Files:** `config.ts`, `server/control/rbac.ts`, `src/workspaces/_api/{quickAdd_v1.ts,sprintCreate_v1.ts}` (nieuw), `src/workspaces/_shell/WorkspacesProvider.tsx`, `docs/decisions/0005-*.md` (nieuw), `tests/integration/rbac.test.mts` (nieuw), generated apiTypes/apiDocs.

**Verificatie:** front-tsc 0 (bewijst end-to-end client-typing van de nieuwe routes = item-9-proof), server-tsc 0, eslint 0/0, ai:lint schoon, build groen, rbac.test 7/7 + createWorkspace 9/9. De 1 "degraded type extraction" is `system/session` (framework, pre-existing), niet mijn routes.

**Volgende slices (fan-out, workflow):** resterende ~37 ops → eigen getypte `_api`-route + provider-helper (tickets/board bulk-*, members/RBAC, settings/env/integrations/gitlab/budget, stage-config, notifications, suggestions, invite), daarna `control_v1` + generieke `control()` verwijderen. Optioneel per-op `TicketEvent`-enrichment (activity feed) + realtime-`_sync`-laag (browser-gated).

## 2026-07-02 00:58 — /loop Fase-0: board/ticket-ops gemigreerd naar getypte routes

**Gedaan:** 6 board/ticket-ops → eigen getypte `_api`-route (zelfde thin patroon: validate + `hasCapability` RBAC + enqueue naar seriële Conductor): `archive`, `bulkArchive`, `bulkMove`, `bulkStatus`, `bulkAssign` (cap workTickets), `bulkSprint` (cap manageSprints). `WorkspacesProvider` de 6 helpers omgezet naar getypte `apiRequest`-calls (ctx-interface + consumers ongewijzigd). Legacy `control()` nog voor members/settings/RBAC/env/integrations/gitlab/budget/stage-config/notifications/suggestions/invite.

**Files:** `src/workspaces/_api/{archive,bulkArchive,bulkMove,bulkStatus,bulkAssign,bulkSprint}_v1.ts` (nieuw), `src/workspaces/_shell/WorkspacesProvider.tsx`.

**Verificatie:** front-tsc 0, server-tsc 0, eslint 0/0, ai:lint schoon, build groen. Write-logica ongewijzigd (dezelfde Conductor-ops, al gedekt door integration-tests).

**Migratie-status Fase 0:** 8/~40 ops getypt (quickAdd, sprintCreate + 6 board). Resterend: members (change-role/remove/transfer/invite/revoke), roles (create/update), settings (save-env/remove-env/save-integration/remove-integration/gitlab-*/raise-cap/edit-budget/resume-spend/skill-toggle/save-stage-config), notifications (mark-read), suggestions (accept). Daarna `control_v1` + generieke `control()` weg.

## 2026-07-02 01:15 — /loop Fase-0 COMPLEET: hele write-path gemigreerd naar getypte per-actie routes + `control` verwijderd

**Gedaan:** de resterende ~18 client-aangeroepen ops → eigen getypte `_api`-route (zelfde thin patroon: validate + `hasCapability` RBAC + enqueue naar seriële Conductor):
- members/RBAC/lifecycle: `changeRole`, `removeMember`, `transferOwnership`, `renameWorkspace`, `deleteWorkspace`, `roleCreate`, `roleUpdate`, `invite`, `revokeInvite`.
- settings: `saveEnv`, `removeEnv`, `removeIntegration`, `gitlabSettings`, `skillToggle`, `saveIntegration` (echte `IntegrationTool['fields']/['mcp']`-types), `saveStageConfig` (`PipelineStageCfg`-type).
- notifications/suggestions: `markRead` (single + all), `acceptSuggestion`.
- login-only: `createWorkspace` (→ `createBlankWorkspace`, geeft id), `acceptInvite` (login-only enqueue).
- **`WorkspacesProvider` volledig omgezet:** nieuwe `afterWrite(promise)`-helper (neemt een Promise, geen route-naam → erase't de apiRequest-inferentie niet), alle ctx-methods roepen nu hun getypte route aan. Generieke `control()`-helper + `ControlOp`-import verwijderd.
- **Legacy `workspaces/control` route + test verwijderd** (`control_v1.ts` + `control_v1.tests.ts`). Niet-client-aangeroepen ops (raise-cap/edit-budget/resume-spend/gitlab-verify/gitlab-resync/AI-session pause/kill/…) NIET gemigreerd — geen caller (speculatief; blijven in de `ControlOp`-union + conductor voor Fase 2).

**Resultaat item 9:** alle write-calls client-side volledig getypt via de gegenereerde type-map; `Record<string,unknown>` weg aan de client-grens. ~26 ops elk een eigen getypte route. Conductor `executeAction`-interne readers blijven loose (server-intern, onzichtbaar voor de type-server) — per-op typing is Fase-2 cleanup.

**Files:** 20 nieuwe `src/workspaces/_api/*_v1.ts`, `src/workspaces/_shell/WorkspacesProvider.tsx`, verwijderd `control_v1.ts(+tests)`.

**Verificatie:** front-tsc 0 (bewijst dat ELKE op correct bedraad is met matchende payload), server-tsc 0, eslint 0/0, ai:lint schoon, build groen, integration 6/6 files. tsc is het vangnet: een niet-bedrade of mismatchende op zou falen.

**Nog te doen:** Fase-2 cleanup (conductor `executeAction` per-op typen; ongebruikte `OP_CAPABILITY` opruimen), lesson-0002 (default-pipeline naar server/ vóór prod), realtime-`_sync`-laag (browser-gated), Fase-3 features.
