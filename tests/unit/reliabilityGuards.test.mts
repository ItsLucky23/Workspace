//? GAP_SCAN Phase D/E — the pure halves: the AI job queue (D1), the tool-call audit trail parser (D2),
//? rollback target selection (D3), the report-first tenant guard (E2) and the egress posture (E3).

import { Semaphore, CircuitBreaker, runQueued, resetAiBreakers, aiQueueStatus } from '../../server/ai/jobQueue.ts';
import { parseToolCallLine, describeToolCall, toolEventType, parseToolTrail } from '../../server/orchestrator/toolTrail.ts';
import { previousLiveCommit } from '../../server/deploy/deployHistory.ts';
import { withTenant, tenantGuardReport, resetTenantGuardReport } from '../../server/tenant/tenantGuard.ts';
import { runInTenant } from '../../server/tenant/tenantContext.ts';
import { egressMode, egressReport, noteUnconfinedWorker, resetEgressReport } from '../../server/container/egress.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ D1: concurrency cap */

const sem = new Semaphore(2);
let peak = 0;
let active = 0;
const slow = async (): Promise<void> => {
  active += 1;
  peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, 20));
  active -= 1;
};
await Promise.all(Array.from({ length: 8 }, () => sem.run(slow)));
eq(peak, 2, 'at most K jobs run at once (a burst of 8 never exceeds the cap)');
eq(sem.inFlight, 0, 'every slot is released afterwards');
eq(sem.queued, 0, 'and nothing is left queued');

//? A throwing job must not leak its slot — otherwise one failure permanently shrinks the pool.
const sem2 = new Semaphore(1);
await sem2.run(async () => { await Promise.resolve(); }).catch(() => null);
await sem2.run(async () => { await Promise.resolve(); throw new Error('boom'); }).catch(() => null);
eq(sem2.inFlight, 0, 'a throwing job still releases its slot');
await sem2.run(async () => { await Promise.resolve(); });
eq(sem2.inFlight, 0, 'and the pool still works after a failure');

/* ------------------------------------------------------------ D1: circuit breaker */

const T = 1_000_000;
const breaker = new CircuitBreaker(3, 60_000);
eq(breaker.state(T), 'closed', 'a fresh breaker is closed');
assert(breaker.allow(T), 'and lets calls through');
breaker.failure(T); breaker.failure(T);
eq(breaker.state(T), 'closed', 'below the threshold it stays closed');
breaker.failure(T);
eq(breaker.state(T), 'open', 'the threshold trips it open');
assert(!breaker.allow(T + 1000), 'an open circuit fails fast');
eq(breaker.state(T + 60_001), 'half-open', 'after the cooldown it goes half-open');
assert(breaker.allow(T + 60_001), 'the first probe is allowed through');
assert(!breaker.allow(T + 60_002), 'but only ONE probe — the rest still fail fast (no stampede)');
breaker.success();
eq(breaker.state(T + 60_003), 'closed', 'a successful probe closes it again');

//? A failing probe re-opens the circuit rather than letting the next caller through.
const b2 = new CircuitBreaker(1, 1000);
b2.failure(T);
assert(b2.allow(T + 1001), 'half-open probe allowed');
b2.failure(T + 1001);
assert(!b2.allow(T + 1002), 'a failed probe re-opens the circuit');

/* ------------------------------------------------------------ D1: the shared queue */

resetAiBreakers();
let calls = 0;
const failing = async (): Promise<{ ok: boolean }> => { calls += 1; await Promise.resolve(); return { ok: false }; };
for (let i = 0; i < 8; i++) {
  await runQueued({ key: 'flaky-provider', run: failing, isFailure: (r) => !r.ok, onCircuitOpen: () => ({ ok: false }) });
}
assert(calls < 8, 'once the provider keeps failing, later calls fail FAST instead of hitting it');
assert(aiQueueStatus().breakers.some((b) => b.key === 'flaky-provider' && b.state !== 'closed'), 'the provider circuit is visible as open');
resetAiBreakers();

/* ------------------------------------------------------------ D2: tool-call trail */

eq(parseToolCallLine(''), null, 'a blank line is skipped');
eq(parseToolCallLine('not json'), null, 'a non-JSON line is skipped (hook output is another process stdout)');
eq(parseToolCallLine('{"broken":'), null, 'a truncated line is skipped, not thrown on');
eq(parseToolCallLine('{"foo":1}'), null, 'a payload with no tool name is skipped');

const edit = parseToolCallLine('{"tool_name":"Edit","tool_input":{"file_path":"src/app.ts"}}');
eq(edit?.tool, 'Edit', 'the tool name is read');
eq(toolEventType(edit!), 'file-change', 'a write tool is a file-change event');
eq(describeToolCall(edit!), 'Edit: src/app.ts', 'the feed line names the file');

const bash = parseToolCallLine('{"tool":"Bash","input":{"command":"npm test"}}');
eq(toolEventType(bash!), 'command', 'shell is a command event');
eq(describeToolCall(bash!), 'Bash: npm test', 'the feed line names the command');

const failed = parseToolCallLine('{"tool_name":"Bash","tool_input":{"command":"npm test"},"tool_response":{"error":"exit 1"}}');
eq(failed?.ok, false, 'an error response marks the call failed');
assert(describeToolCall(failed!).endsWith('(failed)'), 'and the feed line says so');

const trail = parseToolTrail([
  '{"tool_name":"Read","tool_input":{"file_path":"a.ts"}}',
  'garbage',
  '{"tool_name":"Edit","tool_input":{"file_path":"b.ts"}}',
  '{"tool_name":"Bash","tool_input":{"command":"git commit"}}',
].join('\n'));
eq(trail.length, 3, 'the malformed line is dropped, the rest survive');
eq(trail.map((t) => t.type), ['tool-use', 'file-change', 'command'], 'order is preserved (that IS the audit value)');
eq(trail[1]?.metadata.changedFiles, ['b.ts'], 'a file-change records which file');
assert(trail[0]?.metadata.changedFiles === undefined, 'a read does not claim to have changed anything');

const many = parseToolTrail(Array.from({ length: 300 }, (_, i) => `{"tool_name":"Read","tool_input":{"file_path":"f${String(i)}.ts"}}`).join('\n'), 100);
eq(many.length, 100, 'the trail is bounded');
assert(many.at(-1)?.text.includes('f299'), 'and keeps the NEWEST calls (the tail is what a reviewer reads)');

/* ------------------------------------------------------------ D3: rollback target */

eq(previousLiveCommit([], null), null, 'no history → nothing to roll back to');
eq(previousLiveCommit([{ commit: 'aaa', status: 'error' }], null), null, 'a failed deploy is not a rollback target');
eq(previousLiveCommit([{ commit: 'bbb', status: 'live' }], 'bbb'), null, 'the CURRENTLY live commit is not a rollback target');
eq(previousLiveCommit([{ commit: 'ccc', status: 'error' }, { commit: 'bbb', status: 'live' }, { commit: 'aaa', status: 'live' }], 'ccc'), 'bbb', 'rolls back to the newest earlier LIVE commit');

/* ------------------------------------------------------------ E2: tenant guard (report-first) */

resetTenantGuardReport();
eq(withTenant('ws-1', 'test.scope', () => 'ran'), 'ran', 'the work runs inside the scope');
let observed = tenantGuardReport();
eq(observed.missingScope, 1, 'a call with no ambient scope is recorded (what enforcement would reject)');
eq(observed.mismatches, 0, 'and it is not a mismatch — it is simply unscoped work');

runInTenant('ws-1', () => { withTenant('ws-1', 'test.scope', () => 'same'); });
observed = tenantGuardReport();
eq(observed.mismatches, 0, 're-entering the SAME workspace is not a mismatch');

runInTenant('ws-1', () => { withTenant('ws-2', 'test.crosstenant', () => 'other'); });
observed = tenantGuardReport();
eq(observed.mismatches, 1, 'switching tenants mid-flight IS a mismatch (the dangerous case)');
assert(observed.byLabel.some((l) => l.label === 'test.crosstenant' && l.mismatches === 1), 'the report names the offending call site');
resetTenantGuardReport();

/* ------------------------------------------------------------ E3: egress posture */

const prevEgress = process.env.WS_EGRESS;
delete process.env.WS_EGRESS;
eq(egressMode(), 'report', 'unset defaults to REPORT (was: silently open)');
process.env.WS_EGRESS = '1';
eq(egressMode(), 'enforce', 'WS_EGRESS=1 enforces confinement');
process.env.WS_EGRESS = '0';
eq(egressMode(), 'off', 'WS_EGRESS=0 is an explicit opt-out (no reporting noise)');
if (prevEgress === undefined) delete process.env.WS_EGRESS; else process.env.WS_EGRESS = prevEgress;

resetEgressReport();
noteUnconfinedWorker(T);
noteUnconfinedWorker(T + 5);
const eg = egressReport();
eq(eg.unconfinedLaunches, 2, 'unconfined worker launches are counted for the review');
assert(eg.allowlist.includes('.anthropic.com'), 'the report shows what confinement WOULD allow');
resetEgressReport();

report('reliabilityGuards');
