//? K2 — the one-click service presets. Verifies: the catalog covers the common services; every preset's compose
//? passes the K1 sanitizer UNCHANGED (no host-escape, no published host ports) and declares its service; and
//? `presetCompose` resolves/΄misses correctly. Pure.

import { assert, eq, report } from '../_helpers.mts';
import { listServicePresets, presetCompose } from '../../server/container/servicePresets.ts';
import { sanitizeCompose } from '../../server/container/composeSanitize.ts';

const presets = listServicePresets();
const keys = presets.map((p) => p.key);
for (const k of ['postgres', 'redis', 'kafka', 'rabbitmq', 'elasticsearch', 'minio', 'mailpit']) {
  assert(keys.includes(k), `the catalog includes ${k}`);
}
assert(presets.every((p) => p.label.length > 0 && p.description.length > 0), 'every preset has a label + description');

// every preset compose is clean per the sanitizer (accepted, no rewrites needed = no published host ports)
for (const p of presets) {
  const compose = presetCompose(p.key);
  assert(compose !== null, `presetCompose(${p.key}) resolves`);
  const r = sanitizeCompose(compose ?? '');
  assert(r.ok, `${p.key} preset passes the sanitizer (violations: ${r.violations.join('; ')})`);
  assert(r.services.length >= 1, `${p.key} declares at least one service`);
  eq(r.rewrites.length, 0, `${p.key} publishes no host ports (nothing to rewrite — intra-network only)`);
}

eq(presetCompose('nonsense'), null, 'an unknown preset key resolves to null');
assert((presetCompose('postgres') ?? '').includes('POSTGRES_PASSWORD'), 'the postgres preset seeds dev creds');
assert((presetCompose('kafka') ?? '').includes('KRaft') || (presetCompose('kafka') ?? '').includes('KAFKA_PROCESS_ROLES'), 'the kafka preset is KRaft-mode (no zookeeper)');

report('tests/unit/servicePresets.test.mts');
