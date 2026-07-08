//? M3 — the long-form planner end-to-end: runContentPipeline with a target DURATION produces ~N beats/scenes
//? (each ≈ sceneDuration). Runs against the REAL Mongo in the deterministic STUB world (no keys → the stub
//? script yields exactly the planned beat count), so it's free + deterministic. Cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { runContentPipeline } = await import('../../server/content/runPipeline');
const { planBeatCount } = await import('../../server/content/script');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `lf-${String(stamp)}@youcomm.nl`, name: 'LF' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'LF WS' }, userId: owner.id, clientRequestId: `lf-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));

  //? A content piece with a brief (the moon landing) — the pipeline scripts + decomposes from this.
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', title: 'Moon landing', brief: 'the first moon landing, in stick-man figures' } });

  //? A "long" target (35s @ 5s/scene → 7 beats). Stub world → the stub script yields exactly the plan.
  const durationMs = 35_000;
  const sceneDurationMs = 5000;
  const expected = planBeatCount(durationMs, sceneDurationMs);
  eq(expected, 7, 'the planner asks for 7 beats for a 35s target');

  const r = await runContentPipeline(prisma, { workspaceId: wsId, contentProjectId: piece.id, mode: 'video', durationMs, sceneDurationMs });
  assert(r.ranScript, 'the pipeline generated a script');
  const script = await prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: piece.id }, orderBy: { createdAt: 'desc' } });
  const beatCount = await prisma.beat.count({ where: { workspaceId: wsId, scriptId: script?.id ?? '' } });
  eq(beatCount, expected, `the long-form script produced ${String(expected)} beats (planned from the duration target)`);

  //? M4 — re-running the pipeline with a NEW duration REGENERATES the script (was: reused the old one, so the
  //? new length was ignored). 60s @ 5s/scene → 12 beats, replacing the 7.
  await runContentPipeline(prisma, { workspaceId: wsId, contentProjectId: piece.id, mode: 'video', durationMs: 60_000, sceneDurationMs });
  const script60 = await prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: piece.id }, orderBy: { createdAt: 'desc' } });
  const beats60 = await prisma.beat.count({ where: { workspaceId: wsId, scriptId: script60?.id ?? '' } });
  eq(beats60, planBeatCount(60_000, sceneDurationMs), 'a re-run with a new duration regenerates the script to the new beat count');

  //? A default run (no duration) uses the 4-beat arc — the planner only kicks in with a target.
  const piece2 = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', title: 'Short', brief: 'a quick short' } });
  await runContentPipeline(prisma, { workspaceId: wsId, contentProjectId: piece2.id, mode: 'video' });
  const script2 = await prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: piece2.id }, orderBy: { createdAt: 'desc' } });
  const beats2 = await prisma.beat.count({ where: { workspaceId: wsId, scriptId: script2?.id ?? '' } });
  eq(beats2, 4, 'no duration target → the default 4-beat arc');
  console.log(`[lf] ✓ long-form: ${String(beatCount)} beats for 35s; default: ${String(beats2)} beats`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/longFormPipeline.test.mts');
