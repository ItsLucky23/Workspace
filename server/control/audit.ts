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
