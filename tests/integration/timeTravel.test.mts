//? T2 — time-travel refs against a REAL temp git repo (no Docker/Mongo). Verifies: `commitAsOf` resolves the
//? commit at/before a timestamp; `prepareRevertRef` produces a "main minus X" synthetic ref that, checked out,
//? has that commit's change UNDONE (clean revert); and a revert whose lines were later modified returns a typed
//? CONFLICT (never a broken ref). Builds + tears down its own throwaway repo.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assert, eq, report } from '../_helpers.mts';
import { commitAsOf, prepareRevertRef, resolveRefSpec } from '../../server/git/timeTravel.ts';

const root = mkdtempSync(path.join(tmpdir(), 'tt-'));
const work = path.join(root, 'work');
const bare = path.join(root, 'repo.git');
mkdirSync(work, { recursive: true });

//? Run git in `work` with a fixed commit date (so commitAsOf is deterministic).
function g(args: string[], dateIso?: string): string {
  const env = { ...process.env, GIT_AUTHOR_DATE: dateIso ?? '', GIT_COMMITTER_DATE: dateIso ?? '', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' };
  return execFileSync('git', args, { cwd: work, env, encoding: 'utf8' }).trim();
}
function commit(msg: string, dateIso: string): string {
  g(['add', '-A']); g(['commit', '-m', msg], dateIso); return g(['rev-parse', 'HEAD']);
}

try {
  g(['init', '-b', 'main']);
  const T = (n: number): string => `2026-01-0${String(n)}T12:00:00`;
  writeFileSync(path.join(work, 'base.txt'), 'A\n'); writeFileSync(path.join(work, 'other.txt'), 'x\n');
  const c1 = commit('c1 base', T(1));
  writeFileSync(path.join(work, 'base.txt'), 'A\nB\n');
  const c2 = commit('c2 add B', T(2));           // target for the CONFLICT (B is modified next)
  writeFileSync(path.join(work, 'base.txt'), 'A\nB2\n');
  const c3 = commit('c3 change B', T(3));
  writeFileSync(path.join(work, 'other.txt'), 'x\ny\n');
  const c4 = commit('c4 add y to other', T(4));  // target for the CLEAN revert (other.txt untouched after)

  //? Publish the bare mirror the time-travel fns operate on.
  execFileSync('git', ['clone', '--bare', work, bare], { encoding: 'utf8' });
  assert(Boolean(c1 && c2 && c3 && c4), 'built a 4-commit history');

  // commitAsOf — as of just after c2, the tip-at-or-before is c2.
  const asOfC2 = await commitAsOf(bare, 'main', Date.parse('2026-01-02T12:00:30Z'));
  eq(asOfC2, c2, 'commitAsOf returns the commit at/before the timestamp (c2)');
  const asOfC4 = await commitAsOf(bare, 'main', Date.parse('2026-01-09T00:00:00Z'));
  eq(asOfC4, c4, 'a later timestamp resolves to the tip (c4)');

  // CLEAN revert: undo c4 (added "y" to other.txt, never touched again) → the ref has other.txt back to "x".
  const clean = await prepareRevertRef(bare, 'main', c4, 'clean');
  assert(clean.ok && !clean.conflict, 'reverting an untouched-later commit is a clean synthetic ref');
  eq(clean.ref, 'refs/synthetic/clean', 'the synthetic ref is pinned in the bare');
  const otherAtRef = execFileSync('git', ['--git-dir', bare, 'show', `${clean.sha ?? ''}:other.txt`], { encoding: 'utf8' });
  eq(otherAtRef, 'x\n', 'at the synthetic ref, c4\'s change to other.txt is undone');
  const baseAtRef = execFileSync('git', ['--git-dir', bare, 'show', `${clean.sha ?? ''}:base.txt`], { encoding: 'utf8' });
  eq(baseAtRef, 'A\nB2\n', 'the rest of the tree is intact (base.txt still at c3)');

  // CONFLICT revert: undo c2 (added "B") after c3 changed "B" → a typed conflict, no broken ref.
  const conflict = await prepareRevertRef(bare, 'main', c2, 'conf');
  assert(!conflict.ok && conflict.conflict === true, 'reverting a later-modified commit is a typed conflict');
  eq(conflict.error, 'revert.conflict', 'the conflict is surfaced as a typed error');

  // T3 — resolveRefSpec: the three time-travel spec kinds (what the Assistant proposes → the preview op resolves).
  const specCommit = await resolveRefSpec(bare, 'main', { kind: 'commit', value: c3 });
  eq(specCommit.ref, c3, 'a commit spec resolves to that SHA');
  const specUnsafe = await resolveRefSpec(bare, 'main', { kind: 'commit', value: 'x; rm -rf /' });
  assert(!specUnsafe.ok && specUnsafe.error === 'ref.unsafe', 'an unsafe commit value is rejected');
  const specAsof = await resolveRefSpec(bare, 'main', { kind: 'asof', whenMs: Date.parse('2026-01-03T12:00:30Z') });
  eq(specAsof.ref, c3, 'an asof spec resolves to the commit at/before T (c3)');
  const specRevertClean = await resolveRefSpec(bare, 'main', { kind: 'revert', value: c4 });
  assert(specRevertClean.ok && Boolean(specRevertClean.ref) && specRevertClean.ref !== c4, 'a clean revert spec resolves to a NEW synthetic ref');
  const specRevertConflict = await resolveRefSpec(bare, 'main', { kind: 'revert', value: c2 });
  assert(!specRevertConflict.ok && specRevertConflict.conflict === true, 'a conflicting revert spec surfaces the conflict');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

report('tests/integration/timeTravel.test.mts');
