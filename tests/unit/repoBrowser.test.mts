//? Unit test — the workspace-level Code browser's git-read helpers (server/git/repoStore:
//? `repoTree` + `readRepoFileAt`). Seeds a REAL bare repo from a file-tree via `initGreenfieldRepo`
//? (no DB, no docker), then asserts the whole-tree listing, single-file read, binary/truncation flags,
//? and the traversal/absolute/missing/unlinked guards — the assertions the auto-sweep can't reach and
//? the routes are thin wrappers over. Run: `npx tsx tests/unit/repoBrowser.test.mts`.

import { rmSync } from 'node:fs';
import path from 'node:path';

import { initGreenfieldRepo, repoTree, readRepoFileAt } from '../../server/git/repoStore';
import { assert, eq, report } from '../_helpers.mts';

const WS = `repobrowsertest-${String(Date.now())}`;
const WS_UNLINKED = `repobrowsertest-unlinked-${String(Date.now())}`;
const PROJ = 'proj-code';

const dataDir = (ws: string): string => path.join(process.cwd(), 'data', 'workspaces', ws);
//? A fake binary blob: a NUL byte (built without a literal NUL in source) is what flags "binary".
const NUL = String.fromCharCode(0);
const BIG = 'a'.repeat(250_000);

try {
  rmSync(dataDir(WS), { recursive: true, force: true });
  rmSync(dataDir(WS_UNLINKED), { recursive: true, force: true });

  await initGreenfieldRepo(WS, PROJ, [
    { path: 'src/index.ts', content: 'export const x = 1;\n' },
    { path: 'src/util/helper.ts', content: 'export const y = 2;\n' },
    { path: 'README.md', content: '# Hi\n' },
    { path: 'bin.dat', content: `PK${NUL}${String.fromCharCode(1)}binary` },
    { path: 'big.txt', content: BIG },
  ]);

  // --- tree listing -----------------------------------------------------------
  const tree = await repoTree(WS, PROJ);
  assert(tree.linked === true, 'repoTree: a seeded repo reports linked:true');
  eq(tree.branch, 'main', 'repoTree: branch is the repo baseline (main), server-derived');
  const paths = (tree.entries ?? []).map((e) => e.path).sort();
  eq(paths, ['README.md', 'big.txt', 'bin.dat', 'src/index.ts', 'src/util/helper.ts'], 'repoTree: lists every blob (recursively) at the baseline branch');
  const idx = (tree.entries ?? []).find((e) => e.path === 'src/index.ts');
  assert(idx !== undefined && idx.size === Buffer.byteLength('export const x = 1;\n'), 'repoTree: an entry carries the blob byte-size');

  // --- single-file read (happy path) -----------------------------------------
  const f = await readRepoFileAt(WS, PROJ, 'src/index.ts');
  assert(f.ok === true && f.content === 'export const x = 1;\n' && f.binary !== true && f.truncated !== true, 'readRepoFileAt: returns the exact file content');

  // --- binary detection -------------------------------------------------------
  const bin = await readRepoFileAt(WS, PROJ, 'bin.dat');
  assert(bin.ok === true && bin.binary === true && bin.content === undefined, 'readRepoFileAt: a NUL-byte blob is flagged binary, with no content');

  // --- truncation -------------------------------------------------------------
  const big = await readRepoFileAt(WS, PROJ, 'big.txt');
  assert(big.ok === true && big.truncated === true && (big.content?.length ?? 0) === 200_000, 'readRepoFileAt: a >200KB file is truncated to the byte cap');

  // --- path guards ------------------------------------------------------------
  const trav = await readRepoFileAt(WS, PROJ, '../etc/passwd');
  assert(trav.ok === false && trav.error === 'repo.invalidPath', 'readRepoFileAt: rejects parent traversal (..)');
  const abs = await readRepoFileAt(WS, PROJ, '/etc/passwd');
  assert(abs.ok === false && abs.error === 'repo.invalidPath', 'readRepoFileAt: rejects an absolute path');

  // --- missing + directory ----------------------------------------------------
  const miss = await readRepoFileAt(WS, PROJ, 'does/not/exist.ts');
  assert(miss.ok === false && miss.error === 'repo.fileMissing', 'readRepoFileAt: an absent path is fileMissing');
  const dir = await readRepoFileAt(WS, PROJ, 'src');
  assert(dir.ok === false && dir.error === 'repo.fileMissing', 'readRepoFileAt: a directory is not previewable (fileMissing)');

  // --- unlinked project -------------------------------------------------------
  const unlinkedTree = await repoTree(WS_UNLINKED, PROJ);
  assert(unlinkedTree.linked === false, 'repoTree: an unlinked project reports linked:false');
  const unlinkedFile = await readRepoFileAt(WS_UNLINKED, PROJ, 'src/index.ts');
  assert(unlinkedFile.ok === false && unlinkedFile.error === 'repo.notLinked', 'readRepoFileAt: an unlinked project is repo.notLinked');
} finally {
  rmSync(dataDir(WS), { recursive: true, force: true });
  rmSync(dataDir(WS_UNLINKED), { recursive: true, force: true });
}

report('tests/unit/repoBrowser.test.mts');
