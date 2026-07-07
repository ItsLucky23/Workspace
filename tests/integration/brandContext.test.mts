//? Integration test for FREEDOM_PROGRAM Q2 (brand/product grounding). Verifies buildBrandContext folds the
//? per-workspace product context + the owning channel's brand voice, and that composeMediaPrompt prepends the
//? brand context. Real Mongo for the reads; the prompt composer is pure.

import { db, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { buildBrandContext } = await import('../../server/content/brandContext');
const { composeMediaPrompt } = await import('../../server/media/prompt');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `bc-${String(stamp)}@youcomm.nl`, name: 'BC' } });

try {
  // ---- pure: composeMediaPrompt prepends brandContext ----
  {
    const p = composeMediaPrompt({ feature: 'image-gen', prompt: 'a red cube', brandContext: 'Brand: minimalist', style: { key: 'x', systemPrompt: 'cinematic' } });
    assert(p.startsWith('Brand: minimalist'), 'brand context grounds the media prompt first');
    assert(p.includes('cinematic') && p.includes('a red cube'), 'style + prompt still present');
  }

  // ---- buildBrandContext folds product context + channel brand voice ----
  const ws = await prisma.workspace.create({ data: { name: 'BC WS', slug: `bc-${String(stamp)}`, ownerId: owner.id, productContext: 'We sell eco running shoes' } });
  const wsId = ws.id;
  const channel = await prisma.channel.create({ data: { workspaceId: wsId, projectId: wsId, name: 'YT', platform: 'youtube', brandVoice: 'energetic, no jargon' } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'Piece', channelId: channel.id } });

  const withChannel = await buildBrandContext(prisma, wsId, piece.id);
  assert(withChannel.includes('We sell eco running shoes'), 'product context is included');
  assert(withChannel.includes('energetic, no jargon'), 'channel brand voice is included');

  const noChannelPiece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'NoChan' } });
  const withoutChannel = await buildBrandContext(prisma, wsId, noChannelPiece.id);
  assert(withoutChannel.includes('We sell eco running shoes') && !withoutChannel.includes('energetic'), 'no channel → product context only');

  const emptyWs = await prisma.workspace.create({ data: { name: 'Empty', slug: `bce-${String(stamp)}`, ownerId: owner.id } });
  eq(await buildBrandContext(prisma, emptyWs.id), '', 'no product context + no channel → empty grounding');

  // cleanup
  await prisma.channel.deleteMany({ where: { workspaceId: wsId } });
  await prisma.contentProject.deleteMany({ where: { workspaceId: wsId } });
  await prisma.workspace.deleteMany({ where: { id: { in: [wsId, emptyWs.id] } } });
} finally {
  await prisma.user.deleteMany({ where: { id: owner.id } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
}

report('tests/integration/brandContext.test.mts');
