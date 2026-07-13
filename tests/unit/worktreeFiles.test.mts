//? Unit test — the #35 worktree-file path guard (server/container/worktreeFiles). The save/read seam execs
//? `docker exec … <path>` bounded to /work, so the path MUST reject traversal (`..`), absolute escapes
//? (leading `/`) and shell-unsafe characters — a hole here would let an edit read/write outside the worktree.
//? Run: `npx tsx tests/unit/worktreeFiles.test.mts`.

import { isSafeWorktreePath } from '../../server/container/worktreeFiles';
import { assert, report } from '../_helpers.mts';

// --- accepted: ordinary worktree-relative paths -----------------------------
for (const ok of ['src/index.ts', 'a.txt', 'deep/nested/dir/file.tsx', 'package.json', 'src/_api/get_v1.ts']) {
  assert(isSafeWorktreePath(ok), `accepts a normal relative path: ${ok}`);
}

// --- rejected: traversal / absolute / injection ------------------------------
for (const bad of [
  '../etc/passwd',            // parent traversal
  'src/../../secret',         // embedded traversal
  '/etc/passwd',              // absolute escape
  '/work/x',                  // absolute even into /work
  'a b.txt',                  // space (shell-unsafe)
  'x;rm -rf /',               // command injection chars
  'x$(whoami)',               // substitution chars
  'x`id`',                    // backtick
  'x|y',                      // pipe
  '',                         // empty
  'a'.repeat(301),            // over the length bound
]) {
  assert(!isSafeWorktreePath(bad), `rejects an unsafe path: ${JSON.stringify(bad).slice(0, 40)}`);
}

report('tests/unit/worktreeFiles.test.mts');
