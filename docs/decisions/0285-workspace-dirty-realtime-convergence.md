---
id: 0285
title: Every workspace write converges live for every room member via one Conductor-tail `workspaceDirty` broadcast
status: accepted
date: 2026-07-21
tags: [realtime, sync, conductor, snapshot, preload, multi-instance]
supersedes: []
---

# 0285 — general realtime convergence + the preload boundary

## Context

The goal: everything a user does is live for every other member of the same workspace, all small data is
cached in memory (no re-GET on navigation), and big data (the codebase) is never preloaded. A four-agent scan
found the architecture was **~85% there** already and named the exact gaps:

- **Already correct:** exactly ONE socket.io room per workspace (`room == workspaceId`), every member joined for
  their whole session regardless of view; navigation derives `view` from the URL with no per-view GET; the
  snapshot preloads all small data for the active project; big data (repo tree, terminals, PTY, previews)
  stays lazy; cross-instance fan-out rides the Redis adapter.
- **The core gap:** realtime coverage was **opt-in per entity**. Hot paths (tickets, content) broadcast their
  own targeted deltas, but ~25 COLD settings/infra control-ops ended in `syncRequest(...).then(refetch())` with
  no room broadcast — **only the initiator converged; every other member stayed stale until a manual reload**.
  A handful (`editSprint`, `reorderStages`, `saveGitlab`, `copyWorkspaceAssets`) didn't even refetch for the
  initiator. New ops kept falling into the same trap because nothing generalized the pattern.

## Decision

**1. One coarse `broadcastWorkspaceDirty(workspaceId, { gone? })` at the single PUBLIC-writer choke-point.**
The Conductor's `enqueueWriterAction` fires it once, after a successful drain, gated on `writerKind === 'public'`
— so it never fires for internal engine ops (stage/automation/forge, which enqueue as `'internal'` and already
push their own ticket deltas). The client listens once (`upsertSyncEventCallback('workspaces/workspaceDirty')`)
and debounce-refetches, **reusing the same 400 ms `dirtyTimer` as `contentDirty`** so a burst of mixed writes
coalesces into ONE refetch. This makes every cold op — and every FUTURE op — live-for-all by construction.

**2. Hot ticket paths are SKIPPED** (`WORKSPACE_DIRTY_SKIP`): the high-churn ops that already broadcast a
targeted per-id delta (`quick-add`, `ticket-edit`, `add-comment`, `archive`, `bulk-*`, `answer-input`) plus
`delete-workspace`. Skipping them means board dragging never triggers a redundant full refetch. The default is
to fire, so a forgotten/new op is still live-for-all — the skip set is a pure optimization, not a correctness
dependency.

**3. `gone` is the workspace-DELETED lifecycle signal.** An in-room refetch cannot converge a workspace that no
longer exists, so `delete-workspace` broadcasts `{ gone: true }`; other members' clients drop the dead tenant
target and fall back to their picker (mirroring the initiator's own eviction).

**4. Optimistic `stageOverrides` is reconciled** against the authoritative ticket delta (dropped once
`ticket.stageId` matches), so an AI-move override can't mask another user's real move — the two boards converge.

**5. The preload boundary: cache small, compute stays lazy.** PAT metadata (id/name/prefix/scopes/dates —
never the token) is preloaded into the snapshot. Prompt-experiment scoring (a count-query-per-experiment) and
the RAG index status (a distinct-file query over the index) are DELIBERATELY kept on-demand — folding either
into the snapshot would re-run its heavy query on every build, now amplified by the new refetch fan-out.

## Rejected alternatives

- **Per-entity typed deltas for all ~25 cold ops.** Exact and refetch-free, but L-effort, and every future op
  must remember to add one — the exact fragility that produced this gap. Rejected for the cold, low-churn ops
  (kept for the hot paths, where the refetch cost would matter).
- **Fire `workspaceDirty` for every public op including the hot ones.** Simpler (no skip set) but adds a
  redundant full refetch on top of every targeted ticket delta during board dragging. Rejected.
- **Preload prompt-experiments + RAG index status too.** Tried, then reverted: `promptExperiments_v1`'s own
  header documents why scoring is on-demand, and the RAG status runs a distinct-file query — both would re-run
  per snapshot build and compound with `workspaceDirty` refetches. They stay lazy (their panels are rare).
- **A boot-time multi-instance misconfig warning keyed on `REDIS_HOST`.** Redis is a CORE dependency here
  (set single-instance too), so the warning fires on every solo boot and desensitizes operators. Dropped in
  favour of `.env_template` guidance — there is no reliable boot-time "this is N instances" signal.

## Consequences

- Adding a control-op is now realtime-for-all with zero extra wiring; only a hot, high-churn op needs a skip
  entry + its own targeted delta.
- The trade: `workspaceDirty` triggers a full snapshot re-pull (a ~60–80 query build) per drained cold write on
  every open client. Debounce + the hot-path skip + the low cold-write cadence make this acceptable; the
  natural next optimization (if cold-write volume climbs) is a lighter dirty-delta instead of a full rebuild.
- The initiator does one redundant debounced refetch (its own `.then(refetch())` plus the echoed nudge);
  harmless and coalesced.
- The `workspaceDirty` carrier route is directly invokable (like `contentDirty`) → a member can nudge a
  refetch in their OWN room; `gone` is hardcoded `false` in the carrier so no eviction can be forged.
- B-23 holds: the carrier only RBAC-gates + returns; `broadcastWorkspaceDirty` is emit-only, never a writer.
