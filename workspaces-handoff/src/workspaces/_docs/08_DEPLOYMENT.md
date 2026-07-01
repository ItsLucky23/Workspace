# 08 — Deployment & run model (how the app itself runs)

> Where every other build-doc describes what the system *does*, this one describes how the **two systems are deployed and kept alive**: the horizontally-scaled **web-app** tier and the **single-instance orchestrator** that is the agent-execution **SPOF**. It is the operational counterpart to [01 §2] (two-system topology) and [07 §overview] (single-instance pin). Prereq: [01](./01_ARCHITECTURE.md), [07](./07_ORCHESTRATOR.md), [SETUP](./SETUP_AND_PREREQUISITES.md). Carries **Q-INF-DEPLOY** (this file is its deliverable) and the boot-lease half of **Q-CT-RESUME**. Cites [REFERENCE_CODES → B-01/G8/G16/B-11/B-31] and the locked container decisions in [REVIEW §Container deep-dive]. **No new verbs** — deployment is pure process/infra topology; it spawns and supervises the same surfaces already specified, never a new protocol surface.
>
> **One-line model:** the web-app is **N stateless replicas behind the `app.` Caddy pool**; the orchestrator is **exactly one supervised process** that takes `lease:orchestrator` on boot and runs `resumeAll()`. Last updated: 2026-06-04.

---

## 0. The split, restated for ops (B-01)

[01 §2] defines two systems with opposite scaling postures. Deployment must keep them physically distinct — a single conflated process would silently break both the horizontal-scale story and the single-writer guarantee.

| System | Process count | State | Scaling lever | Edge route |
|---|---|---|---|---|
| **Web-app** (LuckyStack server) | **N replicas** (≥2 for HA) | stateless (truth in Mongo + Redis; Redis socket adapter for fan-out) | add replicas behind the LB pool | `app.<domain>` (LB pool) [07 §B] |
| **Orchestrator** | **exactly 1 active** (lease-guarded) | host-bound: Docker containers, git worktrees, ~20 node-pty handles, the serial indexer/reconcile worker, cron tick | vertical (bigger host) + the CapacityManager admission gate [REVIEW §7] | `term.<domain>` (single-upstream, never LB) [07 §B, G16] |

The two **must not** be the same process and the orchestrator **must not** be load-balanced ([07 §single-instance], G16). Containerized agents are a *third* runtime class the orchestrator manages but does not itself run inside the web-app — see [REVIEW §Container deep-dive], not repeated here.

> **Containerized-orchestrator note (Q-NET-DOCKER).** The orchestrator itself runs **as a container on the shared `workspaces-net` bridge** so Caddy can dial ticket containers by DNS name on Docker Desktop/WSL2 (the host-process variant can't reach the bridge subnet). For ops purposes that container is still the *single supervised process* of this doc — `restart: unless-stopped` is its supervisor (§3). A bare host process behind systemd is the documented fallback only.

---

## 1. Web-app tier — run model

**Process manager.** Each replica is the standard `createLuckyStackServer` boot ([@luckystack/server]) run under a real process manager — **systemd unit per replica**, or one **container per replica** under `restart: unless-stopped` / an orchestrating scheduler. **Do NOT use devkit's dev-only supervisor** ([REVIEW anti-rec]; it is a hot-reload watcher, not a crash-restart supervisor). Nothing host-bound lives here, so a replica is fungible: kill it, the LB drops it, a new one rejoins.

**Replica count.** `N ≥ 2` for availability; scale on connection/CPU. Stateless + the **Redis socket adapter** (`attachSocketRedisAdapter`, already wired) means a `workspace-<wsId>` room broadcast fans out across all replicas regardless of which one a given client is pinned to. Presence (`presence:ticket:<id>` set, G13) and the event-log (`TicketEvent` + Redis-`INCR` `seq`, G2) are the shared truth; no replica owns session state.

**Health endpoints.** LuckyStack's `http.{healthEndpoint, liveEndpoint, readyEndpoint}` config keys back three probes the LB and the process manager consume:

| Probe | Purpose | Caddy/LB use |
|---|---|---|
| `/healthz` (liveness) | process is up and the event loop is responsive | restart-on-fail (process manager) |
| `/readyz` (readiness) | Mongo + Redis reachable, runtime maps registered (`verifyBootstrap`) | **gate membership in the `app.` pool** — a replica is added only when `/readyz` → 200 |
| `/livez` / boot-UUID | `readBootUuid` cross-check (router handshake) | drift detection across replicas/envs |

A replica failing `/readyz` is pulled from the pool but **not** killed (it may be mid-boot); a replica failing `/healthz` is restarted by its process manager. The `app.` route in [07 §B] is the **only** LB pool — `term.`/`dev-` are single-upstream by construction (G16).

**Caddy `app.` pool.** Caddy fronts the replicas as an upstream pool with active health-checking against `/readyz`; ACME DNS-01 wildcard TLS (`Q-NET-TLS`) terminates here. Adding/removing a replica = updating the pool's upstream list via the Caddy admin API; this is **static at boot** for `app.` (unlike the per-ticket `dev-` routes the orchestrator POSTs dynamically, [07 §B]).

**Web-app checklist — correct when:**
- [ ] Each replica runs under a crash-restart process manager (systemd/container), **not** devkit's dev supervisor.
- [ ] `N ≥ 2`; the Redis adapter is attached so room fan-out spans replicas.
- [ ] `/readyz` gates `app.` pool membership; `/healthz` gates process restart.
- [ ] No host-bound state in the web-app (no PTY handles, no Docker calls, no worktrees) — all of that is the orchestrator's.

---

## 2. Orchestrator — the single supervised process

The orchestrator is **exactly one active process** ([07 §single-instance], B-01). Its single-instance-ness is enforced two ways that must **both** hold: a **supervisor** keeps one running, and the **Redis lease** guarantees that even during a botched failover only one *acts*.

### 2.1 Supervision

Run it as **one** of:
1. **`restart: unless-stopped` container** on `workspaces-net` (the canonical form, Q-NET-DOCKER) — the container runtime is the supervisor; or
2. **a systemd unit** (`Restart=always`, `RestartSec`, a `WatchdogSec` sd_notify liveness ping) — the host-process fallback.

Either way it is **one** unit, never a replica set, never devkit's dev supervisor. On crash the supervisor restarts it; the boot sequence (§2.2) re-establishes ownership and rehydrates sessions.

### 2.2 Boot sequence (ordered, lease-first)

On every (re)start the orchestrator runs a fixed boot sequence. The lease is taken **before** any host-bound work so a slow-dying predecessor can't double-own child handles:

1. **Connect** Mongo + Redis; register clients/tiers (`getPrismaClientFor`, G9) and the Redis key formatter (`registerRedisKeyFormatter`, G24).
2. **Acquire the lease** — `acquireLease('orchestrator', ttlMs)` ([REFERENCE_CODES → G8/G16]; `packages/core/src/lease.ts`, `SET NX PX`, owner-token returned). **If `null` (another holder), do NOT proceed** — back off and retry; only the lease-holder owns child handles. The app-level **renew loop** (`renewLease` on an interval well inside the TTL) and **release on graceful shutdown** (`releaseLease`) are app code — the lease is only the primitive (see the `lease.ts` scope note: a stalled event loop past the TTL loses the lease, so size TTL ≫ the longest plausible GC/IO pause and renew at ≤ TTL/3).
3. **Boot-time Caddy ↔ state reconcile** (under the lease, Q-NET-CADDY): diff live Caddy `@id route-dev-<ticketId>` routes against persisted active tickets; add missing, prune orphaned (so a crash mid-launch/teardown self-heals).
4. **`resumeAll()`** ([01 §4], [07 §A]): read `AgentSession` rows in `{running, busy, needs-input}`; for each, re-attach to its surviving container via the persisted `containerId` + `worktreePath` (Q-CT-RESUME; containers are `--restart unless-stopped`, so they outlive the orchestrator) and reconnect the in-container **pty-agent** over the `/pty` namespace (B-31). The orchestrator ring-buffer is a **cache rebuilt by replay** on reconnect — not durable state — so a crash loses no scrollback ([REVIEW §8]). Assistants whose user is offline stay suspended (`--resume` on reconnect).
5. **Start the leased workers**: the serial reconcile/indexer worker (`concurrency:1`, G1) and the cron tick — all under the same `lease:orchestrator` so they never run twice ([07 §C/§D]).
6. **Start the CapacityManager** admission gate (`MAX_RESIDENT` + RAM watermark, [REVIEW §7]) and the SessionManager watchdog ([01 §4]).

```ts
// Orchestrator boot — lease-first, then reconcile + resume. App code; the lease is the primitive.
async function bootOrchestrator() {
  await connectStores();                                  // Mongo + Redis + tiered clients (G9/G24)
  const token = await acquireLease('orchestrator', LEASE_TTL_MS);   // G8/G16
  if (!token) { await sleep(backoff); return bootOrchestrator(); }  // another holder — never double-own
  startRenewLoop('orchestrator', token, LEASE_TTL_MS);    // renew at <= TTL/3 (app code, not in lease.ts)
  await reconcileCaddyRoutes();                           // boot Caddy <-> state diff (Q-NET-CADDY)
  await sessionManager.resumeAll();                       // re-attach surviving containers + pty-agents (B-31)
  startSerialWorker();                                    // indexer/reconcile, concurrency:1 (G1)
  startCronTick();                                        // leased cron
  capacityManager.start();                                // admission gate (REVIEW §7)
  watchdog.start();                                       // heartbeat/idle/stuck + token-budget (01 §4)
  process.on('SIGTERM', async () => {                     // graceful: stop accepting, drain, release
    capacityManager.stop(); await drainActiveTurns();
    await releaseLease('orchestrator', token);            // hand off cleanly so the next boot acquires fast
  });
}
```

**Graceful shutdown.** On `SIGTERM`: stop admitting new turns, let in-flight turns drain (or suspend them — `claudeSessionId` is retained for `--resume`), then `releaseLease` so the restarted process acquires immediately instead of waiting out the TTL. Containers and worktrees are **left running** (`--restart unless-stopped`) — teardown happens only on explicit ticket done ([07 §A]), so `resumeAll()` on the next boot finds them.

**Orchestrator checklist — correct when:**
- [ ] Exactly one supervised unit (`unless-stopped` container or systemd `Restart=always`); never a replica set, never devkit's supervisor.
- [ ] `acquireLease('orchestrator', …)` runs **before** any container/worktree/pty work; `null` → back off, never proceed.
- [ ] A renew loop holds the lease (app code); graceful shutdown releases it.
- [ ] Boot order is lease → Caddy reconcile → `resumeAll()` → leased workers/cron → CapacityManager/watchdog.
- [ ] `resumeAll()` re-attaches surviving containers via persisted `containerId`+`worktreePath` (Q-CT-RESUME); the ring-buffer is a rebuilt cache, not durable state.

---

## 3. Boot-order / health dependency graph

Deployment has a hard ordering: stores first, then the edge, then the two tiers. The orchestrator's `resumeAll()` depends on surviving containers, which depend on Docker + `workspaces-net`.

```
[1] Stores ─────────────────────────────────────────────
      MongoDB (Atlas Local, $vectorSearch, G10) │ Redis (lease + adapter + seq)
                         │
                         ▼
[2] Docker + workspaces-net bridge  ──  host forward-proxy (egress allow-list, Q-CT-EGRESS)
                         │
                         ▼
[3] Caddy edge  (ACME DNS-01 wildcard TLS, Q-NET-TLS)
        ├── app.<domain>   → (waits for web-app /readyz)         [LB pool]
        ├── term.<domain>  → orchestrator (single-upstream, G16)
        └── dev-<id>.<domain> → ticket containers (POSTed at runtime, [07 §B])
                         │
            ┌────────────┴─────────────┐
            ▼                          ▼
[4a] Web-app replicas (N)      [4b] Orchestrator (1, leased)
     stateless, /readyz             acquireLease → reconcile → resumeAll
     join app. pool on 200          re-attaches [5] containers + pty-agents (B-31)
                                          │
                                          ▼
                                   [5] Ticket containers (--restart unless-stopped)
                                       survive an orchestrator restart
```

**Dependency rules:**
- **Stores before everything.** No lease, no `seq`, no `$vectorSearch` without Mongo+Redis. The web-app `/readyz` and the orchestrator boot both block on store reachability.
- **Docker + bridge + proxy before the orchestrator** — it dials the Docker API and joins `workspaces-net`; ticket containers route egress only through the host forward-proxy (Q-CT-EGRESS).
- **Caddy before client traffic**, but Caddy tolerates absent upstreams (health-checks the `app.` pool; `dev-` routes are added/removed at runtime). Caddy starting before the tiers is fine.
- **The two tiers are mutually independent at boot** — the web-app does not depend on the orchestrator to come up, and vice-versa. But **agent execution depends entirely on the orchestrator** (§4).
- **Containers [5] outlive the orchestrator [4b]** by design — that is what makes a fast `resumeAll()` possible.

---

## 4. SPOF statement (explicit) + the multi-instance lease story

### 4.1 The orchestrator is the agent-execution SPOF

**State it plainly:** the orchestrator is a **single point of failure for agent execution.** While it is down:

- **No new turns run** and **no stage promotions, carry-over writes, signal consumption, board reconciles, or RAG deltas happen** — the Conductor (the only writer, [01 §3.3]) lives inside it.
- **But the blast radius is bounded:**
  - **The web-app stays fully up** — board, chat history, event-log views, presence, config CRUD all serve from Mongo/Redis with no orchestrator dependency. Users see a live board; only *new agent activity* stalls.
  - **Running containers + their pty-agents survive** (`--restart unless-stopped`, B-31). Terminal scrollback is durable in the in-container pty-agent; the browser view reseeds on `resumeAll()` reconnect. A user mid-terminal loses only the relay, not the session.
  - **Truth is append-only** (`TicketEvent`/`WorkspaceSignal`/`RagEntry`), so nothing in-flight is corrupted by a crash — the next boot's `resumeAll()` + signal-loop simply pick up where the durable log left off.
- **Recovery = supervisor restart + the §2.2 boot sequence.** Target: the supervisor restarts within seconds; `resumeAll()` re-attaches (it does not re-launch from scratch — containers are alive), so the recovery cost is reconnect + ring-buffer replay, not re-provisioning.

This SPOF is a **deliberate, accepted v1 constraint** ([01 §2] host-bound state; B-26 trusted small-group, self-hosted). It is the price of the subscription-PTY engine ([01 §1]) — host-bound node-pty handles cannot be made stateless. Mitigations are operational, not architectural: a fast supervisor, a short lease TTL with a clean release-on-shutdown (so restart acquires immediately), and `resumeAll()` re-attach rather than re-launch.

### 4.2 What the lease already buys (today)

The lease is **not** there to give HA — it gives **safe single-ownership** ([REFERENCE_CODES → G8/G16], shipped in `packages/core/src/lease.ts`). Its job is to make a *botched failover* safe: if a dying orchestrator and its replacement briefly overlap, only the lease-holder owns child handles, so you never get two processes double-driving the same containers/worktrees/cron. That property holds **now**, in the single-instance deployment, and is the boot-step-2 guard of §2.2.

### 4.3 Multi-instance (warm-standby) — P4, documented only

True HA for the orchestrator is **P4 hardening** ([05 P4]; `acquireLease('ws-engine:<wsId>')` is listed there as the multi-instance lever) and is **not built in v1**. The eventual shape, sketched so the lease usage above is forward-compatible:

- **Warm-standby, not active-active.** A standby orchestrator runs the same image, blocks on `acquireLease('orchestrator', …)` returning `null`, and **waits**. When the active holder dies (lease TTL expires or it releases on shutdown), the standby acquires and runs the §2.2 boot sequence — including `resumeAll()`, which re-attaches the *surviving* containers the dead instance left running. This is **failover**, not load-sharing — there is still exactly **one active writer** at any instant (the lease guarantees it).
- **Per-workspace sharding** (the `ws-engine:<wsId>` lease, a separate lease per workspace) is the further P4 step: distinct orchestrators each own a *disjoint* set of workspaces, each its own single-writer. This raises aggregate ceiling without ever sharing a workspace's host state — still no active-active within a workspace.
- **Why not active-active in v1:** node-pty handles, the Docker child-process table, and the serial indexer are host-bound, non-shareable state; sharing them would require fencing every host-side mutation, which the trusted-small-group threat model (B-26) does not justify. The lease + warm-standby gives the achievable win (bounded downtime) without that cost.

> **Forward-compat constraint already satisfied:** every host-bound writer in §2.2 (`resumeAll`, the serial worker, the cron tick, the Caddy reconcile) already runs *inside* the lease, so promoting a standby is a deployment change (run a 2nd unit), **not** a code change. P4 adds the warm-standby supervision + per-workspace lease sharding; the boot sequence is unchanged.

**SPOF/HA checklist — correct when:**
- [ ] The SPOF is stated explicitly and its blast radius (web-app survives, containers survive, truth is append-only) is documented.
- [ ] The lease's v1 job (safe single-ownership during failover overlap), distinct from HA, is clear.
- [ ] Multi-instance is documented as **P4 warm-standby + per-workspace sharding**, never active-active within a workspace; the lease usage in §2.2 is already forward-compatible.

---

## 5. Cross-doc seams (where deployment meets the rest)

| Seam | Owned by | This doc's role |
|---|---|---|
| Single-instance lease, child-handle ownership | [07 §single-instance], G8/G16 | the **boot-order** that takes the lease before any child work (§2.2) |
| Per-ticket launch/teardown, Caddy `dev-` routes | [07 §A/§B] | the **boot Caddy↔state reconcile** + `resumeAll()` that re-attach after a restart (§2.2/§3) |
| Container hardening, egress proxy, CapacityManager | [REVIEW §6/§7] | the **dependency ordering** (Docker+proxy before orchestrator) + admission-gate start (§3) |
| Observability (metrics: active/queued turns, lease state, indexer lag, watchdog fires) | Q-INF-OBSERVABILITY (own section) | named as a §2.2 boot consumer; the metric set itself lives there, not here |
| Backup/DR (mongodump, Redis RDB/AOF, event-log restore-priority-1) | Q-INF-DR (SETUP §DR) | referenced as the store-layer recovery this doc's boot sequence depends on |
| Fresh-repo bring-up, first-run bootstrapping | Q-INF-MIGRATION (MIGRATION.md) | this doc assumes a built+installed app; first-install steps live in MIGRATION/SETUP |

**No new verbs.** Every surface here — replicas, the supervised orchestrator, the lease, `resumeAll`, Caddy pools — is process/infra topology. The structured-channel verb surface ([02 §2]) and the `[control-API]` write path ([REFERENCE_CODES §4]) are untouched; deployment hosts them, it does not extend them.
