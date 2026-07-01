# Workspaces — Session Handoff (2026-07-01)

> **Doel van dit document.** Een zelfstandige, gedetailleerde samenvatting van deze bouwsessie, zodat (a) een **verse AI** (na `/compact`) direct kan doorbouwen aan wat openstaat, en (b) een **reviewende AI** alles kan auditen. Lees dit NA `CLAUDE.md` (§ User Project Rules) en de read-order in `src/workspaces/_docs/BUILD_HANDOFF.md` → `V1_SCOPE.md` → `BUILD_ORDER.md`. De levende status staat in `workspaces-handoff/BUILD_LOG.md` + `branch-logs/main.md`; dit is de geconsolideerde momentopname.

---

## 0. TL;DR — waar staan we

- **Product:** Workspaces = self-hosted AI-dev-orchestratie-app op `@luckystack/*` (React 19 + raw Node + Socket.io + Prisma/MongoDB + Redis). Gebruiker schrijft tickets; een pipeline van stages (refine→plan→code→test→review) drijft ze; mens = man-in-the-middle die approvet/vragen beantwoordt (phone-first). 3 rollen: **Assistant** (PTY/user), **Stage-Agent** (PTY/ticket-stage), **Conductor** (deterministisch Node, **enige writer**). Zie `V1_SCOPE.md`.
- **Fasering:** Fase 0 (bootstrap+schema) ✅ · **Fase 1 (basisplatform, GEEN AI)** = deze sessie grotendeels afgemaakt ✅ · Fase 2 (AI+containers+pipeline, **spike-gated**) ❌ nog niet · Fase 3 (tool-modules) ❌.
- **Deze sessie:** Fase 1 **datalaag → read/write-path → 12 schermen gerewired → volledige test-suite (212 asserts groen)** — allemaal **E2E-geverifieerd tegen de echte MongoDB** (via SSH-tunnel + secret-manager). Plus een **echte cross-tenant security-bug gevonden + gefixt** door de tests.
- **Git:** branch `main`, **23 commits ahead of origin, NIET gepusht** (user pusht zelf via eigen SSH — Claude mag NIET pushen en NIET als co-author op commits). Author = `ItsLucky23`. Laatste commit: `e18909c`.
- **Dev-server draait** op `http://127.0.0.1:80/` (backend) — inloggen toont de app met echte data.

---

## 1. Sessie-commits (nieuwste eerst)

```
e18909c  branch-log: Fase-1 complete
c604f6e  multi-type test suite + FIX cross-tenant leak  ← SECURITY
7fe670e  rewire 12 screens off seed + all Fase-1 control-ops
2df8539  BUILD_LOG: foundation + data-seam E2E-verified
28617c0  lesson 0002 (framework API gotchas) + branch-log
59ff8b7  control-API + read path E2E-verified against real Mongo
02fed8d  useWorkspaceData seam — Provider fetches typed snapshot
e1868a2  demo seed + first-login bootstrap + read snapshot (DB-tested)
5e9c1ca  branch-log + BUILD_LOG (foundation)
a8a015e  control-API write path reference slice (in-process Conductor)
e93e70f  freeze the [control-API] contract (A1)
6ac3593  types.ts §15 backfill + tenant isolation layer
4fdecdb  lesson 0001 (guard false-positives)
8284645  mechanical non-i18n lint fixes
ad98bb7  tsconfig ES2022 -> ES2023
e92bf4b  full i18n migration (209 hardcoded strings -> useTranslator)
c60a0de  StageId 7-literal -> typed StageKind (04b §12)
02e56e2  full V1 Prisma schema (27 models)   ← Fase 0.2
```

---

## 2. Architectuur die nu STAAT (Fase 1) + file-map

### 2.1 Data (Prisma) — `prisma/schema.prisma`
- 27 modellen. **3 framework-global** (geen `workspaceId`): `User` (framework-eigen, ongewijzigd), `SshKey`, `PushSubscription`. **24 tenant-scoped** (alle met `workspaceId`).
- Rijke per-stage-config als **Prisma composite `type`s** (spiegelt `PipelineStageCfg`).
- **Schema-verfijning deze sessie:** `PipelineStage.key` toegevoegd — de stabiele slug (`'impl'`/`'plan'`) die tickets + board-kolommen refereren (de ObjectId-`_id` kan de slug niet zijn, moet uniek per collectie). De snapshot mapt `key` → frontend-`id`.
- **Live in echte Mongo gepusht** via een secret-resolve-script (zie §4). MongoDB heeft geen migrations → `prisma db push`.
- **App-enforced** (Prisma dwingt niet af, dus code+tests): workspace-teardown-cascade (`cascadeDeleteWorkspace` in de Conductor), append-only-immutabiliteit, `runInTenant` op elk non-`/api`-pad.

### 2.2 Tenant-laag — `server/tenant/`
- `tenantContext.ts` — `runInTenant(workspaceId, fn)` / `currentWorkspaceId()` (throwt buiten scope) / `hasTenantScope()` via `AsyncLocalStorage`.
- `tenantDb.ts` — `getPrismaClient().$extends(...)` die `workspaceId` injecteert voor **elke** operatie over de 25 `TENANT_MODELS`. **KRITISCH gefixt deze sessie** (lesson 0003): injecteert nu ook op no-arg reads (`findMany()` zonder `where`).
- `tenantRedis.ts` — `registerTenantKeyFormatter()`: per-workspace key-prefix (`:ws:<id>:`); delegeert framework/unscoped keys naar `defaultRedisKeyFormatter`.
- Boot-wired in `luckystack/server/index.ts` (naast `registerNotificationHooks` + de terminal-hook).

### 2.3 Control-API (write-path) — de ENIGE manier waarop user-writes gebeuren
- **Contract:** `src/workspaces/_functions/controlApi.ts` — `ControlOp`-union (41 ops), `ControlRequest`/`ControlAck`, `RBAC_CAPABILITIES` (8), `CONFIRM_REQUIRED` (destructieve ops). **Types + client-facing consts.**
- **RBAC runtime:** `server/control/rbac.ts` — `OP_CAPABILITY` (op→cap-index) + `CAP`. **Moet in `server/`** (zie lesson 0002: generated server-bundel stubt non-`_api` `src/`-runtime-imports naar `undefined`).
- **Route:** `src/workspaces/_api/control_v1.ts` — één dispatching route: valideert → RBAC (`OP_CAPABILITY` + `WorkspaceRole.perms`) → `enqueueControlAction` → `ControlAck`. **Schrijft NOOIT inline** (B-23).
- **Conductor:** `server/orchestrator/conductor.ts` — **in-process serial writer** (ADR 0002; Redis-signal-log + lease = Fase 2). `enqueueControlAction` dr- draint acties serieel onder `runInTenant`, schrijft een append-only `WorkspaceSignal` (monotone Redis-INCR seq), dan `executeAction`. **Alle Fase-1-ops geïmplementeerd** (zie §3). AI-session-ops (pause/kill) = scaffold (loggen "not yet implemented"). Ook: `bootstrapWorkspace()` + `cascadeDeleteWorkspace()`.

### 2.4 Read-path — `useWorkspaceData()` seam
- **Server:** `server/read/workspaceSnapshot.ts` — `buildSnapshot(prisma, userId, wantWorkspaceId?)` aggregeert de tenant-data → **frontend-getypeerde** shapes (narrowing DB-string→union, geen cast). Mapt `PipelineStage.key`→frontend-`id`. `stages` = board-META (volledige editor-config blijft op seed).
- **Route:** `src/workspaces/_api/snapshot_v1.ts` — geeft de snapshot voor de actieve workspace (membership-checked in buildSnapshot).
- **Client:** `src/workspaces/_shell/WorkspacesProvider.tsx` — fetcht `workspaces/snapshot` via `apiRequest` on-mount + bij workspace-switch; levert data via `WorkspacesContext`; mutaties → `workspaces/control` + refetch. `currentUser` uit `useSession()`. Nieuwe context-helper `ticketMembers(ticket)` + `membersById`.
- **Context:** `src/workspaces/_shell/WorkspacesContext.tsx` — uitgebreid met de live data (tickets/members/stages/sprints/budget/docs/skills/invites/activityEvents + loading/refetch).

### 2.5 Bootstrap + seed
- `server/bootstrap/seedWorkspace.ts` — `seedDemoWorkspace(prisma, ownerId)`: mapt de prototype-`_data/seed`-constants → echte rijen (workspace + 3 rollen + 6 members[owner=echte user, rest demo-Users met `naam+shortid@youcomm.nl`] + project + 7 stages[composite config] + 12 tickets + 2 sprints + 2 suggestions + budget + 13 sources + 4 env + 2 integrations + 1 invite + 10 events).
- `server/bootstrap/registerBootstrap.ts` — `postLogin`-hook: seedt op **eerste login** (guard: `workspaceMember.count === 0`). Boot-wired.

### 2.6 Frontend-schermen (Lane C) — `src/workspaces/_screens/` + `_shell/` + `_components/`
- **12 schermen gerewired** off `_data/seed` → `useWorkspaces()`-context: Board, Backlog, TicketDetail, Activity, Usage, Sources, Terminals, AccountSettings, WorkspaceSettings, Pipeline, SearchPalette, Shell.
- **Blijven op seed** (statische catalogs + not-yet-in-snapshot): `HOOK_CATALOG`, `COMMAND_CATALOG`, `NETWORK_CATEGORIES`, `INTEGRATION_TYPES`, `RBAC_CAPABILITIES`, `ROLE_DISPLAY`, `CARRY_VARS`, **`STAGE_CONFIGS`** (Pipeline-editor volledige config), `SESSIONS`, `SSH_KEY_TO_USER`, `TERMINALS`, `SPEND_7D`, `USAGE_ROWS`, `NOTIFICATIONS`.
- **Routing:** framework-native (echte `page.tsx` per view + `board/[ticketId]/`); `workspaces`-template = `WorkspacesProvider` + persistente `WorkspacesShell`. `main.tsx` keyt template op naam (shell blijft gemount).

### 2.7 Tests — `tests/` + `src/workspaces/_api/*.tests.ts`
- `tests/_helpers.mts` — real-DB harness (`db()` resolvet secrets + prisma; `cleanupWorkspace`; `assert`/`eq`/`report`).
- `scripts/runWsTests.mjs` + **`npm run test:ws`** — draait alle `tests/**/*.test.mts`.
- **unit:** `tests/unit/rbac.test.mts` (111), `seedHelpers.test.mts` (18).
- **integration** (echte Mongo, self-cleaning): `seed` (17), `snapshot` (21), `tenant` (15 — isolatie), `conductor` (19).
- **e2e** (echte HTTP): `tests/e2e/httpControl.test.mts` (11).
- **framework per-route** (draaien via `npm run test`): `src/workspaces/_api/control_v1.tests.ts`, `snapshot_v1.tests.ts`.
- **Status: `npm run test:ws` = 7/7 groen, 212 asserts.**

---

## 3. Geïmplementeerde control-ops (Conductor `executeAction`)

**Werkend + HTTP-getest:** `create-workspace` (via `bootstrapWorkspace`, direct), `change-role`, `save-env`, `remove-env`, `rename-workspace`, `quick-add`, `archive`, `bulk-move`, `bulk-status`, `bulk-assign`, `bulk-sprint`, `bulk-archive`, `sprint-create`, `sprint-edit`, `remove-member`, `transfer-ownership`, `delete-workspace` (cascade), `role-create`, `role-update`, `invite`, `revoke-invite`, `accept-invite`, `save-integration`, `remove-integration`, `gitlab-settings`, `gitlab-verify`/`gitlab-resync` (no-op Fase 1), `raise-cap`, `edit-budget`, `resume-spend`, `skill-toggle`, `save-stage-config`, `mark-read`.

**Scaffold (Fase 2, loggen "not yet implemented"):** `pause`, `resume`, `kill`, `pause-all`, `resume-all`, `preview-up`, `preview-down`, `accept-suggestion`.

---

## 4. Hoe draaien/testen (voor de verse AI)

**DB is bereikbaar via een open SSH-tunnel; secrets zijn secret-manager-pointers.** `.env.local` bevat POINTERS (`DATABASE_URL=DATABASE_URL_V1`) — géén letterlijke secrets (repo mag public). Resolven gebeurt bij boot via `initSecretManager({url, token:{fromFile:'.secret-manager-token'}, envNames:()=>true, source:'remote'})`. `.env.local` MAG deze sessie gelezen worden (user override op Rule 16).

- **Standalone script tegen echte DB** (patroon dat overal werkt): laad `.env`+`.env.local` via dotenv → `await initSecretManager(...)` → `getPrismaClient()`. **Belangrijk:** importeer CUT die `getPrismaClient()`/`$extends` op module-load aanroept (conductor, tenantDb, workspaceSnapshot) **dynamisch NA** `initSecretManager`, anders crasht het op de onopgeloste URL. Zie `tests/_helpers.mts` + de integration-tests.
- **`prisma db push`:** kan niet via de kale `prisma:db:push`-npm-script (die geeft de letterlijke pointer). Gebruik een tsx-script dat eerst secrets resolvet, dan `execSync('npx prisma db push --skip-generate')`.
- **Prisma `generate`** locked de query-engine-DLL op Windows → stop eerst de dev-server (de `@luckystack/devkit` supervisor respawnt children; kill de hele tree: npm → supervisor → tsx → server-node).
- **Server (her)starten:** `npm run server` (achtergrond). Boot resolvet secrets, verbindt Mongo/Redis, registreert routes+hooks. **Hot-reload pakt server/-wijzigingen niet altijd op → herstart bij twijfel** (de conductor-ops leken eerst niet te persisteren omdat een stale conductor draaide).
- **HTTP-calls (curl) naar `/api/*`:** (1) POST-body = het **`data`-object DIRECT** (NIET `{data:{...}}`-wrapped — die fout kostte tijd). (2) header `Origin: http://localhost:5173` (anders 403 origin-policy). (3) header `x-csrf-token` (GET `/auth/csrf` eerst) + sessie-cookie. `apiRequest` (client) doet dit vanzelf; alleen curl-tests moeten het handmatig.
- **Login voor tests:** `POST /auth/api/credentials` met `{name,email,password,confirmPassword,provider:'credentials'}` (name+confirmPassword gezet = register). De `postLogin`-hook seedt dan een workspace.
- **Tests:** `npm run test:ws` (de standalone suite) + `npm run test` (framework auto-sweep + per-route). **`npm run test:ws` is de betrouwbare** (de framework-runner kan de devkit-validator-bug raken, zie §5).

---

## 5. Framework-valkuilen (KRITISCH — vastgelegd als lessons)

1. **`docs/lessons/0002` — devkit `validateInputByType` "max depth 64".** De dev-mode strict type-validator choket op ELKE `/api`-route (ook framework-eigen `settings/updatePreferences`) met "input nesting exceeds the maximum depth of 64". `validation.runtimeMode:'off'` helpt NIET in dev (alleen prod). **Fix per-route:** `export const validation = 'relaxed' as const;` (skipt de strict-check; de zod-input-schemas + handler-checks blijven). **→ ELKE nieuwe `_api`-route in Workspaces heeft dit nodig tot de devkit-fix landt.**
2. **`docs/lessons/0002` — server-bundel stubt `src/`-runtime-imports.** Een `_api`-route mag TYPES importeren uit `src/…` (erasen), en runtime-WAARDEN uit `server/…`, maar een runtime-waarde uit `src/…/_functions/…` = `undefined` at runtime. **→ zet server-nodige runtime-waarden in `server/`** (daarom `OP_CAPABILITY` in `server/control/rbac.ts`).
3. **`docs/lessons/0003` — tenant no-arg-findMany leak (SECURITY).** `tenantDb.$extends` injecteerde `workspaceId` alleen als er al een `where` was → no-arg `findMany()` (die de snapshot-read-path overal gebruikt) lekte ALLE workspaces' data. **Gefixt** + regressie-guard in `tests/integration/tenant.test.mts`. **→ altijd tenant-isolatie testen met ≥2 workspaces + een no-arg read.**
4. **`docs/lessons/0001` — guard-false-positives.** De `~15 no-unnecessary-condition` lint-errors in de schermen (`membersById[id]?.x ?? fallback`) zijn CORRECTE guards die de linter mist-flagt zonder `noUncheckedIndexedAccess` (uit). **NIET weghalen.** Juiste fix = `noUncheckedIndexedAccess` project-breed (gemeten: ~56 tsc-sites incl. framework-code) → user-gated. Idem `no-empty-function` op de Fase-1-stub-knoppen.

---

## 6. Beslissingen (ADRs — `docs/decisions/`)

- **0001 — schema-shape:** embed per-stage-config als composite types (niet genormaliseerd); geen `Pipeline`-wrapper; **losse `@db.ObjectId`-refs i.p.v. `@relation`-cascades** (cascade+tenant = app-enforced door de Conductor); geen `OAuthAccount`; `String`+comment i.p.v. Prisma-enums (behoudt prototype-fidelity).
- **0002 — in-process Conductor voor Fase 1:** de Redis-signal-log + `lease:orchestrator` landen in Fase 2 (er is nog geen orchestrator-proces). Single-writer-invariant houdt (1 proces). Contract onveranderd.

---

## 7. WAT NOG OPENSTAAT (prioriteit voor de verse AI)

### 7a. Fase 1 afronden (secundair, mechanisch — hetzelfde patroon)
1. **SESSIONS / TERMINALS / USAGE_ROWS / SPEND_7D / NOTIFICATIONS** nog op seed → naar de snapshot brengen (of aparte `_api`-routes) zodat Account/Terminals/Usage/notificatie-UI live data tonen. (Terminals + Usage/Spend zijn deels Fase-2-materie: terminals = pty-agent, spend = `SpendRecord`-aggregatie.)
2. **Pipeline-editor-config-persist:** de Pipeline-editor bewerkt `STAGE_CONFIGS` (seed, lokaal). De `save-stage-config`-op schrijft nu alleen `name`/`aiEnabled`/`customInstructions`. Volledige stage-config-persist (commands/tools/modelCfg/network composites) + de snapshot `stages` uitbreiden naar de volledige `PipelineStageCfg` (nu board-META). Vereist de composite-union-narrowing die in de snapshot voor stages nu ontweken is.
3. **Mutatie-ops die nu optimistic-local zijn in de Provider** (togglePerm/addRole/saveIntegrationTool/dismissSuggestion/moveTicket) → echte control-API-calls + refetch. (De ops bestaan in de Conductor: `role-update`, `save-integration`, `bulk-move`.) Bijv. `moveTicket` → `bulk-move`-op.
4. **`save-integration`** slaat nu alleen name/type op (fields/mcp composites genegeerd). Uitbreiden.
5. **GitLab-token encryptie** (`gitlab-settings` slaat de token nu plain op — B-07 wil encrypted; app-owned-encryptie-slice).
6. **Auth-account-UI** (1.1): SSH-key-terminal-gate op `/pty` + de account/sessions-UI echt wiren (SESSIONS/SshKey uit de framework-sessie).

### 7b. Kwaliteit / follow-ups
- **`noUncheckedIndexedAccess`-strictness-pass** (lesson 0001) — user-gated project-brede beslissing; fixt de guard-false-positive-lint correct (~56 sites).
- **Echte nl/de/fr-vertaling** — de i18n-keys staan (455 keys), maar nl/de/fr zijn nu Engelse mirrors.
- **Fase-1-stub-knoppen** (`no-empty-function`) — bedraden zodra hun feature landt.
- **Playwright e2e** (`test:e2e`) — nog leeg; een browser-flow (login→board-render) toevoegen zou de UI-laag dekken (nu gedekt via HTTP-e2e + de rewire-tsc).

### 7c. Fase 2 (NIET nu — vergt jouw host + de spike)
- **P0.5 CLI-billing-spike GATET Fase 2** (`P0_CLI_SPIKE.md`) — moet eerst bewijzen dat een interactieve `claude`-PTY de Max-subscription billt (nooit `claude -p`/Agent-SDK). Vergt de host + docker.
- Dan: orchestrator-proces + Redis-signal-log + `lease:orchestrator` (vervangt de in-process Conductor, ADR 0002), containers (`07b`), pipeline-engine, hulp-AI + push.

---

## 8. Invarianten / regels die de verse AI MOET respecteren

Uit `CLAUDE.md` § User Project Rules (de 9 Workspaces-invarianten) + framework-regels:
1. **B-23 single-writer:** AI proposet → user accepteert → **Conductor executeert** (enige writer van board/git/status). LLM's schrijven nooit direct.
2. **FROZEN 7+6 verb-surface** — geen nieuwe verbs; elke write = `[control-API]` → `preApiExecute` → enqueue → Conductor.
3. **`runInTenant` op elk non-`/api`-pad** (Conductor, workers, crons) — loud-fail by design.
4. **Single by design:** GitLab-only, Claude-PTY-only, single-host, single-instance-orchestrator. Geen deferred multi-*-surface bouwen om een feature te "completen".
5. **`V1_SCOPE.md` wint bij conflict.**
6. **Framework-regels:** file-based `_api`/`_sync`-routing, function-injection, strikte typing (**geen `as any`/dubbele cast** — `consistent-type-assertions` is error), `functions.tryCatch.tryCatch`, i18n verplicht (`useTranslator`), Tailwind-tokens only, surgical changes, `npm run lint && npm run build` na elke change.
7. **Commits:** op naam `ItsLucky23`, **geen Claude als co-author/contributer**, **niet pushen** (user pusht zelf).
8. **Na functions/-export of route-wijziging:** `npm run generateArtifacts`. Na doc/route/helper-changes de `ai:*`-indexes (de pre-commit-hook doet dit ook).

---

## 9. Audit-checklist (voor de reviewende AI)

- [ ] **Draait de suite groen?** `npm run test:ws` → verwacht 7/7, 212 asserts. (Server moet draaien voor de e2e-test; DB-tunnel open.)
- [ ] **Tenant-isolatie echt dicht?** Check `server/tenant/tenantDb.ts`: injecteert `workspaceId` voor ELKE non-create-op (ook no-arg `findMany`)? `tests/integration/tenant.test.mts` bewaakt het.
- [ ] **Schrijft de Conductor de enige writer?** `control_v1.ts` schrijft nooit inline; alles via `enqueueControlAction` (B-23).
- [ ] **RBAC:** klopt `OP_CAPABILITY` (server/control/rbac.ts) met de `ControlOp`-union? `tests/unit/rbac.test.mts` checkt exhaustiviteit.
- [ ] **Geen `as any`/dubbele casts** in de nieuwe files? (strikte lint).
- [ ] **`validation:'relaxed'`** op beide `_api`-routes aanwezig (anders 400 op alles)?
- [ ] **Snapshot-shapes** matchen de frontend-types (narrowing zonder cast)? `tests/integration/snapshot.test.mts`.
- [ ] **Deferred-surfaces NIET gebouwd?** Geen `04b §18`-modellen (MergeRequest/CI/Forge/Preview/AuditEntry) in `schema.prisma`.
- [ ] **Frontend-tsc 0 errors** in `src/workspaces` + **build groen**? (De 14 server-tsc-errors zijn pre-existing framework-scaffold: `config.ts`/`SessionProvider`/`socketInitializer` — niet Workspaces-code.)
- [ ] **Secrets:** geen letterlijke secrets in git; `.env.local` = pointers; `.secret-manager-token` gitignored.

---

## 10. Bestandsindex (deze sessie nieuw/gewijzigd, kern)

```
prisma/schema.prisma                         27 modellen + PipelineStage.key
server/tenant/{tenantContext,tenantDb,tenantRedis}.ts   tenant-isolatie
server/control/rbac.ts                       OP_CAPABILITY (runtime, server-side)
server/orchestrator/conductor.ts             de Conductor + alle Fase-1-ops + cascade + bootstrap
server/read/workspaceSnapshot.ts             buildSnapshot (read-path)
server/bootstrap/{seedWorkspace,registerBootstrap}.ts   demo-seed + first-login
src/workspaces/_functions/controlApi.ts      control-API-contract (types + CONFIRM_REQUIRED)
src/workspaces/_api/{control_v1,snapshot_v1}.ts (+ .tests.ts)   routes (validation:'relaxed')
src/workspaces/_shell/{WorkspacesProvider,WorkspacesContext}.tsx  data-seam
src/workspaces/_screens/*.tsx + _shell/Shell.tsx + _components/SearchPalette.tsx  12 gerewired
src/workspaces/_data/{types.ts,seed.ts}      §15-backfill + StageKind + seed-constants (blijven voor catalogs)
tests/_helpers.mts + tests/{unit,integration,e2e}/*.test.mts   suite (212 asserts)
scripts/runWsTests.mjs                        runner (npm run test:ws)
docs/decisions/{0001,0002}-*.md              ADRs
docs/lessons/{0001,0002,0003}-*.md           valkuilen (incl. de security-fix)
config.ts                                    ONGEWIJZIGD (runtimeMode-poging gereverteerd)
```

---

*Einde handoff. De verse AI: begin bij §7a (Fase 1 afronden) of §7c (Fase 2 met de user samen, spike-gated). De reviewende AI: §9. Bij twijfel: `V1_SCOPE.md` wint, en `branch-logs/main.md` heeft de per-prompt-historie.*
