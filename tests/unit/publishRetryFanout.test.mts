//? GAP_SCAN A1/A3 — the pure halves of the autopilot flagship: the scheduled-task channel SET (A1) and the
//? bounded publish retry/backoff maths incl. rate-limit awareness (A3). No DB, no network.

import { paramChannelIds } from '../../server/content/ideatorRole.ts';
import { publishRetryDelayMs, isRateLimitReason, MAX_PUBLISH_ATTEMPTS } from '../../server/content/publish.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ A1: channel set */

eq(paramChannelIds({ channelIds: ['a', 'b', 'c'] }), ['a', 'b', 'c'], 'channelIds[] is taken as the target set');
eq(paramChannelIds({ channelId: 'solo' }), ['solo'], 'the legacy single channelId still works');
eq(paramChannelIds({ channelIds: ['a'], channelId: 'a' }), ['a'], 'the legacy id is de-duped against the set');
eq(paramChannelIds({ channelIds: ['a'], channelId: 'b' }), ['a', 'b'], 'both sources merge, order preserved');
eq(paramChannelIds({}), [], 'no channel params → no targets (theme-only run)');
eq(paramChannelIds({ channelIds: 'nope' }), [], 'a non-array channelIds is ignored');
eq(paramChannelIds({ channelIds: ['a', '', '  ', 42] }), ['a'], 'blank/non-string entries are dropped');

/* ------------------------------------------------------------ A3: retry backoff */

assert(MAX_PUBLISH_ATTEMPTS === 3, 'the retry bound is 3 attempts');
//? Exponential: attempt 1 = base, attempt 2 = 2x base.
const d1 = publishRetryDelayMs(1);
const d2 = publishRetryDelayMs(2);
assert(d1 > 0, 'the first retry is delayed');
eq(d2, d1 * 2, 'the backoff doubles per attempt');

//? A 429 / rate-limit reason backs off much harder than a generic failure.
assert(isRateLimitReason('HTTP 429 Too Many Requests'), 'a 429 is detected');
assert(isRateLimitReason('rate limit exceeded'), 'a rate-limit phrase is detected');
assert(isRateLimitReason('Too Many Requests'), 'the plain phrase is detected');
assert(!isRateLimitReason('connection reset'), 'a generic network error is not a rate limit');
assert(!isRateLimitReason(undefined), 'no reason is not a rate limit');
assert(publishRetryDelayMs(1, 'HTTP 429') > publishRetryDelayMs(1, 'boom'), 'a rate-limited retry waits longer than a generic one');

report('publishRetryFanout');
