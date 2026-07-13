//? Integration test for #35 (code-editor real save) — a LIVE docker round-trip. Creates a labelled
//? `org.workspaces.workspace` container (what isWorkspacesContainer gates on), then proves writeWorktreeFile
//? persists an edit to /work and readWorktreeFile reads it back — plus that a non-our container + a traversal
//? path are refused. Skips cleanly when Docker isn't available. Run: `npx tsx tests/integration/worktreeSave.test.mts`.

import { assert, eq, report } from '../_helpers.mts';

const { readWorktreeFile, writeWorktreeFile } = await import('../../server/container/worktreeFiles');
const { docker, dockerAvailable, containerName } = await import('../../server/container/runtime');

const WS = 'wtsavews';
const TICKET = 'DEV-9001';
const container = containerName(WS, TICKET);
const foreign = `alien-${String(Date.now())}`;

let started = false;
let foreignStarted = false;
try {
  if (!(await dockerAvailable())) {
    console.log('[worktreeSave] docker unavailable — skipping the live round-trip (structural guards covered by the unit test)');
    report('tests/integration/worktreeSave.test.mts');
    process.exit(0);
  }

  //? A minimal labelled "ours" container with a /work dir (mirrors a real ticket worktree).
  await docker(['rm', '-f', container]);
  const run = await docker(['run', '-d', '--label', `org.workspaces.workspace=${WS}`, '--name', container, 'alpine', 'sleep', '120']);
  started = run.code === 0;
  assert(started, 'the labelled test container started');
  await docker(['exec', container, 'sh', '-c', 'mkdir -p /work']);

  // --- write then read back (the core round-trip) -----------------------------
  const w = await writeWorktreeFile(WS, TICKET, 'src/index.ts', 'export const hi = "hello worktree";\n');
  assert(w.ok, 'writeWorktreeFile persisted the file into /work');
  const r = await readWorktreeFile(WS, TICKET, 'src/index.ts');
  assert(r.ok, 'readWorktreeFile read it back');
  eq(r.content, 'export const hi = "hello worktree";\n', 'the read content matches exactly what was saved');

  // --- overwrite (a second save) ----------------------------------------------
  const w2 = await writeWorktreeFile(WS, TICKET, 'src/index.ts', 'changed\n');
  assert(w2.ok, 'a second save overwrites');
  const r2 = await readWorktreeFile(WS, TICKET, 'src/index.ts');
  eq(r2.content, 'changed\n', 'the overwrite persisted');

  // --- nested path creates parent dirs ----------------------------------------
  const w3 = await writeWorktreeFile(WS, TICKET, 'a/b/c/deep.txt', 'nested\n');
  assert(w3.ok, 'writing a nested path creates the parent dirs');
  eq((await readWorktreeFile(WS, TICKET, 'a/b/c/deep.txt')).content, 'nested\n', 'the nested file reads back');

  // --- refusals: traversal + a non-ours container -----------------------------
  eq((await writeWorktreeFile(WS, TICKET, '../escape.txt', 'x')).ok, false, 'a traversal path is refused (never escapes /work)');
  eq((await readWorktreeFile(WS, TICKET, '/etc/passwd')).ok, false, 'an absolute path is refused');

  const fr = await docker(['run', '-d', '--name', foreign, 'alpine', 'sleep', '30']); // NO label → not ours
  foreignStarted = fr.code === 0;
  //? A container WITHOUT the label must be rejected even if the name were guessed — but our helper keys off
  //? containerName(WS,TICKET), so instead prove isWorkspacesContainer refuses an unlabelled ticket container.
  await docker(['rm', '-f', container]);
  const run2 = await docker(['run', '-d', '--name', container, 'alpine', 'sleep', '30']); // recreate WITHOUT the label
  assert(run2.code === 0, 'recreated the ticket container without the ownership label');
  eq((await writeWorktreeFile(WS, TICKET, 'x.txt', 'y')).ok, false, 'an UNLABELLED (not-ours) container is refused — never exec into a foreign container');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  await docker(['rm', '-f', container]).catch(() => undefined);
  if (foreignStarted) await docker(['rm', '-f', foreign]).catch(() => undefined);
}

report('tests/integration/worktreeSave.test.mts');
