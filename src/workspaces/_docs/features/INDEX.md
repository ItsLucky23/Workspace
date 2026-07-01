# Features — detailed feature layer (INDEX / spine)

> This folder is the **DETAILED feature layer** that sits on top of the locked architecture docs `../README.md` + `../01_ARCHITECTURE.md`…`../06_TOKEN_OPTIMIZATION.md` + the orchestrator-runtime companion `../07_ORCHESTRATOR.md`. The 01–06 docs are the **authoritative, locked architecture** (engine, roles, verbs, data model, build plan, token budget); 07 is the architecture-layer **orchestrator runtime mechanics** doc (launch/teardown, Caddy, webhook ingest, RAG delta-indexer) — cite it like 01–06 (e.g. `[07 §A]`). The 24 docs here zoom into one user-facing feature each and say exactly how it is built **on top of** that architecture — UI, flow, additive data, which existing verbs/triggers it reuses. Last updated: 2026-06-04.
>
> **Operator setup** — the non-code things a human must provide to actually run these features (accounts, infra, container image, per-CLI-integration credentials, env vars, build-phase-tagged) lives in [`../SETUP_AND_PREREQUISITES.md`](../SETUP_AND_PREREQUISITES.md).

---

## How to read this

1. Read `../README.md` + 01–06 first (the locked spine). This INDEX assumes you know the 3 roles (Assistant / Stage-Agent / Conductor), the verb surface (02 §2), the carry-over envelope (02 §4), and the data model (04). **Orchestrator runtime mechanics live in `../07_ORCHESTRATOR.md`** (architecture doc, not a feature) — its four sections (§A launch/teardown · §B Caddy proxy · §C GitLab-webhook ingest · §D RAG delta-indexer) are what feature docs cite as `[07 §A]`…`[07 §D]`; cite 07 the same way you cite 01–06.
2. Each feature doc here is self-contained (~2–4 dense pages) and uses one **identical section skeleton** (Scope → User flow → Data → Verbs/Events/Hooks → UI → Extends → Open questions). The exact skeleton + locked blocks every lane must copy verbatim are reproduced at the bottom of this file.
3. When a feature doc needs something from the architecture, it **cites up** by section (e.g. `[02 §5]`, `[03 §3.2]`) — it never restates or contradicts 01–06. If a doc seems to contradict the architecture, the architecture wins; flag it.

### Cohesion rules (non-negotiable)

- **Cite-up, never restate.** Reference 01–06 by section. Don't paraphrase the architecture; link to it.
- **New persistence goes in the delta table here, not into 04.** No feature doc may edit `../04_DATA_MODEL.md`. Every new field/model a doc introduces is declared on its own `**INDEX delta:** …` line (last line of its `## Data` section) and aggregated into the [delta table](#new-fields--models-delta-table) below. The cohesion pass is what finalizes the table from those lines.
- **ZERO new structured-channel verbs.** The verb surface (02 §2) is frozen and complete. Every "API" a feature needs is expressed with the existing verbs + `WorkspaceTrigger` (`when → then`) + the `run-command` allow-list. See the [no-new-verbs assertion](#no-new-verbs-assertion). If a doc thinks it needs a new verb, it's wrong — re-express it.
- **Reuse real names.** Use the exact type/field names from `../../_data/types.ts` and the real components in `../../_components/` and `../../_screens/`.

---

## Navigation — the 24 feature docs

| Doc | Scope (one paragraph) |
|---|---|
| **01_WORKSPACE_SETUP.md** | The workspace-create + project-link flow. Picks a **preset tier** (`Workspace.presetKey`, → 02), links a git repo (`Project.gitUrl`) and declares which files are **GENERATE** (orchestrator-produced docs/skills) vs **LINK** (read live from the repo) via `Project.linkedFiles[]`. Deep-duplicate (**D9**) when copying from an existing workspace: skills/sources/tools/env are cloned for full isolation. Pulls presets (02) + the build phase (03) in as it provisions. |
| **02_PIPELINE_PRESETS.md** | The 3/5/7 **preset tiers** (**D1**), capability-differentiated: `simple` = 3 stages (Refine→Code→Review, Sonnet/medium), `advanced` = 5 (+Plan,+Test), `professional` = 7 (Refinement, Planning, Coding, Reviewer1, Reviewer2, Test, Final — Opus/high + RAG + code-graph + dual review). A preset is a code fixture (`WorkspacePreset`) that instantiates editable `PipelineStageCfg[]`. Documents the **layered system-prompt resolution** (**D2**): `AgentRole.systemPromptTemplate` (base) → preset per-stage override → user per-stage edit, surfacing as `PipelineStageCfg.systemPrompt`. |
| **03_BUILD_PHASE.md** | The "build a workspace" experience after setup: how a chosen preset is realized into a live, editable pipeline; first-ticket walkthrough; the GENERATE-vs-LINK ingestion that produces the initial `InfoDoc` set. Extends 01 (setup hands off here) and 02 (consumes the preset). The Code-stage surface targets the full editor (**D7**), powered by the UI-Builder (**D3**, external). |
| **04_INTEGRATION_TOOLS.md** | Configuring workspace **Integration tools** + **Env vars** and selecting them per-stage with a `ro`/`rw` tier (`StageToolCfg`). **CLI-client-first** (firm): a whitelisted CLI client in the container is the default reach mechanism; MCP only where a CLI client can't (e.g. semantic RAG). Extends 03 §5 (integrations: goal-defined, mechanism-open). |
| **05_PER_SESSION_INFO.md** | Per-session/per-stage telemetry surfaced in the UI: token estimates, cost chips, and the **estimate model** (**D4**) — planning-agent self-estimate (cold-start) **blended** with rolling `SpendRecord` averages, shown as a range + per-model pricing; ticket cost chip = actual-so-far + projected-remaining. Adds `AgentSession.tokenEstimate` surfacing + per-stage `avgTokensPerTurn`. Feeds 02 (per-stage averages). |
| **06_VOICE_INPUT.md** | Voice → ticket / voice → answer. **Documented fully now, BUILD DEFERRED** (**D5**, late tier). Capture → transcript → existing text path (no new ingestion verb). The transcript rides existing surfaces (`TicketEvent.metadata.voiceTranscript?`, `UserPromptSubmit` hook). Falls back to the QuestionSet free-text answer path (→ 09) when used to answer. |
| **07_CODE_CHANGES_REVIEW.md** | Reviewing a stage's code output before promote: the diff/accept surface. Diff **baseline** (**D10**) supports BOTH, **defaults to whole-ticket** (parent/branch-base) with a toggle to per-stage delta; the snapshot is frozen at the stage `commitHash` (carry-over envelope). Shares the **UI-Builder editor** with 08; the existing `FileDiffViewer` is the **optional interim** only (**D3**). |
| **08_CODEBASE_VIEWER.md** | Browsing the ticket's working tree — the **full VSCode-like editor** target (**D7**), powered by the **UI-Builder** (**D3**, external, provided as an in-repo folder later). Defines the mount/props contract (`openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`). Shares the editor with 07; reads the snapshot/commit from 03. |
| **09_QUESTIONS_IN_TICKETS.md** | The phone-from-the-beach question/approval UI: rendering a `QuestionSet` as mobile cards (choice = one tap, approve = Approve/Reject, free = short text) inline in chat and on the board banner. Adds `ChatMessage.questionSetId` so a bubble renders a question card. Pure UI over 02 §5 (QuestionSet/Question already in 04) — `request_input` / `draft_questionset` verbs only. Voice (06) is a free-text fallback into here. |
| **10_AUTOMATIONS_SCREEN.md** | The two authoring surfaces for `WorkspaceTrigger` (03 §1): the **stage-scoped "Automation" sub-tab** inside the Pipeline editor and the **workspace-level Automation screen** (cron + workspace-lifecycle). One model, two editors. Pure UI + config over the existing trigger engine — `when → then` rules, `run-command` allow-list, cron strings. No engine change. |
| **11_WORKSPACE_AI_PANEL.md** | The per-user **Assistant** chat panel (the real `AIPanel` in `_shell/Shell.tsx`, replacing dummy `sendChat`): streaming replies, proposing-only, question-card rendering, Compact/Clear controls, suggestion surfacing. Pure UI over the Assistant role (01 §3.2) + Assistant verbs (02 §2) + `ws-ai:*` events (05 P1 contract). The chat home for 09 (question cards) and config-review proposals (03 §4). |
| **12_BOARD_AND_KANBAN.md** | The scrum board: kanban columns derived from the live pipeline, **AI-driven (no-drag) moves** ([02 §6]), status pills + WIP warnings, card context-menu + quickview, cost chip + terminal/preview badges, sprint picker, the **full filter popover** (D61), **quick-add + expand** (D62), and live merge-on-seq fan-out. Owns `BoardFilter` (ui-only) + the `QuickAddSheet`. Mobile = read-only stage-segments (D63). |
| **13_BACKLOG_AND_SPRINTS.md** | The backlog list (search + quick-filter + person filter), collapsible sprint sections, select-mode + the **bulk action bar** (batched control-API run serially by the Conductor, B-30), column sort (`TicketSort`, ui-only), and the **sprint manager** (create/edit with date pickers, workspace-tz D55). Reuses 12's `BoardFilter` machinery. Mobile single-column select-mode (D63). |
| **14_TERMINALS.md** | The multi-terminal workspace: grid/tabs over every live PTY, per-process sub-tabs (`claude`/`server`/`client`), the **SSH-unlock** capability gate (B-05 nonce + `crypto.verify`), the `connecting→live→exited→locked` panel state, ring-buffer reattach, and the `term.`/pty-agent production bridge (B-31). Attaches to PTYs spawned in [07 §A]/[07 §B]; engine unchanged. |
| **15_SOURCES_MANAGEMENT.md** | The Sources screen: managing **context docs** (generated/git/uploaded `InfoDoc`) + **skills/MCP** (frozen-vs-live `SkillEntry`), the reindex banner + live progress wired to the **[07 §D]** RAG delta-indexer, upload-spec sheet, and read-only preview. Extends 03 (seeds the set) + 04 (CLI-client-first / MCP exception). Surfaces freezing, never restates it. |
| **16_MEMBERS_AND_RBAC.md** | The Members + Permissions + Invites + Danger-zone tabs of `WorkspaceSettings.tsx`: the editable RBAC matrix (`PermRole` × `RBAC_CAPABILITIES`, B-28), email invites (B-06), role-change/transfer/delete confirms. Enforcement lives in the `preApiExecute` membership check (DATAMODEL §1) — every lever is a control-API request, not a verb. |
| **17_ACCOUNT_AND_AUTH.md** | The user's `AccountSettings.tsx` **plus** the auth flows (merged per **D70**): OAuth login (identity, B-05), the **SSH-key terminal-capability gate** (`/pty` nonce + `crypto.verify`, runs against [07 §A]), accept-invite (B-06), sessions, web-push opt-in (B-34), data export (B-39). The user/account side; 16 is the workspace side. |
| **18_NOTIFICATIONS.md** | The cross-surface alert layer: the `TopBar` bell + unread badge, a grouped notification center (desktop dropdown / mobile sheet), and PWA web-push (B-34). A read-projection of the `Notification` model (DATAMODEL §9) — four types (`needs-input`/`merge`/`ai-suggestion`/`container-failure`) sourced from existing verbs/hooks + the [07 §C]/[07 §A] events; deep-links via D65. |
| **19_USAGE_AND_BUDGET.md** | The `Usage.tsx` screen extended with the **budget** surfaces (B-35): a spent/cap bar + alert threshold, budget settings (cap/alert-%/auto-pause), a cap-reached modal (raise-cap + resume, reused from 05), the per-ticket cost chip, and the workspace-wide **Pause all agents** (Admin+, D69). Surfaces `WorkspaceBudget`/`SpendRecord` (DATAMODEL §8). |
| **20_ACTIVITY_AND_EVENT_LOG.md** | The workspace-wide + per-ticket **append-only event feed** over `TicketEvent` (DATAMODEL §6): actor/type chips, deep-links (D65), LIVE badge + reconnect catch-up (B-22 subscribe-first → snapshot → merge-on-`seq`), click-to-expand diffs, and a **rewind scrubber** (D64: event-replay over carry-over `commitHash` snapshots, no new storage). Sourced from [02 §3] hooks; client never writes. |
| **21_SEARCH_AND_COMMAND_PALETTE.md** | **One** global search over **tickets AND Sources/docs** wiring the dead `TopBar` search bar + the ⌘K palette into the same UI (D66): fuzzy id/title/name v1, quick-actions, recent, quick-create (→ 12's quick-add). Semantic ranking is **documented now, build-deferred** (reuses the [07 §D] frozen-per-commit `$vectorSearch` slice via `query_context`). Navigation = D65 deep-link. |
| **22_GITLAB_BOARD_SYNC.md** | The board as a **projection of GitLab** (B-29): tickets ⇄ issues, bidirectional, **GitLab wins on conflict**, a reconcile-cron that heals missed webhooks, and the GitLab settings tab (base URL + encrypted token B-07 + Verify + sync-health). The webhook ingest + serial reconcile **engine is [07 §C]** — cited, not restated. The Conductor is the only projection writer ([01 §3.3]). |
| **23_PREVIEW_DEPLOYMENT.md** | The per-ticket live-app preview: an **"Open preview"** badge (**building / live / down**) served from a PROD container on `dev-<ticketId>.<domain>` ([07 §B], PROD single-port B-13). On-demand + non-blocking, **30-min TTL reset-on-open** + auto-teardown (D67); optional auto-per-stage trigger. Introduces the **`PreviewDeployment`** entity (D68). Reuses [07 §A] launch/teardown. |
| **24_PAUSE_AND_KILL_CONTROLS.md** | The lifecycle levers over running agents: **per-ticket pause/resume** (session parked, container kept for `--resume`), **kill** (teardown, branch + events retained, [07 §A]), workspace **pause-all**, and the runaway → `stuck` → `needs-input` auto-escalation (B-35). Every lever is a control-API request the Conductor executes — never a verb ([02 §1]). RBAC per D69 (kill + pause-all = Admin+). |

---

## NEW FIELDS / MODELS DELTA TABLE

> **The single place new persistence is aggregated.** No feature doc edits `../04_DATA_MODEL.md`; each declares its additions on its `**INDEX delta:**` line and they roll up here. **Finalized by the cohesion pass** — built by reading every doc's `**INDEX delta:**` line, deduping shared fields, and resolving naming collisions (canonical name picked + noted). All fields are *additive* to the existing prototype types / Prisma models; entities already in 04 (`Handoff`, `QuestionSet`/`Question`, `WorkspaceTrigger`, `CarryOver`, `AgentSession`) are NOT re-introduced here — only deltas on top of them.
>
> **Net-new persisted fields/models: 14** — the batch-1 ten (`Workspace.presetKey`, `WorkspacePreset`, `Project.gitUrl`, `Project.linkedFiles[]`, `Project.generatedDocsPath`, `PipelineStageCfg.systemPrompt`, `AgentSession.durationEstimate`, `PipelineStage.avgTokensPerTurn`, `TicketEvent.metadata.voiceTranscript?`, `ChatMessage.questionSetId`) **+ `PreviewDeployment`** (owner 23) **+ the final-sweep three** (`WorkspaceBudget.enforcement` + `WorkspaceBudget.periodWindow` owner 19 / D81–D82; `Workspace.previewConcurrencyCap` owner 23 / D86) — plus **7 ui-only types** (`DiffBaseline`, `EditorMode`, `CodeRange`, `CodebaseEditorHandle`, `CodebaseEditorProps` from batch-1; **`BoardFilter`** owner 12, **`TicketSort`** owner 13 from batch-2) = **21 delta rows** total, **+ 1 already-in-04 surfaced field** (`AgentSession.tokenEstimate`). Docs 04, 10, 11, 14, 16, 17, 18, 20, 21, 22, 24 introduce **no** new persistence (verified — their `INDEX delta:` lines are `(none)`).
>
> **⚠ POST-REVIEW (2026-06-04): this headline is pre-sweep.** The deep review's data-model fixes (`../04b_DATA_MODEL_ADDENDA.md`) add a Resolved-decision **field sweep** + `WorkspaceRole` + the multi-cap `WorkspaceBudget` reshape + the §6–§11 model bodies docs 16–24 cite. **`04b §16` is the authoritative recomputed total** (~1 net-new model + ~19 net-new fields above this 14). Treat `04b` as the schema source of truth; this row is historical until folded.
>
> **Most batch-2 (12–24) entities ALREADY exist** in `../../_data/types.ts` / DATAMODEL and are *surfaced, not introduced* — do not re-add: `Member` / `PermRole` / `Role` / `InviteEntry` (16/17), `SshKeyEntry` / `SessionEntry` / `PushSubscription` / `OAuthAccount` (17), `NotificationItem` / `Notification` (18), `UsageRow` / `WorkspaceBudget` / `SpendRecord` (19), `TicketEvent` / `ActivityEvent` / `TicketFile` (20), `Sprint` (13, edited not added), `Terminal` / `TerminalProcess` / `TerminalLine` (14), `InfoDoc` / `SkillEntry` (15), the GitLab linkage on `Project` / `Ticket` (22). The genuinely-new batch-2 rows are: `PreviewDeployment`, `BoardFilter`, `TicketSort` (batch-2 docs) **+ the final-sweep three** persisted fields (`WorkspaceBudget.enforcement`, `WorkspaceBudget.periodWindow`, `Workspace.previewConcurrencyCap`) — all below.

| New field / model | Type | On / extends | Owning doc | Notes |
|---|---|---|---|---|
| `Workspace.presetKey` | `'simple' \| 'advanced' \| 'professional'` | `Workspace` | **02** (01 sets it) | which preset tier instantiated this workspace's pipeline. **Dedupe:** declared by both 01 & 02 — canonical owner **02** (defines the enum + semantics); 01 sets it in setup step 4. One field. |
| `WorkspacePreset` | code fixture (registry, not a DB row) | new | 02 | per-tier stage list + per-stage model/effort/skills/prompt fixtures; instantiates `PipelineStageCfg[]` on create (D1/D2) |
| `Project.gitUrl` | `string` | `Project` | **01** (03 consumes) | the linked git repo (alongside existing `gitlabPath`). **Dedupe:** declared by both 01 & 03 — canonical owner **01** (setup creates the `Project`); 03 consumes it for clone/seed. One field. |
| `Project.linkedFiles[]` | `{ path: string; role: 'generate' \| 'link' }[]` | `Project` | **01** (03 consumes) | GENERATE = orchestrator-produced; LINK = read live from repo. **Dedupe:** 01 wrote `Project.linkedFiles`, 03 wrote `Project.linkedFiles[]{path,role}` — same field; canonical name **`Project.linkedFiles[]`**. One field. |
| `Project.generatedDocsPath` | `string` (default `'docs/luckystack/'`) | `Project` | 03 | where GENERATE'd docs are committed (03.q3) |
| `PipelineStageCfg.systemPrompt` | `string` | `PipelineStageCfg` | 02 | resolved per-stage prompt (D2 layering). Note: `customInstructions` + `promptTemplate` **already exist** on `PipelineStageCfg` — `systemPrompt` is the layered-base distinct from those |
| `AgentSession.durationEstimate` | `Int?` (seconds) | `AgentSession` | 05 | cold-start self-estimate parsed by the Conductor from the planning agent's carry-over `summary`; sibling of `tokenEstimate`; `>= 0`, nullable until a planning stage runs (D4) |
| `PipelineStage.avgTokensPerTurn` | `Int?` (prototype: on `PipelineStageCfg`) | `PipelineStage` / `PipelineStageCfg` | 05 | rolling per-stage average feeding the D4 estimate blend. **Collision resolved:** the original seed row named this `AgentSession.avgTokensPerTurn (per-stage)`; doc 05 (owner) is authoritative — it is a **per-stage** average, canonical **`PipelineStage.avgTokensPerTurn`** (added to `PipelineStageCfg` in the prototype), NOT on `AgentSession`. |
| `ChatMessage.questionSetId` | `string?` | `ChatMessage` | 09 | already noted in 02 §5 / 04 — lets a chat bubble render a `QuestionSet` card inline. Surfaced by 11, owned by 09. |
| `TicketEvent.metadata.voiceTranscript?` | `string?` (within `TicketEvent.metadata` JSON) | `TicketEvent` | 06 | optional transcript on the `UserPromptSubmit`-sourced event; audio blob not persisted; build deferred (D5) |
| `DiffBaseline` | `'whole-ticket' \| 'stage-delta'` | new (ui-only) | 07 | per-view diff-baseline toggle; defaults `'whole-ticket'` (D10); not persisted |
| `EditorMode` | `'read-only' \| 'edit'` | new (ui-only) | 08 | UI-Builder mount prop; defaults `'read-only'`; not persisted |
| `CodeRange` | `{ startLine; startCol?; endLine?; endCol? }` | new (ui-only) | 08 | reveal-range arg for the editor contract; not persisted |
| `CodebaseEditorHandle` | imperative handle (`openFile`/`revealRange`/`setChangedFiles`/`setBaselineCommit`) | new (ui-only) | 08 | host→editor contract captured via `onReady`; shared with 07; not persisted |
| `CodebaseEditorProps` | mount props (see 08 §Data) | new (ui-only) | 08 | UI-Builder mount props; not persisted |
| `PreviewDeployment` | `{ ticketId, url, status:'building'\|'live'\|'down', startedAt, port, ttlExpiresAt }` | new (server/ui) | **23** | the per-ticket live-preview projection (D68). One active row per `ticketId`; the container/route lifecycle is [07 §A]/[07 §B], this row is what the badge renders. `ttlExpiresAt` = `startedAt + 30m`, bumped on every open (D67). The **only** batch-2 net-new persisted entity. |
| `BoardFilter` | `{ labels[], assigneeId, statuses[], sprintId, hasRunningTerminal, needsInput }` | new (ui-only) | **12** | session-only board/backlog filter state for the D61 full filter popover; pure client predicate over `TICKETS`. Reused (not re-declared) by 13's search/person/quick-filter. Not persisted. |
| `TicketSort` | `{ key:'id'\|'updated'\|'status'\|'stage', dir:'asc'\|'desc' }` | new (ui-only) | **13** | session-only column-sort state for the backlog list; defaults `{ key:'updated', dir:'desc' }`; pure client comparator within each sprint group. Not persisted. |
| `WorkspaceBudget.enforcement` | `'pauseNew' \| 'pauseAll'` | `WorkspaceBudget` (now multi-row) | **19** | per-cap auto-pause mode (D81): `pauseNew` blocks new sessions / lets in-flight finish; `pauseAll` pauses all active sessions to `stopped` immediately. A workspace may hold several `WorkspaceBudget` caps. Persisted. |
| `WorkspaceBudget.periodWindow` | `'calendar-month' \| { rolling: '5h' \| '30d' \| … }` (default `'calendar-month'`, workspace tz) | `WorkspaceBudget` | **19** | per-cap reset window (D82); default calendar-month in the workspace tz (D55); can express provider-native windows (e.g. Claude 5h). Persisted. See "Parked for later" (multi-provider). |
| `Workspace.previewConcurrencyCap` | `Int` (safe default; hard-capped ~20) | `Workspace` | **23** | max concurrent preview PROD containers before "Open preview" queues (D86); backs the queue chip + live-preview manager. Persisted. |

**Already in 04 — surfaced, not introduced** (counted separately so it isn't double-counted as net-new): `AgentSession.tokenEstimate` `Int @default(0)` — defined in 04 §2; doc 05 *surfaces* it as the chip's `actual-so-far` source.

Already in 04 (do **not** re-add — listed only to prevent double-counting): `Handoff`, `QuestionSet` + `Question`, `WorkspaceTrigger` (+ `TriggerEventKind`/`TriggerActionKind`), `CarryOver`, `AgentSession` core fields (incl. `tokenEstimate`), `PipelineStageCfg.roleKey`, `StageModelCfg.contextBudgetTokens`, per-workspace AI-budget fields (`SpendRecord`, `WorkspaceBudget`).

---

## NO-NEW-VERBS assertion

The structured-channel verb surface (02 §2) is **frozen and complete**. The full surface, repeated so no lane reinvents it:

- **Stage-Agent (worker) verbs:** `report_status`, `emit_event`, `request_input`, `emit_carryover`, `emit_signal`, `emit_handoff`, `query_context`.
- **Assistant verbs:** `get_ticket`, `list_tickets`, `read_pipeline`, `propose_suggestion`, `draft_questionset`, `refresh_docs`.

**No feature in this folder adds a verb.** Every feature "API" is one of:
1. an **existing verb** above, or
2. a **`WorkspaceTrigger`** (`when (event) → then (action)`, 03 §1) + the **`run-command` allow-list** (`OrchestratorCommandRegistry`, never raw shell), or
3. an **`AgentRole`** registration / per-stage `PipelineStageCfg` config (03 §3).

No LLM has a write verb (B-23 enforced structurally: AI proposes → user accepts → Conductor executes). If a doc's `## Verbs / Events / Hooks` section can't be written from this list, the feature is mis-modeled — re-express it, do not add a verb.

---

## Dependency graph

```
01_WORKSPACE_SETUP ──pulls in──▶ 02_PIPELINE_PRESETS
01_WORKSPACE_SETUP ──pulls in──▶ 03_BUILD_PHASE
        (setup picks a preset + kicks off the build phase)

07_CODE_CHANGES_REVIEW ◀──shared UI-Builder editor──▶ 08_CODEBASE_VIEWER
08_CODEBASE_VIEWER ──reads snapshot/commit──▶ 03_BUILD_PHASE
        (diff/editor baseline frozen at the stage commitHash)

05_PER_SESSION_INFO ──per-stage avgTokensPerTurn──▶ 02_PIPELINE_PRESETS
        (rolling averages feed preset/estimate tuning)

06_VOICE_INPUT ──free-text fallback──▶ 09_QUESTIONS_IN_TICKETS
        (voice answer → QuestionSet free-text path)

09_QUESTIONS_IN_TICKETS ◀──question cards rendered in──── 11_WORKSPACE_AI_PANEL
04_INTEGRATION_TOOLS ──per-stage tool select──▶ 03_BUILD_PHASE

── batch-2 (12–24) ──────────────────────────────────────────────────
12_BOARD_AND_KANBAN ◀──shared filter / row + card chrome──▶ 13_BACKLOG_AND_SPRINTS
        (BoardFilter owned by 12, reused by 13; 21's ⌘K opens 12's quick-add)

14_TERMINALS ─────────attaches PTYs spawned by───────▶ 07 §A/§B
15_SOURCES_MANAGEMENT ─reindex job──▶ 07 §D ─seeds/links docs──▶ 03 ─CLI-client/MCP rule──▶ 04
18_NOTIFICATIONS ─merge/container events─▶ 07 §C/§A    ─ai-suggestion deep-links into─▶ 11
20_ACTIVITY_AND_EVENT_LOG ──the append-only event feed (rewind over carry-over commitHash, D64); source = 02 §3 hooks
21_SEARCH_AND_COMMAND_PALETTE ─searches Sources──▶ 15   ─deferred semantic slice──▶ 07 §D
22_GITLAB_BOARD_SYNC ──surface of the ingest engine──▶ 07 §C   ──projects onto the board──▶ 12
23_PREVIEW_DEPLOYMENT ──launch/teardown + Caddy──▶ 07 §A/§B   ──builds from the worktree──▶ 03
24_PAUSE_AND_KILL_CONTROLS ──kill reuses teardown──▶ 07 §A   ◀──TicketControlBar proposes the same levers── 11
```

---

## Glossary (feature-level terms)

- **Preset tier** — one of the three capability-differentiated pipeline templates (`simple`/`advanced`/`professional`, D1), instantiated as a `WorkspacePreset` code fixture into editable `PipelineStageCfg[]`. Recorded as `Workspace.presetKey`.
- **Build phase** — the post-setup experience that realizes a chosen preset into a live, editable pipeline + ingests the initial docs/sources (03).
- **GENERATE vs LINK** — the two roles a `Project.linkedFiles[]` entry can take: **GENERATE** = the orchestrator produces/owns the file (e.g. `AI_*` docs, skills); **LINK** = the file is read live from the linked repo. (D9 copy-from-workspace deep-duplicates both kinds.)
- **UI-Builder** — the **external** VSCode-like editor component (D3, D7), NOT in the repo yet; the user adds it as an in-repo folder when this feature is built. Hard dependency, provided later. Mount/props contract: `openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`. The existing `FileDiffViewer` is an optional interim.
- **Changed-files mode** — the diff **baseline** toggle (D10): **whole-ticket** (parent/branch-base, default) vs **per-stage delta**; snapshot frozen at the stage `commitHash`.
- **Estimate range** — the cost projection (D4): planning-agent self-estimate (cold-start) blended with rolling `SpendRecord` averages, shown as a **range** + per-model pricing; the ticket cost chip = actual-so-far + projected-remaining.

---

## Resolved decisions (this session — baked in, do not re-open)

- **D1** — Presets 3/5/7, capability-differentiated: `simple`=3 (Refine→Code→Review), `advanced`=5 (+Plan,+Test), `professional`=7 (Refinement, Planning, Coding, Reviewer1, Reviewer2, Test, Final). Tiers differ by stage list AND per-stage model/effort/skills (simple=Sonnet/med; professional=Opus/high + RAG + code-graph + dual review).
- **D2** — Default system prompts **layered**: `AgentRole.systemPromptTemplate` (base) → preset per-stage override (code fixtures) → user per-stage edit; instantiated as editable per-stage config on workspace-create. Document the resolution order.
- **D3** — UI-Builder is **EXTERNAL, not in the repo yet**; the user adds it as an in-repo folder when this feature is built (hard dependency, provided later). Mount/props contract: `openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`. The existing `FileDiffViewer` is an optional interim only.
- **D4** — Estimates = BOTH: planning-agent self-estimate (cold-start) blended with rolling `SpendRecord` averages; show a range + per-model pricing; ticket cost chip = actual-so-far + projected-remaining.
- **D5** — Voice: documented fully now, **BUILD DEFERRED** (late tier).
- **D6** — Multi-instance / DR: **DEFERRED** to 05 P4 (hardening) — INDEX one-paragraph pointer only, no feature doc.
- **D7** — Code surface: the **full VSCode-like editor** is the target (not a read-only interim), powered by the UI-Builder.
- **D8** — Many small docs (this 11-doc split).
- **D9** — Copy-from-workspace = **deep-duplicate** skills/sources/tools/env (full isolation).
- **D10** — Diff baseline: support BOTH, **default whole-ticket** (parent/branch-base), toggle to per-stage delta; snapshot frozen at the stage `commitHash`.
- *(Integrations)* — CLI-client-first (firm): whitelisted CLI client in the container by default; MCP only where a CLI client can't (e.g. semantic RAG).

---

## Resolved decisions — feature-doc open questions (this session — baked in, do not re-open)

> Every feature doc's `## Open questions` is now resolved and folded here as `D11+`, grouped by owning doc; the original numbering is preserved as `NN.q`. ⚑ marks the four answers that **deviate from the earlier default/proposed** assumption.

**01 — Workspace setup**
- ⚑ **D11 (01.q1)** Slug uniqueness = **per-owner** (two users can each have `my-app`); not global.
- ⚑ **D12 (01.q2)** **One project per workspace** (no project switcher; the seed's 2nd project is legacy); the wizard stays single-project.
- **D13 (01.q3)** Copy-from-workspace = **fresh GitLab connect** (own per-workspace token, B-07); never reuse the source's token.
- **D14 (01.q4)** First-index unlocks when the GENERATE'd project-summary is done; RAG/code-graph keep indexing — show a visible "still indexing in the background" indicator with per-source progress chips (done/indexing) after unlock.

**02 — Pipeline presets**
- **D15 (02.q1)** `WorkspacePreset` fixtures live in a dedicated `_data/presets.ts` (keep `STAGE_CONFIGS` as one preset).
- **D16 (02.q2)** Dual-review (professional) = **serial full carry-over envelopes** (Reviewer1 → injected into Reviewer2).
- **D17 (02.q3)** Keep `systemPrompt` AND `customInstructions` distinct (`systemPrompt` = appended session system prompt / `--append-system-prompt`; `customInstructions` = stage `CLAUDE.md`); do not collapse.
- **D18 (02.q4)** Tiers fully editable post-instantiation; `Workspace.presetKey` is provenance-only.

**03 — Build phase**
- **D19 (03.q1)** GENERATE/LINK split: the Assistant **proposes** it, the user confirms (with sensible fallback defaults).
- **D20 (03.q2)** Re-snapshot on push = an opt-in `stage.on_complete → ai:refresh-docs` `WorkspaceTrigger` (recommended automation; no silent auto-regen by default elsewhere).
- ⚑ **D21 (03.q3)** GENERATE'd docs are **committed into the repo at `docs/luckystack/`** → the build phase needs git **write/commit** (not read-only); the security note reflects build-phase git is write-capable. New field `Project.generatedDocsPath` (default `'docs/luckystack/'`).
- **D22 (03.q4)** Large-repo: ignore junk (`.gitignore`-aware; skip `node_modules`/build/dist/`.git`) + lazy-load tree children.

**04 — Integration tools**
- **D23 (04.q1)** Per-`IntegrationTool.type` allow-pattern map for known types; custom types declare their own `command` + allow pattern. Any wrapper = an allow-listed `run-command`, never a new verb.
- **D24 (04.q2)** Base image bakes common clients (`psql`, `mysql`, `mongosh`, `redis-cli`, `curl`, `git`, `gh`); project-specific clients via per-project `Dockerfile ADD`.
- **D25 (04.q3)** `ro`/`rw` enforced via separate per-tier DB credentials (read-only user + read-write user; tier picks the credential at spawn, B-O8).
- **D26 (04.q4)** Escalate after 3 consecutive failures on the same tool → `needs-input` + notification (configurable); non-blocking signals before that.

**05 — Per-session info**
- **D27 (05.q1)** Estimate emitted as a fenced JSON block inside the planning agent's `emit_carryover` summary (Conductor parses; no envelope/verb change).
- **D28 (05.q2)** Blend = `α·self + (1−α)·rollingAvg`, `α=1` at 0 samples decaying to ~`0.3` by ~10 samples.
- **D29 (05.q3)** Confidence low/med/high by sample count, keyed per (preset, stage, model).
- **D30 (05.q4)** Raise-cap-and-resume = inline editor + a quick `+50%` button; gated on the pipeline/config RBAC capability (not any member).
- **D31 (05.q5)** Per-model pricing = an editable workspace setting with sensible defaults; zero it out to show tokens-only.

**06 — Voice input** *(build deferred, D5)*
- **D32 (06.q1)** Max clip length = 2:00 (single global cap).
- **D33 (06.q2)** Audio deleted immediately after transcription; kept briefly ONLY on STT failure (for re-transcribe).
- **D34 (06.q3)** whisper.cpp = one shared orchestrator-side instance (not per-ticket container).
- **D35 (06.q4)** Transcript used raw as the ticket description in v1 (no Assistant-normalize).
- **D36 (06.q5)** Language = a per-workspace setting reserved; auto-detect off in the first build.

**07 — Code-changes review**
- **D37 (07.q1)** Per-stage-delta baseline = commit-range diff `prevStage.commitHash..thisStage.commitHash`.
- **D38 (07.q2)** v1 accepts the whole stage output at the gate (no per-file/per-hunk staging).
- ⚑ **D39 (07.q3)** Reject payload = free-text note. **Reject re-opens the stage** — the note becomes the `--resume` prompt for the same agent, stage → `busy` (NOT "hold at done"); consistent with 09.q2.
- **D40 (07.q4)** Stepper walks the currently-visible diff's file set (follows the baseline toggle).
- **D41 (07.q5)** Interim `FileDiffViewer` stays minimal + read-only (no backporting the tree/stepper before UI-Builder).

**08 — Codebase viewer**
- **D42 (08.q1)** UI-Builder folder lives co-located at `src/workspaces/_uibuilder/` (mount strategy A: local import; stripped with `src/workspaces` later).
- **D43 (08.q2)** `artifactKind` key = `'code'` (shared by 07 + 08).
- **D44 (08.q3)** Edit mode unlocks ONLY on a live worker container + "work on tickets" RBAC; otherwise read-only. No editing frozen snapshots via scratch worktree in v1.
- **D45 (08.q4)** Theme: UI-Builder consumes the `@theme` tokens directly; a theme map via `CodebaseEditorProps` is the fallback.
- **D46 (08.q5)** Large-repo tree virtualization is UI-Builder's responsibility; the host streams tree/contents via `query_context`, no host pagination.

**09 — Questions in tickets**
- **D47 (09.q1)** Submit all answers at once (Submit enabled once all answered).
- ⚑ **D48 (09.q2)** Reject on an `approve` gate **re-opens the stage** — the agent resumes (`--resume`) with the reject note, stage → `busy` (overrides the earlier "hold at done"; consistent with 07.q3).
- **D49 (09.q3)** Answers immutable after submit; a follow-up creates a new `QuestionSet`.
- **D50 (09.q4)** One `ws-ai:needs-input` push; both the chat card and the board banner subscribe (no double-resolve).
- **D51 (09.q5)** ~6 choices visible before a scroll/"More" affordance on mobile.

**10 — Automations screen**
- **D52 (10.q1)** `'next'` target hidden for non-stage events; resolved at fire-time for `stage.*` events.
- **D53 (10.q2)** `dedupeKey`/`debounceMs` live in an "Advanced" section, server-defaulted.
- **D54 (10.q3)** Recent-fires shows the last 5 inline with a link to the full event-log.
- **D55 (10.q4)** Cron anchored to a workspace timezone (stored on `Workspace`; defaults to the host tz on create).

**11 — Workspace-AI panel**
- **D56 (11.q1)** Signal stream virtualized + low-priority `observation` types collapsed by default; scoped to the user's visible tickets.
- **D57 (11.q2)** `stop` requires a `menuHandler.confirm`; pause/resume/promote act directly (still propose → Conductor executes).
- **D58 (11.q3)** Telemetry for a non-admin Member = their own Assistant + worker sessions on tickets they can see (RBAC read scope).
- **D59 (11.q4)** Compact = AUTO at budget + a manual "Optimize now" button; show an "optimizing context…" state during the round-trip (both paths).
- **D60 (11.q5)** Control buttons show "requested…" then time out ~10s if the Conductor never confirms (e.g. workspace `stopped` on a rate-limit).

All feature-doc open questions are now resolved.

---

## Resolved decisions — batch-2 feature docs (12–24) (this session — baked in, do not re-open)

> The batch-2 decision set, grouped by owning doc, `NN.q` numbering preserved where it maps to a doc's open question. ⚑ marks the three answers that are **spec'd-extras** (beyond the minimal doc scope — added deliberately): **D62** quick-add + expand, **D66** global-search-over-tickets-AND-docs, **D67** preview TTL reset-on-open + auto-teardown. These cross-cut several docs (12–24); each owning doc cites the `D##` rather than restating it.

**12 — Board & Kanban**
- **D61 (12.q-filter)** Board filter = a **FULL popover**: labels + assignee + status + sprint + has-running-terminal + needs-input. UI-only, session-only `BoardFilter`; reused by 13. (Not a thin search box.)
- ⚑ **D62 (12.q-add)** Quick-add = a **title-first sheet with an in-UI "+ more options" expander** revealing description + labels + assignee + sprint in the same sheet (not a separate full form). Submit is a **proposal** the Conductor materialises (B-23). Owned by 12 (`QuickAddSheet`); reused by 21's ⌘K "New ticket".

**12 / 13 — Board + Backlog (mobile)**
- **D63 (12.q-mobile / 13.q-mobile)** Mobile board = **read-only stage-segments + tap-to-open** (no drag, no hover menu); mobile backlog = **single-column select-mode** with a bottom-docked bulk bar. Filters/quick-add open as bottom sheets.

**13 — Backlog & Sprints**
- **D-bulk (13, = B-30)** Bulk ops (Move / Status / Assign / Sprint / Archive) = a **single batched control-API request the Conductor runs serially** (B-30) — no optimistic client mutation; the bar shows "requested…" and reflects the merge-on-seq result. `TicketSort` is ui-only/session-only. Sprint dates anchored to the workspace tz (D55).

**20 — Activity & event log**
- **D64 (20.q-rewind)** Rewind = **event-replay over the carry-over `commitHash` snapshots** (show the frozen file-set at each stage commit, replay the `TicketEvent`s between consecutive commits) — **NO new storage**, only a client cursor into the existing ordered log + `CarryOver` snapshots.

**18 / 20 / 21 — cross-cutting navigation**
- **D65 (deep-link)** In-app navigation is the existing **`navigate({ view, ticketId?, tab?, terminalId? })`** deep-link now (backs Notifications, Activity, ⌘K, search); the matching real URL routes (`/ws/:id/ticket/:tid?tab=…`) are documented as a **future extension** layered on the same call, not built v1.

**21 — Search & command palette**
- ⚑ **D66 (21.q-scope)** **ONE global search over tickets AND Sources/docs** (one input, two entry points: `TopBar` bar + ⌘K palette). v1 = **fuzzy** id/title/name client-side; **semantic ranking is documented but BUILD-DEFERRED**, reusing the [07 §D] frozen-per-commit `$vectorSearch` slice via `query_context` (no new verb, no new entry point). Keyboard = arrow + Enter.

**23 — Preview deployment**
- ⚑ **D67 (23.q-ttl)** Preview = **on-demand + non-blocking** (navigate away while it builds) with a **30-minute TTL that resets on every open** and **auto-teardown** on expiry/close ([07 §A]/[07 §B] PROD single-port, B-13). An *optional, off-by-default* `stage.on_complete → preview-up` `WorkspaceTrigger` pre-warms per stage.
- **D68 (23.q-entity)** Introduce the **`PreviewDeployment`** entity `{ ticketId, url, status:'building'\|'live'\|'down', startedAt, port, ttlExpiresAt }` — one active row per ticket; the container/route lifecycle stays in [07 §A]/[07 §B], this row is the UI projection.

**24 / 12 / 19 — Pause & kill RBAC**
- **D69 (24.q-rbac)** Lifecycle-lever RBAC: **ticket-scoped pause/resume = "work on tickets"** (Owner/Admin/Member); **kill + workspace pause-all = Admin+**. Reuses the B-28 tiers (**no matrix change**); every lever is a **control-API request the Conductor executes, never a structured-channel verb** ([02 §1]).

**17 — Account & Auth**
- **D70 (17.q-merge)** **Merge Account + Auth into one doc** (17): the user's `AccountSettings.tsx` screen plus the auth flows (OAuth login, the SSH `/pty` capability gate, accept-invite) live together; the *workspace* view of membership stays in 16.

**(scope) — the batch-2 split**
- **D71 (batch-2 scope)** Expand the detailed feature layer from 11 to **24 small docs** (12–24), mirroring **D8** (many small docs): board, backlog/sprints, terminals, sources, members/RBAC, account/auth, notifications, usage/budget, activity, search, GitLab sync, preview, pause/kill. Same skeleton + cite-up + no-new-verbs contract as 01–11; orchestrator runtime mechanics extracted into the architecture-layer `../07_ORCHESTRATOR.md` (cited like 01–06, not a feature doc).

The batch-2 **headline** decisions (D61–D71) are baked in. The **secondary** per-doc open questions that docs 14–24 still carried were resolved in the final sweep below (D72–D87).

---

## Resolved decisions — final micro-decisions sweep (D72–D87) (2026-06-04 — baked in, do not re-open)

> The last residual `## Open questions` from docs 14–24, resolved with the user. ⚑ marks answers that **deviate from the earlier proposed default** or **expand scope** beyond the minimal doc. Each owning doc's `## Open questions` section is now a `## Resolved` section citing these.

**14 — Terminals**
- **D72 (14.q1)** "Restart" re-runs **only the selected `StageProcess`'s command**; container-level reactivation stays the ticket-level lever in `TicketDetail`.
- **D73 (14.q2)** "Copy" copies the **full ring-buffer scrollback** (capped at ring-buffer length).

**15 — Sources**
- **D74 (15.q1)** Uploads accept **md/txt/plain text only in v1**; pdf/docx-with-extraction deferred.
- **D75 (15.q2)** Regenerate on a `generated` doc **fires immediately, no confirm** (reversible via git).

**16 — Members & RBAC**
- ⚑ **D76 (16.q1)** Custom `PermRole` is **fully configurable** — the matrix may grant *any* capability, **including** admin-management/ownership-transfer/delete rows. No rows hard-locked to built-ins. (Deviates from the proposed hard-lock.) The single-Owner invariant is held by D77, not by locking rows.
- **D77 (16.q2)** **Block self-demotion**: an Owner cannot remove/downgrade themselves without first transferring ownership; ownership only moves via transfer.

**17 — Account & Auth**
- ⚑ **D78 (17.q1)** SSH key add runs a **one-time proof-of-possession challenge at add-time** (sign a server nonce before the key is stored). (Deviates from the proposed trust-on-add.) The per-open `/pty` challenge still gates each session.
- **D79 (17.q2)** The user's OAuth provider is **identity-only**; the workspace token (B-07) does the board sync. No per-provider workspace gating.

**18 — Notifications**
- **D80 (18.q1)** Push payload is **redacted by default** (title + "open to view"); the full body is fetched in-app behind auth; full-body push is a per-user opt-in. (**REVISED 2026-06-04** via `REVIEW_AND_OPEN_QUESTIONS.md` Q-SEC-NOTIF-PUSH — reverses the earlier full-body default after the security review, rule 19.)

**19 — Usage & Budget**
- ⚑ **D81 (19.q2)** **Multiple budget caps**, each with an **enforcement mode**: `pauseNew` (block new sessions, let in-flight finish) **or** `pauseAll` (pause all active sessions immediately). (Expanded — `WorkspaceBudget` becomes multi-row with `enforcement`.)
- ⚑ **D82 (19.q3)** Budget reset period is a **per-cap configurable window** (`WorkspaceBudget.periodWindow`), default **calendar month in the workspace tz** (D55), able to express provider-native windows (e.g. Claude's 5-hour quota). (Expanded.) See "Parked for later" — the multi-provider AI abstraction.
- **(19.q1)** *Report-only, confirmed:* framing = advisory budget + auto-pause, hard limit = plan quota. The `Usage.tsx` "no monetary budget" comment is a **build-time code cleanup** (flag, do not auto-fix).

**20 — Activity & event log**
- **D83 (20.q1)** Workspace-feed catch-up = **bounded recent window + lazy-load older**; per-ticket `seq` dedupes within a ticket.

**21 — Search & command palette**
- **D84 (21.q1)** Keep v1 caps (tickets 8, docs 5) and group order Tickets → Sources → Actions **even in semantic mode**; semantic re-ranks within groups, never collapses them.

**22 — GitLab board sync**
- ⚑ **D85 (22.q1)** Pipeline **stage state is NOT synced outbound** — it stays **board-local**. (Deviates from the proposed `stage::*` label-encoding.) Outbound = GitLab-native only (issue open/close, ordinary labels).

**23 — Preview deployment**
- ⚑ **D86 (23.q1)** Concurrent-preview limit = a **workspace setting** (`Workspace.previewConcurrencyCap`) with a safe default, bounded by a **hard cap (~20)**. Over-cap requests **queue** (chip: "queued — N previews live") with explanatory copy; a **live-preview manager** lists live preview containers with a per-preview **stop** control. (Expanded.)

**24 — Pause & kill**
- **D87 (24.q1)** A paused ticket **keeps its container** for `--resume`, but it is **reclaimed after a generous, configurable idle window** with a **pre-reclaim notification**; post-reclaim resume needs full reactivation.

All feature-doc open questions (01–24) are now resolved and baked in.

---

## Parked for later (NOT v1 — explicitly deferred, revisit before the engine layer is built)

- **Multi-provider AI abstraction.** Today the engine targets **Claude CLI in a PTY** (the load-bearing billing decision). The user wants the engine to later abstract over **other AI backends** — e.g. Codex, or raw provider APIs (DeepSeek, etc.). Open design surface to revisit: (a) **billing/limit accounting** — syncing a subscription-style quota window vs. metered per-API-call cost (ties into D82's configurable `periodWindow`); (b) **per-provider capability registries** — models, effort levels, custom commands/skills, and feature flags (e.g. ingesting a new provider feature like Claude's ultracode/Workflow) declared per backend; (c) the **engine seam** that keeps "interactive PTY only" for Claude while allowing an API-transport backend for providers that bill per call. **Do not build in v1; surface this before P-engine work starts.** Tracked in memory: `project_workspace_multi_provider_ai`.

---

## Ops / DR pointer

**Multi-instance and disaster-recovery are NOT a feature doc** (D6). They live in `../05_BUILD_PLAN.md` **P4 (Hardening)**: resume-after-crash (`resumeAll()`), the multi-instance lease (`acquireLease('ws-engine:<wsId>')`), rate-limit → `stopped` + backoff, spend/budget accounting + auto-pause, and presence/catch-up polish. Treat anything operational/recovery-related as an extension of P4, cited up — do not spawn a feature doc for it.

---

# Drafting contract (copy verbatim into every feature doc)

> The drafting lanes MUST use the identical skeleton + locked blocks below. Reproduced here verbatim so all 24 docs share one contract.

## LOCKED ARCHITECTURE (authoritative — cite, never restate or contradict)

LOCKED ARCHITECTURE — authoritative in src/workspaces/_docs/ (README + 01-06). CITE it by section (e.g. "[03 §5]"); NEVER restate or contradict it:
- Engine: interactive Claude CLI in a node-pty PTY ONLY, on the Max subscription (NO headless claude -p, NO Agent SDK — they meter a separate pool from 2026-06-15).
- 3 roles: ASSISTANT (per active user per workspace; chat; read/propose only; suspended on disconnect) · STAGE-AGENT (worker; one per (ticket,stage); in a container for code roles) · CONDUCTOR (deterministic Node; ALL coordination + the ONLY writer of board/git/status). Plus an OPTIONAL FUTURE one-shot ephemeral reasoner (not standing). No LLM has write verbs (B-23 enforced structurally: AI proposes, user accepts, Conductor executes).
- Structured channel = a whitelisted CLI/HTTP helper (verbs) + Claude hooks (type:http). Worker verbs: report_status, emit_event, request_input, emit_carryover, emit_signal, emit_handoff, query_context. Assistant verbs: get_ticket, list_tickets, read_pipeline, propose_suggestion, draft_questionset, refresh_docs. *** NO NEW VERBS *** — every "API" a feature needs MUST be expressed with these existing verbs + WorkspaceTriggers + run-command allow-list. If you think you need a new verb, you're wrong — re-express it.
- Carry-over envelope = {summary, changedFiles, openQuestions, commitHash} (B-O2). Append-only WorkspaceSignal consumed serially by the Conductor (B-O6). Token-optimization = per-stage + per-AI context budget -> self-handoff (emit_handoff -> /clear -> reload), doc 06. Automation = WorkspaceTrigger (when->then) + cron + run-command (allow-listed), doc 03. Pluggable AgentRole (roleKey, needsWorkspace) + ArtifactViewer + OrchestratorCommand registries, doc 03. Containers only for code roles; cross-platform (Docker on Win/WSL2 + Linux); stack-agnostic (.NET/Go/any). Integrations = CLI-client-first.

## LOCKED DECISIONS (this session — bake in, do not re-open)

- D1 Presets 3/5/7, capability-differentiated. simple=3 (Refine->Code->Review); advanced=5 (+Plan,+Test); professional=7 (Refinement, Planning, Coding, Reviewer1, Reviewer2, Test, Final). Tiers differ by stage list AND per-stage model/effort/skills (simple=Sonnet/med; professional=Opus/high + RAG + code-graph + dual review).
- D2 Default system prompts LAYERED: AgentRole.systemPromptTemplate (base) -> preset per-stage override (code fixtures) -> user per-stage edit; instantiated as editable per-stage config on workspace-create. Document the resolution order.
- Integrations CLI-client-first (firm): whitelisted CLI client in the container by default; MCP only where a CLI client can't (e.g. semantic RAG).
- D4 Estimates = BOTH: planning-agent self-estimate (cold-start) blended with rolling SpendRecord averages; show a range + per-model pricing; ticket cost chip = actual-so-far + projected-remaining.
- D5 Voice: documented fully now, BUILD DEFERRED (late tier).
- D7 Code surface: the FULL VSCode-like editor is the target (not a read-only interim), powered by UI-Builder.
- D3 UI-Builder: EXTERNAL, NOT in the repo yet. The user will ADD IT AS AN IN-REPO FOLDER when this feature is built. Docs MUST state this plainly (hard dependency, provided later) and define the mount/props contract (openFile, revealRange, setChangedFiles, setBaselineCommit). The existing FileDiffViewer is an OPTIONAL INTERIM only.
- D9 Copy-from-workspace = DEEP-DUPLICATE skills/sources/tools/env (full isolation).
- D10 Diff baseline: support BOTH, DEFAULT whole-ticket (parent/branch-base), toggle to per-stage delta; snapshot frozen at the stage commitHash.
- D6 Multi-instance/DR: DEFERRED to 05 P4 (hardening) — INDEX one-paragraph pointer only, no feature doc.
- D8 Many small docs.

## SECTION SKELETON (exact — every feature doc uses this, markdown ##/### headers, dense and concrete)

1. `# NN — <Title>` + a one-line `>` blurb naming which 01-06 docs it extends.
2. `## Scope` — in / out / deferred (bullets).
3. `## User flow` — numbered steps; desktop + mobile notes; mockup hints (ASCII or prose).
4. `## Data` — additive fields/models with types + validation. END this section with a line: `**INDEX delta:** <comma-list of the exact new fields/models this doc introduces>` so the cohesion pass can aggregate them. DO NOT edit 04_DATA_MODEL.md.
5. `## Verbs / Events / Hooks` — ONLY existing verbs (list which) + WorkspaceTriggers/hooks used. State "No new verbs." explicitly.
6. `## UI` — new components vs reused (name real ones from _components/_screens where possible), mobile parity notes.
7. `## Extends` — bullet list quoting the specific 01-06 sections this builds on (e.g. "[02 §5] QuestionSet").
8. `## Open questions` — numbered (these roll up into the INDEX decisions list).

Keep ~2-4 dense pages. Friendly, precise, no fluff. Reuse exact type/field names from `src/workspaces/_data/types.ts`.
