//? K1-b — the compose-engine namespacing + arg builders (pure). Verifies: the compose PROJECT name + the
//? per-workspace network are workspace-scoped (two workspaces never collide); the external default network is
//? injected into the sanitized compose (but not if it already declares `networks:`); and the up/down/ps arg
//? shapes are the namespaced `docker compose -p <project> -f <file> …`.

import { readFileSync } from 'node:fs';

import { assert, eq, report } from '../_helpers.mts';
import { stackProject, stackNetwork, withWorkspaceNetwork, composeUpArgs, composeDownArgs, composePsArgs } from '../../server/container/composeEngine.ts';

// namespacing: workspace-scoped, docker-safe
eq(stackProject('WS-1', 'My DB'), 'ws-ws-1-my-db', 'project name is ws-<id>-<name>, docker-safe');
assert(stackProject('a', 'x') !== stackProject('b', 'x'), 'two workspaces get distinct project names for the same stack');
eq(stackNetwork('WS-1'), 'ws-ws-1-svc', 'the per-workspace service network');
assert(stackNetwork('a') !== stackNetwork('b'), "two workspaces' service networks never collide");

// external default network injection
{
  const injected = withWorkspaceNetwork('services:\n  db:\n    image: postgres\n', 'ws-x-svc');
  assert(injected.includes('networks:') && injected.includes('name: ws-x-svc') && injected.includes('external: true'), 'the external per-workspace network is appended');
  const already = withWorkspaceNetwork('services:\n  db:\n    image: postgres\nnetworks:\n  custom: {}\n', 'ws-x-svc');
  assert(!already.includes('name: ws-x-svc'), 'a compose that already declares networks: is left untouched');
}

// Deploy proxy isolation: static assertions keep this test dependency-free and lock the Caddy/Admin boundary.
{
  const compose = readFileSync(new URL('../../deploy/docker-compose.yml', import.meta.url), 'utf8');
  const caddyfile = readFileSync(new URL('../../deploy/Caddyfile', import.meta.url), 'utf8');
  const appBlock = compose.match(/  app:[\s\S]*?\n  caddy:/)?.[0] ?? '';
  const caddyBlock = compose.match(/  caddy:[\s\S]*?\nvolumes:/)?.[0] ?? '';
  const managementBlock = compose.match(/\n  management:\n[\s\S]*?(?=\n  workspaces-net:)/)?.[0] ?? '';

  assert(/internal: true[\s\S]*subnet: "\$\{WS_CADDY_MANAGEMENT_SUBNET:-172\.30\.0\.0\/24\}"/.test(managementBlock), 'the management subnet is internal and operator-configurable');
  assert(!/^\s+name:/m.test(managementBlock), 'the management network keeps Compose project scoping instead of a shared global name');
  assert(/networks:\s*\n\s+internal: \{\}\s*\n\s+management:\s*\n\s+aliases: \[app-upstream\]/.test(appBlock), 'the app exposes its proxy upstream only on management');
  assert(!/workspaces-net:/.test(appBlock), 'the app is not attached to the ticket dataplane');
  assert(/WS_CADDY_ADMIN: http:\/\/caddy-admin:2019[\s\S]*WS_EDITOR_EDGE_AUTH: "1"[\s\S]*WS_EDITOR_AUTH_BACKEND: app-upstream:80/.test(appBlock), 'app-to-Caddy control and mandatory edge-auth stay on management aliases');
  assert(/WS_CADDY_ADMIN_IP: "\$\{WS_CADDY_ADMIN_IP:-172\.30\.0\.2\}"/.test(caddyBlock), 'Caddy receives its operator-configurable management IP');
  assert(/management:\s*\n\s+ipv4_address: "\$\{WS_CADDY_ADMIN_IP:-172\.30\.0\.2\}"\s*\n\s+aliases: \[caddy-admin\]/.test(caddyBlock), 'Caddy Admin has a fixed management-only endpoint');
  assert(/workspaces-net: \{\}/.test(caddyBlock), 'Caddy remains attached to the ticket preview dataplane');
  assert(!/\n\s+- ["']?\d+:2019/.test(caddyBlock), 'the Caddy Admin port is never host-published');
  assert(/admin \{\$WS_CADDY_ADMIN_IP\}:2019 \{[\s\S]*origins caddy-admin:2019[\s\S]*enforce_origin[\s\S]*\}/.test(caddyfile), 'Caddy Admin binds only to the injected management address and enforces its origin');
  assert(!/admin\s+(?:0\.0\.0\.0|:2019)/.test(caddyfile), 'Caddy Admin never regresses to a shared bind');
  assert(/:80 \{\s*reverse_proxy app-upstream:80\s*\}/.test(caddyfile), 'the main app reverse proxy targets the management-only app alias');
}

// arg shapes
{
  const up = composeUpArgs('ws-x-db', '/data/db.yml');
  eq(up.join(' '), 'compose -p ws-x-db -f /data/db.yml up -d --remove-orphans', 'up args are namespaced + detached');
  const down = composeDownArgs('ws-x-db', '/data/db.yml');
  assert(down.includes('down') && down.includes('-v'), 'down removes volumes');
  const ps = composePsArgs('ws-x-db', '/data/db.yml');
  assert(ps.includes('ps') && ps.join(' ').includes('-p ws-x-db'), 'ps is namespaced');
}

report('tests/unit/composeEngine.test.mts');
