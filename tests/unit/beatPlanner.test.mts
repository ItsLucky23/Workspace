//? M3 — the long-form beat/scene planner. Pure: a target duration maps to ~N beats (each ≈ sceneDuration),
//? bounded to [2, 40]; no/zero target → 0 (use the default arc).

import { planBeatCount } from '../../server/content/script.ts';
import { eq, report } from '../_helpers.mts';

eq(planBeatCount(30_000, 5000), 6, '30s @ 5s/scene → 6 beats');
eq(planBeatCount(60_000, 5000), 12, '60s @ 5s/scene → 12 beats');
eq(planBeatCount(15_000, 5000), 3, '15s @ 5s/scene → 3 beats');
eq(planBeatCount(600_000, 5000), 40, '10 min @ 5s/scene → capped at 40 beats (budget is the hard cap)');
eq(planBeatCount(1000, 5000), 2, 'a tiny duration floors at 2 beats');
eq(planBeatCount(null), 0, 'no target → 0 (default arc)');
eq(planBeatCount(0, 5000), 0, 'zero target → 0');
eq(planBeatCount(20_000, 10_000), 2, '20s @ 10s/scene → 2 beats');

report('tests/unit/beatPlanner.test.mts');
