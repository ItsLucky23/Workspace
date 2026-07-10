//? G1 — the publish composer WRITES per-platform variants. Before G1 `publishVariants` was only ever READ
//? (extractPublishVariant), so every post went title-only + PRIVATE. This drives the real content-request-publish
//? op with a caption/hashtags/privacy and asserts they persist on the piece + read back via extractPublishVariant.
//? Real Mongo, no keys/Docker (the op only creates a suggestion + persists the variant; it does not upload).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { extractPublishVariant } = await import('../../server/content/publish');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `pvw-${String(stamp)}@youcomm.nl`, name: 'PVW' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'PV Writer WS');
  workspaceId = created.workspaceId;
  const ws = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: ws } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: ws, projectId: project?.id ?? '', title: 'Launch reel' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: ws, contentProjectId: piece.id, kind: 'render', status: 'ready', url: '/media/x.mp4' } });

  //? Before: no variants → extract returns null → title-only, private.
  eq(piece.publishVariants, null, 'a fresh piece has no publish variants');

  //? Drive the composer via the real op: a YouTube post with a caption, hashtags and PUBLIC privacy.
  await enqueueControlAction({ workspaceId: ws, op: 'content-request-publish', target: {}, payload: {
    contentProjectId: piece.id, assetId: asset.id, platform: 'youtube',
    caption: 'Our big launch!', hashtags: ['launch', 'ai'], privacy: 'public',
  }, userId: owner.id, clientRequestId: `pvw-1-${String(stamp)}` });
  await wait(600);

  const after = await prisma.contentProject.findFirst({ where: { workspaceId: ws, id: piece.id }, select: { publishVariants: true } });
  const variant = extractPublishVariant(after?.publishVariants, 'youtube');
  assert(variant !== null, 'the youtube variant was persisted + reads back');
  eq(variant?.caption, 'Our big launch!', 'the caption persisted');
  eq((variant?.hashtags ?? []).join(','), 'launch,ai', 'the hashtags persisted');
  eq(variant?.privacy, 'public', 'privacy is PUBLIC (no more silent private)');

  //? A suggestion was opened for the publish (accept → upload).
  const sug = await prisma.workspaceSuggestion.findFirst({ where: { workspaceId: ws, type: 'publish' } });
  assert(sug !== null, 'a publish suggestion was created for the user to accept');

  //? A second platform's variant merges without clobbering youtube.
  await enqueueControlAction({ workspaceId: ws, op: 'content-request-publish', target: {}, payload: {
    contentProjectId: piece.id, assetId: asset.id, platform: 'tiktok', caption: 'launch on tiktok', privacy: 'public',
  }, userId: owner.id, clientRequestId: `pvw-2-${String(stamp)}` });
  await wait(600);
  const after2 = await prisma.contentProject.findFirst({ where: { workspaceId: ws, id: piece.id }, select: { publishVariants: true } });
  assert(extractPublishVariant(after2?.publishVariants, 'youtube') !== null, 'the youtube variant survives a second platform write');
  eq(extractPublishVariant(after2?.publishVariants, 'tiktok')?.caption, 'launch on tiktok', 'the tiktok variant was added');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/publishVariantWriter.test.mts');
