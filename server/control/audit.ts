//? H1 — the admin/security audit trail. Governance ops (role/member/secret/ownership/workspace changes) had NO
//? record; this appends an immutable `AuditLog` row for each. Best-effort: a failure NEVER breaks the op (the
//? authoritative write already happened). NEVER logs a secret VALUE — only the fact + the key/target + safe meta.

import type { PrismaClient } from '@prisma/client';

import { jsonInput } from '../util/json';

export async function recordAudit(
  prisma: PrismaClient, workspaceId: string, actorId: string | null, action: string,
  target?: string | null, metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: { workspaceId, ...(actorId ? { actorId } : {}), action, ...(target ? { target } : {}), ...(metadata ? { metadata: jsonInput(metadata) } : {}) },
  }).catch(() => null);
  //? GAP_SCAN D4 — mirror into the platform-level archive. The tenant copy above is deleted BY the
  //? workspace-deletion it records; this one is outside the cascade, so "who deleted what, when" survives.
  //? Best-effort and never awaited into the op's success — an audit write must not fail a completed write.
  await mirrorToArchive(prisma, workspaceId, actorId, action, target, metadata);
}

//? The out-of-tenant mirror. The workspace NAME is resolved at write time because after a delete there is
//? nothing left to resolve it from. Silently degrades to a nameless row if that lookup fails.
async function mirrorToArchive(
  prisma: PrismaClient, workspaceId: string, actorId: string | null, action: string,
  target?: string | null, metadata?: Record<string, unknown>,
): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }).catch(() => null);
  await prisma.auditArchive.create({
    data: {
      workspaceId, ...(ws?.name ? { workspaceName: ws.name } : {}),
      ...(actorId ? { actorId } : {}), action, ...(target ? { target } : {}),
      ...(metadata ? { metadata: jsonInput(metadata) } : {}),
    },
  }).catch(() => null);
}

export interface ArchivedAuditEntry { id: string; workspaceId: string; workspaceName: string | null; action: string; target: string | null; actorId: string | null; createdAt: string }

//? D4 — read the durable trail, including entries whose workspace no longer exists. Deliberately NOT part
//? of the workspace snapshot: it spans workspaces, so it is an operator/host-level view.
export async function listAuditArchive(prisma: PrismaClient, filter: { workspaceId?: string; action?: string } = {}, limit = 200): Promise<ArchivedAuditEntry[]> {
  const rows = await prisma.auditArchive.findMany({
    where: { ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}), ...(filter.action ? { action: filter.action } : {}) },
    orderBy: { createdAt: 'desc' }, take: limit,
  });
  return rows.map((r) => ({
    id: r.id, workspaceId: r.workspaceId, workspaceName: r.workspaceName, action: r.action,
    target: r.target, actorId: r.actorId, createdAt: r.createdAt.toISOString(),
  }));
}

export interface AuditEntry { id: string; action: string; target: string | null; actorName: string; metadata: unknown; createdAt: string }

//? H1 — the audit VIEW: the recent governance entries, newest-first, with the actor's name resolved. Tenant-scoped.
export async function listAuditLog(prisma: PrismaClient, workspaceId: string, limit = 200): Promise<AuditEntry[]> {
  const rows = await prisma.auditLog.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: limit });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => typeof id === 'string'))];
  const users = actorIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameById = new Map<string, string>(users.map((u) => [u.id, u.name ?? u.email]));
  const displayName = (id: string | null): string => {
    if (id === null) return 'system';
    return nameById.get(id) ?? 'unknown';
  };
  return rows.map((r): AuditEntry => ({
    id: r.id, action: r.action, target: r.target, metadata: r.metadata,
    actorName: displayName(r.actorId),
    createdAt: r.createdAt.toISOString(),
  }));
}
