# 05 — Build plan (optimized for parallel agent teams / ultracode)

> The roadmap, structured so each phase fans out into **independent workstreams** you can hand to parallel agents (or an ultracode workflow) and integrate at a milestone. Prereqs: [01](./01_ARCHITECTURE.md)–[04](./04_DATA_MODEL.md). Status: **nothing built yet**; P0 (these docs) done. First build = the **thin Brain PoC** in P1.
>
> **⚑ SUPERSEDED for V1 by [BUILD_ORDER.md].** 05’s A–F lane scheme + P0–P4 phasing is the design-horizon record; the V1 build is the 4-lane map (A/B/C/D) in [BUILD_ORDER.md] + [V1_SCOPE.md] §6. The "thin Brain PoC" line below is pre-V1-scope. Read [V1_SCOPE.md] + [BUILD_ORDER.md] first.

---

## How to read this

Each phase lists: **workstreams** (the parallel lanes), the **shared contracts** that let them run concurrently, the **integration milestone**, and **verification**. A lane is safe to parallelize when it only depends on a frozen contract, not on another lane's internals. Freeze the contracts *first* (they're already specified in 02/04), then fan out.

**Frozen contracts that unlock parallelism** (define once, lane-independent): the **structured-channel verbs** (02 §2), the **`ws-ai:*` socket events** (02 §… below), the **carry-over envelope** (02 §4), the **data model** (04), and the **AgentRole** interface (03 §3). With these pinned, lanes integrate without renegotiation.

---

## P0 — Docs (done)
This `_docs/` set. **Verify:** README + 01–05 exist, cross-link, quote the binding rules (B-23, B-O2, B-O6, B-35, B-38), and are self-contained enough to start any P1 lane cold.

---

## P1 — Foundations (HIGH parallelism)
Goal: the skeleton that proves the engine + lets a real per-user Assistant chat. Six lanes, mostly independent behind the frozen contracts.

| Lane | Scope | Depends on | Can start immediately? |
|---|---|---|---|
| **A — Data** | Prisma schema for all models (04) + tenant scoping (`runInTenant`) + `getPrismaClientFor` tiers | data-model doc | ✅ |
| **B — SessionManager** | boot-time singleton; spawn/suspend/`--resume` per-user **Assistant** (`assistant:ws:user`) + **Stage-Agents** (`worker:ticket:stage`); ring-buffer, watchdog, **active-turn** cap+queue — generalize `server/hooks/workspacesTerminal.ts`. (No standing Coordinator; the optional one-shot reasoner is P5.) | terminal pattern | ✅ |
| **C — Structured channel** | the `ws` CLI/HTTP helper + the orchestrator endpoint + hook-ingress route (`registerCustomRoute` pre-params, token-gated) | verb contract | ✅ |
| **D — Conductor** | ticket state machine, carry-over store/inject, QuestionSet create/answer, serial signal loop (stubs where B/C aren't ready) | state-machine spec | ✅ (against contracts) |
| **E — Client wiring** | replace dummy `sendChat`/`parseMove`/`moveTicket` with `ws-ai:*`; stream into existing `ChatBubble`/`useTypewriter`; real-time room fan-out; Compact/Clear buttons | socket-event contract | ✅ |
| **F — Containers** | base image + Docker-API provisioning (Win via WSL2 + Linux) + a **.NET sample** + worktree + pty-agent | — | ✅ (infra lane) |

**Integration milestone = the thin Brain PoC** (B + C-lite + E): one interactive `claude` PTY **per user, per workspace** (`assistant:<wsId>:<userId>`) over the existing socket bridge, dev-gated (`WORKSPACE_AI_ENABLED=1`), replacing the dummy chat; that user's replies stream into their panel; the session **persists** across tab switches (module registry, like `XtermTerminal.tsx`); the **Compact** button writes `/compact\r`; the chat thread broadcasts to the `workspace-<wsId>` room so other clients of the *same user* stay in sync. PoC is **chat-only** — one user, one Assistant; no Coordinator, no board mutation, no verbs yet.

**Suggested fan-out:** an ultracode workflow with 6 parallel agents (A–F), each handed the relevant doc section + the frozen contracts; a 7th "integration" agent assembles the PoC from B/C/E once they land. Lanes A, F, and D-stubs need no UI; B/C/E converge on the PoC.

**Verify (PoC):** `npm run lint:client` (0/0) · `tsc --noEmit -p tsconfig.client.json` · `vite build` · `npm run lint:server` (0/0) · `tsc -b tsconfig.server.json`. Manual: restart backend; host `claude login`-ed; send a message → real streamed reply; switch tabs → session persists; Compact runs; **off in production** unless `WORKSPACE_AI_ENABLED=1`; confirm via host usage it draws the **subscription**.

---

## P2 — The flow end-to-end (MEDIUM parallelism)
Goal: a ticket actually walks a stage with a code agent, asks questions, and promotes.

| Lane | Scope |
|---|---|
| **Stage-Agent spawn** | render `PipelineStageCfg` → `.claude/settings.json`/`.mcp.json`(opt)/`CLAUDE.md`/injected-prompt; spawn `claude` in the container (code roles); wire hooks |
| **Carry-over + promote** | `emit_carryover` → validate → store → `done`; promote injects A→B; `query_context` for full prior output |
| **QuestionSet loop** | `request_input`/`Notification` → QuestionSet → mobile cards → answer → `--resume` |
| **Signals (Conductor)** | serial signal-log consumption under a lease (deterministic); `stopped`→`stuck`→needs-input (agent self-phrases); deterministic `link-tickets`; reasoning-heavy `config-review` drafted by a connected user's Assistant |
| **Notifications** | `Notification` model + in-app/email/web-push (B-34) |
| **Token-optimization** | per-stage + per-AI context budget; after-turn check; `emit_handoff` → `/clear` → reload (06). Applies first to long Assistant sessions |

Parallelizable: the five lanes share the verb + data contracts; spawn vs carry-over vs questions vs signals vs notifications touch different code. **Milestone:** create a ticket → it refines (a reasoning role, no container) → asks a question → you answer on mobile → it promotes into a code stage → a containerized agent edits files → emits carry-over → you promote again. **Verify:** an integration walkthrough on the seed workspace + the lint/build gate.

---

## P3 — Automation + plugins (HIGH parallelism)
Goal: triggers, doc-refresh, and the first non-`code` role.

| Lane | Scope |
|---|---|
| **Trigger engine** | `WorkspaceTrigger` model + matcher + ActionExecutor + the leased cron tick (03 §1) |
| **Automation UI** | Pipeline "Automation" sub-tab (stage-scoped) + workspace Automation screen |
| **Refresh-docs** | `OrchestratorCommandRegistry('ai:refresh-docs')` wired to cron + chat + on-complete + maintenance suggestion |
| **AgentRole registry** | `registerAgentRole` + `roleKey` on stages + the General-tab Role dropdown + a 2nd role |
| **ArtifactViewer registry** | `registerArtifactViewer` + `TicketDetail` render-by-`artifactKind` (fallback `FileDiffViewer`) |
| **Integrations wiring** | the v1 whitelisted-CLI-client mechanism per tool + tier→credential |

All six are independent (different registries/surfaces). **Milestone:** a nightly `ai:refresh-docs` cron fires; an `on_approval → start-stage` trigger auto-advances; a second role is selectable and runs. **Verify:** trigger fires with no browser connected (tail the orchestrator); lint/build.

---

## P4 — Hardening (parallel)
resume-after-crash (`resumeAll`) · multi-instance lease (`acquireLease('ws-engine:<wsId>')`) · rate-limit→`stopped` + backoff · spend/budget accounting + auto-pause · presence + catch-up polish · optional metered-burst fallback (config flag, API/Agent-SDK) for parallelism beyond the subscription ceiling. Each is an independent lane. **Verify:** kill the orchestrator mid-stage → it resumes; simulate quota exhaustion → `stopped` + notify.

---

## P5+ — New capabilities (each fully independent)
- **Built-in Claude Design** role (the 03 §7 walkthrough — proves zero core change).
- **Voice → ticket** (whisper.cpp, B-O1; streaming upload seam, spec §7).
- **Cross-ticket awareness** (`query_context` "is another ticket touching this file?").
- **Morning-briefing cron** (`invoke-workspace-ai` on a schedule → board-health summary suggestion).
Each = a new role / trigger / verb consumer; none touches the others (the stable-waist guarantee, 03 §6).

---

## Critical files (reference)
- Pattern to extend: `server/hooks/workspacesTerminal.ts`; wire in `server/server.ts`.
- Client socket pattern: `src/workspaces/_components/XtermTerminal.tsx`.
- Replace in P1-E: `src/workspaces/page.tsx` (`sendChat`/`parseMove`), `_shell/WorkspacesContext.tsx`, `_shell/Shell.tsx` (`AIPanel`/`ChatBubble`/`useTypewriter`).
- Contracts: `src/workspaces/_data/types.ts`, `_data/seed.ts`.

## `ws-ai:*` socket events (the P1 client contract)
Client→server: `chat {wsId,userId,text}` (routes to that user's Assistant) · `attach {wsId,sessionKey}` · `detach {sessionKey}` · `reply {ticketId,answers}` · `control {ticketId,action:'pause'|'resume'|'stop'|'promote',toStage?}`.
Server→client: `stream {sessionKey,data}` · `status {sessionKey,ticketId?,status}` · `event {ticketId,event}` · `needs-input {ticketId,questionSet}` · `suggestion {suggestion}` · `notification {notification}` · `exit {sessionKey,code}`.
All gated identically to `ws-term:*` (SSH-key challenge + RBAC); each socket joins `workspace-<wsId>` for Redis-adapter fan-out.
