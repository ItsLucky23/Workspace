//? Integration test for V4 (IDEA_TO_OUTCOME) — content-refine-range. Real Conductor + Mongo. Selecting a time
//? range regenerates the covered scene(s) as NEW versions (parentId lineage) with the instruction folded in,
//? keeping the timeline shape. B-23: the Conductor is the writer.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 12_000, stepMs = 80): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rr-${String(stamp)}@youcomm.nl`, name: 'RR' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'RR WS' }, userId: owner.id, clientRequestId: `rr-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  const wsId = ws?.id ?? '';
  workspaceId = ws?.id ?? null;

  await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { title: 'Refine test', brief: 'x', format: 'faceless' }, userId: owner.id, clientRequestId: `rr-p-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Refine test' } }));
  const pieceId = piece?.id ?? '';

  //? Three 15s scenes → timeline [0-15), [15-30), [30-45)s.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-save-scenes', target: {}, payload: { contentProjectId: pieceId, scenes: [
    { videoAssetId: 'clip0', durationMs: 15_000, prompt: 'the opening' },
    { videoAssetId: 'clip1', durationMs: 15_000, prompt: 'the middle' },
    { videoAssetId: 'clip2', durationMs: 15_000, prompt: 'the ending' },
  ] }, userId: owner.id, clientRequestId: `rr-save-${String(stamp)}` });
  const saved = await poll(async () => { const s = await prisma.videoScene.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId } }); return s.length === 3 ? s : null; });
  assert(saved !== null, 'three scenes saved');
  const origIds = new Set(saved?.map((s) => s.id));

  //? Refine 13–18s → covers scene 0 (0-15) + scene 1 (15-30).
  await enqueueControlAction({ workspaceId: wsId, op: 'content-refine-range', target: {}, payload: { contentProjectId: pieceId, startMs: 13_000, endMs: 18_000, instruction: 'smoother transition and clearer voice' }, userId: owner.id, clientRequestId: `rr-ref-${String(stamp)}` });
  //? Wait until 2 scenes carry a parentId (the two refined versions).
  const after = await poll(async () => { const s = await prisma.videoScene.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId }, orderBy: { order: 'asc' } }); return s.filter((x) => x.parentId).length === 2 ? s : null; });
  assert(after !== null && after.length === 3, 'the timeline still has 3 scenes (refined in place, not appended)');
  const refined = after?.filter((s) => s.parentId) ?? [];
  eq(refined.length, 2, 'exactly the two covered scenes were refined');
  assert(refined.every((s) => origIds.has(s.parentId ?? '')), 'each refined scene links its ORIGINAL as parent (lineage)');
  assert(refined.every((s) => (s.prompt ?? '').includes('Refinement: smoother transition and clearer voice')), 'the refinement instruction is folded into the new prompt');
  //? Scene 2 (30-45s) was outside the range → untouched (still an original id, no parent).
  const untouched = after?.find((s) => s.order === 2);
  assert(untouched !== undefined && !untouched.parentId && origIds.has(untouched.id), 'the out-of-range scene is untouched');

  //? A range that hits nothing does nothing.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-refine-range', target: {}, payload: { contentProjectId: pieceId, startMs: 100_000, endMs: 120_000, instruction: 'noop' }, userId: owner.id, clientRequestId: `rr-noop-${String(stamp)}` });
  await wait(400);
  eq((await prisma.videoScene.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId } })).length, 3, 'an out-of-range refine is a no-op');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/refineRange.test.mts');
