---
id: 0286
title: Switching workspace/project is instant via a client stale-while-revalidate snapshot cache + idle prefetch
status: accepted
date: 2026-07-21
tags: [realtime, sync, cache, preload, client, performance]
supersedes: []
---

# 0286 — client snapshot cache (instant workspace/project switching)

## Context

ADR 0285 made every write live for the ACTIVE workspace and confirmed the snapshot preloads all small data for
the active workspace + active project (so the first board visit is instant). One gap remained (P5): the
snapshot is scoped to ONE active project, so switching project — or workspace — threw away the whole `snap` and
re-pulled everything (a ~60–80 query build) behind a loading state. No switch was ever instant after the first,
and returning to a workspace you were just on still spun.

## Decision

**A client-side stale-while-revalidate cache, entirely in `WorkspacesProvider.tsx` — no server change.**

- `snapCacheRef: Map<"${workspaceId}::${projectId}", Snap>` caches every loaded snapshot; `lastProjectByWsRef`
  tracks the last project per workspace.
- A **mirror effect** (`useEffect(() => cacheEntry(snap), [snap])`) writes the ACTIVE snapshot into the cache
  on every change, so the deltas that keep the active workspace live also keep its cache entry fresh.
- **Switching** (`setActiveWorkspace` / `setActiveProject`) renders the cached snapshot **instantly**
  (`setSnap(cached); setLoading(false)`) when present — no spinner — and always fires the existing
  want*-driven `refetch` in the **background** to reconcile. The refetch's `shouldApplySnapshotResponse` guard
  (newest sequence + still-desired target) makes a late response unable to clobber a newer switch. A bare
  workspace switch returns to the project you were last on (via `lastProjectByWs`), so the background refetch
  targets the same project the cache shows — no flip to the default.
- **Idle background prefetch:** once the active workspace has loaded, sequentially (≈350 ms apart) fetch every
  OTHER workspace's default-project snapshot into the cache — so even the FIRST switch to any workspace is
  instant — without blocking login or hammering the server. Runs once per session; skips already-cached ones.
- **Only the active workspace joins its room + has live delta hooks.** A cached non-active workspace goes stale
  until re-selected, at which point the switch's background refetch freshens it. The cache holds only `Snap`
  objects (small metadata) — big data (repo trees, PTY, media bytes) is never cached, inheriting the snapshot's
  own boundary.

## Rejected alternatives

- **Split the snapshot into a workspace-wide slice + a per-project slice** (fetch the workspace-wide part once,
  only re-pull the project slice on project switch). The "cleaner" data-model fix, but it needs new route
  shapes + slice-routing plumbing on both sides. The cache makes switching instant regardless of scoping, at a
  fraction of the change — the full-rebuild background refetch is invisible to the user.
- **Keep every cached workspace LIVE** (join all N rooms, route each delta to the right cached snapshot). Much
  heavier — N room memberships + per-workspace delta routing — for data you can only look at one at a time.
  Stale-while-revalidate freshens on switch, which is exactly when you need it. Rejected.
- **Lazy cache only (no prefetch).** Would leave the first visit to each workspace behind a spinner. The user
  chose the idle background prefetch so first switches are instant too; it's throttled + non-blocking, so login
  stays fast.
- **No cache (the prior behaviour).** Every switch re-pulls behind a loading state; returning to a
  just-visited workspace is never instant.

## Consequences

- Switching workspace/project is instant for anything visited or prefetched; the background refetch keeps it
  correct. Returning to a workspace lands you back on the project you were on.
- Memory holds N `Snap` objects (one per visited/prefetched workspace-project), bounded by the user's
  membership count — all small data, no blobs, no eviction. An LRU cap is the natural follow-up only if a user
  with very many workspaces ever strains it.
- The background prefetch issues up to N-1 snapshot builds shortly after login (throttled, sequential); a heavy
  read fanned out, but idle and non-blocking, and it buys instant-first-switch everywhere.
- Cross-workspace correctness holds: delta callbacks scope by the active project, and the sequence/desired-target
  guard prevents a stale or prefetch response from becoming the wrong active snapshot.
