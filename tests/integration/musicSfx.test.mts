//? Integration test for F2.5 (music + sfx, ADR 0049). Real Conductor + Mongo. content-gen-music /
//? content-gen-sfx produce audio assets via the shared generateMediaAsset path (stub, metered).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f25-${String(stamp)}@youcomm.nl`, name: 'CP F25' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F25 WS' }, userId: owner.id, clientRequestId: `f25-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 1000, enabled: true }, userId: owner.id, clientRequestId: `f25-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f25-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Soundtrack', format: 'faceless' }, userId: owner.id, clientRequestId: `f25-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Soundtrack' } }));
  const pieceId = piece?.id ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-music', target: {}, payload: { contentProjectId: pieceId, prompt: 'upbeat synthwave' }, userId: owner.id, clientRequestId: `f25-gm-${String(stamp)}` });
  const music = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'music' } }));
  assert(music !== null, 'content-gen-music produced a music asset');
  assert((music?.url ?? '').startsWith('stub://music/'), 'the music is a valid-shaped stub');
  eq((await prisma.mediaJob.findFirst({ where: { workspaceId: wsId, feature: 'music' } }))?.providerId, 'suno', 'music routed to suno (M2 — Suno is the music provider)');

  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-sfx', target: {}, payload: { contentProjectId: pieceId, prompt: 'whoosh transition' }, userId: owner.id, clientRequestId: `f25-gx-${String(stamp)}` });
  const sfx = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'sfx' } }));
  assert(sfx !== null, 'content-gen-sfx produced an sfx asset');
  assert((sfx?.url ?? '').startsWith('stub://sfx/'), 'the sfx is a valid-shaped stub');

  //? music(6c) + sfx(1c) = 7c debited.
  eq((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.spentCents, 7, 'music(6c) + sfx(1c) debited the budget');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/musicSfx.test.mts');
