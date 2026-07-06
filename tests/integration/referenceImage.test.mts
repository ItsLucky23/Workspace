//? Integration test for F2.1 (reference-driven photorealistic image, ADR 0049 — the #1 feature). Real
//? Conductor + Mongo. content-gen-reference-image conditions on a reference url, in the realistisch style +
//? free-form extra ("dancing, brown curls"), stub (no key), metered. Also the budget-block path. Self-cleans.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { ensureDefaultStyles } = await import('../../server/content/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f21-${String(stamp)}@youcomm.nl`, name: 'CP F21' } });
let workspaceId: string | null = null;

try {
  await ensureDefaultStyles(prisma);
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F21 WS' }, userId: owner.id, clientRequestId: `f21-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 1000, enabled: true }, userId: owner.id, clientRequestId: `f21-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f21-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Ref shots', format: 'image' }, userId: owner.id, clientRequestId: `f21-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Ref shots' } }));
  const pieceId = piece?.id ?? '';

  //? Reference-conditioned photoreal image: reference + realistisch + extra instructions.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-reference-image', target: {}, payload: { contentProjectId: pieceId, referenceUrl: 'stub://ref/subject.png', styleKey: 'realistisch', extraInstructions: 'make them dancing with brown curly hair' }, userId: owner.id, clientRequestId: `f21-gr-${String(stamp)}` });

  const img = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'image' } }));
  assert(img !== null, 'content-gen-reference-image produced an image asset');
  const meta = (img?.metadata ?? {}) as { hasReference?: boolean; style?: string; extra?: string };
  assert(meta.hasReference === true, 'the generation was conditioned on the reference image');
  eq(meta.style, 'realistisch', 'the realistisch style was applied (realism = priority)');
  eq(meta.extra, 'make them dancing with brown curly hair', 'the free-form extra instructions flowed through');

  const job = await prisma.mediaJob.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, feature: 'reference-image' } });
  assert(job !== null, 'a reference-image MediaJob was recorded');
  eq(job?.providerId, 'fal', 'reference-image routed to fal');
  eq(job?.resultAssetId, img?.id, 'the MediaJob links its asset');
  const input = (job?.input ?? {}) as { referenceUrl?: string };
  eq(input.referenceUrl, 'stub://ref/subject.png', 'the reference url is recorded on the job');

  eq((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.spentCents, 5, 'the reference-image stub cost (5c) debited the budget');

  //? BLOCK path: cap at the current spend → remaining 0 → the next reference-image is blocked.
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 5, enabled: true }, userId: owner.id, clientRequestId: `f21-eb2-${String(stamp)}` });
  await poll(async () => ((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.capCents === 5 ? true : null));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-reference-image', target: {}, payload: { contentProjectId: pieceId, referenceUrl: 'stub://ref/other.png' }, userId: owner.id, clientRequestId: `f21-gr2-${String(stamp)}` });
  await wait(300);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'image' } }), 1, 'a reference-image over the budget cap is blocked (still 1 asset)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/referenceImage.test.mts');
