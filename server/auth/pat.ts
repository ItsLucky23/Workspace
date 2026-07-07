//? X3 — Personal Access Tokens for the public API. The raw token is generated once + returned to the user at
//? issue; only its SHA-256 hash is stored. Resolving hashes the presented token + matches a non-revoked row.
//? A PAT that drives a write goes through the SAME single-writer Conductor + control-op RBAC as the in-app
//? path — the PAT only authenticates + scopes; it is never a direct writer.

import { createHash, randomBytes } from 'node:crypto';

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { enqueueControlAction } from '../orchestrator/conductor';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';

const TOKEN_PREFIX = 'wsk_';

//? sha256 hex of the raw token. Pure + exported for tests.
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

//? Mint a new raw token + its hash + a short display prefix. The raw is shown ONCE (never stored).
export function generateToken(): { raw: string; hash: string; prefix: string } {
  const raw = `${TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, 12) };
}

export interface ResolvedPat { id: string; userId: string; workspaceId: string; scopes: string[] }

//? Resolve a presented raw token to its (non-revoked) PAT. Touches lastUsedAt. Returns null if unknown/revoked.
export async function resolvePat(prisma: PrismaClient, rawToken: string): Promise<ResolvedPat | null> {
  const raw = (rawToken || '').trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const [, row] = await tryCatch(() => prisma.personalAccessToken.findFirst({ where: { tokenHash: hashToken(raw), revoked: false } }));
  if (!row) return null;
  await prisma.personalAccessToken.updateMany({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  return { id: row.id, userId: row.userId, workspaceId: row.workspaceId, scopes: row.scopes };
}

//? The public control-ops a PAT may drive + the scope each requires. A PAT missing the scope is rejected
//? BEFORE the op enqueues; an op not in this map is not exposed to the public API at all.
const OP_SCOPE: Partial<Record<ControlOp, string>> = {
  'quick-add': 'tickets:write',       // create a ticket
  'content-create': 'content:write',  // create a content piece
};

//? The ops the public API exposes (typed guard so an HTTP route can narrow a request string → ControlOp).
export function isPublicOp(op: string): op is ControlOp { return Object.prototype.hasOwnProperty.call(OP_SCOPE, op); }

export interface PatDriveResult { ok: boolean; status: number; error?: string }

//? Drive ONE control-op via a PAT: authenticate → scope-check → enqueue on the single-writer chain (the same
//? Conductor + RBAC as the app). Never a direct writer. Returns an HTTP-ish status for the REST adapter.
export async function driveViaPat(prisma: PrismaClient, rawToken: string, op: ControlOp, payload: Record<string, unknown>): Promise<PatDriveResult> {
  const pat = await resolvePat(prisma, rawToken);
  if (!pat) return { ok: false, status: 401, error: 'auth.invalidToken' };
  const needed = OP_SCOPE[op];
  if (!needed) return { ok: false, status: 400, error: 'api.unsupportedOp' };
  if (!pat.scopes.includes(needed)) return { ok: false, status: 403, error: 'auth.insufficientScope' };
  const [err] = await tryCatch(() => enqueueControlAction({ workspaceId: pat.workspaceId, op, target: {}, payload, userId: pat.userId, clientRequestId: `pat-${pat.id}-${hashToken(op + JSON.stringify(payload)).slice(0, 12)}` }));
  if (err) return { ok: false, status: 500, error: 'api.opFailed' };
  return { ok: true, status: 200 };
}
