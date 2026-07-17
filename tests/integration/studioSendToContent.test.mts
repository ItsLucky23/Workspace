//? Send-to-Content (gap-fix "verbind de eilanden") through the REAL Conductor + Mongo: a ready Studio
//? artifact becomes a content piece with a 'script' asset carrying the artifact body; a non-ready
//? artifact is refused. Cleans up its own workspace.

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
const owner = await prisma.user.create({ data: { email: `s2c-${String(stamp)}@youcomm.nl`, name: 'S2C' } });
let wsId = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'S2C WS');
  wsId = created.workspaceId;

  const brief = await prisma.studioBrief.create({ data: { workspaceId: wsId, name: 'Launch v1', productName: 'Testproduct', audience: 'devs', goals: 'launch', tone: 'punchy' } });
  const artifact = await prisma.studioArtifact.create({ data: { workspaceId: wsId, briefId: brief.id, kind: 'videoScript', role: 'marketer', title: 'Promo script', content: { hook: 'Stop scrolling', scenes: [] }, status: 'ready' } });

  await enqueueControlAction({ workspaceId: wsId, op: 'studio-send-to-content', target: {}, payload: { artifactId: artifact.id }, userId: owner.id, clientRequestId: `s2c-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId } }));
  assert(piece !== null, 'a content piece was created from the artifact');
  eq(piece?.title, 'Promo script', 'the piece takes the artifact title');
  assert((piece?.brief ?? '').includes('videoScript') && (piece?.brief ?? '').includes('Testproduct'), 'the brief names the artifact kind + product');
  eq(piece?.format, 'faceless', 'a videoScript artifact maps to the faceless (video) format');

  const asset = await prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: piece?.id ?? '' } });
  assert(asset !== null && asset.kind === 'script' && asset.status === 'ready', "the artifact body landed as a ready 'script' asset");
  const md = asset?.metadata;
  const meta = (md !== null && typeof md === 'object' && !Array.isArray(md)) ? md as Record<string, unknown> : {};
  eq(meta.source, 'studio', 'the asset is tagged as studio-sourced');
  assert(typeof meta.body === 'string' && meta.body.includes('Stop scrolling'), 'the asset carries the artifact content');

  //? A generating artifact is refused (no second piece).
  const pending = await prisma.studioArtifact.create({ data: { workspaceId: wsId, briefId: brief.id, kind: 'copy', role: 'marketer', title: 'Half done', content: {}, status: 'generating' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'studio-send-to-content', target: {}, payload: { artifactId: pending.id }, userId: owner.id, clientRequestId: `s2c-p-${String(stamp)}` });
  await wait(400);
  eq(await prisma.contentProject.count({ where: { workspaceId: wsId } }), 1, 'a non-ready artifact creates NO piece');
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/studioSendToContent.test.mts');
}
