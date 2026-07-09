//? H2 — per-user spend attribution + budget check (pure). Verifies aggregateByUser groups tokens/cost per user
//? (unattributed → 'system', sorted by total tokens desc) and userBudgetExceeded gates on a per-user token cap.

import { assert, eq, report } from '../_helpers.mts';
import { aggregateByUser, userBudgetExceeded } from '../../server/spend/record.ts';

{
  const rows = [
    { userId: 'u1', tokensIn: 100, tokensOut: 50, costEstimate: 0.1 },
    { userId: 'u1', tokensIn: 100, tokensOut: 50, costEstimate: 0.1 },
    { userId: 'u2', tokensIn: 10, tokensOut: 5, costEstimate: 0 },
    { userId: null, tokensIn: 20, tokensOut: 0, costEstimate: 0 },
  ];
  const agg = aggregateByUser(rows);
  eq(agg.length, 3, 'three distinct spenders (u1, u2, system)');
  eq(agg[0].userId, 'u1', 'the heaviest user is first');
  eq(agg[0].tokensIn, 200, 'u1 tokens summed');
  eq(agg[0].turns, 2, 'u1 turns counted');
  assert(Math.abs(agg[0].costEstimate - 0.2) < 1e-9, 'u1 cost summed');
  assert(agg.some((u) => u.userId === 'system'), 'unattributed rows land under system');
}
eq(aggregateByUser([]).length, 0, 'no rows → no users');

// per-user budget check
assert(!userBudgetExceeded(500, 0), 'cap 0 → no cap → never exceeded');
assert(!userBudgetExceeded(500, 1000), 'under cap → not exceeded');
assert(userBudgetExceeded(1000, 1000), 'at cap → exceeded');
assert(userBudgetExceeded(1500, 1000), 'over cap → exceeded');

report('tests/unit/userSpend.test.mts');
