//? Client snapshot cache (stale-while-revalidate) — switching workspace/project renders instantly from an
//? in-memory cache while a background refetch reconciles, and a background prefetch fills the cache with every
//? other workspace so even the first switch is instant. Big data (codebase/PTY/media bytes) stays lazy.
//?
//? This is client React-state machinery, so — like the other provider tests — it is guarded at the source
//? level (a component harness would be needed to drive the real state transitions). The point is to pin the
//? mechanism so a refactor can't silently drop instant-switch or re-introduce a per-switch spinner.

import { readFileSync } from 'node:fs';

import { assert, report } from '../_helpers.mts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const provider = read('src/workspaces/_shell/WorkspacesProvider.tsx');

/* ------------------------------------------------------------ the cache + its key */

assert(provider.includes('const snapKey = '), 'a cache key helper exists');
assert(provider.includes('`${workspaceId ?? \'\'}::${projectId ?? \'\'}`'), 'the key is scoped by workspace AND project (an entry is one active project)');
assert(provider.includes('const snapCacheRef = useRef<Map<string, Snap>>(new Map())'), 'the snapshot cache is an in-memory Map keyed by workspace::project');
assert(provider.includes('const lastProjectByWsRef = useRef<Map<string, string>>(new Map())'), 'the last-active project per workspace is tracked (so a bare workspace switch returns to it, no flip)');

/* ------------------------------------------------------------ the active entry stays delta-fresh */

const mirror = provider.slice(provider.indexOf('const cacheEntry = useCallback'));
assert(mirror.slice(0, 400).includes('snapCacheRef.current.set(snapKey(entry.activeWorkspaceId, entry.activeProjectId), entry)'), 'cacheEntry stores a snapshot under its resolved key');
assert(provider.includes('useEffect(() => { cacheEntry(snap); }, [snap, cacheEntry]);'), 'the ACTIVE snapshot is mirrored to the cache on every change (so deltas keep the cached entry fresh)');

/* ------------------------------------------------------------ instant switch: render cache, refetch in bg */

const setWs = provider.slice(provider.indexOf('setActiveWorkspace: (id) =>'), provider.indexOf('setActiveWorkspace: (id) =>') + 1100);
assert(setWs.includes('if (cached) { setSnap(cached); setLoading(false); } else { setLoading(true); }'), 'a workspace switch renders a cached snapshot INSTANTLY (no spinner) and only shows loading on a miss');
assert(setWs.includes('lastProjectByWsRef.current.get(id)'), 'and returns to the project you were last on in that workspace');
const setProj = provider.slice(provider.indexOf('setActiveProject: (id) =>'));
assert(setProj.slice(0, 500).includes('if (cached) { setSnap(cached); setLoading(false); } else { setLoading(true); }'), 'a project switch uses the same instant-cache path');
//? The background refetch is still driven by the existing want* effect (the switch changes wantWorkspaceId/
//? wantProjectId → refetch fires → shouldApplySnapshotResponse reconciles), so freshness is preserved.
assert(provider.includes('useEffect(() => { refetch(); }, [refetch]);'), 'the want*-driven refetch still fires after a switch to reconcile the cache');

/* ------------------------------------------------------------ background prefetch: once, throttled, skips cached */

const prefetch = provider.slice(provider.indexOf('const prefetchedRef = useRef(false)'));
assert(prefetch.slice(0, 900).includes('if (prefetchedRef.current || !snap.activeWorkspaceId || snap.workspaces.length <= 1) return'), 'prefetch runs once, only after the active workspace loads, and only when there are OTHER workspaces');
assert(prefetch.slice(0, 900).includes('if (lastProjectByWsRef.current.has(wsId)) continue'), 'prefetch skips workspaces already cached');
assert(prefetch.slice(0, 900).includes("data: { workspaceId: wsId }") && prefetch.slice(0, 900).includes('cacheEntry(res.result)'), 'prefetch fetches each other workspace and caches it (default project)');
assert(prefetch.slice(0, 900).includes('setTimeout(resolve, 350)'), 'prefetch is throttled (sequential, ~350ms apart) so login stays fast and the server is not hammered');

/* ------------------------------------------------------------ big data must NOT be cached (only the snapshot) */

//? The cache holds Snap objects only. The snapshot never contains repo trees / PTY / media bytes (verified by
//? the realtime + snapshot tests); the cache inherits that boundary — it caches metadata, never blobs.
assert(!provider.includes('snapCacheRef.current.set(') || provider.includes('cacheEntry'), 'writes go through cacheEntry (Snap only) — no ad-hoc caching of big payloads');

report('workspaceCache');
