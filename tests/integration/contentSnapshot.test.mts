//? Integration test for F4.2 (content UI wiring, ADR 0069). Real Conductor + Mongo + snapshot builder.
//? Asserts the content lane is wired into the workspace snapshot: the in-flight pieces + the media €-budget
//? status render from `snapshot.content` (so the content UI + settings can read it). Self-cleans.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f42-${String(stamp)}@youcomm.nl`, name: 'CP F42' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F42 WS' }, userId: owner.id, clientRequestId: `f42-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 500, enabled: true }, userId: owner.id, clientRequestId: `f42-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f42-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Dino explainer', format: 'faceless' }, userId: owner.id, clientRequestId: `f42-cc-${String(stamp)}` });
  await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Dino explainer' } }));

  //? The snapshot exposes the content lane.
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  assert(snap.content.pieces.some((p) => p.title === 'Dino explainer'), 'the content piece appears in snapshot.content.pieces');
  const piece = snap.content.pieces.find((p) => p.title === 'Dino explainer');
  eq(piece?.stageId, 'idea', 'the piece carries its stage');
  eq(piece?.format, 'faceless', 'the piece carries its format');
  assert(snap.content.mediaBudget.enabled, 'the media budget status is exposed + enabled');
  eq(snap.content.mediaBudget.capCents, 500, 'the media budget cap is exposed');
  eq(snap.content.mediaBudget.spentCents, 0, 'spend starts at 0');

  //? An archived piece drops out of the snapshot.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-archive', target: {}, payload: { contentProjectId: piece?.id }, userId: owner.id, clientRequestId: `f42-ar-${String(stamp)}` });
  await poll(async () => ((await prisma.contentProject.findUnique({ where: { id: piece?.id ?? '' } }))?.archived === true ? true : null));
  const snap2 = await buildSnapshot(prisma, owner.id, wsId);
  assert(!snap2.content.pieces.some((p) => p.title === 'Dino explainer'), 'an archived piece drops out of the snapshot');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentSnapshot.test.mts');
