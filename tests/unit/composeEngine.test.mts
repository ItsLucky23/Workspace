//? K1-b — the compose-engine namespacing + arg builders (pure). Verifies: the compose PROJECT name + the
//? per-workspace network are workspace-scoped (two workspaces never collide); the external default network is
//? injected into the sanitized compose (but not if it already declares `networks:`); and the up/down/ps arg
//? shapes are the namespaced `docker compose -p <project> -f <file> …`.

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
