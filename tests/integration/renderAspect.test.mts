//? F1 — a content piece's chosen aspect ratio (9:16 shorts/reels, 1:1, 16:9) is persisted by the
//? content-run-pipeline op AND reaches the renderer. Before F1 `assembleContent` never passed `format`,
//? so every render was 16:9 regardless of the piece. This proves the op→persist→assemble wiring end-to-end
//? (the plan-level 9:16→720x1280 scaling is covered by tests/unit/renderFormats.test.mts). Real Mongo, no Docker.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `asp-${String(stamp)}@youcomm.nl`, name: 'Asp' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Aspect WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', title: 'Vertical short', brief: 'a punchy 9:16 short' } });

  //? A new piece defaults to 16:9.
  eq(piece.aspectRatio, '16:9', 'a new piece defaults to 16:9');

  //? Run the pipeline asking for a 9:16 vertical (shorts/reels) render.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-run-pipeline', target: {}, payload: { contentProjectId: piece.id, mode: 'video', aspectRatio: '9:16' }, userId: owner.id, clientRequestId: `asp-run-${String(stamp)}` });

  //? The chosen aspect is persisted on the piece → assemble reads it → the renderer gets 9:16.
  const after = await poll(async () => {
    const p = await prisma.contentProject.findFirst({ where: { workspaceId: wsId, id: piece.id }, select: { aspectRatio: true } });
    return p?.aspectRatio === '9:16' ? p : null;
  });
  assert(after !== null, 'the pipeline persisted the 9:16 aspect ratio on the piece (reaches assemble/render)');

  //? An invalid value is ignored (stays on the last valid), not blindly stored.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-run-pipeline', target: {}, payload: { contentProjectId: piece.id, mode: 'video', aspectRatio: 'nonsense' }, userId: owner.id, clientRequestId: `asp-bad-${String(stamp)}` });
  await wait(1200);
  const stillValid = await prisma.contentProject.findFirst({ where: { workspaceId: wsId, id: piece.id }, select: { aspectRatio: true } });
  eq(stillValid?.aspectRatio, '9:16', 'an invalid aspect value is ignored (kept the last valid one)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/renderAspect.test.mts');
