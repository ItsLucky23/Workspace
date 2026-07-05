//? Designer library persistence (ADR 0034) — the DB writers behind the `designerLibrary` route, kept
//? server-side so consumer `src/` never imports Prisma. Setting a theme/style active rebuilds the
//? injected `design-system` context-doc the coding agent reads.

import type { PrismaClient, Prisma } from '@prisma/client';

import { rebuildDesignSystemDoc } from './designSystemDoc';

//? Bridge a genuinely-JSON value to Prisma's Json WRITE type (mirrors server/studio/generate.ts).
const asJson = (v: unknown): Prisma.InputJsonValue => v ?? {};

export interface DesignArtifactInput { id?: string; kind: string; name: string; description?: string; content: unknown; source?: string }

//? Upsert a design-library entry; returns its id ('' if an update hit nothing).
export async function saveDesignArtifact(prisma: PrismaClient, workspaceId: string, a: DesignArtifactInput): Promise<string> {
  const content = asJson(a.content);
  const source = a.source === 'ai' || a.source === 'seed' ? a.source : 'manual';
  if (a.id) {
    await prisma.designArtifact.updateMany({ where: { workspaceId, id: a.id }, data: { name: a.name.trim(), description: a.description ?? null, content } });
    return a.id;
  }
  const created = await prisma.designArtifact.create({ data: { workspaceId, active: false, kind: a.kind, name: a.name.trim(), description: a.description ?? null, content, source }, select: { id: true } });
  return created.id;
}

//? Mark the one active theme/style for its kind, then rebuild the design-system doc. false if unknown.
export async function setActiveDesignArtifact(prisma: PrismaClient, workspaceId: string, id: string): Promise<boolean> {
  const target = await prisma.designArtifact.findFirst({ where: { workspaceId, id }, select: { kind: true } });
  if (!target) return false;
  await prisma.designArtifact.updateMany({ where: { workspaceId, kind: target.kind }, data: { active: false } });
  await prisma.designArtifact.updateMany({ where: { workspaceId, id }, data: { active: true } });
  await rebuildDesignSystemDoc(prisma, workspaceId);
  return true;
}

export async function deleteDesignArtifact(prisma: PrismaClient, workspaceId: string, id: string): Promise<void> {
  const wasActive = await prisma.designArtifact.findFirst({ where: { workspaceId, id }, select: { active: true } });
  await prisma.designArtifact.deleteMany({ where: { workspaceId, id } });
  if (wasActive?.active) await rebuildDesignSystemDoc(prisma, workspaceId);
}
