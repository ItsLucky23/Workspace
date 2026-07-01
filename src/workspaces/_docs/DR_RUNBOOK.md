# DR_RUNBOOK — Backup & Disaster-Recovery operator runbook (P4)

> **Phase: P4 (hardening).** This is the operator-facing backup/restore runbook that `B-36` forward-pointed to and that no doc has yet written. It realizes **Q-INF-DR** (recommendation accepted 2026-06-04): mongodump cron, Redis RDB/AOF, the append-only event-log as **restore-priority-1 + replay**, target RPO/RTO, what is acceptably lost, and the ordered restore procedure. Scope is the **single-instance orchestrator + its data tier** ([01 §1], [08_DEPLOYMENT.md]); the horizontally-scaled web-app tier is stateless and recovers by redeploy. Cite this doc as `[DR_RUNBOOK §N]`. Source-read: `SETUP_AND_PREREQUISITES.md` §3/§9, `04b_DATA_MODEL_ADDENDA.md` §11a (append-only set), `REVIEW_AND_OPEN_QUESTIONS.md` Q-INF-DR, `REFERENCE_CODES.md` B-36/B-O6/B-24/G24.
>
> **No new verbs.** Backup and restore are pure infra/operator procedures driven by host cron + the orchestrator boot path ([REFERENCE_CODES → B-01]); nothing here touches the frozen structured-channel surface ([02 §2]: 7 worker + 6 assistant verbs, all read|propose, none write). No restore step is an LLM action; the orchestrator boot reconcile and `resumeAll()` are deterministic Conductor/host code ([REFERENCE_CODES → B-23]).
>
> **P4 task (explicit).** Ship the three backup cron units (§4–§6), the restore drill (§9), and the RPO/RTO board (§3) as one P4 deliverable. Until P4 lands, the system runs **un-backed-up** — acceptable only for the trusted small-group, self-hosted PoC threat model ([REFERENCE_CODES → B-26]); state that limitation loudly in any pre-P4 production-ish deployment.

---

## §1. What this runbook protects (and what it cannot)

The system is two systems ([REFERENCE_CODES → B-01]): a horizontally-scaled **web-app tier** (stateless — redeploy is its recovery) and a **single-instance orchestrator** holding host-bound state (`lease:orchestrator`, containers, worktrees, PTYs — [08_DEPLOYMENT.md], G8/G16 lease). DR is overwhelmingly about the **data tier behind the orchestrator** plus the orchestrator's ability to **re-reconcile** on boot.

| Layer | DR strategy | Recoverable to |
|---|---|---|
| **MongoDB** (tenant data + the append-only event-log) | `mongodump` cron → off-host store; Atlas continuous backup if managed (§4) | last successful dump / Atlas PITR window |
| **Redis** (lease, queue, per-ticket `seq`, presence) | RDB snapshot + AOF (§5) | last AOF fsync (sub-second to 1 s) |
| **Append-only event-log** (`TicketEvent`/`RagEntry`/`WorkspaceSignal`) | **restore-priority-1** — restored first, then replayed (§6) | the dump; gaps are tolerated, not reordered |
| **In-flight container state** (running PTY turn, un-committed worktree edits, un-emitted carry-over) | **NOT backed up — acceptably lost** (§7) | nothing; re-derived by `resumeAll()` + re-run |
| **Web-app tier** | stateless; redeploy from image | immediate |
| **Caddy edge routes** | rebuilt on orchestrator boot reconcile under the Redis lease ([REFERENCE_CODES → B-11], G3) | on boot |

The non-negotiable design fact behind this whole runbook: **Mongo is truth, sync/Redis is a best-effort accelerator** (the CQRS split, G2/G12). The durable, append-only event-log ([04b §11a]) is the spine of recovery — if it survives, the operational history of every ticket is reconstructable even if everything ephemeral is lost.

---

## §2. The append-only set is the recovery spine ([04b §11a])

Six models are **app-enforced append-only** — the app has no update/delete path for them ([04b §11a], [04 §4]); a correction is a new append. They are the DR restore-priority set:

`TicketEvent` · `RagEntry` · `WorkspaceSignal` · `SpendRecord` · `CarryOver` · `Handoff`

Of these, three are **restore-priority-1** (restore first, replay before anything depends on them):

- **`TicketEvent`** ([04b §6]) — the single ordered, immutable, per-ticket fact stream. `seq` is **monotonic per ticket** (allocated by Redis `INCR ws:{workspaceId}:ticket:{ticketId}:evseq` through `registerRedisKeyFormatter`, G24/[04b §6]). `seq` — never `createdAt` — is the merge/dedupe key; gaps are tolerated (a crashed writer may burn a number), **reordering is not**. This is what makes the log replay-safe after a partial restore.
- **`WorkspaceSignal`** ([REFERENCE_CODES → B-O6]) — the durable Mongo signal-transport the Conductor consumes serially (no Redis-stream; survives restart by design). Carries `seq` (monotonic) + `processedAt` ([04b §13]); on restore the Conductor resumes consuming from the lowest un-`processedAt` row.
- **`RagEntry`** — append-only, commit-stamped ([REFERENCE_CODES → B-25]); queried by commit-hash, dedupe on `commitHash+filePath+chunkId` ([REFERENCE_CODES → B-O3]). Lossy-tolerant: a missing `RagEntry` is **re-derivable** by re-indexing the frozen `commitHash` ([REFERENCE_CODES → DH5 commit-hash]), so it restores priority-1 for *fast* recovery but a gap is self-healing, not data-loss.

Why priority-1: the board, notifications, the rewind scrubber, and GitLab projections all *source from* `TicketEvent` (docs 18/20/22/24 via [04b §6]). Restore it first, verify `seq` continuity per ticket, and the rest of the system can rebuild its read-projections from it. The **subscribe-before-fetch** discipline ([04b §6], Q-INF-TESTING) that protects live clients is the same discipline that protects a post-restore client: subscribe to the live channel, fetch the snapshot up to `max(seq)`, merge live events with `seq > snapshotMax`.

---

## §3. Target RPO / RTO

> Targets for the trusted small-group, self-hosted deployment ([REFERENCE_CODES → B-26]). Tune the cron cadence in §4–§6 to hit these; they are operator-set, not framework-enforced.

| Tier | RPO (max data loss) | RTO (max downtime) | How achieved |
|---|---|---|---|
| **MongoDB (tenant data + event-log)** | **≤ 1 h** self-hosted (dump cadence); **≤ minutes** on Atlas continuous backup / PITR | **≤ 30 min** (mongorestore + boot reconcile) | hourly `mongodump` (§4) or Atlas PITR |
| **Redis (lease/queue/seq/presence)** | **≤ 1 s** with AOF `everysec`; **≤ snapshot interval** with RDB-only | **≤ 5 min** (Redis reload + lease re-acquire) | AOF + periodic RDB (§5) |
| **Append-only event-log replay** | bounded by the Mongo RPO above | **≤ 15 min** to verify `seq` continuity + resume signal consumption | priority-1 restore + replay (§6) |
| **In-flight container state** | **RPO = ∞ (acceptably lost)** — see §7 | re-derived on `resumeAll()` (no separate restore) | not backed up |
| **Whole-orchestrator-host loss** | = Mongo + Redis RPO above | **≤ 1 h** (provision host → restore data → boot → `resumeAll()`) | the full §9 procedure |

**Key consequence of the billing model:** because the engine is interactive-PTY-on-subscription ([01 §1], [REFERENCE_CODES → E1/E8]), a lost in-flight turn costs **no metered credits to re-run** — re-running a dropped turn is cheap. This is *why* "acceptably lost in-flight state" (§7) is a sound RPO choice rather than an expensive one.

---

## §4. MongoDB backup — `mongodump` cron (self-hosted) / Atlas (managed)

MongoDB runs with **Atlas Local in the Docker stack** for `$vectorSearch` RAG ([SETUP §3], G10, [REFERENCE_CODES → B-24]); a vanilla replica-set does not serve `$vectorSearch`. Two backup tracks depending on deployment:

### 4a. Self-hosted (Atlas Local in Docker) — `mongodump` cron
- **Cadence:** hourly full `mongodump` (gzip archive) to a host path, then sync to off-host object storage (S3-compatible) immediately. Hourly hits the ≤ 1 h RPO (§3). Daily-only is acceptable only for the pre-P4 PoC.
- **Scope:** dump **all tenant databases**. Tenancy is `workspaceId`-scoped within Mongo via `$extends` ([04b §11b/§11c]); a dump is whole-cluster, restore can be whole-cluster or per-collection (§9). The keyed-client tiers (`mongo:ro`/`mongo:rw`, B-O8/G9) are **app-level** credential isolation — backups use a dedicated **backup user with cluster-wide read**, NOT a tenant `ro` user (a tenant `ro` user only sees its injected where-scope).
- **Command shape** (operator cron, not committed secrets — creds from the tmpfs env-file pattern, [04b §13], Q-SEC-CREDLIFETIME):
  ```
  mongodump --uri "$DATABASE_URL_BACKUP" --gzip \
    --archive=/backups/mongo/ws-$(date +%Y%m%dT%H%M%SZ).archive.gz
  # then: push the archive to off-host object storage, prune local > 48 h
  ```
- **Vector-search indexes are NOT in the dump.** `mongodump` captures collections, not Atlas Search / `$vectorSearch` index definitions. The search indexes are **rebuilt at orchestrator boot** via `createSearchIndexes` (`$runCommandRaw`, [SETUP §3], G10) — they are derived, not backed up. Restore data first; the boot path re-creates the indexes; a re-index of `RagEntry` against the frozen `commitHash` repopulates anything stale ([REFERENCE_CODES → B-O3/B-25]).
- **Retention:** keep ≥ 48 h of hourly archives on the off-host store + daily rollups for ≥ 30 d (aligns with the workspace data-retention posture, [REFERENCE_CODES → B-39]).

### 4b. Managed Atlas — continuous backup / PITR
- Enable **Atlas continuous cloud backup** with point-in-time restore. This subsumes the cron: RPO drops to minutes and PITR lets you roll to just-before an incident. Still verify search-index re-creation post-restore (Atlas restores collections; confirm the search indexes via the boot path or the Atlas UI).
- Keep the §4a `mongodump` as a **secondary, provider-independent** copy (defends against an Atlas-account-level incident).

### 4c. Backup verification (mandatory, both tracks)
A backup that has never been restored is a hope, not a backup. The §9 restore **drill** is a P4 deliverable, not optional: run a quarterly restore into a throwaway environment and assert (a) per-ticket `seq` continuity in `TicketEvent`, (b) `WorkspaceSignal` consumption resumes, (c) the search indexes rebuild.

---

## §5. Redis backup — RDB snapshot + AOF

Redis holds the orchestrator's **volatile coordination state**: the leader-election `lease:orchestrator` (G8/G16, [REFERENCE_CODES → B-01]), the job queue (bullmq, G1), the per-ticket `seq` counters (`INCR`, G2/[04b §6]), and presence sets (`presence:ticket:<id>`, G13). All Redis keys route through `registerRedisKeyFormatter` (G24) for tenant-prefix safety.

**None of Redis is the system of record** — Mongo is (the CQRS truth/accelerator split, G2/G12). Redis loss is therefore *recoverable but disruptive*, and the backup goal is "lose ≤ 1 s and reload fast," not "never lose."

- **AOF (append-only file) with `appendfsync everysec`** — primary durability; bounds Redis RPO to ≤ 1 s. This is the recommended default.
- **RDB snapshot** — periodic point-in-time `.rdb` (e.g. `save 900 1 300 10`), copied off-host alongside the Mongo archives. Faster to load than a large AOF; use as the coarse fallback.
- **What specifically must survive or be safely rebuilt:**
  - **`seq` counters** — the load-bearing one. If the per-ticket `evseq` keys are lost, the next `INCR` would restart low and **collide with existing `TicketEvent.seq`** (corrupting the merge/dedupe key). On a Redis-only loss, **reseed each ticket's `evseq` from Mongo** before accepting new events: `evseq = max(seq) over TicketEvent for that ticket` (a boot reconcile step, §9 step 6). This is why Mongo-truth makes Redis loss survivable — the counters are re-derivable from the durable log.
  - **`lease:orchestrator`** — intentionally **not** restored; the booting orchestrator re-acquires it via `acquireLease('orchestrator', ttl)` (G8/G16). A stale restored lease would be worse than none.
  - **queue jobs** — bullmq jobs lost on Redis loss are re-enqueued by the boot reconcile (the merge-indexer and reconcile-cron re-derive pending work from Mongo state, G1/[07 §indexer]).
  - **presence sets** — transient; rebuilt as clients reconnect (G13). No restore needed.

---

## §6. The append-only event-log — restore-priority-1 + replay

This is the heart of Q-INF-DR. The restore **order** matters because read-projections and the Conductor depend on the log being whole-and-ordered first.

1. **Restore the three priority-1 collections first** (`TicketEvent`, `WorkspaceSignal`, `RagEntry`) from the Mongo dump (§4) — before, or as the leading slice of, the full restore. `mongorestore --nsInclude` can target them ([§9] step 4).
2. **Verify per-ticket `seq` continuity** in `TicketEvent`: for each `ticketId`, the restored `seq` values must be strictly increasing with no *reordering* (gaps are allowed). A gap means a writer burned a number pre-crash — tolerated. A *reorder* means a corrupt restore — abort and re-restore.
3. **Reseed Redis `evseq`** from `max(TicketEvent.seq)` per ticket (§5) so newly-appended events continue above the restored high-water mark — never below it.
4. **Resume `WorkspaceSignal` consumption** from the lowest row with `processedAt == null` ([04b §13], [REFERENCE_CODES → B-O6]). The Conductor consumes serially under `runInTenant` ([04b §11c], Q-SEC-RUNINTENANT) — a mandatory wrapper for the signal-consumer and every background worker; the failure mode is a hard `currentWorkspaceId()` crash, never a silent cross-tenant read. Verify it does not re-process already-`processedAt` signals.
5. **Re-derive read-projections** from the restored log: the board, notification center, usage chips, and GitLab projection columns all source from `TicketEvent` (docs 18/19/20/22). They are **rebuilt**, not separately restored. The `Ticket.lastActivityAt` denormalization ([04b §13]) is recomputed from the latest `TicketEvent` per ticket.
6. **Rebuild RAG search indexes** (boot path, §4a) and let the per-changed-files delta indexer ([REFERENCE_CODES → B-O3]) heal any `RagEntry` gap against the frozen `commitHash`.

**Replay is bounded and deterministic.** Because `seq` is monotonic and the log is append-only, replay is idempotent on the merge/dedupe key — re-applying an event the projection already has is a no-op (G12 client-side gap detection mirrors this). There is **no LLM in the replay path**; the Conductor is deterministic ([REFERENCE_CODES → B-23], [01 §3]).

---

## §7. What is acceptably lost — in-flight container state

The deliberate RPO = ∞ tier. **In-flight per-ticket container state is not backed up** and is re-derived, not restored:

- A **running PTY turn** mid-execution (the agent was "thinking"/typing when the host died). The turn is dropped; on recovery the session `--resume`s on `claudeSessionId` ([04b §7]) and the user/Conductor re-issues the turn. Cheap to re-run (no metered credits, §3, [01 §1]).
- **Un-committed worktree edits** inside a container that died before a commit. The worktree clone is into a clean container volume from `git clone --single-branch` ([REFERENCE_CODES → B-31], Q-CT-WORKTREE), pinned to the frozen `commitHash` ([REFERENCE_CODES → DH5 commit-hash]). Edits that never reached a commit are gone; the design intent is that meaningful state becomes a **commit** (which lives in GitLab, the source of truth, [REFERENCE_CODES → B-29]) or an **`emit_carryover`/`emit_event`** (which the Conductor persists to Mongo). Anything between those checkpoints is in-flight and acceptably lost.
- **The container itself.** `--restart unless-stopped` ([REFERENCE_CODES → B-31]) keeps containers alive across an *orchestrator* crash, but a *host* loss takes them. `resumeAll()` ([04b §7], Q-CT-RESUME) re-associates surviving containers by stored `containerId`+`worktreePath` and re-attaches the pty-agent at `ptyAgentUrl`; containers that did not survive are **re-created** for their ticket from the durable `AgentSession` row, fresh `.claude` re-rendered per stage ([04b §7], Q-CT-UNIT). The scrollback ring-buffer (durable in the pty-agent) is a convenience, not a DR asset — its loss costs only terminal history, not work.
- **Live, un-persisted tokens.** Per [REFERENCE_CODES → B-21]/DH5(event-granularity): live AI tokens stream un-persisted; only the **completed** `ai-message` event is durable. A crash mid-stream loses the partial stream — the completed-message replay (§6) is the recovery.
- **Redis presence + transient socket state** (§5) — rebuilt on reconnect.

The rule of thumb: **if it isn't a Mongo row, a Redis-reseedable counter, or a GitLab commit, it is acceptably lost** — and the architecture is built so that everything *meaningful* becomes one of those three at a milestone boundary.

---

## §8. What restores it all — the orchestrator boot reconcile

DR is not just data restore; it is **boot reconcile**. After the data tier is back, the single-instance orchestrator boot path ([08_DEPLOYMENT.md], [REFERENCE_CODES → B-01]) is what re-derives the live system:

1. **Acquire `lease:orchestrator`** (`acquireLease`, G8/G16) — refuse to run two instances.
2. **Reseed Redis `evseq`** from Mongo (§5/§6 step 3) before accepting new events.
3. **`resumeAll()`** — re-associate or re-create per-ticket containers from `AgentSession` rows; re-mint `channelTokenId`/`hookTokenId` per session (Q-ENG-TOKEN-LIFECYCLE, [04b §7]); `--resume` on `claudeSessionId`.
4. **Rebuild Caddy `@id` routes** for every live ticket/preview under the lease ([REFERENCE_CODES → B-11], Q-NET-CADDY) — wildcard DNS-01 TLS with internal-CA fallback.
5. **Rebuild Atlas vector-search indexes** (§4a) and resume the indexer/reconcile crons (G1).
6. **Resume `WorkspaceSignal` consumption** (§6 step 4) and re-arm the GitLab webhook-reconciliation cron ([REFERENCE_CODES → B-29]) to heal any webhook missed during downtime.

The web-app tier needs no reconcile — it redeploys stateless behind the `app.` Caddy pool and reconnects to the restored data tier.

---

## §9. Restore procedure — step list (whole-host loss)

> The worst case: the orchestrator host is gone. Lesser cases (Redis-only loss, single-collection corruption) are subsets — skip the steps that don't apply. Run the §4c drill on this exact list quarterly.

1. **Provision a fresh orchestrator host.** Install Docker (+ WSL2 on Windows, [SETUP §2]), the base image (pinned Claude CLI, [REFERENCE_CODES → B-12], Q-CT-CLIPIN), Caddy. Do **`claude login`** with the **Max** account; ensure `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`apiKeyHelper` are **unset** ([SETUP §1], [01 §1]) — else sessions bill API credits instead of the subscription.
2. **Restore secrets/env.** Re-create `.env.local` and the per-tier encrypted DB credential pairs (injected at boot via tmpfs env-file, denyRead from Bash — [04b §13], Q-SEC-CREDLIFETIME). The GitLab PAT is per-workspace, encrypted on the Workspace row ([REFERENCE_CODES → B-07]); it restores with the Mongo data (step 4), not from env.
3. **Stand up Redis** with AOF/RDB from the off-host copy (§5) — or empty if the snapshot is unusable (the boot reconcile reseeds `evseq` from Mongo either way). Do **not** restore a stale `lease:orchestrator`.
4. **Restore MongoDB.** `mongorestore --gzip --archive=<latest>.archive.gz` (whole-cluster) — **or** lead with the priority-1 slice for a faster partial bring-up:
   ```
   mongorestore --gzip --archive=<latest> \
     --nsInclude 'ws_*.TicketEvent' --nsInclude 'ws_*.WorkspaceSignal' --nsInclude 'ws_*.RagEntry'
   # then the remainder of the archive
   ```
   (Atlas: trigger a PITR restore to just before the incident; skip the archive path.)
5. **Verify the event-log** (§6 steps 2): per-ticket `seq` strictly increasing, no reorders. Abort + re-restore on any reorder.
6. **Boot the orchestrator** → it runs the §8 reconcile (acquire lease → reseed `evseq` → `resumeAll()` → rebuild Caddy routes → rebuild search indexes → resume signal consumption + webhook reconcile cron).
7. **Redeploy the web-app tier** behind the `app.` Caddy pool; confirm `/healthz` and that clients reconnect (subscribe-before-fetch → snapshot → merge-on-`seq`, [04b §6], B-22).
8. **Post-restore validation:** open a workspace board (projection rebuilt from `TicketEvent`), confirm an existing ticket's activity feed + rewind scrubber render, confirm a preview subdomain resolves over TLS, confirm a new `TicketEvent` appends with `seq > restored high-water mark`. Accept that in-flight turns from the incident are gone (§7) — re-issue them.

---

## §10. Cross-reference index

| This doc | Reconciles / depends on | Cited codes / Q-* |
|---|---|---|
| §2 append-only spine | [04b §11a], [04b §6], [04b §13] | B-O6, B-25, B-O3, G2, G24 |
| §3 RPO/RTO | [01 §1] (cheap re-run), [08_DEPLOYMENT.md] | B-01, B-26, E1 |
| §4 Mongo backup | [SETUP §3], [04b §13] | B-24, G10, B-O8/G9, B-39, Q-SEC-CREDLIFETIME |
| §5 Redis backup | [SETUP §3], [04b §6] | G1, G2, G8/G16, G13, G24, B-O6 |
| §6 event-log replay | [04b §6], [04b §11c] | B-O6, B-23, G12, Q-SEC-RUNINTENANT, Q-INF-TESTING |
| §7 acceptable loss | [04b §7] | B-31, B-21, DH5(commit-hash/event-granularity), B-29, Q-CT-RESUME |
| §8 boot reconcile | [08_DEPLOYMENT.md], [04b §7] | B-01, B-11, B-29, G8/G16, Q-NET-CADDY, Q-ENG-TOKEN-LIFECYCLE |
| §9 restore steps | [SETUP §1/§2], [04b §13] | B-07, B-12, Q-CT-CLIPIN, B-22 |

**Self-check:** No new verbs introduced. No restore step is an LLM action — boot reconcile + `resumeAll()` are deterministic Conductor/host code (B-23). In-flight container state is explicitly RPO = ∞ (acceptably lost). The append-only event-log is restore-priority-1 with a bounded, idempotent, `seq`-ordered replay. Tagged **P4**; pre-P4 the system runs un-backed-up by design ([REFERENCE_CODES → B-26]). This doc writes a new file only and edits no existing doc.
