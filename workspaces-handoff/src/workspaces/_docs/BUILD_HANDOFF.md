# BUILD_HANDOFF — the single front door for building Workspaces V1

> **You are a fresh AI pointed at this file. Read it top-to-bottom, then read the docs in the order in §2, then ask the user the "where do I start?" question in §6.** This is the master entry-point: it tells you *what Workspaces is*, *what V1 actually ships*, *the order to read the spec*, *how the 4 parallel build lanes are spun up and kept non-overlapping*, and *the constraints every lane must honor*. It introduces **no new design, no new verbs, no new scope** — it routes you into the real docs. Where it summarizes, the cited doc governs. Last updated: 2026-06-04.
>
> **The one rule that overrides everything below:** [V1_SCOPE.md](./V1_SCOPE.md) is the authority on *what ships*. The broader doc set (01–08, 04b, the all-in-one layer, the 24 `features/` docs) describes a **bigger system than V1 builds** — it is the design horizon, not the build. When any doc over-describes beyond V1_SCOPE, **V1_SCOPE wins** ([V1_SCOPE §5]). Codes (`B-23`, `G6`, `DH5`, `B-O2`…) resolve via [REFERENCE_CODES.md].

---

## 1. What Workspaces is (10 lines) + the one load-bearing decision

Workspaces is a **self-hosted, AI-driven dev-orchestration app**. A user writes simple tickets; a configurable **pipeline of stages** (refine → plan → implement → test → review) drives each ticket forward; the human is a **man-in-the-middle who only approves and answers questions** — ideally from a phone. Three roles ([README], [01 §3]): the **Assistant** (one interactive `claude` PTY per active user — the chat that proposes/relays), the **Stage-Agent** (one interactive `claude` PTY per *(ticket, stage)*, doing the work inside a container), and the **Conductor** (deterministic Node in the single-instance orchestrator — **the only writer** of board/git/status). The app installs `@luckystack/*` and follows LuckyStack's file-based `_api`/`_sync` routing + function-injection conventions (root `CLAUDE.md`).

**The one load-bearing decision — PTY billing ([README] "the one decision everything hangs on", [01 §1]):** as of 2026-06-15, headless `claude -p` and the Agent SDK draw from a **separate metered credit pool**, NOT the interactive Max subscription. The user's hard requirement is *everything runs on the Max subscription*. Therefore **every Claude session is an interactive `claude` in a node-pty PTY** — never `claude -p`, never the Agent SDK. Structured output comes from **Claude hooks** (`type:http`) + an **agent-initiated structured channel**, both of which work *inside* an interactive subscription session. This is why the **P0.5 CLI billing spike** ([P0_CLI_SPIKE]) is the FIRST task and **GATES the build**.

**V1 in one line:** **Claude CLI (interactive PTY) + GitLab only + one self-hosted server.** Single forge, single provider, single host, single-instance orchestrator. Everything multi-* is designed-but-deferred ([V1_SCOPE §4]).

---

## 1b. Step 0 — bringing this into a fresh repo (do this FIRST, before any reading order)

This `src/workspaces/` folder is dropped into a **fresh repo that `npm install`s `@luckystack/*`** — Workspaces is a consumer app, not a fork of the framework. **Before building, set up the repo per [PORT_MANIFEST.md]:**

1. Create a fresh repo and install the framework (`npm install @luckystack/*` — exact set in [SETUP_AND_PREREQUISITES.md] / [MIGRATION.md]).
2. Copy the **whole `src/workspaces/` folder** in (it is self-contained — only `@luckystack` + lib imports).
3. Copy the **one loose backend file** [PORT_MANIFEST.md] lists — `server/hooks/workspacesTerminal.ts` (the dev terminal bridge) — and add its **one registration line** to the server entry.
4. Copy **`_docs/REPO_CLAUDE.template.md` to the repo root as `CLAUDE.md`**.
5. Keep the **`ui-builder/` folder as a reference** for Lane D (Monaco patterns — not product code).

> **[PORT_MANIFEST.md] is the authoritative copy-list** (what to bring, where it goes, what NOT to copy because it's the framework, and the deps to add). If a lane ever needs a file not in the manifest, flag it — don't reach silently back into the old monorepo.

---

## 1c. The 2026-06-11 additions round (read after V1_SCOPE)

After the founding doc set was locked, an **interview-mode sparring session (2026-06-11)** generated a round of **net-new ideas** — capabilities the founding docs didn't cover — each vetted so **none re-litigates a locked decision**, each honoring the same invariants (§4). They live in **[`additions/`](./additions/00_INDEX.md)**:

- **[additions/00_INDEX.md](./additions/00_INDEX.md)** — the map: 12 V1 additions + 4 HORIZON, the lane assignment, the build order (keystone = #9 per-stage commit).
- **[additions/00_DECISIONS_LEDGER.md](./additions/00_DECISIONS_LEDGER.md)** — the decision trail + the **aggregated schema/contract deltas** each addition needs (fold these into [04b]/[CONTROL_API]/[02]/[P0_CLI_SPIKE] before the lane builds — never cast around a missing delta).
- **[additions/00_TIER2_HARDENING.md](./additions/00_TIER2_HARDENING.md)** — ~17 correctness/robustness fixes mapped to their owning docs (ride along with each lane).

> These additions **extend** the build; [V1_SCOPE.md](./V1_SCOPE.md) still wins on the founding scope, and the additions index marks each item V1 vs HORIZON. Two open reconciliation items are flagged for the user in [additions/00_INDEX.md](./additions/00_INDEX.md) (the QuestionSet-answer write path; the #1 intake-cost fallback).

---

## 2. Reading order for a builder

Read in this order. The first three are mandatory before you touch any code; the rest you read when your lane needs them (§3 lists each lane's docs).

### 2.1 Read-first (every builder, every lane — in this order)

1. **[V1_SCOPE.md](./V1_SCOPE.md)** — the definitive *what-ships*. §2 IN/OUT table, §3 the seven concrete V1 flows, §4 the deferred list, §5 the precedence rule, §6 the four lanes + Phase 0. **This is ground truth.**
2. **[BUILD_ORDER.md](./BUILD_ORDER.md)** *(companion sequencing doc — read it next for per-lane task order, the Phase-0 gate, and the integration checkpoints)*. — the build sequence: what's in Phase 0, what each lane does first, where the lanes synchronize.
3. **[00_SPEC_RECONCILIATION.md](./00_SPEC_RECONCILIATION.md)** — the precedence carve-out + ERRATA (E1–E8). Tells you which layer governs which decision class so you never "comply" with a superseded spec (e.g. don't re-instate headless to satisfy `CLAUDE_SETTINGS_MAP`). Read BEFORE any `handoff/` spec.
4. **Root [`CLAUDE.md`](../../../CLAUDE.md)** — the LuckyStack framework rules (file-based routing, function-injection, strict typing, branch logs, the autonomous-commands policy). Your lane code obeys these.

### 2.2 Then your lane docs + the frozen contracts (§3)

Once the read-first set is in hand, read your lane's docs (§3) and the two contract docs every lane builds against: **[CONTROL_API.md]** (the write path) and **[04b_DATA_MODEL_ADDENDA.md]** + **[04_DATA_MODEL.md]** (the schema/types).

### 2.3 The full doc map (grouped)

> Use this to locate a doc by purpose. **Decision-logs** explain *why*; **architecture/build-grade** explain *how*; **feature** docs are per-surface detail; **all-in-one** docs are mostly the V1-deferred horizon (build only what [V1_SCOPE §2] marks IN).

**Ground-truth & reconciliation (read-first):**
| Doc | Purpose |
|---|---|
| [V1_SCOPE.md] | **What V1 ships** — the authority on scope (wins on conflict). |
| [BUILD_ORDER.md] | The build sequence / per-lane order / integration checkpoints (companion to V1_SCOPE §6). |
| [00_SPEC_RECONCILIATION.md] | Precedence rule + ERRATA E1–E8 (which layer governs which class). |
| [REFERENCE_CODES.md] | Binding definitions of every `G#`/`B#`/`DH#` code + B-xx→owning-doc matrix. |

**Architecture (the *why* + runtime shape):**
| Doc | Purpose |
|---|---|
| [README.md] | The model in one screen, the PTY-billing decision, the doc map. |
| [01_ARCHITECTURE.md] | Engine + billing, two-system topology, the 3 roles, session lifecycle, real-time multi-client. |
| [02_PROTOCOL_AND_FLOW.md] | `ws-ai:*` events, the frozen structured-channel verbs, hooks, ticket state machine, RBAC. |
| [03_AUTOMATION_AND_PLUGINS.md] | Triggers + cron, the `AgentRole` plugin model, artifact viewers. |
| [07_ORCHESTRATOR.md] | Deterministic orchestrator runtime: ticket launch/teardown, Caddy proxy, GitLab-webhook ingest, RAG indexer. |
| [08_DEPLOYMENT.md] | The run model (N web replicas + 1 leased orchestrator running `resumeAll()`), boot order, SPOF. |

**Build-grade (the contracts + subsystems lanes implement against):**
| Doc | Purpose |
|---|---|
| [CONTROL_API.md] | **The `[control-API]` write spec** — `_api` route → `preApiExecute` RBAC → enqueue → Conductor (the only writer); the op catalogue, ControlAck, merge-on-`seq`. |
| [04_DATA_MODEL.md] | Prisma models ↔ prototype `types.ts` mapping. |
| [04b_DATA_MODEL_ADDENDA.md] | §6–§11 model bodies (TicketEvent+`seq`, AgentSession, SpendRecord/WorkspaceBudget, Notification/PushSubscription), `runInTenant`. |
| [02b_PROTOCOL_ADDENDA.md] | The PTY-engine machine contract: Stop-hook reconciliation, `VERB_REGISTRY` + conformance test, fenced-block parsing. |
| [07b_CONTAINER_RUNTIME.md] | **The container build guide** — three-layer images, managed-token-projection auth, per-ticket/stage isolation, clone-into-volume, dial-by-name net, egress proxy, hardening, CapacityManager, pty-agent. (Greenfield — the old `ui-builder` has no containers.) |
| [GOLDEN_PLAN_STAGE.md] | One fully-rendered stage → literal `.claude/settings.json`/`.mcp.json`/`CLAUDE.md`/launch-command — the config-renderer regression fixture. |
| [CODE_EDITOR.md] | **The Lane-D editor build-doc** — the in-container openvscode-server exposed via Caddy + the read-only `FileDiffViewer` diff fallback; the changes-page stage-lock + pause/resume-with-changes orchestration around the VS Code session. |
| [P0_CLI_SPIKE.md] | **The P0.5 gating spike** — subscription billing, interactive `type:http` hooks, `/clear` vs `/compact`, per-turn usage, `--resume`-after-crash, managed-token-projection. **Blocks the container lanes until green.** |
| [MIGRATION.md] | Prototype → real-repo port: `types.ts` → Prisma, the `useWorkspaceData()` data-seam refactor, first-run bootstrap, the `runInTenant` worker checklist. |
| [OBSERVABILITY.md] | Structured-logging contract, minimal metrics, per-leased-loop liveness, the `@luckystack/monitoring` adapter. |
| [DR_RUNBOOK.md] | Backup/restore (mongodump + Redis AOF/RDB), event-log replay, RPO/RTO, the ordered restore procedure. |
| [TESTING_STRATEGY.md] | The test tier the auto-sweep can't reach: deterministic-Conductor unit tests, the fake/replay `EngineDriver`, the subscribe-before-fetch race test, `VERB_REGISTRY` conformance. |

**All-in-one layer (mostly the V1-deferred horizon — build only the IN slice per [V1_SCOPE §2/§4]):**
| Doc | V1 status |
|---|---|
| [FORGE_ABSTRACTION.md] | Seam stays as design; **only `GitLabForge` is built** (`forgeMode='gitlab'`). GitHub / built-in git-server / mode-switching OUT. |
| [BUILTIN_MR_REVIEW.md] | **Mostly DEFERRED.** V1 = push-on-approval → GitLab create-MR-URL ([V1_SCOPE §3.1]). No built-in MR entity / on-platform merge / auto-merge. |
| [BUILTIN_CI_PIPELINES.md] | **DEFERRED.** GitLab runs its own CI on its side; we build/trigger none ([V1_SCOPE §3.7]). |
| [GIT_STRATEGY.md] | Serial-merge/rebase/conflict machinery is horizon; V1's "merge" = a `git push` + a GitLab link. Branch convention (`DEV-####`) IS used. |
| [TRUST_SAFETY_UX.md] | V1 ships the per-stage proceed-or-gate toggle + edit-lock; the auto-merge end of the autonomy spectrum is DEFERRED. |
| [CLIENT_AND_PUSH.md] | **IN** — PWA-first phone client + web-push (VAPID, redacted-payload-then-in-app per the D80 reversal), approve-from-lockscreen. |
| [SELF_HOST_INSTALLER.md] | The minimal (external-forge) profile of the docker-compose stack + bootstrap is the V1 install shape. |
| [AI_QUALITY_AND_EVALS.md] | Per-role system prompts (used by lane D); the golden-tickets eval harness is light-touch in V1. |
| [PRODUCT_ANALYTICS.md] | **DEFERRED** (the event log it folds over ships; the dashboards do not). |
| [MULTI_PROVIDER_SEAM.md] | **PARKED** — build only the single-spawn wrapper (`cmd:'claude'`); no second provider. |

**Feature docs (`features/01–24` — per-surface detail; cite as `features/NN`):**
| Range | Surfaces (read the one your lane builds) |
|---|---|
| 01–06 | Workspace setup, pipeline presets, build phase, integration tools, per-session info, voice *(voice DEFERRED)*. |
| 07–11 | **Code changes/review, codebase viewer** (lane D core), questions-in-tickets, automations, the Workspace-AI panel (lane C). |
| 12–16 | Board/kanban, backlog/sprints, terminals, sources, members/RBAC. |
| 17–21 | Account/auth, notifications, usage/budget, activity/event-log, search *(rich semantic search DEFERRED)*. |
| 22–24 | GitLab board sync, preview-deployment *(DEFERRED)*, pause/kill controls. |

**Decision-logs (the *why* behind every build-doc choice):**
| Doc | Purpose |
|---|---|
| [REVIEW_AND_OPEN_QUESTIONS.md] | The 26-agent deep review: 13 recs, 12 anti-recs, 68 resolved questions (each with its `→ Keuze`). |
| [REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE.md] | The all-in-one round: cohesion verdict + 5 decide-first forks + 50 consolidated questions. |
| [05_BUILD_PLAN.md] | The original phased fan-out (P0–P4) — historical lane scheme (A–F); **for V1 the lane map is [V1_SCOPE §6]** (A/B/C/D), not 05's A–F. |
| [SETUP_AND_PREREQUISITES.md] | The operator/human to-do list: accounts, infra, container image, credentials, env vars per phase. |

---

## 3. The 4-AI spin-up protocol

V1 is built as **four non-overlapping lanes** ([V1_SCOPE §6]), each a **separate AI session** that may use **ultracode** and must **NOT overlap files** with another lane. A **Phase 0** (the P0.5 spike + the shared types/contracts/scaffolding) precedes the parallel lanes.

### 3.1 How the user spins it up

The user opens **four AI sessions** and tells each one, verbatim in spirit:

> *"You are **AI{1|2|3|4}**, you own **Lane {A|B|C|D}**. Use **ultracode**. Read `src/workspaces/_docs/BUILD_HANDOFF.md` first, then `BUILD_ORDER.md` and your lane's docs (§3.2 below). Build only your lane's files. Honor the standing constraints (§4). Then ask me where to start."*

### 3.2 The four lanes — owns / docs / starting point

| Lane | AI | Owns (build only these dirs/surfaces) | Lane docs | Depends on |
|---|---|---|---|---|
| **A — Engine & Orchestrator** | AI1 | Server orchestrator + engine + PTY + containers/pty-agent/SSH + control-API **write-handlers** + GitLab push/create-MR-URL + **the P0.5 spike**. | [01], [02], [02b], [07], [07b], [CONTROL_API], [FORGE_ABSTRACTION] (GitLab only), [MULTI_PROVIDER_SEAM §v1], [P0_CLI_SPIKE], [GOLDEN_PLAN_STAGE] | — (publishes the control-API contracts) |
| **B — Data, tenancy & sync-backend** | AI2 | Prisma schema incl. [04b] §6–§11, `runInTenant`, the seq/merge-on-seq event-log + sync backend, migration/bootstrap, seed. | [04], [04b], [MIGRATION], [TESTING_STRATEGY] | — (publishes the schema/types **first**) |
| **C — Frontend app & realtime-client** | AI3 | Board/tickets/pipeline UI (reuse the prototype screens), the Assistant chat, realtime sync client, PWA + push, notifications, account/auth UI. | [features/11/12/13/17/18], [CLIENT_AND_PUSH], [05 P1], [02] (`ws-ai:*` contract) | B's published types + A's control-API contracts |
| **D — Code-editor & changes/config** | AI4 | The [openvscode-server] integration + the changes page (diff/highlight/edit) + stage-lock/pause/resume + per-stage config UI + the [GOLDEN_PLAN_STAGE] renderer + prompts. | [CODE_EDITOR], [features/07/08/02], [GOLDEN_PLAN_STAGE], [features/03], [AI_QUALITY_AND_EVALS] | B's types + A's control-API + container-route contracts |

### 3.3 Phase 0 + the gate (before the lanes fan out)

- **Phase 0** = the **P0.5 CLI billing spike** ([P0_CLI_SPIKE]) **+** the shared types/contracts/scaffolding. The spike must be **GREEN (or GREEN-WITH-WORKAROUND)** before the **container-touching** work in any lane starts ([P0_CLI_SPIKE §7], [V1_SCOPE §6]). A billing/PTY **RED escalates to the user — it never routes around the gate to headless** ([P0_CLI_SPIKE] anti-recommendation; Rule 22).
- **Contract-publish ordering unlocks parallelism:** **B publishes the Prisma schema/types first**; **A publishes the control-API op shapes + the `ws-ai:*`/container-route contracts**. Once those are frozen, **A / C / D build in parallel** in **distinct directories** against the frozen contracts — no lane reads another lane's internals.

### 3.4 The non-overlap rules (every lane obeys)

1. **Own only your lane's directories.** Never create or edit a file another lane owns. If your lane needs a sibling's structure, depend on its **published contract** (B's types, A's control-API shapes), not its source.
2. **Propose cross-lane changes — never edit another lane's files.** If you need a change in another lane's surface, write the proposal (what + why + the contract delta) and surface it to the user / the integration checkpoint. Editing across lanes is the failure mode.
3. **Build against frozen contracts.** The control-API op catalogue ([CONTROL_API §8]), the Prisma schema ([04b]), and the `ws-ai:*` event contract ([02]) are the integration surface. If a contract is wrong, **fix the contract at its owning lane (propose to A/B), then rebuild** — don't cast or wrapper around it (Rule 21).
4. **Sync at the integration checkpoints** (see [BUILD_ORDER.md] / [05_BUILD_PLAN.md] milestones): the PoC convergence (B+C+the chat), the end-to-end ticket flow (refine → question → promote → container edit → carry-over → promote), and the changes-page push → create-MR-URL. Integrate at the milestone, not continuously.

---

## 4. Standing constraints — every AI honors these on every change

> These are non-negotiable and structural ([V1_SCOPE §2 invariants], [00_SPEC_RECONCILIATION], root `CLAUDE.md`). A change that violates one of these is wrong even if the feature "works."

1. **B-23 — AI proposes → user accepts → Conductor executes.** The **Conductor is the only writer** of board/git/status ([01 §3.3]). LLMs (Assistant, Stage-Agent) **propose** only. (V1 nuance: the Workspace-AI's *instruction = consent* still maps to a control-API request the Conductor executes — it is never a write verb. Destructive/important actions still require an explicit confirm. [V1_SCOPE §3.3].)
2. **No new verbs — the FROZEN 7+6 verb surface.** ([02 §2], all `read|propose`.) Every write goes **[control-API] → `preApiExecute` RBAC → enqueue → Conductor**. Never add a verb to close a feature gap — re-express via existing verbs + `WorkspaceTrigger` + `run-command` + MCP ([00 §3]).
3. **Every user-initiated write is a `[control-API]` op.** No direct writers, no client-side mutation of authoritative state; the client merges by `seq` ([CONTROL_API §6.3], B-30).
4. **`runInTenant` on every orchestrator-side path** — every sync-handler AND every background worker runs tenant-scoped row-isolation ([04b §11c]). The Assistant is scoped to its workspace; **never host/system-level or out-of-workspace** ("cannot delete system32").
5. **Single-instance orchestrator** under `lease:orchestrator`; single forge (GitLab), single provider (Claude PTY), single host. Every multi-* surface is OUT ([V1_SCOPE §4]).
6. **LuckyStack framework conventions** — file-based `_api`/`_sync` routing, the function-injection system, strict typing (zero `as unknown`/`as any`; if generated types fail, fix the generator — never cast), i18n for user-facing text, Tailwind tokens only (root `CLAUDE.md` Rules 11–21). Run `npm run lint && npm run build` autonomously after changes.
7. **V1_SCOPE wins over the broader docs** ([V1_SCOPE §5]). Never re-instate a deferred surface (built-in MR, on-platform merge, auto-merge, CI, multi-provider, GitHub, preview-deploy, analytics, voice) to "complete" a feature. Build the IN column ([V1_SCOPE §2]) + the §3 flows; the deferred design lives in its cited doc for a future lane.
8. **The PTY-billing invariant** — every Claude session is interactive `claude` in a node-pty PTY; never `claude -p`, never the Agent SDK ([01 §1]). Structured output via hooks + the structured channel only.
9. **Report-without-auto-fixing + surgical changes** — flag out-of-scope issues to the user rather than fixing them; every changed line traces to the task (root `CLAUDE.md` Rules 27–28). Append a branch-log entry after real code/architecture changes (Branch Log Protocol).

---

## 5. What V1 deliberately does NOT build (so you don't drift into it)

A quick negative checklist ([V1_SCOPE §4]) — if you find yourself building any of these, stop and confirm with the user:

- **No** built-in `MergeRequest` entity, on-platform merge, approvals, or auto-merge. (V1 = push-on-approval from the last stage → GitLab returns the create-MR URL → the user merges on GitLab.)
- **No** built-in CI / `PipelineRunner` (GitLab runs its own CI on its side).
- **No** second AI provider (Claude PTY only), **no** GitHub forge, **no** built-in git-server container, **no** forge-mode switching.
- **No** preview-deployments, **no** product-analytics dashboards, **no** voice input, **no** rich semantic search (client-side filter only).
- **VS Code local edits are NOT synced** to other clients in V1 (explicitly accepted, [V1_SCOPE §3.1]).

---

## 6. Where to start — the prompt the AI asks the user

After reading §1–§5 (and your lane docs once you know your lane), **ask the user this** before writing any code:

> *"I've read BUILD_HANDOFF + V1_SCOPE + the reconciliation + my lane docs. To confirm before I start:*
> 1. *Which lane am I — **A (Engine/Orchestrator)**, **B (Data/tenancy/sync)**, **C (Frontend/realtime)**, or **D (Editor/changes/config)**?*
> 2. *Is the **P0.5 CLI billing spike** already GREEN, or am I (Lane A) running it first as the gate?*
> 3. *Have the **frozen contracts** been published yet — B's Prisma schema/types and A's control-API + `ws-ai:*` + container-route shapes — or do I (B/A) publish mine first before the others fan out?*
> 4. *Where in my lane's build order do you want me to begin — the first task in [BUILD_ORDER.md] for my lane, or a specific surface you want first?"*

Then build **only your lane's files**, against the **frozen contracts**, honoring the **§4 constraints**, with **V1_SCOPE as ground truth**. Propose cross-lane changes; never edit another lane's files. Sync at the integration checkpoints.

---

> **This is the single front door.** If a later doc seems to contradict V1's scope, re-read [V1_SCOPE §5] — V1_SCOPE wins on *what*, the build-docs govern *how*, and a real conflict with no ERRATA row is a **flag to the user**, never a silent pick (Rule 3a).
