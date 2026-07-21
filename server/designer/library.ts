//? Designer library persistence (ADR 0034) — the DB writers behind the `designerLibrary` route, kept
//? server-side so consumer `src/` never imports Prisma. Setting a theme/style active rebuilds the
//? injected `design-system` context-doc the coding agent reads.

import type { PrismaClient, Prisma } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import { rebuildDesignSystemDoc } from './designSystemDoc';
import { indexDesignArtifact, removeDesignArtifactIndex } from './designLibraryRag';

//? Bridge a genuinely-JSON value to Prisma's Json WRITE type (mirrors server/studio/generate.ts).
const asJson = (v: unknown): Prisma.InputJsonValue => v ?? {};

//? A Mongo ObjectId is exactly 24 hex chars — guard the shape BEFORE querying so a malformed id
//? (mirrors server/orchestrator/projectResolve.ts) resolves to "not found" instead of throwing
//? Prisma's "Malformed ObjectID".
const isObjectId = (s: string): boolean => /^[0-9a-fA-F]{24}$/.test(s);

export interface DesignArtifactInput { id?: string; kind: string; name: string; description?: string; content: unknown; source?: string }

//? Upsert a design-library entry; returns its id ('' if an update hit nothing).
export async function saveDesignArtifact(prisma: PrismaClient, workspaceId: string, a: DesignArtifactInput): Promise<string> {
  const content = asJson(a.content);
  const source = a.source === 'ai' || a.source === 'seed' ? a.source : 'manual';
  const name = a.name.trim();
  //? A supplied id is a deterministic retry identity. Resolve it globally first so an impossible hash
  //? collision cannot alias another tenant; an absent id keeps the legacy kind/name upsert behaviour.
  const supplied = a.id ? await prisma.designArtifact.findUnique({ where: { id: a.id }, select: { id: true, workspaceId: true } }) : null;
  if (supplied && supplied.workspaceId !== workspaceId) return '';
  const existing = supplied ?? (a.id
    ? null
    : await prisma.designArtifact.findFirst({ where: { workspaceId, kind: a.kind, name }, select: { id: true } }));
  let id: string;
  if (existing) {
    await prisma.designArtifact.updateMany({ where: { workspaceId, id: existing.id }, data: { name, description: a.description ?? null, content } });
    id = existing.id;
  } else {
    const created = await prisma.designArtifact.create({ data: { ...(a.id ? { id: a.id } : {}), workspaceId, active: false, kind: a.kind, name, description: a.description ?? null, content, source }, select: { id: true } });
    id = created.id;
  }
  //? Refresh the design-system doc so the saved look joins the named-looks catalog the coding agent reads.
  await rebuildDesignSystemDoc(prisma, workspaceId);
  //? 3.6 — index the look into the design-library corpus so future generations can build on it (best-effort).
  await tryCatch(() => indexDesignArtifact(prisma, workspaceId, id, a.kind, name, a.description ?? ''));
  return id;
}

//? Mark the one active theme/style for its kind, then rebuild the design-system doc. false if unknown.
export async function setActiveDesignArtifact(prisma: PrismaClient, workspaceId: string, id: string): Promise<boolean> {
  if (!isObjectId(id)) return false;
  const target = await prisma.designArtifact.findFirst({ where: { workspaceId, id }, select: { kind: true } });
  if (!target) return false;
  await prisma.designArtifact.updateMany({ where: { workspaceId, kind: target.kind }, data: { active: false } });
  await prisma.designArtifact.updateMany({ where: { workspaceId, id }, data: { active: true } });
  await rebuildDesignSystemDoc(prisma, workspaceId);
  return true;
}

export async function deleteDesignArtifact(prisma: PrismaClient, workspaceId: string, id: string): Promise<void> {
  await prisma.designArtifact.deleteMany({ where: { workspaceId, id } });
  //? Always rebuild — the deleted look must leave the named-looks catalog too, not only when it was active.
  await rebuildDesignSystemDoc(prisma, workspaceId);
  await tryCatch(() => removeDesignArtifactIndex(prisma, workspaceId, id));
}
