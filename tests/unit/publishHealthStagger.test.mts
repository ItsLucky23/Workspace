//? GAP_SCAN A5/A6 — the pure per-channel health roll-up and the burst-staggering plan. No DB, no clock.

import { buildChannelHealth, staggerPlan, accountKey, type HealthJobLite, type HealthChannelLite } from '../../server/content/publishHealth.ts';
import { assert, eq, report } from '../_helpers.mts';

const T = 1_700_000_000_000;
const at = (mins: number): Date => new Date(T + mins * 60_000);

const channels: HealthChannelLite[] = [
  { id: 'c-yt', name: 'Main YT', platform: 'youtube', defaultAccountId: 'acc1' },
  { id: 'c-tt', name: 'Shorts TT', platform: 'tiktok', defaultAccountId: null },
  { id: 'c-new', name: 'Fresh', platform: 'youtube', defaultAccountId: 'acc2' },
];
const byId = (rows: ReturnType<typeof buildChannelHealth>, id: string) => rows.find((r) => r.channelId === id);

/* ------------------------------------------------------------ A5 */

const jobs: HealthJobLite[] = [
  { platform: 'youtube', accountId: 'acc1', status: 'done', error: null, updatedAt: at(0) },
  { platform: 'youtube', accountId: 'acc1', status: 'error', error: 'publish.uploadFailed', updatedAt: at(10) },
  { platform: 'youtube', accountId: 'acc1', status: 'done', error: null, updatedAt: at(20) },
  { platform: 'tiktok', accountId: null, status: 'done', error: null, updatedAt: at(5) },
  { platform: 'tiktok', accountId: null, status: 'error', error: 'quota', updatedAt: at(30) },
];

const health = buildChannelHealth(channels, jobs);
eq(health.length, 3, 'every channel gets a health row');

const yt = byId(health, 'c-yt');
eq(yt?.state, 'warn', 'a channel that failed but recovered is warn, not down');
eq(yt?.posts, 2, 'successes are counted');
eq(yt?.failures, 1, 'failures are counted');
eq(yt?.lastSuccessAt, at(20).getTime(), 'the last success is the NEWEST success');

const tt = byId(health, 'c-tt');
eq(tt?.state, 'down', 'a channel whose latest attempt failed is down');
eq(tt?.lastError, 'quota', 'the failure reason is carried for the UI');

const fresh = byId(health, 'c-new');
eq(fresh?.state, 'idle', 'a channel that never posted is idle, not broken');
eq(fresh?.posts, 0, 'an idle channel has no posts');

//? A stub counts as a successful post (it is an honest "no connection" outcome, not a failure).
const stubbed = buildChannelHealth([channels[0]!], [{ platform: 'youtube', accountId: 'acc1', status: 'stub', error: null, updatedAt: at(1) }]);
eq(stubbed[0]?.state, 'ok', 'a stub-only channel is ok');

//? A4 crossover: a dead OAuth connection forces `down` even with a clean post history.
const dead = buildChannelHealth([channels[0]!], jobs, new Set([accountKey('youtube', 'acc1')]));
eq(dead[0]?.state, 'down', 'a needsReconnect account is down regardless of history');
assert(dead[0]?.needsReconnect === true, 'the reconnect flag is carried through');

//? Jobs from ANOTHER account never leak into a channel's health.
const isolated = buildChannelHealth([channels[2]!], jobs);
eq(isolated[0]?.posts, 0, 'jobs are matched per (platform, account), not per platform');

/* ------------------------------------------------------------ A6 */

const due = [
  { id: 'j1', platform: 'youtube', accountId: 'acc1' },
  { id: 'j2', platform: 'youtube', accountId: 'acc1' },
  { id: 'j3', platform: 'youtube', accountId: 'acc1' },
  { id: 'j4', platform: 'tiktok', accountId: null },
];
const plan = staggerPlan(due, T, 300_000);
assert(!plan.has('j1'), 'the first job per account fires immediately');
eq(plan.get('j2'), T + 300_000, 'the second is pushed out one interval');
eq(plan.get('j3'), T + 600_000, 'the third is pushed out two intervals');
assert(!plan.has('j4'), 'a different account is not throttled by the first account burst');
eq(plan.size, 2, 'only the deferred jobs are returned');

eq(staggerPlan(due, T, 0).size, 0, 'staggering off (0 spacing) defers nothing');
eq(staggerPlan([], T, 300_000).size, 0, 'an empty tick plans nothing');
eq(staggerPlan([due[0]!], T, 300_000).size, 0, 'a single due job is never delayed');

report('publishHealthStagger');
