//? Test for FREEDOM_PROGRAM R2 — cross-workspace copy. Verifies copy-workspace-assets copies the user styles +
//? the brand kit from a source workspace into the target (reusing R1/R3), and refuses when the acting user is
//? NOT a member of the source. Real Conductor + Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { exportStyleSet } = await import('../../server/content/styles');
const { saveBrandLibrary, exportBrandKit } = await import('../../server/studio/brand');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cwa-${String(stamp)}@youcomm.nl`, name: 'CWA' } });
const stranger = await prisma.user.create({ data: { email: `cwa2-${String(stamp)}@youcomm.nl`, name: 'STR' } });
let src: string | null = null; let dst: string | null = null; let other: string | null = null;

try {
  src = (await createBlankWorkspace(prisma, owner.id, 'CWA SRC')).workspaceId;
  dst = (await createBlankWorkspace(prisma, owner.id, 'CWA DST')).workspaceId;
  other = (await createBlankWorkspace(prisma, stranger.id, 'CWA OTHER')).workspaceId;

  // seed SRC with a user style + a brand
  await prisma.stylePreset.create({ data: { workspaceId: src, feature: 'image-gen', key: 'noir', label: 'Noir', systemPrompt: 'b&w', builtin: false } });
  await saveBrandLibrary(prisma, src, { name: 'Acme', voice: 'bold' });

  // copy SRC → DST (owner is a member of both)
  await enqueueControlAction({ workspaceId: dst, op: 'copy-workspace-assets', target: {}, payload: { sourceWorkspaceId: src }, userId: owner.id, clientRequestId: `cwa-1-${String(stamp)}` });
  eq((await exportStyleSet(prisma, dst)).length, 1, 'the style copied into DST');
  eq((await exportBrandKit(prisma, dst))?.name, 'Acme', 'the brand copied into DST');

  // a user NOT in the source cannot copy from it (owner is not a member of `other`)
  await enqueueControlAction({ workspaceId: dst, op: 'copy-workspace-assets', target: {}, payload: { sourceWorkspaceId: other }, userId: owner.id, clientRequestId: `cwa-2-${String(stamp)}` });
  //? nothing new copied — DST still has exactly the 1 style from SRC
  eq((await exportStyleSet(prisma, dst)).length, 1, 'copying from a non-member source is refused');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  for (const id of [src, dst].filter((x): x is string => x !== null)) await cleanupWorkspace(prisma, id, [owner.id]).catch(() => undefined);
  if (other) await cleanupWorkspace(prisma, other, [stranger.id]).catch(() => undefined);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: stranger.id } }).catch(() => undefined);
}

report('tests/integration/copyWorkspaceAssets.test.mts');
