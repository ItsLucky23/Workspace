//? Spike — verify the multi-instance coordination primitives (Deel A) against real Redis, the
//? contention behaviour the integration happy-path can't show:
//?  1. claimActionOnce: the first claim wins, a duplicate re-send is dropped.
//?  2. withWorkspaceLease: two CONCURRENT critical sections on the SAME workspace are serialised
//?     (never overlap) — the cross-instance single-writer guarantee.
//?  3. withWorkspaceLease: two concurrent sections on DIFFERENT workspaces DO overlap (no
//?     head-of-line blocking — unrelated workspaces run in parallel).
//? Run (needs the Redis tunnel :6380): `npx tsx scripts/spike/clusterSpike.mts`

import { db } from '../../tests/_helpers.mts';

await db(); //? bootstraps env + registers the prisma/redis clients the primitives use

const { withWorkspaceLease, claimActionOnce } = await import('../../server/orchestrator/cluster');

const ok = (label: string, cond: boolean): void => { console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

//? 1. Dedup — first true, duplicate false.
const key = `spike-${String(process.pid)}-${String(Math.floor(Math.random() * 1e9))}`;
const first = await claimActionOnce(key);
const dup = await claimActionOnce(key);
ok('claimActionOnce: first wins, duplicate dropped', first && !dup);

//? 2. Same-workspace mutual exclusion — record enter/exit; the two windows must NOT overlap.
const wsA = `spikeA-${String(process.pid)}`;
const windows: { id: number; enter: number; exit: number }[] = [];
const section = (id: number, holdMs: number) => withWorkspaceLease(wsA, async () => {
  const enter = Date.now();
  await sleep(holdMs);
  const exit = Date.now();
  windows.push({ id, enter, exit });
});
await Promise.all([section(1, 250), section(2, 250)]);
const [w1, w2] = windows.sort((a, b) => a.enter - b.enter);
const noOverlap = w1.exit <= w2.enter + 15; //? small clock slack
ok('withWorkspaceLease: same workspace serialised (no overlap)', windows.length === 2 && noOverlap);

//? 3. Different-workspace parallelism — two sections on distinct workspaces should overlap.
const stamps: { enter: number; exit: number }[] = [];
const par = (ws: string) => withWorkspaceLease(ws, async () => {
  const enter = Date.now();
  await sleep(250);
  stamps.push({ enter, exit: Date.now() });
});
await Promise.all([par(`spikeB-${String(process.pid)}`), par(`spikeC-${String(process.pid)}`)]);
const overlap = stamps.length === 2 && Math.min(stamps[0].exit, stamps[1].exit) > Math.max(stamps[0].enter, stamps[1].enter);
ok('withWorkspaceLease: different workspaces run in parallel', overlap);

console.log('done');
process.exit(0);
