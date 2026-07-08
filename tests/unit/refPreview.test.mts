//? T1 — the ref-preview PLAN is pure + tested (the live launch is Docker). Verifies: the clone-exec is a plain
//? branch-tip clone by default but a FULL-history clone + `git checkout <ref>` when a ref is given; a ref is
//? name/route-scoped so TWO refs of one branch produce DISTINCT containers + subdomains (run side by side); and
//? an unsafe ref (shell metachars, `..` ranges) is rejected before it can reach the clone shell.

import { assert, eq, report } from '../_helpers.mts';
import { cloneExecArgs, refSlug, isSafeRef, containerName } from '../../server/container/runtime.ts';
import { refPreviewRoute } from '../../server/proxy/index.ts';

// clone-exec: default branch-tip clone vs full-clone + checkout
{
  const branchOnly = cloneExecArgs('ws-x-dev-1', 'DEV-1');
  eq(branchOnly.join(' '), 'exec ws-x-dev-1 git clone --branch DEV-1 --single-branch /mirror /work', 'no ref → the unchanged branch-tip clone');

  const atRef = cloneExecArgs('ws-x-dev-1-ref-abc123', 'DEV-1', 'abc123def');
  const shell = atRef.join(' ');
  assert(atRef[0] === 'exec' && atRef[2] === 'sh' && atRef[3] === '-lc', 'ref clone runs a shell (sh -lc)');
  assert(shell.includes('git clone /mirror /work') && shell.includes('git -C /work checkout abc123def'), 'ref → full clone + checkout the exact ref');
  assert(!shell.includes('--single-branch'), 'a ref clone is NOT single-branch (needs full history)');
}

// ref slug + safety
{
  eq(refSlug('abc123DEF456ghi'), 'abc123def456', 'refSlug is a ≤12-char docker-safe slug');
  eq(refSlug('feature/x'), 'feature-x', 'a slash normalizes to a dash');
  assert(isSafeRef('a1b2c3d') && isSafeRef('refs/heads/main') && isSafeRef('v1.2.3'), 'plain sha/branch/tag refs are safe');
  assert(!isSafeRef('main; rm -rf /') && !isSafeRef('a`b`') && !isSafeRef('$(whoami)'), 'shell metachars are rejected');
  assert(!isSafeRef('HEAD~1..HEAD') && !isSafeRef('a..b'), 'a `..` range is rejected');
  assert(!isSafeRef(''), 'empty ref is rejected');
}

// two refs of one branch → distinct containers + routes (coexist)
{
  const n1 = containerName('ws1', 'DEV-1', refSlug('aaaa1111'));
  const n2 = containerName('ws1', 'DEV-1', refSlug('bbbb2222'));
  assert(n1 !== n2 && n1.includes('-ref-') && n2.includes('-ref-'), 'each ref gets its own ref-scoped container name');
  eq(containerName('ws1', 'DEV-1'), 'ws-ws1-dev-1', 'no suffix → the plain worker container name (unchanged)');

  const r1 = refPreviewRoute({ ticketKey: 'DEV-1', branch: 'DEV-1', refSlug: refSlug('aaaa1111'), containerName: n1 });
  const r2 = refPreviewRoute({ ticketKey: 'DEV-1', branch: 'DEV-1', refSlug: refSlug('bbbb2222'), containerName: n2 });
  assert(r1.id !== r2.id, 'the two ref routes have distinct ids (idempotent per ref)');
  assert(r1.host !== r2.host, 'the two ref routes have distinct subdomains (side-by-side)');
  assert(r1.target === `${n1}:5173` && r2.target === `${n2}:5173`, 'each route targets its own ref container');
}

report('tests/unit/refPreview.test.mts');
