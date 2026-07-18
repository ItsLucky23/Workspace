//? Docker subprocess output caps retain only a diagnostic tail and terminate the child before it can
//? accumulate unbounded stdout/stderr. Uses Node as a stand-in binary; no Docker daemon is required.

import { assert, eq, report } from '../_helpers.mts';

process.env.WS_DOCKER_BIN = process.execPath;
const { docker } = await import('../../server/container/runtime.ts');

const stdoutOverflow = await docker(['-e', "process.stdout.write('0123456789')"], { maxOutputBytes: 6 });
assert(stdoutOverflow.outputLimitExceeded, 'stdout cap is reported');
eq(stdoutOverflow.out, '456789', 'stdout retains only its tail at the cap');

const stderrOverflow = await docker(['-e', "process.stderr.write('abcdefghij')"], { maxOutputBytes: 6 });
assert(stderrOverflow.outputLimitExceeded, 'stderr cap is reported');
eq(stderrOverflow.err, 'efghij', 'stderr retains only its tail at the cap');

report('dockerRuntimeOutput');
