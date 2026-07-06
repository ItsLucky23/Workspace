//? Unit test for the forge issue-sync pagination + transient-error classification (server/git/
//? gitlabSync, C3). No network — `accumulatePages` runs over an injected page fetcher. Verifies:
//? a single short page stops, multiple full pages are followed + concatenated, the safety cap is
//? reported (not silently dropped), and isTransientForgeError only retries 5xx/429/network.

import { assert, eq, report } from '../_helpers.mts';

const { accumulatePages, isTransientForgeError } = await import('../../server/git/gitlabSync.ts');

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

// 3) more full pages than the cap → capped=true (surfaced, never silent)
{
  const { rows, capped } = await accumulatePages(fakeForge(100000, 100), { perPage: 100, maxPages: 3 });
  eq(rows.length, 300, 'stops at maxPages * perPage');
  assert(capped, 'capped=true so the caller can log the truncation');
}

// 4) transient-error classification
{
  assert(isTransientForgeError(new Error('gitlab 503')), '5xx is transient');
  assert(isTransientForgeError(new Error('github 429')), '429 is transient');
  assert(isTransientForgeError(new Error('ECONNRESET')), 'a network error (no status) is transient');
  assert(!isTransientForgeError(new Error('github 401')), '401 is NOT retried (bad token)');
  assert(!isTransientForgeError(new Error('gitlab 404')), '404 is NOT retried');
}

report('tests/unit/forgePagination.test.mts');
