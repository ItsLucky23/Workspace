//? Integration test for F2.3 (reference-video analysis, ADR 0049). Real Conductor + Mongo. A reference
//? video url + a NEW story → a beat/style blueprint that SEEDS a new Script + Beats (stub, no gemini key).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f23-${String(stamp)}@youcomm.nl`, name: 'CP F23' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F23 WS' }, userId: owner.id, clientRequestId: `f23-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f23-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Reworked story', format: 'faceless' }, userId: owner.id, clientRequestId: `f23-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Reworked story' } }));
  const pieceId = piece?.id ?? '';

  //? Analyse a reference video + retell a NEW story in its shape.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-analyze-reference-video', target: {}, payload: { contentProjectId: pieceId, referenceVideoUrl: 'stub://ref/viral.mp4', newStory: 'the history of coffee' }, userId: owner.id, clientRequestId: `f23-ar-${String(stamp)}` });

  const script = await poll(() => prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId } }));
  assert(script !== null, 'reference-video analysis seeded a Script from the blueprint');
  eq(script?.providerId, 'gemini-api', 'the analysis ran on the gemini (video-capable) provider');
  eq(script?.title, 'From reference video', 'the script is marked as reference-seeded');

  const beats = await prisma.beat.findMany({ where: { workspaceId: wsId, scriptId: script?.id ?? '' }, orderBy: { order: 'asc' } });
  eq(beats.length, 4, 'the blueprint produced a 4-beat arc');
  assert((beats[0]?.text ?? '').toLowerCase().includes('coffee'), 'the new story (coffee) drives the beats, not the reference');
  assert((beats[0]?.text ?? '').toLowerCase().includes('hook'), 'the arc mirrors the reference shape (hook-first)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/referenceVideo.test.mts');
