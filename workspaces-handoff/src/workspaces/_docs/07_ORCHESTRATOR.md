# 07 — Orchestrator runtime mechanics (launch/teardown · Caddy · webhook ingest · RAG delta-indexer)

> The single-instance **engine** every feature sits on. Architecture-layer companion to [01](./01_ARCHITECTURE.md): where 01 names the *two-system topology* and the *three roles*, this doc spells out the **deterministic runtime mechanics the Conductor drives** — the per-ticket launch/teardown sequence, the Caddy subdomain proxy, the GitLab-webhook ingest + board sync, and the RAG delta-indexer + vector store. Feature docs cite these as `[07 §A]`…`[07 §D]`. Prereq: [01](./01_ARCHITECTURE.md), [02](./02_PROTOCOL_AND_FLOW.md), [SETUP](./SETUP_AND_PREREQUISITES.md). Last updated: 2026-06-04.

---

## Overview — what the orchestrator is

The **orchestrator** is the single-instance Node service of the two-system split ([01 §2], spec B-01): the web-app scales horizontally (stateless + Redis adapter), the orchestrator stays **one process** because it owns host-bound mutable state (Docker containers, git worktrees, ~20 live node-pty sessions, the serial indexer). It is the body the **Conductor** ([01 §3.3]) lives in — the Conductor is the deterministic brain (state machine, the only writer of board/git/status), and the orchestrator is the set of runtime mechanics it drives.

- **Prototype:** stubbed **in-process** in the LuckyStack server as a dev-gated module (mirroring `server/hooks/workspacesTerminal.ts`), so the PoC needs no second service ([01 §2], SETUP §1 TL;DR).
- **Real repo:** a **separate single-instance Node service** importing `@luckystack/core` for `tryCatch`/logger/Redis; runs apart from the scaled web-app (spec B-01; SETUP §9).
- **Single-instance pin** is the load-bearing constraint behind every section here: a **Redis lease** (`registerLeaderElection`/R5 helper, SETNX-style) guards the writer side so child-process handles, the indexer worker, and the cron tick never run twice ([01 §2], gaps G8/G16).

**This doc is NOT a feature doc.** No Scope/User-flow/UI skeleton — it is the runtime layer the feature docs cite. Each section is *overview → mechanics → pseudocode → checklist*.

The four mechanics, and who they pair with:

| § | Mechanic | Drives | Feature docs that cite it |
|---|---|---|---|
| **A** | Ticket launch & teardown sequence | session lifecycle ([01 §4]), the state machine ([02 §1]) | `features/03` (build phase), `features/01` (setup), `features/05` (per-session info) |
| **B** | Caddy subdomain proxy | `app.`/`term.`/`dev-<ticketId>.` routing | `features/04` (terminals), `features/08`/preview (`dev-` subdomain) |
| **C** | GitLab-webhook ingest + board sync | board = view on GitLab (B-29) | the future `features/22` (board sync) |
| **D** | RAG delta-indexer + vector store | the RAG skill, frozen-per-commit context | `features/05` (per-session info), SETUP §3 |

---

## A — Ticket launch & teardown sequence

**Overview.** Activating a ticket (or promoting it into an `aiEnabled` stage, [02 §1]) runs a fixed **7-step lifecycle** that ends in a live Stage-Agent PTY; tearing it down keeps the GitLab branch + `TicketEvent` audit and discards the container. This is the deterministic body behind `SessionManager.spawnWorker(...)` ([01 §4]) for *code* roles. The whole sequence runs **under the single-instance Redis lease** (G8/G16) — only the leader owns the child-process handles. It is **cross-platform**: the orchestrator drives the Docker API, so Linux hosts and Windows hosts (Docker Desktop / WSL2) behave identically; the host's `~/.claude` (subscription auth) is mounted into each container ([01 §7], SETUP §1).

**The 7 steps** (spec DATAMODEL §5 container/git lifecycle; IDEE_SPEC §6 infra-per-ticket):

1. **Activate** — Conductor flips `(stage, idle)→(stage, busy)` ([02 §1]); acquires the per-ticket work claim.
2. **`git pull origin <default>`** in the project mirror — get current HEAD.
3. **Capture `commitHash`** — HEAD of the default branch. This is the **frozen** snapshot baseline (DH5): if `main` advances while the ticket is open, the ticket stays on this hash until re-activation. It binds both the worktree code state and the RAG snapshot.
4. **RAG snapshot — reuse-or-index** (§D): does a snapshot exist for `commitHash`? → **link** it; else **index it + stamp** (`RagEntry` rows carry `commitHash`). Two tickets on the same morning commit share one snapshot (spec §5.3, B-25).
5. **`git worktree add` on branch `DEV-####`** — the ticket-prefix names the branch/worktree; the RAG version hangs off the *commit-hash*, not the prefix.
6. **Container start** — from **one base image** ([01 §7], B-12), then **render the stage's `.claude/settings.json` + `.mcp.json` + `CLAUDE.md` from `PipelineStageCfg`** (permissions/commands → `settings.json` allow/ask/deny; skills → `.mcp.json` MCP servers; instructions/visibility → `CLAUDE.md`; per `CLAUDE_SETTINGS_MAP.md` §2), and run the ordered **`StageProcess`** commands (DEV = Vite :5173 + backend :80, gap G14). Env injected at boot: `DNS=https://dev-<ticket>.<domain>`, `DATABASE_URL`, `REDIS_*`, `NODE_ENV=development` (gap G15, §B).
7. **Pty-agent attaches the `claude` PTY** — the per-container pty-agent (B-31) starts interactive `claude` in the worktree with the rendered settings; the orchestrator proxies the `/pty` namespace. A scrollback ring-buffer survives orchestrator restart ([01 §4] resume, B-31). The agent then **works → opens an MR**.

Then the back half (continuous, not part of spawn): **merge webhook** (§C) → **delta-indexer** (§D) → **teardown**: container removed; **branch + `TicketEvent` retained** (spec §9.4 "wat blijft/wegwerp"). Re-activation re-runs steps 1–7 on the existing branch.

```ts
// SessionManager.spawnWorker for a code role — under the single-instance lease (G8/G16).
async function launchTicketStage(ticketId, stageId, carryOver) {
  await withLease(`lease:orchestrator`, async () => {       // R5 leader lease — leader owns child handles
    conductor.setStatus(ticketId, stageId, 'busy');          // 1. activate (Conductor = only writer, [01 §3.3])
    await git.pull(projectMirror, defaultBranch);            // 2. pull
    const commitHash = await git.revParse('HEAD');           // 3. freeze baseline (DH5)

    const snapshot = await rag.findSnapshot(commitHash)      // 4. reuse-or-index (§D)
      ?? await rag.indexSnapshot({ projectId, commitHash });

    const wt = await git.worktreeAdd(`DEV-${ticket.prefix}`, commitHash);  // 5. worktree on DEV-#### branch

    const cfg = await loadStageCfg(stageId);
    const container = await docker.run(BASE_IMAGE, {         // 6. one base image (B-12)
      env: { DNS: `https://dev-${ticketId}.${DOMAIN}`, DATABASE_URL, REDIS_HOST, NODE_ENV: 'development' }, // G15
      mounts: [hostClaudeAuthMount],                         // ~/.claude → subscription auth ([01 §7])
      limits: { cpu, mem, pids },                            // trusted-group hygiene (B-26)
    });
    renderClaudeConfig(container, cfg);   // .claude/settings.json + .mcp.json + CLAUDE.md (CLAUDE_SETTINGS_MAP §2)
    await caddy.addRoute(`dev-${ticketId}.${DOMAIN}`, container.viteAddr); // §B — Vite :5173, not backend (G14)
    for (const p of cfg.processes) await container.exec(p.commands);       // StageProcess (ordered terminals)

    const pty = await ptyAgent.attach(container, {           // 7. interactive claude PTY (B-31)
      cmd: 'claude', cwd: wt.path, snapshot, carryOver });   // NEVER claude -p / Agent-SDK ([01 §1])
    sessionManager.register(`worker:${ticketId}:${stageId}`, { pty, ringBuffer: [], status: 'starting' });
  });
}

async function teardownTicketStage(ticketId, stageId) {
  await withLease(`lease:orchestrator`, async () => {
    await ptyAgent.kill(`worker:${ticketId}:${stageId}`);    // pty only on explicit done/teardown (G5)
    await caddy.deleteRoute(`dev-${ticketId}.${DOMAIN}`);    // §B
    await docker.remove(container);                          // container = disposable
    // branch + TicketEvent retained (audit, spec §9.4); re-activate = re-run 1–7 on the branch
  });
}
```

**Checklist — A is correct when:**
- [ ] The whole launch + teardown runs inside the **Redis lease** — no second instance ever owns a child handle (G8/G16).
- [ ] `commitHash` is captured **at worktree creation** and frozen for the ticket's life (DH5); RAG + code share it.
- [ ] Step 4 **reuses** an existing snapshot for the same `commitHash` rather than re-indexing (B-25).
- [ ] The PTY is **interactive `claude`** on the mounted subscription auth — never `claude -p`/Agent-SDK ([01 §1]).
- [ ] `.claude/settings.json` + `.mcp.json` + `CLAUDE.md` are rendered from `PipelineStageCfg`, not hand-edited (CLAUDE_SETTINGS_MAP §2).
- [ ] DEV proxy points at **Vite :5173**, env carries the real `dev-` subdomain `DNS` (G14/G15).
- [ ] Teardown **retains** the branch + `TicketEvent`; only the container is disposable.
- [ ] Identical behavior on Linux and Windows/WSL2 (Docker API driven, [01 §7]).

---

## B — Caddy subdomain proxy

**Overview.** One TLS-terminating **Caddy** edge fronts three upstream classes (B-11, gap G3); `@luckystack/router` is the wrong tool (path-segment routing, no TLS, static bindings). The orchestrator drives Caddy's **admin API** — **POST a route on container start, DELETE it on teardown** — so the route lifecycle is explicit and auditable in the event-log. Wildcard **on-demand TLS** covers `*.<domain>`.

| Subdomain | Upstream | When |
|---|---|---|
| `app.<domain>` | web-app (scaled LuckyStack server) | static (boot) |
| `term.<domain>` | orchestrator (terminals + control API) | static (boot) |
| `dev-<ticketId>.<domain>` | **the ticket container's Vite :5173** (G14) | per-container: POST on start, DELETE on teardown |

**The DEV 2-port model (G14).** A LuckyStack project runs two processes in DEV: **Vite** (`vite --host`, fixed **:5173**, browser-facing) proxies `/api`,`/sync`,`/auth`,`/uploads`,`/socket.io`(ws) + health to the **Node backend** (`:80`). The edge MUST target **Vite :5173**, not the backend — proxying the backend breaks HMR (`/@vite/client`) + the socket.io handshake. A build-only preview stage uses PROD-mode (one port).

**Boot-time env injection (G15).** A container's app derives `backendUrl`, CORS `allowedOrigins`, OAuth callbacks, and email links from `DNS`. So at container boot (§A step 6) the orchestrator injects `DNS=https://dev-<ticketId>.<domain>` (+ extra origins as needed) alongside `DATABASE_URL`/`REDIS_*` — otherwise CORS is fail-closed (403 on state-changing POST) and OAuth/email links point at the wrong host.

```ts
// On container start (§A step 6): register the per-ticket route via the Caddy admin API.
await fetch(`${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`, {
  method: 'POST',
  body: JSON.stringify({
    match: [{ host: [`dev-${ticketId}.${DOMAIN}`] }],
    handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `${container.ip}:5173` }] }], // Vite, not :80 (G14)
  }),
});
// On teardown (§A): DELETE the route by id — symmetric, auditable in the event-log.
await fetch(`${CADDY_ADMIN}/id/route-dev-${ticketId}`, { method: 'DELETE' });
```

Used by `features/04` (browser terminals reach `term.<domain>`) and the preview/`08`-area (`dev-<ticketId>.<domain>` live app).

**Checklist — B is correct when:**
- [ ] Edge is **Caddy** (admin-API routes + wildcard on-demand TLS), not `@luckystack/router` (G3).
- [ ] Per-ticket route is **POSTed on start, DELETEd on teardown** — both land as event-log entries.
- [ ] `dev-<ticketId>` upstream is the container's **Vite :5173** (G14).
- [ ] Container boot env sets the real `DNS=https://dev-<ticketId>.<domain>` so CORS/OAuth don't fail-close (G15).
- [ ] Terminal WebSockets route **directly** to the single-instance orchestrator (`term.<domain>`), never load-balanced (G16).

---

## C — GitLab-webhook ingest + board sync mechanism

**Overview.** A GitLab merge (and issue/board change) reaches the orchestrator as a webhook, which **enqueues a serial reconcile/delta job**. GitLab is the **source of truth** (B-29): on conflict, GitLab wins; the board is a projection. A reconcile **cron heals missed webhooks**.

**The endpoint.** A `registerCustomRoute` in the **`pre-params` phase, origin-exempt** (R1 webhook seam). Two sharp edges, both resolved:
- **Origin-403 (G6):** fail-closed origin enforcement would 403 a server-to-server POST (no Origin/Referer). The `pre-params`/origin-exempt seam lets the registered webhook path bypass it (the edge proxy may also inject an allowed Origin).
- **Body already consumed / HMAC impossible (G7):** `getParams` drains + content-type-gates the body before custom routes run. So **verify the plaintext `X-Gitlab-Token` header — NOT a body-HMAC.** GitLab's webhook auth *is* that header, so this is sufficient (other providers' body-HMAC would be blocked).

**The enqueue.** The handler does the cheap, synchronous work only — **verify the token, then push one job** onto the serial reconcile/delta queue (bullmq, §D shares the lease) — and returns 200 fast. All heavy work (board reconcile, RAG delta) happens in the **single serial worker** (concurrency:1 under the Redis lease, G1).

```ts
// registerCustomRoute({ phase: 'pre-params', originExempt: true, path: '/hooks/gitlab' }, handler)
async function gitlabWebhook(req, res) {
  if (req.headers['x-gitlab-token'] !== WS_GITLAB_HOOK_SECRET)  // header secret, NOT body-HMAC (G6/G7)
    return res.writeHead(401).end();
  await reconcileQueue.add('gitlab-event', { kind: req.headers['x-gitlab-event'], body: req.parsedBody });
  res.writeHead(200).end();                                     // enqueue + ack fast; worker does the work
}

// Serial worker (concurrency:1, leased — shares §D's worker/lease, G1):
reconcileQueue.process(1, async (job) => {
  await withLease(`lease:orchestrator`, async () => {
    const remote = await gitlab.fetchAuthoritative(job.data);   // GitLab = SoT (B-29)
    conductor.reconcileBoard(remote);                           // conflict → GitLab wins; Conductor is the writer
    if (job.data.kind === 'Merge Request Hook' && merged)
      await ragDeltaQueue.add('delta', { projectId, commitHash: remote.mergeCommit }); // → §D
  });
});

// node-cron heal: periodically re-fetch authoritative state to catch dropped webhooks (B-29).
cron.schedule('*/N * * * *', () => reconcileQueue.add('gitlab-reconcile', { full: true }));
```

Pairs with the future board-sync feature doc (`features/22`). The Conductor is the only writer of the board projection ([01 §3.3]).

**Checklist — C is correct when:**
- [ ] Endpoint is a `registerCustomRoute` in **`pre-params`, origin-exempt** (R1, G6).
- [ ] Auth verifies the **`X-Gitlab-Token` header**, never a body-HMAC (G7).
- [ ] The handler **enqueues + acks fast**; all reconcile/delta work is in the serial worker (G1).
- [ ] Conflict resolution = **GitLab wins** (B-29); only the Conductor writes the board projection.
- [ ] A **reconcile cron** heals missed webhooks (B-29).

---

## D — RAG delta-indexer + vector store

**Overview.** RAG context is **append-only, frozen-per-commit** (spec §5, B-25): each `RagEntry` carries `commitHash`, so a `$vectorSearch` filtered on the ticket's commit-hash is automatically frozen-per-ticket — never updated/deleted. The indexer is **bullmq + node-cron**, **one worker `concurrency:1` under the Redis lease** (G1), so writes are serial and race-free even if the queue is shared. On merge (§C) it does a **per-changed-file delta** with **dependency-aware graph propagation** (B-O3) — not a full re-index.

**Delta mechanics (B-O3).**
- **RAG:** re-chunk + re-embed **only the changed files**' chunks (full re-index per merge is too expensive).
- **Code-graph:** re-parse changed files **+ propagate to their importers** (a changed file affects who imports it).
- **Dedupe** at chunk level on `commitHash + filePath + chunkId` (the `@@unique` in DATAMODEL §3) → re-runs are idempotent.

**Embeddings (B-18/B-32).** A **self-hosted** code-embedding model (nomic-embed / BGE / jina-code) in a container — no code egress, no per-call cost (SETUP §3).

**Vector store (G10/B-24).** `$vectorSearch` needs **MongoDB Atlas Local** in the Docker stack — a vanilla `replicaSet=rs0` does **not** serve it. Query via the injected `functions.db.prisma.ragEntry.aggregateRaw({ pipeline: [{ $vectorSearch: { ..., filter: { commitHash: { $eq: ticketCommit } } } }] })` — the commit-hash filter lives **inside** `$vectorSearch.filter`, so freezing is enforced on the index, not post-filtered. **Fallback** (behind a flag): embeddings as `Float[]` + **cosine in the Node worker** (acceptable to ~10k vectors/snapshot). Raw `aggregateRaw` results are untyped `JsonObject` → **zod-parse** (no `as`-cast), centralized in one `functions/rag.ts` wrapper (gap G23).

```ts
// One worker, concurrency:1, leased (G1). Fed by §C on merge.
ragDeltaQueue.process(1, async (job) => {
  await withLease(`lease:orchestrator`, async () => {
    const { projectId, commitHash, prevCommit } = job.data;
    const changed = await git.diffNames(prevCommit, commitHash);          // per-changed-file delta (B-O3)
    const affected = await codeGraph.importersOf(changed);                // dependency-aware propagation (B-O3)
    for (const file of new Set([...changed, ...affected])) {
      for (const chunk of chunkFile(file)) {
        const id = { commitHash, filePath: file, chunkId: chunk.id };     // dedupe key (DATAMODEL §3)
        if (await rag.exists(id)) continue;                               // idempotent
        const embedding = await selfHostedEmbed(chunk.text);              // self-hosted, no egress (B-18)
        await rag.appendEntry({ ...id, content: chunk.text, embedding }); // append-only — never update/delete
      }
    }
  });
});

// Snapshot reuse-or-index for §A step 4:
async function indexSnapshot({ projectId, commitHash }) { /* full index at the baseline commit, stamped */ }

// Frozen-per-ticket query (the RAG skill / functions.rag.search):
const rows = await functions.db.prisma.ragEntry.aggregateRaw({ pipeline: [
  { $vectorSearch: { index: 'rag', path: 'embedding', queryVector, numCandidates, limit,
                     filter: { commitHash: { $eq: ticketCommit } } } },   // frozen on the index (G10)
  { $project: { content: 1, filePath: 1, _id: 0 } },
] });
return ragRowsSchema.parse(rows);   // zod, no cast (G23)
```

Pairs with `features/05` (per-session info / the RAG skill) and SETUP §3 (Atlas Local + embeddings container). A retention cron (G1) may later drop snapshots older than the oldest active ticket-commit (spec §5 `[OPEN §6.5]`).

**Checklist — D is correct when:**
- [ ] One worker, **`concurrency:1` under the Redis lease** (G1) — serial, race-free.
- [ ] Merge → **per-changed-file delta + importer propagation**, not full re-index (B-O3).
- [ ] Chunk dedupe on **`commitHash + filePath + chunkId`** → idempotent (DATAMODEL §3).
- [ ] Embeddings are **self-hosted** — no code egress, no per-call cost (B-18).
- [ ] `$vectorSearch` runs on **Atlas Local** with the commit-hash filter **inside** `$vectorSearch.filter` (G10/B-24); `Float[]`+cosine fallback behind a flag.
- [ ] Raw results are **zod-parsed**, never cast (G23); store is **append-only** (no update/delete).

---

## Security / single-instance / dev-gating note

Inherits [01 §8] (browser→shell→spawn is an RCE surface) and adds the engine-level posture:
- **Single-instance by lease.** Every writer mechanic here (§A child handles, §C reconcile, §D indexer, the cron tick) runs under the **same Redis lease** (G8/G16). The orchestrator owns mutable host state and **must not** be load-balanced; only the web-app scales. Terminal/control WebSockets route **directly** to it (`term.<domain>`), never through the router.
- **Dev-gating.** Host-shell paths (the prototype's in-process stub) stay dev-gated (`NODE_ENV!=='production' || WORKSPACE_AI_ENABLED==='1'`); production code-stage agents run **only** in containers — egress allow-listed, resource-limited (CPU/mem/PID), trusted-small-group hygiene (B-26), with the host `~/.claude` mounted for subscription auth.
- **Secrets at spawn.** Short-lived scoped tokens injected at container boot (§A step 6); never raw long-lived creds in the image or `.claude` env. The `dev-` route's env carries only what the container needs (§B/G15). Webhook auth is a header secret (§C/G7).

**No new structured-channel verbs — the orchestrator drives sessions + executes Conductor decisions.** The frozen verb surface ([02 §2]) is untouched: workers `report_status`/`emit_event`/`request_input`/`emit_carryover`/`emit_signal`/`emit_handoff`/`query_context`; assistants `get_ticket`/`list_tickets`/`read_pipeline`/`propose_suggestion`/`draft_questionset`/`refresh_docs`. Everything in this doc — launch/teardown, Caddy routes, webhook reconcile, delta-indexing — is the **deterministic orchestrator executing what the Conductor decides** ([01 §3.3]); user levers (move/promote/pause/kill/bulk) are control-API requests the Conductor executes, **never** new verbs. AI proposes → user accepts → Conductor executes (B-23).
