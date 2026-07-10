//? K2 — the one-click service presets. Verifies: the catalog covers the common services; every preset's compose
//? passes the K1 sanitizer UNCHANGED (no host-escape, no published host ports) and declares its service; and
//? `presetCompose` resolves/΄misses correctly. Pure.

import { assert, eq, report } from '../_helpers.mts';
import { listServicePresets, presetCompose, presetEnv } from '../../server/container/servicePresets.ts';
import { sanitizeCompose } from '../../server/container/composeSanitize.ts';
import { serviceEnvArgs } from '../../server/container/serviceEnv.ts';

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

//? K3 — every preset publishes connection-string env pointing at the service's INTRA-NETWORK name (no host,
//? no localhost, no published port) so the app/agent reaches it by name once the container joins the service net.
for (const p of presets) {
  const env = presetEnv(p.key);
  assert(Object.keys(env).length >= 1, `${p.key} publishes at least one connection-string env var`);
  //? Each value points at a service hostname, never localhost/127.0.0.1 (those wouldn't resolve inside the net).
  for (const [k, v] of Object.entries(env)) {
    assert(!/localhost|127\.0\.0\.1/.test(v), `${p.key}.${k} does not point at localhost (uses the service name)`);
  }
  //? The env is docker-run-safe (no `=`/whitespace in keys).
  assert(serviceEnvArgs(env).length === Object.keys(env).length * 2, `${p.key} env produces valid -e KEY=VALUE args`);
}
//? The headline scenario: Kafka is reachable by broker address, Postgres by a full DATABASE_URL.
eq(presetEnv('kafka').KAFKA_BROKERS, 'kafka:9092', 'the kafka preset publishes KAFKA_BROKERS=kafka:9092');
assert((presetEnv('postgres').DATABASE_URL ?? '').startsWith('postgresql://'), 'the postgres preset publishes a DATABASE_URL');
eq(Object.keys(presetEnv('nonsense')).length, 0, 'an unknown preset publishes no env');

eq(presetCompose('nonsense'), null, 'an unknown preset key resolves to null');
assert((presetCompose('postgres') ?? '').includes('POSTGRES_PASSWORD'), 'the postgres preset seeds dev creds');
assert((presetCompose('kafka') ?? '').includes('KRaft') || (presetCompose('kafka') ?? '').includes('KAFKA_PROCESS_ROLES'), 'the kafka preset is KRaft-mode (no zookeeper)');

report('tests/unit/servicePresets.test.mts');
