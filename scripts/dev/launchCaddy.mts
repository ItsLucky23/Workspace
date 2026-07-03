//? Dev tool — run Caddy as a container on `workspaces-net` so the backend's proxy provider
//? (server/proxy/caddyProvider.ts) can add per-ticket editor/preview routes via the Admin API,
//? and the editor subdomains (vscode-<slug>.localhost) resolve to the ticket containers.
//?
//?   npm run caddy:launch          # up (publishes :443 + admin :2019)
//?   npm run caddy:launch -- down  # stop + remove
//?
//? The backend must point at it: WS_CADDY_ADMIN=http://localhost:2019 (default). TLS in dev is
//? Caddy's internal CA for *.localhost (curl -k, or install the root to silence browser warnings).

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DOCKER = process.env.WS_DOCKER_BIN ?? 'docker';
const NET = process.env.WS_NET ?? 'workspaces-net';
const NAME = 'ls-caddy';
const ACTION = process.argv[2] ?? 'up';
const CONFIG = path.join(process.cwd(), 'docker', 'caddy.json').replaceAll('\\', '/');

function docker(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(DOCKER, args, { encoding: 'utf8' });
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

if (ACTION === 'down') {
  docker(['rm', '-f', NAME]);
  console.log('Caddy removed.');
} else {
  docker(['network', 'create', NET]); // idempotent
  docker(['rm', '-f', NAME]);
  const r = docker([
    'run', '-d', '--name', NAME, '--network', NET, '--restart', 'unless-stopped',
    '-p', '443:443', '-p', '80:80', '-p', '2019:2019',
    '-v', `${CONFIG}:/etc/caddy/config.json:ro`,
    'caddy:2', 'caddy', 'run', '--config', '/etc/caddy/config.json',
  ]);
  if (r.code !== 0) { console.error(`Caddy launch failed: ${r.err}`); process.exitCode = 1; }
  else {
    console.log(`Caddy up on workspaces-net (:443 + admin :2019). Config: ${CONFIG}`);
    console.log('Backend seam: WS_CADDY_ADMIN=http://localhost:2019');
  }
}
