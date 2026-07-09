//? H5 — the fair-drain selector (pure). Verifies round-robin across workspaces: the parked turn from the
//? LEAST-loaded workspace is served first (so one workspace can't starve the others), with FIFO within a
//? workspace (strict-less-than on ties keeps the earliest).

import { assert, eq, report } from '../_helpers.mts';
import { pickFairNext } from '../../server/orchestrator/capacity.ts';

const t = (workspaceId: string, key: string) => ({ workspaceId, key, stageId: 'code' });

// least-loaded workspace wins even though it's LAST in the queue
{
  const items = [t('wsA', 'A-1'), t('wsA', 'A-2'), t('wsB', 'B-1')];
  const pick = pickFairNext(items, { wsA: 2, wsB: 0 });
  eq(pick?.item.key, 'B-1', 'the idle workspace (wsB, 0 in-flight) is served before the busy one');
  eq(pick?.index, 2, 'its queue index is returned for removal');
}

// a workspace absent from the in-flight map counts as 0 (served first)
{
  const items = [t('wsA', 'A-1'), t('wsC', 'C-1')];
  const pick = pickFairNext(items, { wsA: 3 });
  eq(pick?.item.key, 'C-1', 'wsC (no slots held) beats wsA (3 held)');
}

// FIFO within equal load — the earliest queued wins on a tie
{
  const items = [t('wsA', 'A-1'), t('wsB', 'B-1'), t('wsA', 'A-2')];
  const pick = pickFairNext(items, { wsA: 1, wsB: 1 });
  eq(pick?.index, 0, 'all equally loaded → the head of the queue (FIFO)');
}

eq(pickFairNext([], {}), null, 'empty queue → null');

report('tests/unit/capacityFairness.test.mts');
