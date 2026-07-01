# 01 — Architecture (engine, topology, runtime)

> The *why* and the runtime shape. Prereq: [README](./README.md). Protocol details are in [02](./02_PROTOCOL_AND_FLOW.md); long-session context handling in [06](./06_TOKEN_OPTIMIZATION.md).

---

## 1. The billing constraint is load-bearing

Research against current (2026) Claude Code behavior, summarized:

| Mode | Bills to | Structured output | Verdict |
|---|---|---|---|
| **Interactive `claude` in a PTY** (OAuth `/login`) | **Max subscription** | via hooks + tool calls (not TUI text) | **the only mode we use** |
| `claude -p` / `--print` headless | **separate Agent-SDK credit pool (from 2026-06-15)** | native `stream-json` | rejected (meters credits) |
| Agent SDK (`@anthropic-ai/claude-agent-sdk`) | API key *or* Agent-SDK credits | native messages/MCP | rejected (not the subscription) |

Caveat to respect: if `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `apiKeyHelper` are set, they take precedence and charge API credits — the orchestrator must spawn sessions with a clean env so they use the host's `/login` subscription. Concurrency: no documented hard cap; ~5–15 concurrent *active* PTYs per host is the practical ceiling; the subscription quota (monthly/rolling) is the real limit → see §6.

**Consequence:** the spec's older `CLAUDE_SETTINGS_MAP.md` plan (autonomous stages via `claude -p --output-format stream-json --json-schema`) is **superseded** for the subscription-only path. We keep its *hooks* design (which works in interactive mode too) and its stage-config→`.claude` mapping; we drop headless. Headless/API remains a documented *optional* burst path only (see 03 integrations / 05 P4), never the default.

> **Forward-compat note (report-only):** the no-headless / no-SDK ban is specifically the **Claude-subscription billing-path** rule — it protects subscription economics, not "headless" as a category. A future metered-API backend (parked) may legitimately be headless. See [MULTI_PROVIDER_SEAM](./MULTI_PROVIDER_SEAM.md).

---

## 2. Two-system topology (spec B-01)

Workspaces is two systems; don't conflate them:

| System | What | Scaling |
|---|---|---|
| **Web-app** (LuckyStack server) | board UI, auth, config CRUD, event-log view, presence, the `ws-ai:*` socket surface | **horizontal** (stateless + Redis adapter) |
| **Orchestrator** | PTY sessions (Assistants + Stage-Agents), Conductor, SessionManager, structured-channel endpoint + hook ingress, scheduler/triggers, Docker/worktree/RAG | **single-instance** (host-bound process state; lease-guarded) |

- **Prototype:** the orchestrator is stubbed **in-process** in the LuckyStack server as a dev-gated hook module (mirroring `server/hooks/workspacesTerminal.ts`), so we can build the PoC without standing up a second service.
- **Real repo:** the orchestrator is a **separate single-instance Node service** that may import `@luckystack/core` (for `tryCatch`, logger, Redis) but runs apart from the horizontally-scaled web-app.

---

## 3. The three roles

### 3.1 Stage-Agent (the worker)
- Interactive `claude` PTY, **one per `(ticketId, stageId)` activation**, torn down at stage end.
- **Why per-stage, not per-ticket:** a stage boundary IS a `.claude/settings.json` + skills + `.mcp.json` + model boundary, and those load at session start and can't be hot-swapped. The carry-over envelope (02 §4) is exactly the mechanism to hand state across the boundary, so a fresh agent per stage loses nothing.
- **Where it runs:** in a per-ticket **container** for *code* roles (`AgentRole.needsWorkspace=true`); as a lightweight host-side session for *reasoning* roles (Refine/Plan). See §5 and 03 §3.
- Does the real work; emits structured output via the structured channel + hooks (02 §2–3). Autonomous *within* its sandbox (permission rules + egress allow-list cap it). Big-ticket sessions self-handoff at their context budget (06).
- **Self-phrases its own blocks:** when it gets stuck after its retries, it (it's an LLM, alive at decision-time) writes the user-facing question itself via `request_input` / `emit_signal('stopped',{userQuestion})` — no separate "supervisor" LLM is needed to phrase it.

### 3.2 Assistant (the per-user chat)
- Interactive `claude` PTY, **one per active user, per workspace**. The chat *that user* talks to: refine a vague ticket into a draft + question list, answer "how is ticket X doing?", relay the user's approvals, help author the pipeline, do reasoning-heavy judgement (epics, config-review) while the user is around.
- **Spawned on connect, suspended on disconnect or idle TTL** (PTY killed, `claudeSessionId` retained for `--resume`). Carries *that user's* identity → its proposals are gated by that user's RBAC.
- **Has NO write verbs** — read/propose only. The Conductor executes; the Assistant proposes. (B-23 by construction.)
- **Why per-user (not one shared brain):** removes chat contention (each user gets parallel, instant replies), keeps each session's context lean (slower fill), and per-user RBAC falls out naturally. The cost is more *open* sessions, but idle PTYs are cheap (§6).

### 3.3 Conductor (deterministic — coordination + the only writer)
- Plain TypeScript in the orchestrator, **always on**, **no LLM**. **The only actor that writes** `Ticket.status`, `TicketEvent`, `CarryOver`, promotions, notifications, config patches — and the only thing that **coordinates** agents.
- Owns: the ticket **state machine** (02 §1), the **serial signal-log consumption** loop, **session lifecycle** (via SessionManager), **carry-over injection**, **RBAC** enforcement, execution of **user-approved** proposals, deterministic suggestions (e.g. link-tickets), and the **token-optimization** cycle (06).
- This is the answer to "do the agents need an LLM to talk to each other?" — **no.** Agents emit JSON to the Conductor; the Conductor is a strict, deterministic process. Coordination never needs an LLM. The LLMs (Assistants, Stage-Agents) only *reason and propose*.

### 3.x (optional, future) ephemeral background reasoner
The *one* thing the deterministic Conductor can't do is **LLM reasoning when no user is connected** — a scheduled "board-health briefing", or synthesizing suggestions from the signal log while you're away. That is **not** a standing role: the Conductor spawns a **one-shot `claude` session** for that specific cron/triggered task (= the `invoke-workspace-ai` trigger action, 03 §1), it proposes, and it exits. Near-zero idle cost, naturally token-bounded, **not built in v1** — add it only if you want proactive-while-away reasoning. When a user *is* online, this work is just done by their Assistant.

---

## 4. SessionManager & lifecycle

A **boot-time singleton** in the orchestrator (NOT a per-socket closure — sessions are workspace-scoped and must outlive any socket; truth lives in Prisma + Redis, never in socket.io session state).

```ts
type SessionKey =
  | `assistant:${wsId}:${userId}`   // per-user chat
  | `worker:${ticketId}:${stageId}` // stage worker
  | `reasoner:${wsId}:${jobId}`     // (future, optional) one-shot background reasoner
class SessionManager {
  sessions: Map<SessionKey, ManagedSession>   // in-memory PTY handles
  spawnAssistant(wsId, userId)     // on user connect; --resume if a session id is on file
  spawnWorker(ticketId, stageId, carryOver)   // render stage cfg → (container?) → claude PTY
  spawnReasoner(wsId, jobId, prompt)           // (future) one-shot; exits when done
  send(key, text)                  // write prompt + '\r' to PTY stdin
  suspend(key) / kill(key)         // suspend keeps claudeSessionId for --resume
  resumeAll()                      // on boot: rehydrate from AgentSession rows
  watchdog()                       // single setInterval: heartbeat/idle/stuck + token-budget checks (06)
}
interface ManagedSession {
  key; pty: IPty; ringBuffer: string[]   // scrollback for browser reattach
  status: 'starting'|'ready'|'busy'|'needs-input'|'done'|'stuck'|'killed'|'error'
  claudeSessionId?: string               // captured for --resume
  userId?: string                        // assistants only
  tokenEstimate: number                  // running estimate for the budget check (06)
  lastHeartbeatAt: number
}
```

- **Spawn / suspend:** an **Assistant** spawns when its user connects and is **suspended on disconnect / idle TTL** (resume via `--resume` on reconnect). A **Worker** spawns on ticket activation / stage promotion (for code roles: `git pull` → capture commit-hash → RAG snapshot → `git worktree add` → container start → render `.claude/settings.json` → attach the pty-agent), killed at stage end. A **reasoner** (future) is one-shot.
- **Resume-after-crash:** on boot, `resumeAll()` reads `AgentSession` rows in `{running, busy, needs-input}` and re-spawns each with `claude --resume <claudeSessionId>` (Claude persists sessions to `~/.claude/projects/<proj>/<id>.jsonl`, ~30 days). Containers/worktrees survive (teardown only on explicit done), so a worker continues; the ring-buffer reseeds the browser view.
- **Watchdog (stuck/idle, spec B-35):** three signals → `stuck`: (1) `lastHeartbeatAt` stale past the stage idle threshold; (2) Claude's `Notification(idle_prompt)` hook; (3) `--max-turns`/`--max-budget-usd` cap (a runaway guard, not a billing meter). On `stuck`: the Conductor sets status; the stuck agent (if alive) has self-phrased a question, else a deterministic notification fires; escalate to `needs-input`. The same loop checks each session's `tokenEstimate` against its budget → triggers the self-handoff cycle (06).

---

## 5. Real-time multi-client + contention

The workspace is a **shared real-time surface**: many clients per workspace (e.g. 4 users at once) all see the same live board/status/terminals/suggestions/notifications.

- **Sync mechanism (all framework-present, spec §10–11):** truth = append-only `TicketEvent` in Mongo with a Redis-`INCR` `seq`; live push via sync/sockets; fan-out to the `workspace-<wsId>` room through the **Redis socket adapter** (already wired in this repo); **presence** via an app Redis set; **catch-up after reconnect** = subscribe-first → snapshot via `_api` → merge-on-`seq` (handles mobile drop-offs).
- **No chat contention** (the multi-user win of per-user Assistants): each user talks to **their own** Assistant, so N users → N parallel, independent chat threads — no serialization, no one user's turn blocking another's. Each Assistant's context holds only that user's conversation, so it fills slower.
- **Consistency without shared chat:** Assistants never share conversation history — the **DB (via the Conductor) is the source of truth**. They read shared state through verbs (`get_ticket`, `list_tickets`, …) and propose; the Conductor reconciles (e.g. optimistic concurrency on a ticket if two users act at once). So independent sessions stay consistent because they all read/write the same DB, not each other.
- The **deterministic fast-path** answers most status/cost/"where is X" questions straight from the DB with **no LLM turn at all**.

---

## 6. Concurrency & cost control (one subscription)

- **The real limit is concurrent *active turns*, not open sessions.** Idle/suspended PTYs cost almost nothing (host RAM aside); what hits the subscription quota and rate limits is sessions *generating at the same time*. So many open Assistants are fine; the cap governs simultaneous generation.
- **Hard cap** `MAX_CONCURRENT_ACTIVE` (default ~4, tunable toward the practical ceiling). When more turns want to run than the cap allows, the excess **queues** (Redis FIFO). A worker shows `idle`+"queued" until a slot frees; a user's chat turn waits briefly behind the cap.
- **Suspend idle Assistants** on disconnect / idle TTL (resume on return) so open-but-idle users don't consume slots.
- **Warm vs cold.** Worker containers can be pre-warmed at ticket-activation so only the `claude` start is on the critical path. Assistants resume (warm-ish) on reconnect.
- **Rate-limit → `stopped`.** On sustained throttling/quota exhaustion (repeated retries / an explicit limit message in the stream), the orchestrator sets the affected session to `stopped` (mapped to `stuck`, note "rate limit — subscription quota"), pauses new spawns, notifies, and optionally auto-resumes after backoff. This is the engine-level "update: stopped, reason: …".
- **Long sessions stay lean via the token-budget self-handoff** (06) rather than growing unbounded.
- **Budget** (`SpendRecord`/`WorkspaceBudget`, B-35) is *advisory* on the subscription (the real limit is quota, not dollars). The cap + queue + suspend + self-handoff are the actual levers. **Never headless for throughput** — it meters the Agent-SDK pool (§1).

---

## 7. Cross-platform & stack-agnostic

- **Host OS-agnostic.** Code-stage agents run in **Docker (Linux) containers**; the orchestrator drives the Docker API, so it behaves identically on a **Linux host** and a **Windows host (Docker Desktop / WSL2)**. The prototype's host-shell bridge (PowerShell on Windows via ConPTY) is a *dev* stand-in only; production agents are always containerized. The host's `~/.claude` (subscription auth) is mounted into each container.
- **Stack-agnostic.** One **base image** (git + Claude CLI + common tooling) + a **per-project image/devcontainer** + per-stage `StageProcess` commands. A **C#/.NET** project uses a .NET-SDK image and `dotnet build`/`dotnet test`; a Go/Kafka/raw-MySQL project configures its own commands/integrations. The whole Pipeline config is generic (commands, network, integrations, model) — never Node/Prisma-specific. RAG/skills index files by path + commit-hash, language-independent.

---

## 8. Security & dev-gating (browser→shell→spawn = an RCE surface)

Inherit the terminal module's posture and extend it:
- **Host-shell paths stay dev-gated** (`NODE_ENV!=='production' || WORKSPACE_AI_ENABLED==='1'`). Production workers run **only** in containers (egress-allow-listed, resource-limited).
- **SSH-key challenge** on the agent/PTY namespace before any `ws-ai:chat`/`control`/`attach` (the existing nonce + `crypto.verify` against the stored public key; identity maps key→user). Framework socket auth covers the connection; this adds the per-session capability gate. The Assistant's `userId` comes from this identity.
- **RBAC server-side on every mutating action** (promote, accept config-change, kill). The LLM proposing is irrelevant — the Conductor checks the *caller's* role (matrix in 02 §7 / spec §RBAC). A Member cannot edit pipeline/config.
- **The structured channel is the only write path and is tightly scoped** — per-session token (a worker can't act on another ticket) + per-stage `permissions.allow`. Assistants have no write verbs at all.
- **No user-supplied command reaches `pty.spawn`** — the orchestrator renders the fixed `claude` invocation + flags from validated config; the browser can *request* a spawn (`ws-ai:control`) but never choose binary/args/cwd.
- **Secrets at spawn, not baked in** — short-lived scoped tokens injected into the container at start; never raw long-lived creds in the image or `.claude` env. Egress limited by the stage's network allow-list. Threat model is **trusted small-group, self-hosted** (B-26) — reasonable container hygiene (CPU/mem/PID limits), not gVisor-class isolation.
