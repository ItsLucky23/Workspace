//? Spike: prove ADR 0010 end-to-end against REAL Docker containers using the REAL editor
//? code (startEditorInContainer + editorProfile copy-in/out). Not a unit test — a runnable
//? proof. Run: PATH+=docker-bin; npx tsx --tsconfig tsconfig.server.json scripts/spike/editorProfileSpike.mts
//?
//? Steps:
//?  1. Run container C1 (editor image), start openvscode via startEditorInContainer → reachable.
//?  2. Simulate an extension LOGIN (write a token into the profile's secret area in C1),
//?     capture the profile back to the per-user host store.
//?  3. Run a SECOND container C2, project the profile → assert the token is present in C2.
//?     => the login carried across containers (the whole point of the per-user profile).

import { spawnSync } from 'node:child_process';
import { startEditorInContainer } from '../../server/container/editorServer.ts';
import { captureProfileFromContainer, projectProfileIntoContainer, editorProfileDir, IN_CONTAINER_USER_DATA } from '../../server/container/editorProfile.ts';

const IMAGE = 'workspaces/base-editor:test';
const USER = 'spikeuser';
const C1 = 'ls-editor-spike-1';
const C2 = 'ls-editor-spike-2';
const HOST_PORT = '3210';
const TOKEN = 'spike-token';

interface Res { code: number; out: string; err: string }
function run(cmd: string, args: string[]): Res {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const docker = (args: string[]): Res => run('docker', args);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function step(msg: string): void { console.log(`\n=== ${msg} ===`); }
function assert(cond: boolean, msg: string): void { console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) process.exitCode = 1; }

async function runEditorContainer(name: string, publish: boolean): Promise<void> {
  docker(['rm', '-f', name]);
  const args = ['run', '-d', '--name', name];
  if (publish) args.push('-p', `${HOST_PORT}:3000`);
  args.push(IMAGE, 'sleep', 'infinity');
  const r = docker(args);
  if (r.code !== 0) throw new Error(`run ${name} failed: ${r.err}`);
  //? Seed a /work git repo so the editor opens a real folder.
  docker(['exec', name, 'bash', '-lc', 'mkdir -p /work && cd /work && git init -q && echo hi > README.md && git add -A && git -c user.email=a@b.c -c user.name=a commit -qm init || true']);
}

async function main(): Promise<void> {
  console.log('editorProfileDir(spikeuser) =', editorProfileDir(USER));

  step('1. container C1 + start the editor via the real startEditorInContainer');
  await runEditorContainer(C1, true);
  const started = await startEditorInContainer({ container: C1, userId: USER, token: TOKEN, workdir: '/work' });
  assert(started.ok, `startEditorInContainer C1 ok (${started.error ?? ''})`);
  await sleep(9000);
  const probe = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '6', `http://localhost:${HOST_PORT}/?tkn=${TOKEN}`]);
  assert(probe.out === '302' || probe.out === '200', `editor reachable in-container via published port (got ${probe.out})`);

  step('2. simulate an extension LOGIN in C1 + capture the profile back');
  //? An extension login lands a secret in the user-data dir; emulate that file, then capture.
  docker(['exec', C1, 'bash', '-lc', `mkdir -p ${IN_CONTAINER_USER_DATA} && echo '{"github.auth":"gh_SECRET_123"}' > ${IN_CONTAINER_USER_DATA}/secret-marker.json`]);
  const captured = await captureProfileFromContainer(C1, USER);
  assert(captured.ok, `captureProfileFromContainer ok (${captured.error ?? ''})`);

  step('3. NEW container C2 + project the profile → is the login present?');
  await runEditorContainer(C2, false);
  const projected = await projectProfileIntoContainer(C2, USER);
  assert(projected.ok, `projectProfileIntoContainer C2 ok (${projected.error ?? ''})`);
  const readBack = docker(['exec', C2, 'bash', '-lc', `cat ${IN_CONTAINER_USER_DATA}/secret-marker.json 2>/dev/null`]);
  console.log('   C2 sees:', readBack.out);
  assert(readBack.out.includes('gh_SECRET_123'), 'the login token from C1 carried into C2 via the per-user profile');

  step('cleanup');
  docker(['rm', '-f', C1, C2]);
  console.log('\nDONE. exitCode =', process.exitCode ?? 0);
}

await main();
