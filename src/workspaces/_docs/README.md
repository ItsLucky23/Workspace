# Workspace-AI — architecture docs (AI handoff)

> **Purpose.** These docs let any AI (or a parallel agent team / ultracode workflow) pick up the **Workspace-AI** build cold. They turn the settled design into an actionable spec. Read this README first, then the numbered docs. Last updated: 2026-06-04.

---

## The one decision everything hangs on (read this first)

**As of 2026-06-15, headless `claude -p` and the Agent SDK draw from a *separate metered credit pool* — NOT the interactive Max subscription.** Only **interactive PTY** `claude` sessions stay on the subscription. The user's hard requirement is *everything runs on the Max subscription*. Therefore:

- **Every Claude session is an interactive `claude` in a node-pty PTY.** Never `claude -p`, never the Agent SDK.
- **Structured output is NOT scraped from the TUI.** It comes from (a) **Claude hooks** (`type:http`) for lifecycle events, and (b) an **agent-initiated structured channel** (a whitelisted CLI/HTTP helper the agent runs via the native Bash tool, or — optionally — an MCP server). Both work *inside* an interactive subscription session.

If you change nothing else from these docs, keep that. Everything downstream depends on it.

---

## What we are building

**Workspaces** is a self-hosted, AI-driven dev-orchestration app: the user writes simple tickets; a configurable **pipeline** of stages refines → plans → implements → tests → reviews them; the human is a **man-in-the-middle** who only approves and answers questions (ideally from a phone). The **Workspace-AI** is the brain that ties it together.

> **Repo context.** Right now this lives as a **UI-only prototype** in `src/workspaces/` (dummy data) inside the LuckyStack monorepo, because LuckyStack is about to publish to npm. The *real* Workspaces will be a fresh repo that installs `@luckystack/*`. These docs target that real build, but every contract is mirrored 1:1 by the prototype's `_data/types.ts` so migration is mechanical. The one already-real piece is the terminal (`server/hooks/workspacesTerminal.ts` + `_components/XtermTerminal.tsx`) — the proven node-pty↔socket pattern the engine extends.

---

## The model in one screen

**Three roles** — only one of which is an LLM-free, always-on process:

| Role | What it is | Count | Bills to | Writes board/git state? |
|---|---|---|---|---|
| **Assistant** | interactive `claude` PTY — the chat *one user* talks to (refine, answer, relay approvals) | **1 per active user, per workspace** (suspended when they disconnect) | subscription | **no** — read/propose only |
| **Stage-Agent** | interactive `claude` PTY doing the actual work for one ticket-stage | one per *(ticket, stage)*, in a container for code stages | subscription | only inside its own container (files, MRs) |
| **Conductor** | deterministic Node code in the orchestrator (no LLM) — **all coordination + the only writer** | 1, always-on | free | **yes — the only writer** |

> **No standing "Coordinator" / extra per-workspace CLI.** Coordination between agents is **deterministic** (agents emit JSON to the Conductor; see below) — it never needed an LLM. The *only* residual reason for a non-Assistant LLM is **proactive reasoning while no user is connected** (e.g. a scheduled "board-health briefing", or generating suggestions while you're away). That is a **future, optional, ephemeral one-shot reasoner** the Conductor spawns *only* for a cron/triggered task and then discards — not a persistent instance, and not needed for v1.

The **Conductor** owns all scrum/git/status mutations + coordination; the LLMs only **propose**; **Stage-Agents** do the work. This enforces the spec's autonomy rule **B-23** ("Workspace-AI proposes, the user accepts") *by construction*, and keeps the LLMs on the subscription. The **per-user Assistant** model removes chat contention between users and keeps each session's context lean. Tickets still progress while you're away: the **Stage-Agents** are the workers, the **Conductor** is the always-on plumbing.

```
              browser / phone (real-time, many clients per workspace)
                         │  ws-ai:* socket events (per-user chat)
        ┌────────────────▼─────────────────────────────────────┐
        │  Orchestrator (single-instance Node service)          │
        │   • Conductor  (deterministic: state, coordination,   │
        │                 the signal log, the only writer)      │
        │   • SessionManager (owns every PTY, watchdog, queue)  │
        │   • structured-channel endpoint + hook ingress        │
        │   • scheduler (leased tick) + trigger engine          │
        └─┬──────────────────────────────┬─────────────────────┘
          │ node-pty (per-user)           │ node-pty (in containers)
   ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────────┐ ┌────────────────┐
   │ Assistant   │ │ Assistant   │ │ Stage-Agent     │ │ Stage-Agent    │
   │ user A @ ws │ │ user B @ ws │ │ DEV-1240@impl   │ │ DEV-1249@plan  │
   └─────────────┘ └─────────────┘ └─────────────────┘ └────────────────┘
          ▲ read/propose                  ▲ emit verbs + hooks (JSON → Conductor)
          └───────────────────────────────┘
              structured channel (CLI/HTTP helper, or MCP)
   (optional, future: the Conductor may spawn a one-shot ephemeral reasoner
    for scheduled/proactive LLM tasks when no user is connected — not standing)
```

Ticket-agents **report via structured JSON into an append-only signal log** (not direct AI↔AI chat); the deterministic **Conductor** consumes it. Reasoning-heavy judgement (e.g. "should these be an epic?") is done by a **connected user's Assistant**, or deferred. See [02 §6](./02_PROTOCOL_AND_FLOW.md) and [01 §3](./01_ARCHITECTURE.md).

---

## Document map

### ▶ V1 setup — START HERE (the drag-and-drop build package, 2026-06-04)

> A fresh AI pointed at this folder should read **`BUILD_HANDOFF.md` first**, then `V1_SCOPE.md`, then `BUILD_ORDER.md`. **Precedence:** `V1_SCOPE` wins on *what* ships; the build-docs win on *how* each piece works; `00_SPEC_RECONCILIATION.md` resolves any handoff/-vs-_docs conflict.

| Doc | Role | Read when |
|---|---|---|
| **[BUILD_HANDOFF.md](./BUILD_HANDOFF.md)** | **The single front door.** What Workspaces is, what V1 ships, the reading order, the 4-AI spin-up protocol, the standing constraints, the "where do I start?" prompt. | FIRST — every builder, every lane, before any code. |
| **[V1_SCOPE.md](./V1_SCOPE.md)** | **Ground truth on WHAT ships.** IN/OUT table, the 7 concrete V1 flows, the deferred list, the precedence rule, the 4 lanes + Phase 0. | SECOND — the authority every other doc defers to on scope. |
| **[BUILD_ORDER.md](./BUILD_ORDER.md)** | **The sequenced build plan.** Phase 0 (P0.5 spike gate + frozen contracts), the 4 non-overlapping lanes (A/B/C/D) with per-lane dirs/docs/milestones, the dependency graph, the non-overlap protocol, checkpoints CP0–CP5. | THIRD — once you know your lane. |
| **[CODE_EDITOR.md](./CODE_EDITOR.md)** | **The Lane-D editor build-doc.** openvscode-server in-container (1:1 VS Code, account extensions, multi-language LSP, native git diff), the per-ticket Caddy route, the edit-lock/pause/resume orchestration, push-on-approval ride-along, the ui-builder Monaco demotion. | When building Lane D (editor / changes page). |
| **[REPO_CLAUDE.template.md](./REPO_CLAUDE.template.md)** | **Template for the new repo's root `CLAUDE.md`.** Copy to repo root (do not edit in place). | Once, at repo bootstrap (Phase 0). |
| **[PORT_MANIFEST.md](./PORT_MANIFEST.md)** | **The copy-list.** Exactly which non-framework files to bring into the fresh repo (the folder + `server/hooks/workspacesTerminal.ts` + the one wiring line + the `ui-builder/` reference + deps), and what NOT to copy (it's the framework). | At repo bootstrap, when copying files in. |

### Architecture (the locked spine)

| Doc | Covers | Read when… |
|---|---|---|
| **[01_ARCHITECTURE.md](./01_ARCHITECTURE.md)** | engine + billing, two-system topology, the 3 roles, session lifecycle, real-time multi-client + contention, cross-platform & stack-agnostic containers, security | you need the *why* and the runtime shape |
| **[02_PROTOCOL_AND_FLOW.md](./02_PROTOCOL_AND_FLOW.md)** | `ws-ai:*` socket events, the structured-channel verbs, hooks, the ticket state machine, carry-over, QuestionSet, signals/suggestions/notifications, RBAC | you're wiring sessions ↔ orchestrator ↔ UI |
| **[03_AUTOMATION_AND_PLUGINS.md](./03_AUTOMATION_AND_PLUGINS.md)** | triggers + cron, refresh-docs, the AgentRole plugin model, artifact viewers, integrations, the "add a Design stage" walkthrough | you're adding automation or a new stage-type |
| **[04_DATA_MODEL.md](./04_DATA_MODEL.md)** | Prisma models (real repo) ↔ prototype `types.ts` mapping, exact new entity fields | you're touching persistence |
| **[05_BUILD_PLAN.md](./05_BUILD_PLAN.md)** | the parallelism-optimized phased roadmap + per-phase fan-out + verification | you're about to build |
| **[06_TOKEN_OPTIMIZATION.md](./06_TOKEN_OPTIMIZATION.md)** | the context-budget + self-handoff cycle that keeps long-lived sessions lean | you're worried about long sessions filling context |
| **[07_ORCHESTRATOR.md](./07_ORCHESTRATOR.md)** | the single-instance **orchestrator runtime mechanics** the Conductor drives — §A ticket launch/teardown, §B Caddy subdomain proxy, §C GitLab-webhook ingest + board sync, §D RAG delta-indexer + vector store. Architecture-layer companion to 01 (not a feature doc); feature docs cite it as `[07 §A]`…`[07 §D]` | you need the deterministic runtime sequence behind a feature (containers, Caddy routes, webhooks, RAG) |
| **[features/INDEX.md](./features/INDEX.md)** | the **detailed per-feature layer** — now **24 docs** (setup, presets, build phase, integrations, per-session info, voice, code review, codebase editor, questions, automations, AI panel, board, backlog/sprints, terminals, sources, members/RBAC, account/auth, notifications, usage/budget, activity, search, GitLab sync, preview, pause/kill) — extends 01–07, never contradicts | you're designing or building a specific feature |
| **[SETUP_AND_PREREQUISITES.md](./SETUP_AND_PREREQUISITES.md)** | the **operator/human to-do list** — accounts, infra, container image, per-CLI-integration credentials, env vars (each tagged with the build phase it's needed for) | you're about to actually run it |

### Build-doc set (added 2026-06-04 — from the deep review; read `REVIEW_AND_OPEN_QUESTIONS.md` for the decisions behind them)

> **Reconciliation / reference layer** (read first — the rest cite these):

| Doc | Covers | Read when… |
|---|---|---|
| **[REVIEW_AND_OPEN_QUESTIONS.md](./REVIEW_AND_OPEN_QUESTIONS.md)** | the 26-agent deep review: container & multi-provider deep-dives, 13 recommendations, 12 anti-recommendations, the 68 resolved open questions (each with its `→ Keuze`) | you want the *why* behind any build-doc decision |
| **[00_SPEC_RECONCILIATION.md](./00_SPEC_RECONCILIATION.md)** | the precedence carve-out + ERRATA (E1–E8): which layer governs which decision class; supersedes README's blanket "specs win" for engine/billing/role-topology/verb-surface | you hit a `handoff/` claim that seems to conflict with the `_docs` — read FIRST |
| **[REFERENCE_CODES.md](./REFERENCE_CODES.md)** | binding inlined definitions of every cited G#/B#/DH code + the B-xx→owning-doc coverage matrix; frees the build-docs from the frozen `handoff/` folder | you see a `B-23`/`G6`/`DH5` citation and need its real definition |
| **[CONTROL_API.md](./CONTROL_API.md)** | the formal `[control-API]` spec: an authenticated `_api` route family → `preApiExecute` RBAC → enqueue a Conductor action (never a direct writer); the op-catalogue, ControlAck, merge-on-`seq` | you're building any user-initiated WRITE (pause/kill/bulk/role/budget/preview) |
| **[04b_DATA_MODEL_ADDENDA.md](./04b_DATA_MODEL_ADDENDA.md)** | the §6–§11 model bodies docs 16–24 cite, the ONE canonical `AgentSession`, multi-cap `WorkspaceBudget`, the 5-value `WorkspaceSuggestion`, typed `StageKind`, the field sweep + `types.ts` backfill | you're touching persistence beyond what `04` spells out |

> **Runtime / protocol & operational subsystems:**

| Doc | Covers | Read when… |
|---|---|---|
| **[02b_PROTOCOL_ADDENDA.md](./02b_PROTOCOL_ADDENDA.md)** | the PTY-engine machine contract: the Stop-hook forced-reconciliation loop, per-session token lifecycle, the executable `VERB_REGISTRY` + conformance test, fenced-block parsing, the `emit_output→emit_carryover` collapse | you're wiring the deterministic backstop behind the interactive-PTY engine |
| **[07b_CONTAINER_RUNTIME.md](./07b_CONTAINER_RUNTIME.md)** | the build-grade container layer: three-layer images, managed-token-projection auth, per-ticket/per-stage isolation, clone-into-volume, dial-by-name networking, egress forward-proxy, hardening table, CapacityManager, pty-agent | you're building or operating the container runtime |
| **[GOLDEN_PLAN_STAGE.md](./GOLDEN_PLAN_STAGE.md)** | one fully-rendered stage (professional-preset PLAN) to literal `.claude/settings.json`/`.mcp.json`/`CLAUDE.md`/launch-command — the config-renderer's first regression fixture | you're building the config renderer (diff its output against this) |
| **[P0_CLI_SPIKE.md](./P0_CLI_SPIKE.md)** | the P0.5 gating spike: subscription-billing, interactive `type:http` hooks, `/clear`-vs-`/compact`, per-turn usage, `--resume`-after-crash, managed-token-projection — blocks P1 lanes B/C/F until green | BEFORE starting P1 lanes B (SessionManager), C (channel), or F (containers) |
| **[08_DEPLOYMENT.md](./08_DEPLOYMENT.md)** | the run model: N stateless web-app replicas + the single supervised orchestrator that takes `lease:orchestrator` and runs `resumeAll()`; boot-order graph; the explicit SPOF + P4 warm-standby | you're deploying or supervising the two systems |
| **[OBSERVABILITY.md](./OBSERVABILITY.md)** | structured-logging contract, the minimal metrics set, per-leased-loop liveness, the alerting baseline, and the thin `@luckystack/monitoring` adapter; operator-vs-product stream boundary | you need to see/alert the orchestrator running |
| **[DR_RUNBOOK.md](./DR_RUNBOOK.md)** | P4 backup/restore: mongodump + Redis AOF/RDB, the append-only event-log as restore-priority-1 + replay, RPO/RTO board, what is acceptably lost, the ordered restore procedure | you're setting up backups or recovering from a host loss |
| **[TESTING_STRATEGY.md](./TESTING_STRATEGY.md)** | the test tier the auto-sweep can't reach: deterministic-Conductor unit tests, the fake/replay `EngineDriver`, the event-log subscribe-before-fetch race (FIRST slice), `VERB_REGISTRY` conformance + drift script | you're writing tests for the orchestrator/Conductor/event-log |
| **[MIGRATION.md](./MIGRATION.md)** | prototype→real-repo port: the fresh `@luckystack`-consuming target, `types.ts→Prisma` step list, the `useWorkspaceData()` data-seam refactor, first-run bootstrapping, the `runInTenant` background-worker checklist | you're porting the UI prototype onto the real backend |
| **[MULTI_PROVIDER_SEAM.md](./MULTI_PROVIDER_SEAM.md)** | PARKED-for-v1 seam: build only the single-spawn wrapper now; the 3-point conformance bar, the two hard forward-compat constraints, per-driver billing, the report-only prose de-conflicts | you're tempted to abstract the engine over a second AI backend (don't, beyond the wrapper) |

### All-in-one layer (added 2026-06-04 — pluggable forge + the build-quality/operability gaps; decisions in `REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE.md`)

| Doc | Covers | Read when… |
|---|---|---|
| **[REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE.md](./REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE.md)** | the all-in-one round: cohesion verdict + the 5 decide-first forks + 50 consolidated open questions (each with a `→ Keuze`) | you want the *why/decisions* behind the all-in-one docs |
| **[FORGE_ABSTRACTION.md](./FORGE_ABSTRACTION.md)** | the pluggable `ForgeProvider` seam (6 capabilities) — GitLabForge (today, SoT) / GitHubForge (design-now) / BuiltinForge (own repo+MR+CI); per-workspace `forgeMode`, Source-of-Truth per mode | you're touching anything git-host-related (board sync, repo, MR, CI, webhooks) |
| **[BUILTIN_MR_REVIEW.md](./BUILTIN_MR_REVIEW.md)** | the per-ticket changes page expanded into a full MR experience: diff + review threads + approvals + merge; built-in-owns vs external-federates | you're building the merge-request / code-review surface |
| **[BUILTIN_CI_PIPELINES.md](./BUILTIN_CI_PIPELINES.md)** | lightweight CI = container jobs on the existing orchestrator; the pluggable `PipelineRunner` (built-in / forge-native / external engine); `.workspaces/ci.yml` | you're building CI/pipelines |
| **[GIT_STRATEGY.md](./GIT_STRATEGY.md)** | branch/rebase/merge/conflict/rollback across parallel tickets, serial Conductor-only merges, per forge mode | you're building the git/merge mechanics |
| **[AI_QUALITY_AND_EVALS.md](./AI_QUALITY_AND_EVALS.md)** | the per-role system prompts + the golden-tickets eval harness + prompt versioning/A-B + the human-reject→few-shot feedback loop | you care whether the pipeline produces *good* output |
| **[CLIENT_AND_PUSH.md](./CLIENT_AND_PUSH.md)** | PWA-first phone client + web-push (VAPID, service worker, redacted-payload-then-in-app per the D80 reversal), approve-from-lockscreen ergonomics | you're building the phone/PWA client or push |
| **[SELF_HOST_INSTALLER.md](./SELF_HOST_INSTALLER.md)** | the one-command docker-compose stack + bootstrap; minimal (external-forge) vs full (built-in git+CI) profile | you're packaging the self-host install |
| **[TRUST_SAFETY_UX.md](./TRUST_SAFETY_UX.md)** | shadow/gate-every-stage autonomy, forward-revert rollback, the immutable `AuditEntry`, per-workspace autonomy levels | you're building the trust/control surface |
| **[PRODUCT_ANALYTICS.md](./PRODUCT_ANALYTICS.md)** | cycle-time/throughput/stuck-detection/cost-per-type from the event log (distinct from operator OBSERVABILITY) | you're building product-level insight dashboards |

---

## Glossary

- **Assistant** — the per-user, per-workspace chat session (reasoning/proposing only).
- **Stage-Agent** — the worker Claude session for one ticket at one stage.
- **Conductor** — deterministic orchestrator code; **all coordination** + the sole writer of state; executes what the user approves.
- **(optional, future) background reasoner** — an *ephemeral* one-shot session the Conductor spawns only for proactive/scheduled LLM tasks with no user online (briefings, suggestion synthesis). Not a standing role.
- **Structured channel** — the typed agent→orchestrator path (verbs like `emit_carryover`, `request_input`, `emit_signal`, `emit_handoff`); transport is a whitelisted CLI/HTTP helper or MCP.
- **Carry-over** — the `{summary, changedFiles, openQuestions, commitHash}` envelope a stage emits and the next stage receives (spec **B-O2**).
- **Self-handoff / token-optimization** — when a long session hits its context budget, it writes a detailed handoff, then `/clear`s and reloads it (see [06](./06_TOKEN_OPTIMIZATION.md)).
- **Role (`AgentRole`)** — pluggable stage behavior (`code`, `design`, …): system prompt + default skills/commands/model + output schema + viewer + `needsWorkspace`.
- **Trigger** — a `when (event) → then (action)` automation rule (stage-lifecycle or cron).
- **Signal / Suggestion / Note** — append-only agent observations → proposals → free-form notes (spec **§7 / B-O6 / B-23**).

---

## Source specs these docs distill (authoritative, in `handoff/`)

`DATAMODEL.md` (§7 Workspace-AI, B-23, B-O6) · `CLAUDE_SETTINGS_MAP.md` (B-38 — stage-config → real `.claude` config) · `BESLISSINGEN.md` (B-01…B-O8 decisions) · `IDEE_SPEC.md` (two-system topology, §8 Workspace-AI) · `designs/CLAUDE_DESIGN_FEATURE_COMPLETION.md` (the future Design feature). Where these docs and the specs disagree, the specs win — flag it. (A cold AI should also read the repo's root `CLAUDE.md` for working rules.)

## Status & scope

Design + docs only. **No backend AI is wired yet**; the chat panel is still the dummy `sendChat`/`parseMove`. The first build milestone is the **thin Brain PoC** — one per-user **Assistant** chat (chat-only). Build order and parallel fan-out: **[05_BUILD_PLAN.md](./05_BUILD_PLAN.md)**.
