//? K1 — the compose sanitizer (security core of the "run any compose" engine). Verifies: a clean multi-service
//? compose passes with its published host ports rewritten to container-only (no cross-workspace collision); and
//? EVERY host-escape directive (privileged, docker.sock mount, host bind-mount, network_mode/pid/ipc: host,
//? cap_add, devices, security_opt) REJECTS the file — including flow-style the parser folds to a scalar. Pure.

import { assert, eq, report } from '../_helpers.mts';
import { sanitizeCompose, rewritePortEntry } from '../../server/container/composeSanitize.ts';

// a clean compose: passes, services found, host ports rewritten to container-only
{
  const clean = `services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  cache:
    image: redis:7
volumes:
  pgdata:
`;
  const r = sanitizeCompose(clean);
  assert(r.ok, 'a clean compose is accepted');
  assert(r.services.includes('db') && r.services.includes('cache'), 'both services are found');
  assert(!r.sanitized.includes('5432:5432'), 'the published host port is stripped');
  assert(r.sanitized.includes('- "5432"'), 'the container port is kept (reachable intra-network by name)');
  assert(r.rewrites.length === 1, 'exactly one port rewrite recorded');
  assert(r.sanitized.includes('pgdata:/var/lib/postgresql/data'), 'a NAMED volume is preserved (not a host bind)');
}

// rewritePortEntry unit
{
  eq(rewritePortEntry('"8080:80"').value, '"80"', 'host:container → container-only');
  eq(rewritePortEntry('127.0.0.1:8080:80').value, '"80"', 'ip:host:container → container-only');
  eq(rewritePortEntry('"53:53/udp"').value, '"53/udp"', 'protocol is preserved');
  eq(rewritePortEntry('"80"').rewritten, false, 'a bare container port is not rewritten');
}

// each host-escape directive rejects the file
function rejects(compose: string, why: string): void {
  const r = sanitizeCompose(compose);
  assert(!r.ok && r.violations.length > 0, `REJECT: ${why} (violations: ${r.violations.join('; ')})`);
  eq(r.sanitized, '', `${why} → no sanitized output`);
}

rejects('services:\n  x:\n    image: a\n    privileged: true\n', 'privileged');
rejects('services:\n  x:\n    image: a\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n', 'docker.sock mount');
rejects('services:\n  x:\n    image: a\n    volumes:\n      - /etc:/host-etc\n', 'host bind-mount');
rejects('services:\n  x:\n    image: a\n    network_mode: host\n', 'network_mode: host');
rejects('services:\n  x:\n    image: a\n    pid: host\n', 'pid: host');
rejects('services:\n  x:\n    image: a\n    ipc: host\n', 'ipc: host');
rejects('services:\n  x:\n    image: a\n    cap_add:\n      - SYS_ADMIN\n', 'cap_add');
rejects('services:\n  x:\n    image: a\n    devices:\n      - /dev/sda\n', 'devices');
rejects('services:\n  x:\n    image: a\n    security_opt:\n      - seccomp:unconfined\n', 'security_opt');

// flow-style the subset parser would opacify is still caught by the raw scan
rejects('services:\n  x: { image: a, privileged: true }\n', 'flow-style privileged (raw-scan catch)');

// no services map → rejected
{
  const r = sanitizeCompose('version: "3"\nfoo: bar\n');
  assert(!r.ok, 'a compose with no services is rejected');
}

report('tests/unit/composeSanitize.test.mts');
