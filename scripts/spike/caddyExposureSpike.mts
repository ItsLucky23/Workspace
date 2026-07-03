//? Spike: prove ITEM 1 — the per-ticket editor is reachable through REAL Caddy via the
//? `vscode-<slug>.<baseDomain>` subdomain (not a published port), with WebSocket upgrades.
//? Run: PATH+=docker-bin; npx tsx --tsconfig tsconfig.server.json scripts/spike/caddyExposureSpike.mts

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { startEditorInContainer } from '../../server/container/editorServer.ts';
import { getProxyProvider } from '../../server/proxy/index.ts';

const DOCKER = process.env.WS_DOCKER_BIN ?? 'docker';
const NET = 'workspaces-net';
const EDITOR = 'ws-caddytest';
const HOST = 'vscode-caddytest.localhost';
const TOKEN = 'ctok';

interface Res { code: number; out: string; err: string }
function run(cmd: string, args: string[]): Res {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const docker = (args: string[]): Res => run(DOCKER, args);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function assert(cond: boolean, msg: string): void { console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) process.exitCode = 1; }

async function ensureCaddy(): Promise<void> {
  docker(['network', 'create', NET]);
  const up = docker(['ps', '--filter', 'name=^/ls-caddy$', '--format', '{{.Names}}']);
  if (up.out.includes('ls-caddy')) { console.log('Caddy already up.'); return; }
  const cfg = path.join(process.cwd(), 'docker', 'caddy.json').replaceAll('\\', '/');
  docker(['rm', '-f', 'ls-caddy']);
  const r = docker(['run', '-d', '--name', 'ls-caddy', '--network', NET, '-p', '443:443', '-p', '2019:2019', '-v', `${cfg}:/etc/caddy/config.json:ro`, 'caddy:2', 'caddy', 'run', '--config', '/etc/caddy/config.json']);
  if (r.code !== 0) throw new Error(`Caddy launch failed: ${r.err}`);
  await sleep(2500);
  console.log('Caddy launched.');
}

async function main(): Promise<void> {
  console.log('=== ensure Caddy on workspaces-net ===');
  await ensureCaddy();

  console.log('\n=== editor container on the net + openvscode (baked, no download) ===');
  docker(['rm', '-f', EDITOR]);
  const runc = docker(['run', '-d', '--name', EDITOR, '--network', NET, 'workspaces/base:0.1.0', 'sleep', 'infinity']);
  if (runc.code !== 0) throw new Error(`editor run failed: ${runc.err}`);
  docker(['exec', EDITOR, 'bash', '-lc', 'mkdir -p /work && echo hi > /work/README.md']);
  const started = await startEditorInContainer({ container: EDITOR, userId: 'caddytest', token: TOKEN, workdir: '/work' });
  assert(started.ok, `startEditorInContainer ok (${started.error ?? ''})`);

  console.log('\n=== upsert the editor route via the proxy provider (Caddy Admin API) ===');
  const up = await getProxyProvider().upsertRoute({ id: 'vscode-caddytest', host: HOST, target: `${EDITOR}:3000` });
  assert(up.ok, `proxy upsertRoute ok (${up.error ?? ''})`);
  await sleep(6000); // openvscode boot + first-request cert issuance

  console.log('\n=== reach the editor THROUGH Caddy via the real subdomain ===');
  let code = '';
  for (let i = 0; i < 5; i++) {
    const c = run('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', '--resolve', `${HOST}:443:127.0.0.1`, `https://${HOST}/?tkn=${TOKEN}`]);
    code = c.out;
    if (code === '302' || code === '200') break;
    await sleep(2500);
  }
  console.log(`   https://${HOST}/ -> ${code}`);
  assert(code === '302' || code === '200', `editor reachable through Caddy subdomain (got ${code})`);

  console.log('\n=== WebSocket upgrade passes through the proxy ===');
  const ws = run('curl', ['-sk', '-i', '--max-time', '8', '--resolve', `${HOST}:443:127.0.0.1`,
    '-H', 'Connection: Upgrade', '-H', 'Upgrade: websocket', '-H', 'Sec-WebSocket-Version: 13', '-H', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    `https://${HOST}/?tkn=${TOKEN}&reconnectionToken=x&skipWebSocketFrames=false`]);
  const wsUpgraded = ws.out.includes('101') || ws.out.toLowerCase().includes('upgrade');
  console.log('   WS response first line:', ws.out.split('\n')[0]?.trim());
  assert(wsUpgraded, 'proxy forwards the WebSocket upgrade (101 / Upgrade header seen)');

  console.log('\n=== cleanup ===');
  await getProxyProvider().removeRoute('vscode-caddytest');
  docker(['rm', '-f', EDITOR]);
  console.log('\nDONE. exitCode =', process.exitCode ?? 0);
}

await main();
