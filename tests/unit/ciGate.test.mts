//? R2 — the test-stage CI gate verdict (pure). A `test`-kind stage auto-fires the built-in CI; only a RED run
//? blocks the ticket. Verifies the kind check + the status→verdict mapping (passed/success → pass, failed →
//? fail-block, none/canceled/running/unknown → nogate, so an un-runnable gate never wedges a ticket).

import { assert, eq, report } from '../_helpers.mts';
import { isTestStage, testStageCiVerdict } from '../../server/ci/gate.ts';

assert(isTestStage('test'), 'a test-kind stage fires the gate');
assert(!isTestStage('code') && !isTestStage('review') && !isTestStage('plan'), 'non-test stages do not fire the gate');

eq(testStageCiVerdict('passed'), 'pass', 'passed → pass');
eq(testStageCiVerdict('success'), 'pass', 'success → pass');
eq(testStageCiVerdict('failed'), 'fail', 'failed → fail (blocks advancement)');
eq(testStageCiVerdict('none'), 'nogate', 'no ci.yml → nogate (does not block)');
eq(testStageCiVerdict('canceled'), 'nogate', 'no docker → nogate (an un-runnable gate never wedges the ticket)');
eq(testStageCiVerdict('running'), 'nogate', 'a transient/unknown status → nogate');
eq(testStageCiVerdict('weird'), 'nogate', 'an unknown status defaults to nogate (fail-open, never a false block)');

report('tests/unit/ciGate.test.mts');
