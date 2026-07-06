//? Integration test for U4 — the insights folds + brand editor. Verifies the snapshot surfaces content
//? analytics (pieces/spend/publish), the style library, and channels + brand voice; and that the
//? content-edit-brand control-op updates the channel + re-indexes brand-RAG (B-23). Real Mongo; self-cleans.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { brandCommit } = await import('../../server/content/brandMemory');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cins-${String(stamp)}@youcomm.nl`, name: 'CIns Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'CIns WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const projectId = project?.id ?? '';

  //? A content piece + a channel + a media-spend + a publish job → analytics inputs.
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId, title: 'Explainer', format: 'faceless', status: 'done' } });
  const channel = await prisma.channel.create({ data: { workspaceId: wsId, projectId, name: 'My YT', platform: 'youtube' } });
  await prisma.mediaSpend.create({ data: { workspaceId: wsId, contentProjectId: piece.id, feature: 'image-gen', providerId: 'fal', costCents: 12 } });
  await prisma.publishJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, assetId: piece.id, platform: 'youtube', status: 'done' } });

  const snap = await buildSnapshot(prisma, owner.id, wsId);
  // analytics fold
  eq(snap.content.analytics.totalPieces, 1, 'analytics counts the live piece');
  eq(snap.content.analytics.doneCount, 1, 'analytics counts the done piece');
  eq(snap.content.analytics.publishedCount, 1, 'analytics counts the published job');
  eq(snap.content.analytics.totalCostCents, 12, 'analytics sums the media spend');
  assert(snap.content.analytics.costByFeature.some((c) => c.feature === 'image-gen' && c.cents === 12), 'cost-by-feature carries the spend');
  // channels fold
  assert(snap.content.channels.some((c) => c.id === channel.id && c.platform === 'youtube'), 'the channel is surfaced');
  // styles fold is an array (builtin/global styles may or may not be seeded)
  assert(Array.isArray(snap.content.styles), 'the style library fold is present');

  //? content-edit-brand updates the channel + indexes brand-RAG.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-edit-brand', target: {}, payload: { channelId: channel.id, brandVoice: 'friendly and concise' }, userId: owner.id, clientRequestId: `cins-b-${String(stamp)}` });
  const updated = await prisma.channel.findUnique({ where: { id: channel.id } });
  eq(updated?.brandVoice, 'friendly and concise', 'the channel brand voice was saved');
  const brandRows = await prisma.ragEntry.findMany({ where: { workspaceId: wsId, commitHash: brandCommit(channel.id) } });
  assert(brandRows.length >= 1, 'the brand snippet was indexed into brand-RAG');

  const snap2 = await buildSnapshot(prisma, owner.id, wsId);
  assert(snap2.content.channels.some((c) => c.id === channel.id && c.brandVoice === 'friendly and concise'), 'the snapshot reflects the new brand voice');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentInsights.test.mts');
