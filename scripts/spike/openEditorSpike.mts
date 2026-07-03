//? Spike: prove the PRODUCT orchestration `openEditorForTicket` (editorSession.ts) end-to-end
//? against real Docker — it launches the ticket container via the real `launchTicketContainer`,
//? attaches the proxy network, projects the user profile, starts openvscode, and builds the
//? per-ticket proxy route. Verifies the editor is actually serving inside the container.
//? Run: PATH+=docker-bin; npx tsx --tsconfig tsconfig.server.json scripts/spike/openEditorSpike.mts

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openEditorForTicket } from '../../server/container/editorSession.ts';
import { containerName, teardownTicketContainer } from '../../server/container/runtime.ts';

const WS = 'spikews';
const KEY = 'DEV-9001';
const BRANCH = 'DEV-9001';
const USER = 'spikeuser';
const IMAGE = 'workspaces/base-editor:test';

interface Res { code: number; out: string; err: string }
function run(cmd: string, args: string[], cwd?: string): Res {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...(cwd ? { cwd } : {}) });
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const git = (args: string[], cwd?: string): Res => run('git', args, cwd);
const docker = (args: string[]): Res => run('docker', args);
function assert(cond: boolean, msg: string): void { console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) process.exitCode = 1; }

function setupMirror(): void {
  const mirror = path.join(process.cwd(), 'data', 'workspaces', WS, 'repo.git');
  rmSync(path.join(process.cwd(), 'data', 'workspaces', WS), { recursive: true, force: true });
  mkdirSync(path.dirname(mirror), { recursive: true });
  const tmp = path.join(process.cwd(), 'data', 'workspaces', WS, '_seed');
  mkdirSync(tmp, { recursive: true });
  git(['init', '-q'], tmp);
  git(['config', 'user.email', 'a@b.c'], tmp);
  git(['config', 'user.name', 'dev'], tmp);
  run('bash', ['-lc', `cd "${tmp}" && printf '# spike\\nexport const x = 1;\\n' > app.ts`]);
  git(['add', '-A'], tmp);
  git(['commit', '-qm', 'init'], tmp);
  git(['branch', BRANCH], tmp);
  git(['clone', '--bare', '-q', tmp, mirror]);
  rmSync(tmp, { recursive: true, force: true });
  console.log('mirror ready:', mirror, '(has', BRANCH + ')');
}

async function main(): Promise<void> {
  console.log('=== setup a minimal bare mirror ===');
  setupMirror();

  console.log('\n=== openEditorForTicket (real launchTicketContainer + profile + proxy route) ===');
  const r = await openEditorForTicket({ workspaceId: WS, ticketKey: KEY, branch: BRANCH, userId: USER, image: IMAGE });
  console.log('result:', JSON.stringify(r));
  assert(r.ok, `openEditorForTicket ok (${r.error ?? ''})`);
  assert(r.host === 'vscode-dev-9001.localhost', `route host = vscode-dev-9001.localhost (got ${r.host ?? '-'})`);

  console.log('\n=== is the editor actually serving INSIDE the ticket container? ===');
  const name = containerName(WS, KEY);
  await new Promise((r) => setTimeout(r, 8000)); // openvscode boot
  const ps = docker(['exec', name, 'bash', '-lc', 'pgrep -f openvscode >/dev/null && echo running || echo down']);
  console.log('   openvscode process:', ps.out);
  const probe = docker(['exec', name, 'bash', '-lc', `curl -s -o /dev/null -w "%{http_code}" --max-time 6 "http://localhost:3000/?tkn=${r.token ?? ''}" || echo 000`]);
  console.log('   in-container editor http:', probe.out);
  assert(probe.out.includes('302') || probe.out.includes('200'), 'openvscode is serving on :3000 inside the ticket container');
  //? the /work worktree was cloned from the mirror (real git) — confirm it's there.
  const work = docker(['exec', name, 'bash', '-lc', 'ls /work && git -C /work rev-parse --abbrev-ref HEAD']);
  console.log('   /work:', work.out.replaceAll('\n', ' | '));
  assert(work.out.includes('app.ts'), 'the ticket branch worktree is checked out in /work');

  console.log('\n=== cleanup ===');
  await teardownTicketContainer(WS, KEY);
  rmSync(path.join(process.cwd(), 'data', 'workspaces', WS), { recursive: true, force: true });
  rmSync(path.join(process.cwd(), 'data', 'editor-profiles', USER), { recursive: true, force: true });
  console.log('\nDONE. exitCode =', process.exitCode ?? 0);
}

await main();
