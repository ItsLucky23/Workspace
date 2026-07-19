//? H1 — the admin/security audit trail. Governance ops (role/member/secret/ownership/workspace changes) had NO
//? record; this appends an immutable `AuditLog` row for each. Best-effort: a failure NEVER breaks the op (the
//? authoritative write already happened). NEVER logs a secret VALUE — only the fact + the key/target + safe meta.

import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import { jsonInput } from '../util/json';

export async function recordAudit(
  prisma: PrismaClient, workspaceId: string, actorId: string | null, action: string,
  target?: string | null, metadata?: Record<string, unknown>,
): Promise<void> {
  const [tenantError] = await tryCatch(() => prisma.auditLog.create({
    data: { workspaceId, ...(actorId ? { actorId } : {}), action, ...(target ? { target } : {}), ...(metadata ? { metadata: jsonInput(metadata) } : {}) },
  }));
  if (tenantError) noteAuditFailure(action, tenantError.message);
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

  //? F20 — the HASH CHAIN. Each row hashes its own content plus the previous row's hash, so deleting or
  //? editing an entry breaks the chain from that point on and `verifyAuditChain` can name where. This does
  //? not PREVENT tampering — nothing local can — it makes tampering detectable, which is the property an
  //? audit trail actually needs.
  const previous = await prisma.auditArchive.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } }).catch(() => null);
  const seq = (previous?.seq ?? 0) + 1;
  const prevHash = previous?.hash ?? '';
  const hash = auditRowHash({ seq, prevHash, workspaceId, actorId, action, target: target ?? null, metadata: metadata ?? null });

  const [error] = await tryCatch(() => prisma.auditArchive.create({
    data: {
      workspaceId, ...(ws?.name ? { workspaceName: ws.name } : {}),
      ...(actorId ? { actorId } : {}), action, ...(target ? { target } : {}),
      ...(metadata ? { metadata: jsonInput(metadata) } : {}),
      seq, prevHash, hash,
    },
  }));

  //? F20 — the write stays BEST-EFFORT (rolling back a completed role change because its log failed is the
  //? worse outcome), but it is no longer SILENT: a swallowed audit failure is how a trail quietly stops
  //? being a trail. Loud log + a counter a health surface can read.
  if (error) noteAuditFailure(action, error.message);
}

export interface AuditRowInput { seq: number; prevHash: string; workspaceId: string; actorId: string | null; action: string; target: string | null; metadata: Record<string, unknown> | null }

//? The chain hash. Pure + exported so the verification logic is testable without a DB.
export function auditRowHash(row: AuditRowInput): string {
  const payload = JSON.stringify([row.seq, row.prevHash, row.workspaceId, row.actorId ?? '', row.action, row.target ?? '', row.metadata ?? null]);
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

const auditFailures: { count: number; lastAt: number; lastAction: string; lastError: string } = { count: 0, lastAt: 0, lastAction: '', lastError: '' };

export function noteAuditFailure(action: string, message: string): void {
  auditFailures.count += 1;
  auditFailures.lastAt = Date.now();
  auditFailures.lastAction = action;
  auditFailures.lastError = message.slice(0, 200);
  console.error(`[audit] FAILED to record '${action}': ${message}. The action itself succeeded — the trail did not.`);
}

export function auditHealth(): { failures: number; lastAt: number; lastAction: string; lastError: string } {
  return { failures: auditFailures.count, lastAt: auditFailures.lastAt, lastAction: auditFailures.lastAction, lastError: auditFailures.lastError };
}

export function resetAuditHealth(): void { auditFailures.count = 0; auditFailures.lastAt = 0; auditFailures.lastAction = ''; auditFailures.lastError = ''; }

export interface ChainVerdict { ok: boolean; checked: number; brokenAtSeq: number | null; reason: string }

//? Walk the chain and report the FIRST row whose hash does not match, or whose link to the previous row is
//? wrong. Pure over already-fetched rows.
export function verifyAuditChain(rows: (AuditRowInput & { hash: string })[]): ChainVerdict {
  const ordered = rows.toSorted((a, b) => a.seq - b.seq);
  let expectedPrev = '';
  for (const [index, row] of ordered.entries()) {
    //? The first row we hold may legitimately follow rows we did not fetch, so its prevHash is trusted.
    if (index > 0 && row.prevHash !== expectedPrev) {
      return { ok: false, checked: index + 1, brokenAtSeq: row.seq, reason: 'a row is missing or was reordered' };
    }
    if (auditRowHash(row) !== row.hash) {
      return { ok: false, checked: index + 1, brokenAtSeq: row.seq, reason: 'a row was edited after it was written' };
    }
    expectedPrev = row.hash;
  }
  return { ok: true, checked: ordered.length, brokenAtSeq: null, reason: 'chain intact' };
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
