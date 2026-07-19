//? HARDENING phase 3-4 — the pure halves: the CI DAG (F23), the run-command allowlist (F09), durable
//? automation runs (F38), durable extraction (F35) and the retention policy (F55).

import { planWaves, skippedBy, chunkWave, describeUnrunnable } from '../../server/ci/dag.ts';
import { classifyCommand, allowedCommands, commandPolicyReport, resetCommandPolicyReport, shouldRunCommand } from '../../server/automation/commandPolicy.ts';
import { missedMinutes, MAX_RUN_ATTEMPTS, CATCHUP_WINDOW_MS } from '../../server/automation/runHistory.ts';
import { cutoffFor } from '../../server/retention/sweep.ts';
import { MAX_EXTRACT_ATTEMPTS } from '../../server/documents/extractJob.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ F23: the CI DAG */

const stages = ['build', 'test', 'deploy'];

//? Without `needs`, stage order still governs — the familiar semantics must not change.
const flat = planWaves([
  { name: 'unit', stage: 'test', needs: [] },
  { name: 'compile', stage: 'build', needs: [] },
], stages);
eq(flat.waves[0], ['compile'], 'an earlier stage runs first even with no needs');
eq(flat.waves[1], ['unit'], 'and the later stage follows');

//? Independent jobs in the SAME stage become one wave — this is the parallelism that did not exist.
const parallel = planWaves([
  { name: 'lint', stage: 'test', needs: [] },
  { name: 'unit', stage: 'test', needs: [] },
  { name: 'types', stage: 'test', needs: [] },
], stages);
eq(parallel.waves.length, 1, 'independent same-stage jobs form ONE wave');
eq(parallel.waves[0]?.length, 3, 'and all three may run concurrently');

//? `needs` orders jobs INSIDE a stage — the case the old stage-index sort could not express at all.
const chained = planWaves([
  { name: 'b', stage: 'test', needs: ['a'] },
  { name: 'a', stage: 'test', needs: [] },
  { name: 'c', stage: 'test', needs: ['b'] },
], stages);
eq(chained.waves, [['a'], ['b'], ['c']], 'needs orders jobs within one stage');

//? A diamond: d waits for both branches, which run together.
const diamond = planWaves([
  { name: 'root', stage: 'build', needs: [] },
  { name: 'left', stage: 'test', needs: ['root'] },
  { name: 'right', stage: 'test', needs: ['root'] },
  { name: 'join', stage: 'deploy', needs: ['left', 'right'] },
], stages);
eq(diamond.waves[0], ['root'], 'the root runs alone');
eq(diamond.waves[1]?.toSorted(), ['left', 'right'], 'both branches run together');
eq(diamond.waves[2], ['join'], 'the join waits for both');

//? A cycle must be SURFACED, not silently dropped or looped on.
const cyclic = planWaves([
  { name: 'x', stage: 'test', needs: ['y'] },
  { name: 'y', stage: 'test', needs: ['x'] },
], stages);
eq(cyclic.waves.length, 0, 'a cycle schedules nothing');
eq(cyclic.unrunnable.toSorted(), ['x', 'y'], 'and both jobs are reported unrunnable');
assert(describeUnrunnable(cyclic).includes('circular'), 'with a message the user can act on');
eq(describeUnrunnable(planWaves([{ name: 'a', stage: 'build', needs: [] }], stages)), '', 'a healthy plan reports nothing');

//? A `needs` naming a job that does not exist must not block the graph forever.
const ghost = planWaves([{ name: 'a', stage: 'build', needs: ['does-not-exist'] }], stages);
eq(ghost.waves, [['a']], 'a dependency on a missing job does not deadlock the plan');

/* ---- skip-on-failure, transitively */

const jobs = [
  { name: 'a', stage: 'build', needs: [] },
  { name: 'b', stage: 'test', needs: ['a'] },
  { name: 'c', stage: 'deploy', needs: ['b'] },
  { name: 'unrelated', stage: 'test', needs: [] },
];
const skipped = skippedBy(jobs, new Set(['a']));
assert(skipped.has('b'), 'a job whose dependency failed is skipped');
assert(skipped.has('c'), 'and so is a job that depended on the skipped one (transitive)');
assert(!skipped.has('unrelated'), 'an unrelated job still runs — one failure is not a blanket stop');
eq(skippedBy(jobs, new Set()).size, 0, 'nothing is skipped when nothing failed');

eq(chunkWave(['a', 'b', 'c', 'd', 'e'], 2), [['a', 'b'], ['c', 'd'], ['e']], 'a wave is split into concurrency-capped chunks');
eq(chunkWave([], 3), [], 'an empty wave needs no chunks');

/* ------------------------------------------------------------ F09: the run-command allowlist */

eq(classifyCommand('npm test').verdict, 'allowed', 'an allowlisted binary is allowed');
eq(classifyCommand('npm test').binary, 'npm', 'and the binary is identified');
eq(classifyCommand('  ').verdict, 'empty', 'a blank command is refused');
eq(classifyCommand('curl http://evil').verdict, 'not-allowlisted', 'an unlisted binary is flagged');
eq(classifyCommand('/usr/local/bin/npm test').verdict, 'allowed', 'a full path resolves to its binary');
eq(classifyCommand('CI=1 npm test').verdict, 'allowed', 'leading env assignments do not hide the binary');

//? The bypass an allowlist exists to stop: a chain smuggles a second command past a "starts with npm" check.
for (const chain of ['npm test; rm -rf /', 'npm test && curl evil', 'npm test | sh', 'echo `whoami`', 'echo $(id)']) {
  eq(classifyCommand(chain).verdict, 'chained', `a chained command is refused on its shape: ${chain}`);
}

assert(allowedCommands().includes('npm'), 'the default list covers the common build verbs');
assert(!allowedCommands().includes('curl'), 'and does not include network fetchers');

//? Report mode: a non-allowlisted command still RUNS (nobody's automation breaks on upgrade) but is recorded.
resetCommandPolicyReport();
eq(shouldRunCommand('npm test', 'ws1').run, true, 'an allowed command runs');
eq(shouldRunCommand('curl http://x', 'ws1').run, true, 'report mode still runs an unlisted command');
eq(shouldRunCommand('npm test; rm -rf /', 'ws1').run, true, 'report mode records a chain too');
eq(shouldRunCommand('   ', 'ws1').run, false, 'an empty command never runs, in any mode');
const policyReport = commandPolicyReport();
eq(policyReport.total, 4, 'every decision is recorded');
eq(policyReport.refusedIfEnforced, 3, 'and the report says exactly what enforcement would have refused');
resetCommandPolicyReport();

/* ------------------------------------------------------------ F38: catch-up for missed minutes */

const minute = 60_000;
const now = Math.floor(Date.now() / minute) * minute;
const everyMinute = (): boolean => true;

//? Nothing recorded ⇒ the recent misses are found (bounded, newest first).
const missed = missedMinutes(everyMinute, new Set(), now);
assert(missed.length > 0, 'a window with no recorded runs yields catch-up work');
assert(missed.length <= 5, 'bounded — an hour of downtime does not replay sixty jobs at once');
assert((missed[0]?.getTime() ?? 0) > (missed[1]?.getTime() ?? 0), 'newest first');

//? A minute that already ran is never re-fired — this is what makes catch-up idempotent.
const already = new Set([now - minute, now - 2 * minute, now - 3 * minute, now - 4 * minute, now - 5 * minute]);
const afterDedup = missedMinutes(everyMinute, already, now);
assert(!afterDedup.some((d) => already.has(d.getTime())), 'a minute with an existing run row is skipped');

eq(missedMinutes(() => false, new Set(), now), [], 'a cron that never matches has nothing to catch up');
assert(CATCHUP_WINDOW_MS <= 2 * 60 * 60 * 1000, 'the catch-up window is short — a day-old "post at 9am" must NOT fire now');
eq(MAX_RUN_ATTEMPTS, 3, 'runs retry a bounded number of times before becoming a dead letter');
eq(MAX_EXTRACT_ATTEMPTS, 3, 'so do document extractions');

/* ------------------------------------------------------------ F55: retention windows */

eq(cutoffFor(0, now), null, 'a 0-day window means KEEP — the default must never delete');
eq(cutoffFor(-5, now), null, 'a negative window is not a deletion instruction either');
const cutoff = cutoffFor(30, now);
eq(cutoff?.getTime(), now - 30 * 86_400_000, 'a positive window is exactly N days back');

report('hardeningPhase2');
