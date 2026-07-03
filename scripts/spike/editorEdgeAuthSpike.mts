//? Spike: prove ITEM 5 edge-auth end-to-end through the REAL proxy `forwardAuth` (other agent's
//? caddyProvider) + the real `/editor-auth-check` backend endpoint. An editor route with
//? `forwardAuth` set → an UNAUTHENTICATED request to the subdomain is denied (401), a request
//? carrying a valid LuckyStack session cookie is allowed (302). Needs the backend running (:80)
//? and a valid session cookie file (Netscape format) as argv[2].
//? Run: PATH+=docker-bin; npx tsx --tsconfig tsconfig.server.json scripts/spike/editorEdgeAuthSpike.mts /tmp/editcookies.txt

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { startEditorInContainer } from '../../server/container/editorServer.ts';
import { getProxyProvider } from '../../server/proxy/index.ts';

const DOCKER = process.env.WS_DOCKER_BIN ?? 'docker';
const NET = 'workspaces-net';
const EDITOR = 'ws-edgeauth';
const HOST = 'vscode-edgeauth.localhost';
const TOKEN = 'etok';
const AUTH_BACKEND = process.env.WS_EDITOR_AUTH_BACKEND ?? 'host.docker.internal:80';
const cookieFile = process.argv[2] ?? '';

interface Res { code: number; out: string; err: string }
function run(cmd: string, args: string[]): Res { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }; }
const docker = (a: string[]): Res => run(DOCKER, a);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function assert(c: boolean, m: string): void { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) process.exitCode = 1; }

//? Pull the `token` value out of a Netscape cookie jar.
function sessionToken(): string {
  if (!cookieFile) return '';
  const line = readFileSync(cookieFile, 'utf8').split('\n').find((l) => l.includes('\ttoken\t'));
  return line ? (line.trim().split('\t').at(-1) ?? '') : '';
}

async function ensureCaddy(): Promise<void> {
  docker(['network', 'create', NET]);
  if (docker(['ps', '--filter', 'name=^/ls-caddy$', '--format', '{{.Names}}']).out.includes('ls-caddy')) return;
  const cfg = path.join(process.cwd(), 'docker', 'caddy.json').replaceAll('\\', '/');
  docker(['rm', '-f', 'ls-caddy']);
  docker(['run', '-d', '--name', 'ls-caddy', '--network', NET, '-p', '443:443', '-p', '2019:2019', '-v', `${cfg}:/etc/caddy/config.json:ro`, 'caddy:2', 'caddy', 'run', '--config', '/etc/caddy/config.json']);
  await sleep(2500);
}

function curl(extra: string[]): string {
  return run('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', '--resolve', `${HOST}:443:127.0.0.1`, ...extra, `https://${HOST}/?tkn=${TOKEN}`]).out;
}

async function main(): Promise<void> {
  await ensureCaddy();
  docker(['rm', '-f', EDITOR]);
  docker(['run', '-d', '--name', EDITOR, '--network', NET, 'workspaces/base:0.1.0', 'sleep', 'infinity']);
  docker(['exec', EDITOR, 'bash', '-lc', 'mkdir -p /work && echo hi > /work/README.md']);
  const started = await startEditorInContainer({ container: EDITOR, userId: 'edgeauth', token: TOKEN, workdir: '/work' });
  assert(started.ok, `editor up (${started.error ?? ''})`);

  console.log('\n=== upsert editor route WITH forwardAuth (edge-auth ON) ===');
  const up = await getProxyProvider().upsertRoute({ id: 'vscode-edgeauth', host: HOST, target: `${EDITOR}:3000`, forwardAuth: AUTH_BACKEND });
  assert(up.ok, `upsertRoute+forwardAuth ok (${up.error ?? ''})`);
  await sleep(6000);

  console.log('\n=== UNAUTHENTICATED request → must be DENIED ===');
  const unauth = curl([]);
  console.log('   unauth ->', unauth);
  assert(unauth === '401' || unauth === '403', `unauthenticated editor request denied by forward_auth (got ${unauth})`);

  console.log('\n=== request WITH a valid session cookie → must be ALLOWED ===');
  const tok = sessionToken();
  if (!tok) { console.log('   (no session cookie file — skipping the allow case)'); }
  else {
    const authed = curl(['-H', `Cookie: token=${tok}`]);
    console.log('   authed ->', authed);
    assert(authed === '302' || authed === '200', `logged-in editor request allowed through forward_auth (got ${authed})`);
  }

  console.log('\n=== cleanup ===');
  await getProxyProvider().removeRoute('vscode-edgeauth');
  docker(['rm', '-f', EDITOR]);
  console.log('DONE. exitCode =', process.exitCode ?? 0);
}

await main();
