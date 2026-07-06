//? Integration test for F0.1 (content-platform data model, ADR 0049). Against real Mongo. Asserts the
//? `content` projectType + all 9 content models (Channel, ContentProject, ContentAsset, Script, Beat,
//? MediaJob, RenderJob, StylePreset, MediaSpend) round-trip with `workspaceId`, and that a DIFFERENT
//? workspace sees none of them under an explicit workspaceId filter (row-isolation, the feature-model
//? pattern). Media cost is in CENTS (metered €). Self-cleans via _helpers cleanupWorkspace.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f01-${String(stamp)}@youcomm.nl`, name: 'CP F01' } });
let workspaceId: string | null = null;
let otherWsId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'CP F01 WS');
  workspaceId = created.workspaceId;
  const wsId = workspaceId;

  //? A content-lane project + its models.
  const cproj = await prisma.project.create({ data: { workspaceId: wsId, name: 'Content', projectType: 'content', gitlabPath: '' } });
  eq(cproj.projectType, 'content', 'a project can be projectType=content');

  const channel = await prisma.channel.create({ data: { workspaceId: wsId, projectId: cproj.id, name: 'My Channel', platform: 'youtube', handle: '@me', brandVoice: 'bold + curious' } });
  const style = await prisma.stylePreset.create({ data: { workspaceId: wsId, feature: 'image-gen', key: 'realistisch', label: 'Realistisch', systemPrompt: 'photorealistic, natural lighting', builtin: false } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: cproj.id, channelId: channel.id, title: 'Dino video', brief: 'a story about dinosaurs', format: 'faceless', styleId: style.id } });
  eq(piece.stageId, 'idea', 'a new content piece enters at the idea stage');
  eq(piece.status, 'idle', 'a new content piece is idle');

  const script = await prisma.script.create({ data: { workspaceId: wsId, contentProjectId: piece.id, body: 'Once upon a time, a T-Rex...', styleId: style.id } });
  const beat = await prisma.beat.create({ data: { workspaceId: wsId, scriptId: script.id, contentProjectId: piece.id, order: 0, text: 'Intro', visualPrompt: 'a T-Rex at dawn' } });
  const job = await prisma.mediaJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, feature: 'image-gen', providerId: 'fal', styleId: style.id, input: { prompt: 'a T-Rex', extraInstructions: 'dancing' }, costCents: 12 } });
  eq(job.status, 'queued', 'a media job starts queued');
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'image', url: 'stub://img/1', mediaJobId: job.id, metadata: { w: 1024, h: 1024 } } });
  const render = await prisma.renderJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, composition: 'faceless', input: { beats: [beat.id] }, costCents: 0 } });
  const spend = await prisma.mediaSpend.create({ data: { workspaceId: wsId, contentProjectId: piece.id, mediaJobId: job.id, feature: 'image-gen', providerId: 'fal', costCents: 12 } });

  //? Round-trip: every model carries the workspaceId.
  eq(channel.workspaceId, wsId, 'channel carries the workspaceId');
  eq(style.workspaceId, wsId, 'stylePreset carries the workspaceId');
  eq(piece.workspaceId, wsId, 'contentProject carries the workspaceId');
  eq(script.workspaceId, wsId, 'script carries the workspaceId');
  eq(beat.workspaceId, wsId, 'beat carries the workspaceId');
  eq(job.workspaceId, wsId, 'mediaJob carries the workspaceId');
  eq(asset.workspaceId, wsId, 'contentAsset carries the workspaceId');
  eq(render.workspaceId, wsId, 'renderJob carries the workspaceId');
  eq(spend.workspaceId, wsId, 'mediaSpend carries the workspaceId');
  eq(job.costCents, 12, 'media cost is stored in cents (metered €)');

  //? Row-isolation: a different workspace sees none of these under its own workspaceId filter.
  const other = await createBlankWorkspace(prisma, owner.id, 'CP F01 Other');
  otherWsId = other.workspaceId;
  eq(await prisma.contentProject.count({ where: { workspaceId: otherWsId } }), 0, 'a different workspace sees no content pieces (row-isolation)');
  eq(await prisma.channel.count({ where: { workspaceId: otherWsId } }), 0, 'a different workspace sees no channels');
  eq(await prisma.mediaSpend.count({ where: { workspaceId: otherWsId } }), 0, 'a different workspace sees no media spend');
  eq(await prisma.contentProject.count({ where: { workspaceId: wsId } }), 1, 'the owning workspace sees its content piece');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  if (otherWsId) await cleanupWorkspace(prisma, otherWsId, [owner.id]).catch(() => undefined);
  if (!workspaceId && !otherWsId) await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentModel.test.mts');
