//? Unit test for the forge issue-sync pagination + transient-error classification (server/git/
//? gitlabSync, C3). No network — `accumulatePages` runs over an injected page fetcher. Verifies:
//? a single short page stops, multiple full pages are followed + concatenated, the safety cap is
//? reported (not silently dropped), and isTransientForgeError only retries 5xx/429/network.

import { assert, eq, report } from '../_helpers.mts';

const {
  accumulatePages,
  buildForgeSnapshot,
  forgeSnapshotRequestId,
  forgeTouchedKeys,
  isTransientForgeError,
  MAX_FORGE_DESCRIPTION,
  MAX_FORGE_ISSUES,
  MAX_FORGE_LABEL,
  MAX_FORGE_LABELS,
  MAX_FORGE_SIGNAL_BYTES,
  MAX_FORGE_TITLE,
  readForgeSnapshot,
} = await import('../../server/git/gitlabSync.ts');

// build a fake forge: `total` issues, `perPage` per page
const fakeForge = (total: number, perPage: number) => async (page: number): Promise<number[]> => {
  const start = (page - 1) * perPage;
  return Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_v, i) => start + i);
};

// 1) a single short page → no more requests
{
  let pages = 0;
  const fetchPage = async (page: number): Promise<number[]> => { pages += 1; return (await fakeForge(30, 100)(page)); };
  const { rows, capped } = await accumulatePages(fetchPage, { perPage: 100, maxPages: 20 });
  eq(rows.length, 30, 'returns all 30 rows from the first short page');
  eq(pages, 1, 'stops after the first short page');
  assert(!capped, 'not capped');
}

// 2) 250 issues over 100/page → 3 pages, concatenated in order (the >100 that used to be dropped)
{
  const { rows, capped } = await accumulatePages(fakeForge(250, 100), { perPage: 100, maxPages: 20 });
  eq(rows.length, 250, 'follows pages until a short page — 250 issues, not just the first 100');
  eq(rows[0], 0, 'first row preserved');
  eq(rows[249], 249, 'last row preserved (order kept)');
  assert(!capped, 'a natural short-page end is not a cap');
}

// 3) a 100-row GitHub provider page with mostly PRs is still full: filter only
// after the raw count drives termination, otherwise page 2 is silently lost.
{
  let pages = 0;
  const { rows, capped } = await accumulatePages(async (page) => {
    pages += 1;
    if (page === 1) return { rows: [101], rawCount: 100 };
    return { rows: [102], rawCount: 1 };
  }, { perPage: 100, maxPages: 20 });
  eq(rows, [101, 102], 'a full raw page continues even when local filtering leaves one issue');
  eq(pages, 2, 'raw provider count, not filtered rows, controls termination');
  assert(!capped, 'the following raw short page is a complete listing');
}

// 4) more full pages than the cap → capped=true (surfaced, never silent)
{
  const { rows, capped } = await accumulatePages(fakeForge(100000, 100), { perPage: 100, maxPages: 3 });
  eq(rows.length, 300, 'stops at maxPages * perPage');
  assert(capped, 'capped=true so the caller can log the truncation');
}

// 5) an oversized provider page cannot defeat the configured per-page count
{
  const { rows, capped } = await accumulatePages(async () => Array.from({ length: 1_000 }, (_v, i) => i), { perPage: 100, maxPages: 1 });
  eq(rows.length, 100, 'an oversized provider page is sliced before accumulation');
  assert(capped, 'the one-page safety bound remains visible');
}

// 6) transient-error classification
{
  assert(isTransientForgeError(new Error('gitlab 503')), '5xx is transient');
  assert(isTransientForgeError(new Error('github 429')), '429 is transient');
  assert(isTransientForgeError(new Error('ECONNRESET')), 'a network error (no status) is transient');
  assert(!isTransientForgeError(new Error('github 401')), '401 is NOT retried (bad token)');
  assert(!isTransientForgeError(new Error('gitlab 404')), '404 is NOT retried');
  assert(!isTransientForgeError(new Error('forge response too large')), 'the local response-size guard is not retried');
}

// 7) normalized snapshots bound every field, count, and the serialized signal payload
{
  const labels = Array.from({ length: MAX_FORGE_LABELS + 10 }, (_v, i) => `label-${String(i)}-${'x'.repeat(MAX_FORGE_LABEL)}`);
  const rows = Array.from({ length: MAX_FORGE_ISSUES + 10 }, (_v, i) => ({
    iid: i + 1,
    title: 't'.repeat(MAX_FORGE_TITLE + 50),
    description: 'd'.repeat(MAX_FORGE_DESCRIPTION + 50),
    labels,
    web_url: 'https://forge.example/' + 'u'.repeat(3_000),
    state: 'opened',
  }));
  const snapshot = buildForgeSnapshot('project-a', 'gitlab', 'Acme/Repo.git', rows);
  assert(snapshot.capped, 'count/field pressure is surfaced as capped');
  assert(snapshot.issues.length <= MAX_FORGE_ISSUES, 'snapshot issue count is bounded');
  eq(snapshot.repo, 'acme/repo', 'repo identity is normalized for stable matching');
  assert((snapshot.issues[0]?.title.length ?? 0) <= MAX_FORGE_TITLE, 'title is bounded');
  assert((snapshot.issues[0]?.description?.length ?? 0) <= MAX_FORGE_DESCRIPTION, 'description is bounded');
  assert((snapshot.issues[0]?.labels.length ?? 0) <= MAX_FORGE_LABELS, 'label count is bounded');
  assert((snapshot.issues[0]?.labels[0]?.length ?? 0) <= MAX_FORGE_LABEL, 'label length is bounded');
  assert(Buffer.byteLength(JSON.stringify(snapshot)) <= MAX_FORGE_SIGNAL_BYTES, 'serialized snapshot stays below the safe signal budget');
}

// 8) dataset ids are stable across provider ordering and result keys are fail-closed
{
  const first = buildForgeSnapshot('project-a', 'github', 'acme/repo', [
    { iid: 2, title: 'B' },
    { iid: 1, title: 'A' },
  ]);
  const reordered = buildForgeSnapshot('project-a', 'github', 'acme/repo', [
    { iid: 1, title: 'A' },
    { iid: 2, title: 'B' },
  ]);
  eq(forgeSnapshotRequestId(first), forgeSnapshotRequestId(reordered), 'project+dataset digest is order-stable');
  eq(forgeTouchedKeys({ keys: ['DEV-1', 'bad', 'DEV-2', 3] }), ['DEV-1', 'DEV-2'], 'only safe touched keys reach broadcasts');
  const oversized = { ...first, issues: Array.from({ length: MAX_FORGE_ISSUES + 1 }, () => first.issues[0]) };
  eq(readForgeSnapshot(oversized), null, 'an oversized public snapshot fails runtime validation');
}

report('tests/unit/forgePagination.test.mts');
