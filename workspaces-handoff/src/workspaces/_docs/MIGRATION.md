# MIGRATION — prototype → real `@luckystack`-consuming repo

> **The move is a port, not a 1:1 lift.** The prototype (`src/workspaces/`) is a UI-only SPA: dummy data imported directly from `_data/seed.ts`, typed against `_data/types.ts`, with the *one* real backend piece being the dev-gated host-shell terminal bridge (which is explicitly **discarded** — `Q-PROD-TERMINAL`). The real product is a fresh repository that installs the published `@luckystack/*` packages, stands up Prisma + MongoDB + Redis + the containerized orchestrator, and serves the same screens against a tenant-scoped, socket-fed data layer. This doc is the concrete procedure: the fresh-repo target + first-run bootstrapping, the `types.ts → Prisma` step list (with the doc-only model families flagged), the single largest mechanical refactor (replacing direct global-seed imports with one `useWorkspaceData()`/tenant-scoped seam), the `runInTenant`-for-every-background-worker checklist (a tracked P1 prerequisite), and adding `QuestionSet`/`Question` to `types.ts`.
>
> **Authority.** Resolves `Q-INF-MIGRATION` (fresh repo + migration doc + data seam; correct the "mechanical/1:1" wording), and threads `Q-SEC-RUNINTENANT`, `Q-DATA-*` (the schema reconciliations), and `Q-PROD-QUESTIONSET`. The schema bodies this doc maps **onto** live in [`04b_DATA_MODEL_ADDENDA.md`](./04b_DATA_MODEL_ADDENDA.md) (cited as `[04b §N]`); the precedence/ERRATA rules in [`00_SPEC_RECONCILIATION.md`](./00_SPEC_RECONCILIATION.md); the binding codes in [`REFERENCE_CODES.md`](./REFERENCE_CODES.md). Architecture cited as `[01 §x]`…`[07 §x]`; the tenant primitives are `docs/ARCHITECTURE_MULTI_TENANCY.md`. **No new verbs** — this is a migration doc; it introduces no structured-channel surface, and every "write" it describes is a `[control-API]` Conductor action (B-23), never an LLM verb.

---

## 0. The "mechanical/1:1" correction (read first)

`types.ts:1–8` and `04 §5` claim the dummy data "mirrors `DATAMODEL.md` field-for-field" and "maps over with minimal churn." **That claim is stale and is corrected here** (it is also corrected in `types.ts` and `04` per the `[04b §15]` backfill checklist). The reality the migration must plan around:

| Claimed | Actual |
|---|---|
| `types.ts` mirrors DATAMODEL 1:1 | ~8 doc-only model families have **no `types.ts` mirror** at all (`§2` below); 3 conflicting `AgentSession` definitions; a fixed 7-literal `StageId` that contradicts the dynamic preset model. |
| "maps over with minimal churn" | The data-access pattern is the churn: **15 files import `_data/seed` directly** (`§4`). Every one must move behind a tenant-scoped seam. This is the single largest mechanical refactor in the port. |
| dummy data → Prisma is a copy | Several prototype types are **display projections** (`Sprint.start` is a string `"May 27"`, `Ticket.mr` is `"!91 · draft"`, `WorkspaceBudget` is a single row) that map to *different* canonical columns (`Sprint.startAt: DateTime`, `Ticket.mrUrl`, multi-row `WorkspaceBudget`). Not a rename — a reshape. |

So: **the port is mostly mechanical at the field level, but structurally non-trivial at the data-access level and at the ~8 doc-only models.** Plan it as a port. This doc is ordered so the two highest-risk reconciliations (`AgentSession`, `StageKind`) land *before* the bulk field mapping, and the data-seam refactor is called out as its own lane.

---

## 1. The fresh-repo target

**Decision (`Q-INF-MIGRATION`): a NEW repository that installs the published `@luckystack/*` packages — not an in-place migration of `src/workspaces/`.** The prototype lives inside the framework monorepo (`src/workspaces/_docs/...` is *this* doc's home); the product is a standalone consumer scaffolded via `create-luckystack-app` and depending on the 14 `@luckystack/*` packages at their published versions (npm org live; see `docs/PACKAGE_OVERVIEW.md` for the use-case + peer-dep map).

### 1.1 What carries over vs. what is rebuilt

| Prototype asset | Fate in the fresh repo |
|---|---|
| `_data/types.ts` | **Ports** as the app's shared types, after the `[04b §15]` backfill (`§3` below). Source of the Prisma schema field list. |
| `_data/seed.ts` | **Becomes a Prisma seed script** for first-run bootstrapping (`§5`) — NOT imported by screens. Its constant shapes (workspace, project, 7-stage pipeline, members) seed the DB once. |
| `_screens/*`, `_components/*`, `_shell/*` | **Port the JSX**; rewire data access from direct `seed` imports to the `useWorkspaceData()` seam (`§4`). UI is the high-fidelity part of the prototype and largely survives. |
| `_data/seed` direct imports (15 files) | **Deleted** — replaced by the seam. The single biggest refactor (`§4`). |
| `server/hooks/workspacesTerminal.ts` (host-shell bridge) | **DISCARDED.** Keep only the `ws-term:*` protocol + `XtermTerminal` client; the backend is replaced by the container-scoped pty-agent + a hard prod boot-guard (`Q-PROD-TERMINAL`, `[07 §E]`/`07b`). |
| `StageId` 7-literal union | **Reconciled to `StageKind`** FIRST (`§3.1`). |
| `AgentSession` (no prototype type) | **Canonicalized** FIRST (`§3.1`) from the 3 doc defs into one `[04b §7]` row + a new `types.ts` mirror. |

### 1.2 Infra the fresh repo stands up (beyond the framework defaults)

A consumer `create-luckystack-app` gives you the socket-first React/Node/Prisma/Redis baseline. The product adds, per the build-doc set (cross-referenced, not specified here):

- **Prisma schema** = the `[04b §6–§13]` model bodies + the field sweep + the framework-global vs tenant split (`§3`).
- **Tenant layer** — `functions/tenantContext.ts` (`runInTenant`/`currentWorkspaceId`), `functions/tenantDb.ts` (`$extends` where-injection), the `registerRedisKeyFormatter` boot call (all three from `docs/ARCHITECTURE_MULTI_TENANCY.md`). The `TENANT_MODELS` set is enumerated from `[04b §11b]` (framework-global) vs everything-else (tenant-scoped).
- **Containerized orchestrator** on `workspaces-net` + Caddy + host egress proxy (`[07 §E]`/`07b` — out of scope here).
- **`08_DEPLOYMENT.md`** run models (web-app tier + single-instance supervised orchestrator acquiring `lease:orchestrator` + `resumeAll()` on boot).

---

## 2. The doc-only model families to add (no prototype mirror)

`types.ts` has **no type** for these — they are spec/doc-only and must be authored fresh in the Prisma schema (and mirrored back into `types.ts` per `[04b §15]`). Author these BEFORE the field-level mapping, because the bulk mapping (`§3.3`) assumes they exist:

| Model | Body | Why it has no prototype type |
|---|---|---|
| `TicketEvent` | `[04b §6]` | Prototype approximates it as the UI-only `ActivityEvent` (`types.ts:137`) — missing `seq`, `sessionKey`, `stageId`, `metadata`. |
| `AgentSession` | `[04b §7]` (canonical) | The prototype only has the UI *view* (`Terminal`/`TerminalProcess`/`TerminalLine`), never the runtime row. **Reconcile FIRST — `§3.1`.** |
| `WorkspaceSuggestion` | `[04b §8]` | `AiSuggestion` (`types.ts:101`) is the read-projection; missing `patch`, the 5th `automation` type, `status`. |
| `SpendRecord` | `[04b §9]` | `UsageRow` (`types.ts:225`) is the rendered aggregate, not the per-turn fact. |
| `WorkspaceBudget` (multi-row) | `[04b §9]` | `types.ts:129` is **single-row**; canonical is **multi-cap** (`Q-INF-BUDGET-SCOPE`, multi-cap IS v1). |
| `Notification` + `PushSubscription` | `[04b §10]` | `NotificationItem` (`types.ts:119`) is the read-projection; `PushSubscription` is entirely server-side (Web Push keys). |
| `WorkspaceRole` | `[04b §11e]` | `PermRole` (`types.ts:236`) approximates it but lacks `key`/`builtIn`/`workspaceId`. |
| `QuestionSet` / `Question` | `04 §2` / `[04b]` | The phone-from-the-beach Q/A loop has no prototype type at all — **add to `types.ts` now, `§6`** (`Q-PROD-QUESTIONSET`). |

Plus the already-spec'd new types the backfill names (`CarryOver` envelope, `Handoff`, `WorkspaceTrigger`, `AgentRole`, `TicketArtifact`, `PreviewDeployment`, `BoardFilter`, `TicketSort`) — see the `[04b §15]` checklist. **Append-only** models (`TicketEvent`, `RagEntry`, `WorkspaceSignal`, `SpendRecord`, `CarryOver`, `Handoff`) get **no update/delete path** in any handler (`[04b §11a]`); the DR restore-priority set.

---

## 3. `types.ts → Prisma` as a step list

The mapping is sequenced so the two reconciliations that ripple through the screens land first, then the doc-only models, then the bulk additive field sweep, then the framework-global/tenant split.

### 3.1 Step 1 — reconcile `AgentSession` and `StageKind` FIRST (the two ripple-risks)

These two are first because every later step (and the screens) depend on them.

- **`AgentSession`** — the prototype has 3 conflicting upstream defs and no UI type. Author the ONE canonical `[04b §7]` Prisma model (`kind`, `userId`, `sessionKey`, `claudeSessionId`, `containerId`, `worktreePath`, `ptyAgentUrl`, `cliVersion`, `baseImageRef`, the 4-state `status: ready|busy|paused|stopped`, `tokenEstimate`/`durationEstimate`, `channelTokenId`/`hookTokenId`). Add the matching `types.ts` mirror (`[04b §15]`). The 4-state runtime status is **distinct from** `TicketStatus` (`types.ts:15`) and `StageStatusCfg` — three state machines, do not collapse (`Q-DATA-STATUS`).
- **`StageKind`** — replace the fixed 7-literal `StageId` (`types.ts:14`) with the typed `StageKind` (`refine|plan|code|test|review|final`, `[04b §12]`). **Audit the key/switch sites FIRST** (`Board.tsx`, `Pipeline.tsx`, `WorkspacesContext.tsx` — they index columns by stage *id* (a string), not by `StageKind`), so `Record<StageId, Ticket[]>` becomes `Record<string, Ticket[]>` and exhaustiveness moves to `StageKind` switches (role logic). `PipelineStageCfg.id` stays a free string; add `PipelineStageCfg.kind: StageKind`. Seed's 7 ids map per the `[04b §12]` table (`unrefined`/`refined`→`refine`, `impl`→`code`, …). This is a **typed-key reconciliation, NOT a blind `string`** (`Q-DATA-STAGEID` rejects option 3).

### 3.2 Step 2 — author the doc-only models (`§2`)

Add the `[04b §6–§11]` model bodies to `schema.prisma` (MongoDB: `@id @default(auto()) @map("_id") @db.ObjectId`). Each tenant model carries `workspaceId @db.ObjectId`. Mirror each back into `types.ts` (`[04b §15]`).

### 3.3 Step 3 — the additive field sweep + the reshape columns

Apply the Resolved-decision field sweep (`[04b §13]`) — all additive — plus the prototype-shorthand → canonical-column reshapes. The reshapes are the only **non**-mechanical field moves:

| Prototype (`types.ts`) | Canonical column | Note |
|---|---|---|
| `Ticket.mr?` (`"!91 · draft"`) | `Ticket.mrUrl?: String` | GitLab-derived cache (B-29 SoT, `Q-DATA-ASSIGNMENT`); reconciled by the webhook. |
| `Ticket.issue?` | `Ticket.issueUrl?: String` | same. |
| `Ticket.creatorId?`/`assigneeId?` | keep | already GitLab-derived caches (`types.ts:57–58`). |
| `Sprint.start`/`end` (display strings) | `Sprint.startAt?`/`endAt?: DateTime` | workspace-tz DateTimes; keep the display string as a ui-only helper. |
| `WorkspaceBudget` (single row) | multi-row `WorkspaceBudget` | add `label`, `enforcement: pauseNew\|pauseAll`, `periodWindow`, `windowStartAt` (`[04b §9]`). Screen renders a caps LIST, not one bar. |
| `AiSuggestion.type` (4-value) | 5-value + `patch` | add `automation`, `patch Json?` (`[04b §8]`). |
| `ActivityEvent` | `TicketEvent` + `seq` | add `seq`, `stageId?`, `sessionKey?`, `metadata?` (`[04b §6]`); `seq` (not `createdAt`) is the merge key. |

Then add the sweep fields verbatim from `[04b §13]`: `Workspace.timezone`/`pricing`/`previewConcurrencyCap`/`presetKey`/`assistantTokenBudget`(+`reasonerTokenBudget`)/`handoffInstruction`; `Ticket.archived`/`lastActivityAt`; `Project.gitUrl`/`linkedFiles[]`/`generatedDocsPath`/`baseImageRef`(+`dockerfilePath`); `PipelineStageCfg.systemPrompt`/`roleKey`; `PipelineStage.avgTokensPerTurn`; `StageModelCfg.contextBudgetTokens`; `WorkspaceSignal.seq`+`processedAt`; the encrypted **ro/rw DB credential pair** per integration tool/tier (`Q-SEC-CREDLIFETIME` — injected at boot via tmpfs env-file, denyRead from Bash; never in `.claude/settings.json`).

### 3.4 Step 4 — split framework-global from tenant-scoped (`[04b §11b]`)

The `$extends` where-injection (`docs/ARCHITECTURE_MULTI_TENANCY.md §2`) only injects `workspaceId` for models in `TENANT_MODELS`. Build that set as **everything EXCEPT** the framework-global rows:

- **Framework-global (NO `workspaceId`, NOT in `TENANT_MODELS`):** `User`, `OAuthAccount`, `SshKey`, the framework session store, and `PushSubscription` (a user's device, not a workspace's).
- **Tenant-scoped (carry `workspaceId`, IN `TENANT_MODELS`):** everything else — `Project`/`Pipeline`/`PipelineStage`(+children), `Ticket`/`TicketLink`/`Sprint`, `TicketEvent`, `AgentSession`, `CarryOver`/`Handoff`/`QuestionSet`, `WorkspaceTrigger`/`WorkspaceSignal`/`WorkspaceSuggestion`, `SpendRecord`/`WorkspaceBudget`, `Notification`, `WorkspaceRole`, `InfoSource`/`RagEntry`, `WorkspaceMember`/`Invite`, `PreviewDeployment`.

The Redis key formatter mirrors this split (`docs/ARCHITECTURE_MULTI_TENANCY.md §3`): app namespaces get `:ws:<workspaceId>:`; framework namespaces (`-session`, `:rate-limit`) stay app-global. **Delete-cascade** on workspace teardown follows `[04b §11d]` (tear down live containers BEFORE the row cascade; framework-global rows untouched).

### 3.5 Step 5 — forward-pointers, no code

Per `[04b §15]`: one comment line beside `StageModelTier`/`StageEffort` (`types.ts:256–257`) — "provider-specific; a future capability registry replaces these" (`Q-MP-CAPREG`). No `providerKey` field, no `periodWindow` pre-shaping for the parked multi-provider abstraction (`Q-MP-SEAM` builds only the single-spawn wrapper).

---

## 4. The data seam — `useWorkspaceData()` (the largest mechanical refactor)

**This is the biggest single piece of mechanical work in the port.** The prototype's `_data/seed` is imported **directly by 15 files** (`page.tsx`, `_shell/Shell.tsx`, `_components/SearchPalette.tsx`, and 12 `_screens/*`). Each pulls global constants (`TICKETS`, `MEMBERS`, `WORKSPACES`, `STAGES`, …) at module scope. In the real app there is **no global data** — every read is tenant-scoped, fetched over the socket, and live.

### 4.1 The replacement seam

Introduce **one** hook, `useWorkspaceData()`, that is the *only* data source the screens consume. It reads the active workspace from `WorkspacesContext` (which already holds `activeWorkspace`/`setActiveWorkspace`, `WorkspacesContext.tsx:51–53`) and returns tenant-scoped, socket-fed slices (tickets, members, pipeline, sprints, suggestions, budget, events…). Behind it:

- Reads route through LuckyStack `apiRequest` (typed, `api/{page}/{name}/v{N}`) for snapshots and the `/sync` events for live updates — all of which the server resolves **inside `runInTenant(activeWorkspace.id, …)`** (`§5` enters the scope at the `preApiExecute` boundary per `docs/ARCHITECTURE_MULTI_TENANCY.md`). The client never picks a tenant; the server derives it from the validated session/route and checks membership first.
- The board's live moves (today an app-context override layer, `WorkspacesContext.tsx:69+`) become real `TicketEvent` `status-change` rows streamed over the event channel (`[04b §6]`, doc 20's subscribe-first → snapshot → merge-on-`seq`).

### 4.2 The mechanical procedure (per file)

1. Delete the `import { … } from '../_data/seed'` (or `'../../_data/seed'`).
2. Replace the module-scope constant reads with `const { tickets, members, … } = useWorkspaceData();` inside the component.
3. Replace any `seed.ts` mutation helpers the prototype faked in context (`addRole`, `saveEnvVar`, board overrides…) with `apiRequest` calls that the server routes to a `[control-API]` Conductor action or a direct RBAC-gated `_api` write (user-initiated writes like ticket creation are **direct** RBAC-gated writes; only AI-DRAFTED creation routes as a proposal — `Q-PROD-TICKET-CREATE`).
4. Keep ui-only derived fields (`Ticket.costLabel`, `Sprint` display strings, `Ticket.viewers` presence) as client-side helpers over the seam, not server columns.

The 15 files are the closed work-list for this lane. Because each one's read-set is small and the seam's return shape mirrors the (now-backfilled) `types.ts`, the per-file change is mechanical — but it is the **bulk** of the migration's hand-work and should be its own tracked lane.

---

## 5. First-run bootstrapping (first workspace + owner seeding)

A fresh DB has no `User`, no `Workspace`, no membership — so the tenant layer's `currentWorkspaceId()` would have nothing to resolve. Bootstrapping is the deterministic first-run path that creates the first owner + workspace, after which everything is tenant-scoped.

### 5.1 Order of operations on an empty DB

1. **First user** — the framework auth gate registers the first `User` (framework-global, `[04b §11b]`); SSH key (B-05) or OAuth establishes identity. No tenant scope yet.
2. **First `Workspace` + Owner membership** — a `[control-API]` bootstrap write (RBAC-exempt only for the *first* workspace; subsequent workspace creation is RBAC-gated, `[04b §11e]` single-Owner invariant enforced in `preApiExecute`, D77) creates the `Workspace` (with `timezone` defaulting to host tz, `presetKey`, `pricing` defaults — `[04b §13]`) and a `WorkspaceMember` row referencing the seeded `owner` `WorkspaceRole`.
3. **Seed the built-in `WorkspaceRole`s** — `owner`/`admin`/`member` rows (`builtIn: true`, editable per D76, `[04b §11e]`) for that workspace, positional `perms[]` over the `RBAC_CAPABILITIES` matrix (B-28).
4. **Seed the default pipeline** — from the chosen preset (`simple`/`advanced`/`professional`, D1; default = professional 7-stage, the B-O4 generalization, ERRATA E5). The `_data/seed.ts` `STAGES` shapes become the `PipelineStage` rows (mapped to `StageKind` per `[04b §12]`), with each stage's child collections (skills/commands/tools/statuses/processes) instantiated from the preset.
5. **Now tenant-scoped** — from here every request enters `runInTenant(workspaceId, …)` at the `preApiExecute` boundary (`docs/ARCHITECTURE_MULTI_TENANCY.md §1`), and the screens read through `useWorkspaceData()` (`§4`).

### 5.2 The Prisma seed script

`_data/seed.ts`'s constants (`MEMBERS`, `WORKSPACES`, `PROJECTS`, `STAGES`, and optionally a demo `TICKETS` set) become a **Prisma seed script** run once on a fresh install — NOT a module imported by screens. The demo tickets are optional (dev/demo only); production bootstrapping creates only the first workspace + owner + roles + pipeline. The seed writes through the same tenant scope (it `runInTenant`s the new workspace) so the `$extends` injection stamps `workspaceId` correctly.

---

## 6. Add `QuestionSet`/`Question` to `types.ts` (`Q-PROD-QUESTIONSET`)

The phone-from-the-beach Q/A loop (`request_input` → mobile cards → answer) has **no prototype type** today (`Ticket.needsInput` is a thin string, demoted by ERRATA E4 to the denormalized board-banner one-liner = first open question). Add the types now so the prototype can demo the loop and the schema mirrors `04 §2`:

- **`Question`** — `{ id, prompt, kind: 'choice'|'approve'|'free', options?: string[], answer? }` (the card variants doc 20/the NeedsInput UI render).
- **`QuestionSet`** — `{ id, ticketId, sessionKey, stageId?, sessionId?, questions: Question[], status: 'open'|'answered'|'superseded', createdAt }`. The `sessionId?` carries the `claudeSessionId` so an answer `--resume`s the SAME session (`Q-ENG-CLEAR`); a correction is a NEW append that supersedes (append-only, D49, `[04b §11a]`).
- **`ChatMessage.questionSetId?`** — renders a card inline in the Assistant chat (ERRATA E4).

Wire a **minimal NeedsInput UI** over these (the cheap de-risk per `Q-PROD-QUESTIONSET` option 1). The Stage-Agent self-structures the `Question[]` directly in `request_input` (it is an LLM, alive at ask-time) so the loop works even with no user connected (`Q-ENG-OFFLINE-NORMALIZE`); `draft_questionset` is optional polish. **No new verbs** — `request_input` is the existing worker verb; the Assistant's `draft_questionset` is existing and propose-grade.

---

## 7. `runInTenant`-for-every-background-worker checklist (P1 prerequisite)

`runInTenant` mandatory coverage is a **tracked P1 prerequisite** (`Q-SEC-RUNINTENANT`, `[04b §11c]`), not an open flag. The `/api` lifecycle enters the tenant scope at the `preApiExecute` boundary automatically — but the orchestrator and **every background worker runs OUTSIDE that lifecycle** and MUST call `runInTenant(workspaceId, …)` explicitly, or `currentWorkspaceId()` throws (a hard crash — never a silent cross-tenant read; that loud failure is the design, `docs/ARCHITECTURE_MULTI_TENANCY.md §1`). The `$extends` where-injection isolation (`§2` of that doc) is first-class: it injects `workspaceId` into every tenant-model read/write only when a scope is active.

**Checklist — every non-`/api` path wraps its work (verify each before P1 sign-off):**

- [ ] **Conductor** — the serial action consumer; wraps each `WorkspaceSignal`/action in `runInTenant(signal.workspaceId, …)` before any `tenantDb` write.
- [ ] **Stage-Agent / Assistant sessions** — the orchestrator enters the session's workspace scope before relaying hook payloads into `tenantDb` / event-log writes.
- [ ] **pty-agent relay** — the in-container pty-agent's host-side relay (`[07 §E]`) writes scrollback/events under the session's workspace scope.
- [ ] **RAG indexer** — per-workspace re-index runs inside that workspace's scope (RagEntry is tenant-scoped, `[04b §11d]`).
- [ ] **Signal-consumer** — `WorkspaceSignal` serial consumption (B-O6) scopes by `signal.workspaceId`.
- [ ] **Cron / reconcile-cron** — sprint/budget-window/Caddy-reconcile crons iterate workspaces and `runInTenant` per workspace (the budget `periodWindow` reset reads `Workspace.timezone`, `[04b §9]`/§13).
- [ ] **GitLab webhook handler** — resolves the workspace from the project mapping, then `runInTenant` before reconciling GitLab-derived caches (`Ticket.mrUrl`/`assigneeId`…, `Q-DATA-ASSIGNMENT`).
- [ ] **`resumeAll()` on boot** — re-associates each surviving container (`[04b §7]` `containerId`/`worktreePath`) under its session's workspace scope.

The Redis key formatter (`registerRedisKeyFormatter`) reads the SAME tenant context, so a worker that forgets `runInTenant` fails loudly on the first `formatKey()` of an app namespace too — defense in depth.

---

## 8. Migration order of work (summary)

A lane can pick this up cold. Do the schema reconciliations before the screen port so the screens compile against final types.

| # | Step | Cross-ref | Risk |
|---|---|---|---|
| 1 | Reconcile `AgentSession` + `StageKind` in `types.ts` (audit `Board`/`Pipeline`/`WorkspacesContext` switch sites first) | `[04b §7]`, `[04b §12]` | High — ripples through screens. Do FIRST. |
| 2 | Author the ~8 doc-only models in `schema.prisma` + mirror into `types.ts` | `[04b §6–§11]`, `§2` | Medium — net-new bodies. |
| 3 | Additive field sweep + the reshape columns (`mr→mrUrl`, single→multi-cap budget, …) | `[04b §13]`/§9/§8/§6, `§3.3` | Low/Medium — mostly additive; reshapes are the exception. |
| 4 | Split framework-global vs tenant-scoped → build `TENANT_MODELS` + the Redis formatter | `[04b §11b]`, `docs/ARCHITECTURE_MULTI_TENANCY.md` | Medium — correctness-critical for isolation. |
| 5 | The data seam: replace 15 direct `_data/seed` imports with `useWorkspaceData()` | `§4` | **Highest hand-work volume** — own lane. |
| 6 | First-run bootstrapping + the Prisma seed script | `§5` | Medium — deterministic path. |
| 7 | Add `QuestionSet`/`Question` + minimal NeedsInput UI | `§6`, `Q-PROD-QUESTIONSET` | Low — de-risks the core flow. |
| 8 | `runInTenant` background-worker checklist (P1 gate) | `§7`, `[04b §11c]` | High — P1 prerequisite; loud-fail by design. |
| 9 | Discard host-shell terminal backend; wire container pty-agent + prod boot-guard | `Q-PROD-TERMINAL`, `[07 §E]` | (container lane, out of scope here) |

**Self-check.** No new verbs introduced. Every "write" the screens issue routes to a direct RBAC-gated `_api` write (user-initiated) or a `[control-API]` Conductor action (AI-drafted proposals) — never an LLM verb (B-23). The "mechanical/1:1" wording is corrected (`§0`). The two ripple-risk reconciliations (`AgentSession`, `StageKind`) are sequenced first. The data seam is called out as the largest mechanical refactor (15 files). `runInTenant` coverage for every background worker is a tracked P1 prerequisite, not a flag.
