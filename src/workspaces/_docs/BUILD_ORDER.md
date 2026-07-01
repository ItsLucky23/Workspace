# BUILD_ORDER — the V1 step-by-step build plan (4 non-overlapping lanes)

> **This replaces the now-stale [05_BUILD_PLAN].** [05] was written at the design horizon (6 lanes A–F, the thin-Brain PoC, P1–P5 phasing for a multi-provider/multi-forge/built-in-MR system). The locked V1 scope ([V1_SCOPE], user 2026-06-04) is a deliberate subset: **Claude CLI in a node-pty PTY + GitLab only + one self-hosted host**, shipped as a fresh repo that installs the published `@luckystack/*` packages. This doc is the build order for **that** subset, organized as **4 non-overlapping lanes (A/B/C/D) for 4 parallel AI sessions**, preceded by a shared **Phase 0**. Each lane owns disjoint directories, reads a fixed doc set, depends on frozen contracts it must NOT edit, and ships an ordered milestone list with a verifiable goal per milestone. Read [V1_SCOPE] FIRST — it is the ground truth on *what ships*; the build-docs cited per lane govern *how* each IN piece works. Last updated: 2026-06-04.
>
> **Authority.** Selects the build sequence over [V1_SCOPE §2/§3/§6], [05] (superseded structure), [P0_CLI_SPIKE] (the gate), [MIGRATION] (fresh-repo bootstrap + the `types.ts→Prisma` order), [04b] (schema bodies), [CONTROL_API] (the write transport + catalogue), [07b] (the container runtime), and the in-container VS Code editor flow ([V1_SCOPE §3.1], [features/07], [features/08]). Where [05]'s lane letters/phasing conflict with the 4-lane split here, **BUILD_ORDER wins**; where [V1_SCOPE]'s IN/OUT conflicts with any deeper doc, **V1_SCOPE wins** ([V1_SCOPE §5]).
>
> **No new verbs. No new scope.** This is a sequencing doc. It introduces zero structured-channel verbs and zero new entities. It orders the build over the frozen 7+6 verb surface ([02 §2], all `read|propose`), the single-writer Conductor ([01 §3.3]), the FROZEN [CONTROL_API] verb-free write path, `runInTenant` multi-tenancy ([04b §11c]), and the LuckyStack file-based `_api`/`_sync` + function-injection conventions (root `CLAUDE.md`).

---

## 0. The shape of the build, in one paragraph

A fresh `create-luckystack-app` consumer repo ([MIGRATION §1]) is stood up; the whole `src/workspaces/` prototype folder is dropped in and ported. **Phase 0 runs first, alone**: it (a) runs the **P0.5 CLI billing spike** ([P0_CLI_SPIKE]) which **GATES** all container/engine work, (b) bootstraps the fresh repo, and (c) publishes the two **frozen contracts** that unblock parallelism — **Lane B publishes the Prisma schema + `types.ts` mirror first**, **Lane A publishes the control-API catalogue + `VERB_REGISTRY` first**. Once those contracts are frozen, **4 lanes build in parallel** against them in **disjoint directories**: **A = Engine & Orchestrator**, **B = Data, tenancy & sync-backend**, **C = Frontend app & realtime-client**, **D = Code-editor & changes/config**. Lanes that need a container (A's PTY/engine work, D's in-container VS Code) wait on the spike going GREEN; lanes that build only against frozen *contracts* (B's schema, C's UI against the `ws-ai:*` + control-API shapes, D's stage-config UI) proceed immediately. Non-overlap is enforced by directory ownership + the propose-don't-edit contract protocol (§7). Integration happens at named checkpoints (§8).

---

## 1. Phase 0 — shared, before any parallelism

Phase 0 is **not** a lane; it is the serial prelude every lane depends on. It has three deliverables that must land in this order: the **spike** (gates), the **bootstrap** (the repo exists), the **contracts** (the lanes can start).

### 1.1 Phase 0.A — the P0.5 CLI billing spike (THE GATE) — owner: a human + Lane A's first task

The spike is the **first task of the whole build** and is **load-bearing** ([V1_SCOPE §1], [P0_CLI_SPIKE]). It proves the five unverified premises the entire engine rests on, against the **running 2026 Claude CLI**:

| Spike | Proves | Gates |
|---|---|---|
| A — billing | interactive PTY (clean env) bills the **Max subscription**, not a metered pool ([P0_CLI_SPIKE §1]) | A (engine), D (in-container VS Code) |
| B — hooks | `type:http` hooks (`SessionStart`/`PostToolUse`/`Notification`/`Stop`/`PreCompact`) fire **interactively** + POST to `registerCustomRoute` ([P0_CLI_SPIKE §2]) | A (control-channel ingress, turn-end) |
| C — `/clear` vs `/compact` | `/clear` keeps a resumable session OR the rotated id is observable; `/compact` keeps the id ([P0_CLI_SPIKE §3]) | A (`--resume`), D (token-opt later) |
| D — usage feed | a per-turn token number exists (hook payload) else the char-count estimate is the labeled floor ([P0_CLI_SPIKE §4]) | advisory only — never blocks |
| E — resume + auth projection | `--resume` after crash works; the CLI authenticates from a minimal **RO `.credentials.json` + `.claude.json`** `CLAUDE_CONFIG_DIR` ([P0_CLI_SPIKE §5]) | A + D container auth |

- **Output:** `src/workspaces/_docs/SPIKE_RESULTS.md` ([P0_CLI_SPIKE §6]) — the committed verdict table. Until it exists with every gating row **GREEN** or **GREEN-WITH-WORKAROUND**, the container/engine slices of A and D do not start.
- **On a billing/PTY/auth RED → ESCALATE to the user** ([P0_CLI_SPIKE §0/§1/§5]). Do **NOT** route around it to headless `-p`/Agent-SDK — that re-breaks the load-bearing billing decision ([01 §1], E1). Metered-burst stays a deferred (post-V1) config-flagged option, never an in-lane fallback.
- **Pin the EXACT CLI version** onto every result row and bake it into the L1 base image ([P0_CLI_SPIKE §7], [07b §1.1], `Q-CT-CLIPIN`). Never `@latest`.
- **Verifiable goal:** `SPIKE_RESULTS.md` committed; every gating row GREEN/GREEN-WITH-WORKAROUND (or a RED-ESCALATE block surfaced to the user); the pinned `cliVersion` recorded.

### 1.2 Phase 0.B — fresh-repo bootstrap — owner: Lane B (with A pairing on infra)

Per [MIGRATION §1]: a **new** repo (not an in-place migration of `src/workspaces/`) scaffolded via `create-luckystack-app`, depending on the published `@luckystack/*` packages. Stand up:

- The socket-first React/Node/Prisma/Redis baseline ([MIGRATION §1.2]).
- **Tenant layer** ([MIGRATION §1.2]): `functions/tenantContext.ts` (`runInTenant`/`currentWorkspaceId`), `functions/tenantDb.ts` (`$extends` where-injection), `registerRedisKeyFormatter` boot call — all from `docs/ARCHITECTURE_MULTI_TENANCY.md`.
- The prototype JSX dropped in (`_screens`/`_components`/`_shell`/`page.tsx`/`workspaces.css`) — ported, not yet rewired (Lane C does the rewire).
- The **host-shell terminal backend DISCARDED** ([MIGRATION §1.1], `Q-PROD-TERMINAL`): keep only the `ws-term:*` protocol + `XtermTerminal` client; a hard prod boot-guard crashes if the dev host-shell flag is set without the container backend (Lane A wires the container backend).
- **Verifiable goal:** `npm install` + `npm run build` green on the fresh repo; the prototype screens render against dummy data; the tenant primitives importable; boot-guard present.

### 1.3 Phase 0.C — the two frozen contracts (UNBLOCK the lanes)

Parallelism is only safe behind **frozen contracts** ([05] "how to read this"). Two are published in Phase 0; everything else negotiates against them (§7).

| Contract | Owner (publishes FIRST) | Consumers (must NOT edit) | Source |
|---|---|---|---|
| **Prisma schema + `types.ts` mirror** — all models incl. [04b §6–§11], the `StageKind` reconciliation, the framework-global/tenant split (`TENANT_MODELS`) | **Lane B** | A (reads rows), C (renders), D (stage-config types) | [04b], [MIGRATION §3] |
| **control-API catalogue + `VERB_REGISTRY`** — the `ControlRequest`/`ControlAck` shapes ([CONTROL_API §6]), the op catalogue ([CONTROL_API §8]), the frozen 7+6 verb list ([02 §2]) | **Lane A** | C (calls ops), D (stage/changes ops), B (drains signals) | [CONTROL_API], [02 §2] |
| **`ws-ai:*` + `ws-term:*` socket event contract** — client↔server event names/payloads ([05 `ws-ai:*` section]) | **Lane A** (engine side) + **Lane C** (client side) co-own the shape, A publishes the server contract | C consumes, D reuses `/pty` | [05 §ws-ai:*], [07b §9] |

- These are **append-only by convention during V1**: a lane that needs a change **proposes** it (§7), it does not silently edit another lane's contract file.
- **Verifiable goal:** `schema.prisma` + `types.ts` compile (`tsc --noEmit`) and seed; the control-API route stubs + `VERB_REGISTRY` const compile; the `ws-ai:*`/`ws-term:*` event union is a published TS type all lanes import.

---

## 2. Lane A — Engine & Orchestrator

> The single-instance orchestrator: the engine that spawns/relays Claude PTYs, the container runtime, the control-API **write-handlers** + the Conductor (the only writer), GitLab push → create-MR-URL, and the SSH gate. **Owns the spike** (Phase 0.A).

### 2.1 Directories Lane A owns (no other lane writes here)

| Dir / file | Contents |
|---|---|
| `server/orchestrator/**` | the single-instance orchestrator: `lease:orchestrator`, the Conductor (serial signal-log drain), `SessionManager`, `resumeAll()`, the engine wrapper |
| `server/orchestrator/engine/**` | the single-spawn Claude wrapper ([MULTI_PROVIDER_SEAM §v1]) — `cmd:'claude'` + the SessionManager spawns behind one internal fn; node-pty; turn-end signal; hook ingress |
| `server/orchestrator/containers/**` | the [07b] runtime: image build (Docker API), CapacityManager, clone-into-volume, dial-by-name net, Caddy `@id` routes, host forward-proxy, hardening, the in-container **pty-agent** program + its host relay |
| `server/orchestrator/forge/**` | the `ForgeProvider` seam ([FORGE_ABSTRACTION §3]) with **only `GitLabForge`** implemented: push, the create-MR-URL surface, the webhook reconcile inputs |
| `src/workspaces/_api/**` (control-API **handler bodies**) | the `_api/<op>_v1.ts` route family — RBAC check → enqueue a `WorkspaceSignal` → `ControlAck` ([CONTROL_API §7]). A owns the handler bodies; the *catalogue/types* are the Phase 0.C contract |
| `server/orchestrator/ssh/**` | the per-open SSH-key gate ([07b §9], B-05) resolving a session to a container terminal |
| `containers/base/**` (Dockerfile L1) | the `node:22-bookworm-slim` base image with the pinned CLI ([07b §1.1]) |

### 2.2 Docs Lane A reads

[V1_SCOPE §3.1/§3.4], [01], [07], [07b] (the build guide), [CONTROL_API], [FORGE_ABSTRACTION] (**GitLab path only**, the rest is design-only), [MULTI_PROVIDER_SEAM §v1], [P0_CLI_SPIKE], [04b §7] (the `AgentSession` runtime row), `docs/ARCHITECTURE_MULTI_TENANCY.md` (for `runInTenant` on every worker).

### 2.3 Contracts Lane A depends on (must NOT edit)

- **B's Prisma schema** — A reads/writes rows only through `tenantDb`; A never edits `schema.prisma`. (A *proposes* fields to B — §7.)
- **B's sync-backend** — A's Conductor writes `TicketEvent`/state; B owns the event-log writer + `seq` allocation. A enqueues/writes through B's published seam, not a parallel implementation.

### 2.4 Lane A milestones (ordered; verifiable goal each)

| # | Milestone | Verifiable goal |
|---|---|---|
| A0 | **The spike** (Phase 0.A) | `SPIKE_RESULTS.md` GREEN/GREEN-WITH-WORKAROUND, CLI pinned (GATE for A1+) |
| A1 | **Publish the control-API contract** (Phase 0.C) | `ControlRequest`/`ControlAck` + op catalogue + `VERB_REGISTRY` compile; all consumers import them |
| A2 | **Single-spawn engine + PTY** | one interactive `claude` PTY spawns clean-env, streams over the socket, draws the subscription (confirmed via host usage); turn-end signal fires per the spike's pinned mechanism |
| A3 | **Control-API handler family + Conductor enqueue/drain** | a control-API call (`pause`) → RBAC → one `WorkspaceSignal` → the single-instance Conductor drains it serially → writes via B's seam; `ControlAck{accepted,signalSeq}` returns; nothing mutates inline ([CONTROL_API §7]) |
| A4 | **Container runtime (L1 base + provisioning skeleton)** | `docker run` of L1 with the full hardening table ([07b §7]); managed-token-projection auth ([07b §2]) authenticates a containerized `claude`; clone-into-volume ([07b §4]); dial-by-name Caddy route by `@id` ([07b §5]) |
| A5 | **pty-agent + SSH gate** | the in-container pty-agent owns node-pty + durable scrollback, relayed over `/pty` reusing `ws-term:*` (XtermTerminal byte-identical); SSH lands on the host, the gate resolves to a container terminal ([07b §9]) |
| A6 | **Stage-Agent spawn + per-stage `.claude` render** | a stage transition = a NEW PTY in the SAME container with freshly-rendered `.claude/settings.json`/`.mcp.json`/`CLAUDE.md` from `PipelineStageCfg`; the egress proxy enforces the stage allow-list ([07b §3/§6]) |
| A7 | **CapacityManager + `resumeAll()`** | admission under `MAX_RESIDENT` + RAM watermark, reclaim-before-reject; kill the orchestrator mid-stage → `resumeAll()` re-associates the container by stored `containerId`/`worktreePath`/`ptyAgentUrl`, re-mints tokens, `--resume`s ([07b §8/§9]) |
| A8 | **GitLab push → create-MR-URL** | completing the LAST stage runs `git push DEV-####` (agent commits + the user's local edits) via `GitLabForge.push()`; GitLab's `remote:` create-MR URL is captured + surfaced to the user ([V1_SCOPE §3.1], [FORGE_ABSTRACTION §3]) |
| A9 | **pause/resume-with-changes wiring (engine side)** | `pause` parks the Stage-Agent PTY (container kept for `--resume`); `resume` injects "you may proceed; the user made these changes: <diff>" via the `--resume` prompt ([V1_SCOPE §3.2]) |

### 2.5 Lane A first vertical slice

**A1 + A2 + A3**: publish the control-API contract, spawn one Claude PTY that streams to a connected client, and prove `pause` flows control-API → RBAC → signal → Conductor → a `TicketEvent` written through B's seam → `ws-ai:*` confirmation. This is the smallest proof that **only the Conductor writes** and the engine is real. (Mirrors [05]'s thin-Brain PoC but scoped to the V1 control path.)

---

## 3. Lane B — Data, tenancy & sync-backend

> The persistence + tenancy + realtime-backend foundation. **Owns + publishes the schema first** (Phase 0.C) so every other lane builds against final types.

### 3.1 Directories Lane B owns

| Dir / file | Contents |
|---|---|
| `prisma/schema.prisma` | the full schema incl. [04b §6–§11], the `StageKind` reconciliation ([04b §12]), the field sweep ([04b §13]) |
| `src/workspaces/_data/types.ts` | the `types.ts` mirror after the [04b §15] backfill — the shared app types contract |
| `functions/tenantContext.ts`, `functions/tenantDb.ts` | `runInTenant`/`currentWorkspaceId`, `$extends` where-injection, the `TENANT_MODELS` set ([MIGRATION §3.4]) |
| `server/sync/**` (the event-log writer + sync backend) | the `seq` allocator (Redis `INCR ws:{ws}:ticket:{t}:evseq`, [04b §6]), the append-only `TicketEvent` writer seam, the subscribe-first → snapshot → merge-on-`seq` server side ([CONTROL_API §6.3]) |
| `src/workspaces/_sync/**` (server handlers) | the `_sync/<name>_server_v1.ts` snapshot/stream handlers, each wrapped in `runInTenant` |
| `prisma/seed.ts` + `server/bootstrap/**` | the first-run bootstrap (first user → first workspace → roles → pipeline, [MIGRATION §5]) + the Prisma seed script |

### 3.2 Docs Lane B reads

[V1_SCOPE §3.5/§Data], [04], [04b] (the model bodies), [MIGRATION] (the `types.ts→Prisma` step list, the data seam, bootstrap, the `runInTenant` checklist), [TESTING_STRATEGY] (the subscribe-before-fetch race test), `docs/ARCHITECTURE_MULTI_TENANCY.md`.

### 3.3 Contracts Lane B depends on (must NOT edit)

- **A's control-API catalogue + `VERB_REGISTRY`** — B's sync handlers and the Conductor's writer seam consume the signal shapes A defines; B does not invent its own write transport.
- **The `ws-ai:*` event contract** (Phase 0.C) — B's snapshot/stream handlers emit on the published event names.

### 3.4 Lane B milestones

| # | Milestone | Verifiable goal |
|---|---|---|
| B1 | **Reconcile `AgentSession` + `StageKind` FIRST** ([MIGRATION §3.1]) | the two ripple-risk types land before bulk mapping; `types.ts` compiles; the 7-literal `StageId` → `StageKind` + free-string `id` ([04b §12]) |
| B2 | **Author the ~8 doc-only models** ([04b §6–§11], [MIGRATION §2]) | `TicketEvent`/`AgentSession`/`WorkspaceSuggestion`/`SpendRecord`/multi-cap `WorkspaceBudget`/`Notification`/`PushSubscription`/`WorkspaceRole` + `QuestionSet`/`Question` in `schema.prisma` + mirrored in `types.ts`; **publish the schema contract** (Phase 0.C unblocks A/C/D) |
| B3 | **Field sweep + reshape columns** ([04b §13], [MIGRATION §3.3]) | `mr→mrUrl`, single→multi-cap budget, `Sprint.start→startAt`, the sweep fields; `tsc --noEmit` green |
| B4 | **Framework-global vs tenant split** ([MIGRATION §3.4], [04b §11b]) | `TENANT_MODELS` set correct; `$extends` injects `workspaceId` only for tenant models; the Redis key formatter mirrors the split; a cross-tenant read **fails loudly** |
| B5 | **The event-log writer + `seq` + sync backend** ([04b §6], [CONTROL_API §6.3]) | monotonic `seq` via Redis INCR; append-only `TicketEvent` (no update/delete path); the subscribe-first → snapshot → merge-on-`seq` server handlers stream live |
| B6 | **`runInTenant` background-worker checklist** ([MIGRATION §7], [04b §11c]) | every non-`/api` path (Conductor, sessions, pty-agent relay, RAG, signal-consumer, cron, webhook, `resumeAll`) wraps `runInTenant`; verified loud-fail on omission (P1-gate) |
| B7 | **First-run bootstrap + seed** ([MIGRATION §5]) | empty DB → first user → first workspace + Owner + built-in roles + default 7-stage pipeline; from there every request is tenant-scoped |
| B8 | **The data seam `useWorkspaceData()` server side** ([MIGRATION §4]) | the tenant-scoped, socket-fed snapshot/stream API the 15 prototype files will consume (C does the client rewire) |

### 3.5 Lane B first vertical slice

**B1 + B2 + B5**: reconcile the two ripple types, author the core models, and stand up the `TicketEvent` event-log with monotonic `seq` + the subscribe-first → snapshot → merge-on-`seq` stream. This is the contract every other lane reads against and the spine of the realtime sync. **Publishing B2's schema is the single biggest unblock** in the whole build (§9).

---

## 4. Lane C — Frontend app & realtime-client

> The board/tickets/pipeline UI (porting the prototype screens), the Assistant chat (instruction=consent), the realtime sync client, PWA + push + notifications, and account/auth UI.

### 4.1 Directories Lane C owns

| Dir / file | Contents |
|---|---|
| `src/workspaces/_screens/**` | the ported screens (Board, Backlog, Pipeline, TicketDetail, Activity, Usage, Settings, Sources, Terminals, AccountSettings) — rewired off `_data/seed` onto `useWorkspaceData()` |
| `src/workspaces/_shell/**` | `Shell.tsx`, `WorkspacesContext.tsx`, `MobileChrome.tsx` — the chrome + the active-workspace context |
| `src/workspaces/_components/**` (client UI, excl. the editor) | `XtermTerminal` (client, byte-identical), `SearchPalette`, `primitives`, `motion`, `Icon`, the Assistant chat bubbles, the NeedsInput cards |
| `src/workspaces/_functions/realtime/**` | the realtime sync **client**: subscribe-first → snapshot → merge-on-`seq`, the `useWorkspaceData()` hook, the `ws-ai:*` client, optimistic-affordance-then-merge ([CONTROL_API §6.3]) |
| `src/workspaces/_functions/push/**` + `public/sw.js` + the PWA manifest | the service worker (redacted push render, full-body-in-app fetch), `PushSubscription` registration ([CLIENT_AND_PUSH], [04b §10]) |
| `src/auth/**` (consumer auth/account UI pages) | the account/auth screens ([features/17]) |

### 4.2 Docs Lane C reads

[V1_SCOPE §3.3/§3.5/§3.6], [features/11] (the Assistant panel → instruction=consent), [features/12/13] (board/backlog/sprints), [features/17] (account/auth), [features/18] (notifications), [features/09] (questions-in-tickets cards), [CLIENT_AND_PUSH], [MIGRATION §4] (the data seam, the 15-file work-list), [05 §ws-ai:*].

### 4.3 Contracts Lane C depends on (must NOT edit)

- **B's `types.ts` mirror + `useWorkspaceData()` server seam** — C renders/consumes; C never edits the schema or types (proposes — §7).
- **A's control-API catalogue + `ws-ai:*` contract** — C calls ops via the typed `apiRequest`; C never adds a verb or a bespoke write transport. The Assistant (instruction=consent) maps a natural-language instruction → a control-API request; **destructive ops require an explicit `menuHandler.confirm`** ([V1_SCOPE §3.3]).

### 4.4 Lane C milestones

| # | Milestone | Verifiable goal |
|---|---|---|
| C1 | **The data seam rewire** ([MIGRATION §4]) | the 15 `_data/seed` direct imports replaced by `useWorkspaceData()`; screens render tenant-scoped, socket-fed data; lint/build green |
| C2 | **Realtime sync client** ([CONTROL_API §6.3], [05 §ws-ai:*]) | subscribe-first → snapshot → merge-on-`seq`; a board move from another client appears live; no optimistic edit ever wins over a Conductor write |
| C3 | **Assistant chat (instruction=consent)** ([features/11], [V1_SCOPE §3.3]) | a natural-language instruction maps to a control-API op that **executes directly**; destructive ops (delete workspace, remove member, kill, push) require an explicit confirm; the Assistant has **no write verb** (B-23 preserved) |
| C4 | **NeedsInput cards (the phone Q/A loop)** ([features/09], [MIGRATION §6]) | a `needs-input` `QuestionSet` renders one-question-per-screen cards; Approve == Promote; answer `--resume`s the SAME session |
| C5 | **Board / backlog / sprints / bulk** ([features/12/13]) | kanban + backlog render live; bulk ops dispatch one batched control-API signal, clear on the Conductor's confirmation (merge-on-`seq`) |
| C6 | **PWA + web-push + notifications** ([CLIENT_AND_PUSH], [features/18]) | installable PWA; a `Notification` fans out a **redacted** push; the SW renders the redacted payload; the full body is fetched **in-app behind auth** on tap; deep-link → the approve card |
| C7 | **Account / auth UI** ([features/17]) | login/register/account pages over the framework auth; SSH-key + OAuth identity wired |

### 4.5 Lane C first vertical slice

**C1 + C2 + C3**: rewire one screen (Board) off the seed onto `useWorkspaceData()`, prove a live board move merges by `seq`, and prove one Assistant instruction ("move ticket X to review") executes directly through the control-API while a destructive instruction asks to confirm. This proves the realtime spine + the instruction=consent model end-to-end on the client.

---

## 5. Lane D — Code-editor & changes/config

> The in-container browser VS Code, the changes page (real diff + highlight + edit), the per-stage edit-lock + pause/resume orchestration, the per-stage config UI, and the [GOLDEN_PLAN_STAGE] renderer + prompts.

### 5.1 Directories Lane D owns

| Dir / file | Contents |
|---|---|
| `server/orchestrator/editor/**` | the **openvscode-server** integration: launch it INSIDE the ticket container, expose it via the Caddy proxy at a `vscode-<ticketId>.<domain>` route (same `@id`-route + dial-by-name mechanism as term/preview) ([V1_SCOPE §3.1]) |
| `src/workspaces/_screens/TicketChanges.tsx` (+ the changes-page subtree) | the CHANGES page: the embedded VS Code session + changed-file highlight (real diff); the stage-lock read-only state + Pause-AI button |
| `src/workspaces/_components/editor/**` | the embedding shell for the in-container VS Code; the **read-only inline-diff fallback** (`FileDiffViewer`/`DiffView`, the documented Monaco reference) when the VS Code session isn't up ([features/07], [features/08]) |
| `src/workspaces/_screens/Pipeline.tsx` config subtree + `_components/stageConfig/**` | the per-stage config UI: edit-lock toggle, tools/info/model/skills/MCP, the proceed-or-gate autonomy ([features/02], [features/03]) |
| `src/workspaces/_functions/goldenPlanStage/**` | the [GOLDEN_PLAN_STAGE] renderer + the stage prompts |

### 5.2 Docs Lane D reads

[V1_SCOPE §3.1/§3.2], [features/07] (code-changes review), [features/08] (codebase viewer), [features/02] (pipeline presets / per-stage config), [features/03] (build phase / autonomy), [GOLDEN_PLAN_STAGE], and the ui-builder Monaco reference (`ui-builder/src/sandbox/_components/editor/BaseCodeEditor.tsx`, `ui-builder/src/sandbox/_functions/codeEditor/*`) — a **reference only**, NOT the V1 target.

> **Note:** [CODE_EDITOR.md](./CODE_EDITOR.md) is the canonical Lane-D editor build-doc (now written) — the in-container openvscode-server exposed via Caddy + the read-only `FileDiffViewer` fallback. It is fully consistent with [V1_SCOPE §3.1] + [features/07]/[features/08]; coordinate via §7 if a change must touch a shared contract.

### 5.3 Contracts Lane D depends on (must NOT edit)

- **A's container runtime + Caddy `@id`-route mechanism** — D exposes openvscode-server *through* A's [07b §5] route mechanism + A's pty-agent container; D does not re-implement the container/networking layer. (D *proposes* a `vscode-<ticketId>` route shape to A — §7.)
- **A's control-API ops** for `pause`/`resume`/`complete` — D's stage-lock + pause/resume buttons call A's ops; D never writes state.
- **B's `types.ts`** for `PipelineStageCfg`/`StageKind`/`Ticket.files` — D renders config against B's types.

### 5.4 Lane D milestones

| # | Milestone | Verifiable goal |
|---|---|---|
| D0 | **GATE: the spike GREEN** (A0) | the auth-projection + PTY rows are GREEN before any in-container editor work ([P0_CLI_SPIKE §5]) |
| D1 | **Per-stage config UI** ([features/02], [GOLDEN_PLAN_STAGE]) | each `PipelineStageCfg` renders the edit-lock toggle + tools/info/model/skills/MCP + the proceed-or-gate autonomy; edits persist via a control-API config op (no direct write) |
| D2 | **Changes page + read-only diff fallback** ([features/07], [features/08]) | the changes page shows the full codebase with changed files highlighted from `Ticket.files`; the `FileDiffViewer`/Monaco read-only fallback renders when VS Code isn't up |
| D3 | **In-container openvscode-server** ([V1_SCOPE §3.1]) | openvscode-server runs inside the ticket container; exposed via a `vscode-<ticketId>` Caddy route (A's mechanism); native git-diff/changed-file decorations, native editing, container terminals, multi-language LSP, account-linked extensions |
| D4 | **Stage edit-lock orchestration** ([V1_SCOPE §3.2]) | toggle OFF → the changes editor is read-only ("stage active — changes disabled") + a Pause-AI button; toggle ON → editable |
| D5 | **Pause → edit → resume-with-changes** ([V1_SCOPE §3.2]) | Pause-AI calls A's `pause` (PTY parked); the editor unlocks; re-enable calls A's `resume`, which injects "you may proceed; the user made these changes: <diff>" |
| D6 | **Complete → push handoff (UI side)** ([V1_SCOPE §3.1]) | "complete" on the last stage calls A's `complete`/push op; the returned GitLab create-MR URL renders as a clickable link |
| D7 | **GOLDEN_PLAN_STAGE renderer + prompts** ([GOLDEN_PLAN_STAGE]) | the golden-plan stage renders + the per-stage system prompts layer correctly |

### 5.5 Lane D first vertical slice

**D1 + D2**: the per-stage config UI (the edit-lock toggle + autonomy) + the changes page with the read-only diff fallback (no container needed yet — uses `Ticket.files`). This ships the entire changes/config surface against B's types and A's control-API ops **before** the in-container VS Code (D3) which is gated on the spike. It proves the stage-lock UI state machine independent of the container runtime.

---

## 6. The dependency graph + realistic sequence

### 6.1 What is truly parallel vs what must wait

```
Phase 0 (SERIAL prelude — nothing parallel yet)
  0.A  P0.5 CLI spike  ──────────────► SPIKE_RESULTS.md (GATE)
  0.B  fresh-repo bootstrap (B + A)
  0.C  freeze contracts:  B → schema/types     A → control-API catalogue + VERB_REGISTRY
                          A+C → ws-ai:*/ws-term:* event union
        │
        ▼ (contracts frozen → 4 lanes fan out)
  ┌─────────────┬──────────────┬───────────────┬────────────────┐
  │  Lane A      │  Lane B       │  Lane C        │  Lane D         │
  │  Engine/Orch │  Data/sync    │  Frontend      │  Editor/changes │
  └─────────────┴──────────────┴───────────────┴────────────────┘

  GATE (spike GREEN) blocks:  A2–A9 (engine+container),  D3+ (in-container VS Code)
  NOT gated (contracts only): B (all),  C (all),  A1 (publish contract),
                              D1–D2 (config UI + read-only diff fallback)
```

- **Can start the instant contracts freeze (no spike wait):** all of **Lane B** (it owns the schema), all of **Lane C** (UI against B's types + A's control-API/`ws-ai:*` shapes), **A1** (publish the control-API contract), **D1–D2** (config UI + the read-only `FileDiffViewer` diff — no container).
- **Must wait for the spike GREEN:** **A2–A9** (the engine, PTY, containers, pty-agent, GitLab push — anything that runs a real `claude` or a container), and **D3+** (openvscode-server runs inside a container, so it needs A4's container runtime + the auth projection the spike proves).
- **The hard internal ordering inside a lane:** B must publish B2 (schema) before C1/C5 and D1 can compile against final types; A must publish A1 (control-API) before C3/C5 and D4–D6 can call ops; A4 (container runtime) must exist before A6 (stage-agent) and D3 (in-container VS Code).

### 6.2 The critical path

`spike (0.A)` → `B2 schema (unblocks everyone's types)` → `A1 control-API + A2 PTY + A3 Conductor` → `A4 container runtime` → `A6 stage-agent + D3 in-container VS Code` → `A8 push + D6 create-MR-URL` → integration. **B2 and A1 are the two earliest-needed unblocks**; ship them first inside their lanes. The spike gates the container half of the critical path — if it's RED, escalate before A2+ spends effort.

### 6.3 Realistic sequence (coarse)

1. **Serial:** spike → bootstrap → freeze contracts (B's schema, A's control-API, the socket event union).
2. **Wave 1 (parallel, no spike wait):** B (schema → sync-backend → tenant → bootstrap), C (data-seam rewire → realtime client → Assistant), A1 + D1/D2.
3. **Wave 2 (parallel, spike GREEN):** A2–A9 (engine → containers → pty-agent → push), D3–D7 (in-container VS Code → stage-lock → pause/resume → create-MR-URL).
4. **Integration checkpoints (§8)** stitch the lanes at each vertical slice.

---

## 7. The non-overlap protocol

The lanes never write each other's directories. Coordination is **through the frozen contracts**, and changes to a contract are **proposed, not edited**.

1. **Directory ownership is exclusive** (§2.1/§3.1/§4.1/§5.1). No two lanes share a directory. A file lives in exactly one lane's tree. (Mirrors root `CLAUDE.md` Rule 27 — surgical changes; a lane touches only its own tree.)
2. **Contracts are read-only to consumers.** B owns `schema.prisma` + `types.ts`; A owns the control-API catalogue + `VERB_REGISTRY`; A+C co-own the `ws-ai:*` event union. A consumer lane **imports** these; it never edits the file.
3. **Need a change to another lane's contract? PROPOSE — do NOT edit** (root `CLAUDE.md` Rule 9/27, [V1_SCOPE §7] B-23 spirit). The requesting lane writes a short proposal (the field/op/event it needs + why + the exact shape) and hands it to the owning lane; the **owning lane makes the edit** and re-publishes. Example: Lane D needs a `vscode-<ticketId>` Caddy route → D proposes the route shape, **A** adds it to the [07b §5] route mechanism. Lane C needs a `Ticket.lastActivityAt` sort field → C proposes, **B** adds it to the schema + `types.ts`. This is the same proposes/executes boundary as B-23 (the lane proposes; the contract-owner writes) — never a silent cross-lane edit.
4. **Contract changes are additive during V1.** Prefer adding a field/op/event over reshaping one another lane already builds against; a reshape requires a coordinated checkpoint (§8) so no lane builds on a stale shape.
5. **The frozen verb surface is untouchable.** No lane adds a structured-channel verb ([02 §2] is frozen; `VERB_REGISTRY` conformance-tests it). Every write is a control-API → Conductor action. A lane that thinks it needs a new verb has found a scope error — escalate to the user, do not add one.

---

## 8. Integration checkpoints

Lanes integrate at named slices, not in a big-bang at the end. Each checkpoint has an owner pair + a verifiable goal.

| Checkpoint | Lanes | Verifiable goal |
|---|---|---|
| **CP0 — contracts frozen** | A + B (+ C) | schema/types compile + seed; control-API + `VERB_REGISTRY` compile; `ws-ai:*`/`ws-term:*` event union published; all lanes import them |
| **CP1 — the control spine** | A + B + C | a `pause` flows control-API → RBAC → `WorkspaceSignal` → Conductor → `TicketEvent` (B's writer, monotonic `seq`) → `ws-ai:*` → the client merges by `seq`. (A's A1–A3 + B's B5 + C's C2.) **Only the Conductor writes** is proven end-to-end |
| **CP2 — a Claude PTY in a container** | A (+ B) | one `claude` PTY runs inside a hardened L1 container, auth via managed-token-projection, streams over `/pty` (XtermTerminal byte-identical), bills the subscription. (A4–A5; gated on the spike) |
| **CP3 — the changes/editor surface** | D + A + B | the changes page renders the live diff (B's `Ticket.files`); the per-stage edit-lock toggles read-only; openvscode-server runs in the container via A's Caddy route; pause → edit → resume-with-changes injects the diff. (D2–D5 + A4/A9) |
| **CP4 — a ticket walks a stage** | A + B + C + D | create a ticket → it enters a stage in a container → the agent edits → the changes page shows the diff → answer a NeedsInput card on the phone → promote → complete the last stage → push → the GitLab create-MR URL is clickable. The full V1 happy path |
| **CP5 — realtime + push hardening** | C + A + B | multi-user live sync across clients; redacted push → in-app full-body fetch → deep-link approve; `resumeAll()` survives an orchestrator kill mid-stage |

**At each checkpoint, the lint/build gate is mandatory** (root `CLAUDE.md` Rule 11): `npm run lint && npm run build` zero/zero on both client and server tsconfigs before the checkpoint is declared green.

---

## 9. The single most important thing to ship first

> **Lane B's schema (B2) and Lane A's control-API contract (A1) are the two unblocks the entire build waits on.** Freeze them in Phase 0.C and publish immediately — every other lane compiles against them. The **P0.5 spike (0.A) gates the container half** of the critical path; if it RED-ESCALATEs, stop before A2+ spends effort. With the spike GREEN and the two contracts frozen, A/B/C/D run genuinely in parallel in disjoint directories, integrating at CP1→CP5.

---

## 10. Self-check (V1 invariants this plan preserves)

- **No new verbs / no new scope** — this is a sequencing doc over the frozen 7+6 surface ([02 §2]) and the locked [V1_SCOPE] IN/OUT; it adds neither.
- **B-23 preserved** — every write in every lane is a control-API → Conductor action; the Assistant (instruction=consent) maps to a control-API request, never a write verb ([V1_SCOPE §3.3], [CONTROL_API §4]).
- **Single forge (GitLab), single provider (Claude PTY), single host, single-instance orchestrator** — Lane A implements only `GitLabForge` + the single-spawn wrapper; every multi-* surface is OUT ([V1_SCOPE §4]).
- **`runInTenant` on every orchestrator-side path** — a Lane-B-gated P1 prerequisite ([MIGRATION §7], [04b §11c]); every lane that runs a background worker verifies it.
- **The spike gates the build** — A2+ and D3+ wait on `SPIKE_RESULTS.md` GREEN; a billing/PTY/auth RED escalates, never routes to headless ([P0_CLI_SPIKE §0]).
- **Non-overlap is structural** — exclusive directory ownership + propose-don't-edit on contracts (§7); the same proposes/executes boundary as B-23.
- **V1_SCOPE wins on conflict** with any doc that over-describes beyond V1; the build-docs govern the *how* of each IN piece ([V1_SCOPE §5]).
- This doc **edits no existing file** — it is the new build-order master that **supersedes the structure of [05_BUILD_PLAN]** (cite BUILD_ORDER for the V1 lane plan; [05] remains the design-horizon record).
