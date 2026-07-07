//? Brand/product grounding (FREEDOM_PROGRAM Q2). Builds the workspace's persistent creative context — the
//? per-workspace product context ("what we do / audience / always-mention", `Workspace.productContext`) plus
//? the owning channel's brand voice (`Channel.brandVoice`) — folded into EVERY creative generation so the AI
//? produces on-brand output without the user re-typing it each time. Tenant-scoped by explicit `workspaceId`
//? filtering; returns '' when there is nothing to add (the caller then uses the bare prompt).

import type { PrismaClient } from '@prisma/client';

export async function buildBrandContext(prisma: PrismaClient, workspaceId: string, contentProjectId?: string): Promise<string> {
  const parts: string[] = [];
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { productContext: true } });
  const product = (ws?.productContext ?? '').trim();
  if (product.length > 0) parts.push(`Brand/product context: ${product}`);
  if (contentProjectId) {
    const piece = await prisma.contentProject.findFirst({ where: { id: contentProjectId, workspaceId }, select: { channelId: true } });
    if (piece?.channelId) {
      const channel = await prisma.channel.findFirst({ where: { id: piece.channelId, workspaceId }, select: { brandVoice: true } });
      const voice = (channel?.brandVoice ?? '').trim();
      if (voice.length > 0) parts.push(`Brand voice: ${voice}`);
    }
  }
  return parts.join('\n');
}
