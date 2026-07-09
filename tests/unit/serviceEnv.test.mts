//? K3 — the container env-arg builder (pure). Verifies: each key→value becomes `-e KEY=VALUE`; empty/invalid
//? env names (containing whitespace or `=`) are skipped; values are passed verbatim (docker does not re-interpret).

import { assert, eq, report } from '../_helpers.mts';
import { serviceEnvArgs } from '../../server/container/serviceEnv.ts';

const args = serviceEnvArgs({ DATABASE_URL: 'postgres://app:pw@postgres:5432/app', REDIS_URL: 'redis://redis:6379' });
eq(args.length, 4, 'two vars → four args (-e KEY=VALUE each)');
assert(args.includes('DATABASE_URL=postgres://app:pw@postgres:5432/app'), 'the DB url is passed verbatim');
assert(args.includes('REDIS_URL=redis://redis:6379'), 'the redis url is passed verbatim');
assert(args[0] === '-e' && args[2] === '-e', 'each pair is preceded by -e');

// invalid env names are skipped
{
  const filtered = serviceEnvArgs({ '': 'x', 'HAS SPACE': 'y', 'HAS=EQ': 'z', GOOD: 'ok' });
  eq(filtered.length, 2, 'only the one valid key survives');
  assert(filtered.includes('GOOD=ok'), 'the valid key is kept');
  assert(!filtered.join(' ').includes('HAS SPACE') && !filtered.join(' ').includes('HAS=EQ'), 'invalid names are dropped');
}

eq(serviceEnvArgs({}).length, 0, 'no env → no args');

report('tests/unit/serviceEnv.test.mts');
