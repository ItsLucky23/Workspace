//? Typed, encrypted, crash-replayable Conductor jobs for authoritative writes that have no tenant scope.
//? Routes enqueue data only; this module owns the global lease, writer context, execution and recovery.

import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

import type { LANGUAGE, Prisma, THEME } from '@prisma/client';
import { getPrismaClient, getUploadsDir, tryCatch, tryCatchSync } from '@luckystack/core';
import { getUserAdapter, revokeUserSessions } from '@luckystack/login';

import { decryptSecret, encryptSecret } from '../crypto/secretBox';
import { importWorkspaceBundle } from '../export/workspaceImport';
import { deterministicObjectId } from './actionIds';
import { withWorkspaceLease } from './cluster';
import { cascadeDeleteWorkspace } from './conductor';
import { GLOBAL_WRITER_SCOPE, runInWriterContext } from './writerContext';

const prisma = getPrismaClient();
const MAX_JOB_BYTES = 8 * 1024 * 1024;
const MAX_JOB_ATTEMPTS = 5;
const GLOBAL_JOB_STALE_MS = 30_000;
export const GLOBAL_JOB_RECOVERY_MS = Math.max(60_000, Number(process.env.WS_GLOBAL_JOB_RECOVERY_MIN ?? '1') * 60_000);

interface GlobalActionBase { userId: string }
export interface AccountUpdateGlobalAction extends GlobalActionBase {
  op: 'account-update';
  payload: { avatar?: string; name?: string; theme?: THEME; language?: LANGUAGE };
}
export interface AccountPreferencesGlobalAction extends GlobalActionBase {
  op: 'account-preferences';
  payload: { preferences: Record<string, boolean> };
}
export interface AccountDeleteGlobalAction extends GlobalActionBase {
  op: 'account-delete';
  payload: { email?: string };
}
export interface SshKeyAddGlobalAction extends GlobalActionBase {
  op: 'ssh-key-add';
  target: { keyId: string };
  payload: { name: string; type: string; fingerprint: string; publicKey: string };
}
export interface SshKeyRemoveGlobalAction extends GlobalActionBase {
  op: 'ssh-key-remove';
  target: { keyId: string };
}
export interface PushSaveGlobalAction extends GlobalActionBase {
  op: 'push-save';
  payload: { endpoint: string; p256dh: string; auth: string; fullBodyOptIn: boolean };
}
export interface PushRemoveGlobalAction extends GlobalActionBase {
  op: 'push-remove';
  payload: { endpoint: string };
}
export interface PatRevokeGlobalAction extends GlobalActionBase {
  op: 'pat-revoke';
  target: { patId: string };
}
export interface WorkspaceImportGlobalAction extends GlobalActionBase {
  op: 'workspace-import';
  target: { workspaceId: string };
  payload: { bundle: unknown };
}

export type GlobalAction =
  | AccountUpdateGlobalAction
  | AccountPreferencesGlobalAction
  | AccountDeleteGlobalAction
  | SshKeyAddGlobalAction
  | SshKeyRemoveGlobalAction
  | PushSaveGlobalAction
  | PushRemoveGlobalAction
  | PatRevokeGlobalAction
  | WorkspaceImportGlobalAction;

export type GlobalActionResult =
  | { updated: boolean }
  | { deleted: boolean }
  | { id: string }
  | { removed: number }
  | { subscribed: boolean }
  | { revoked: boolean }
  | { ok: boolean; workspaceId?: string; name?: string; tickets: number; pieces: number; sources: number; error?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);
}

export function assertValidGlobalAction(value: unknown): asserts value is GlobalAction {
  if (!isRecord(value) || !boundedString(value.userId, 128) || !boundedString(value.op, 64)) throw new Error('global-job.invalidAction');
  const payload = isRecord(value.payload) ? value.payload : {};
  const target = isRecord(value.target) ? value.target : {};
  if (value.op === 'account-update') {
    if (Object.values(payload).some((field) => typeof field !== 'string' || field.length > 500)) throw new Error('global-job.invalidAccountUpdate');
    return;
  }
  if (value.op === 'account-preferences') {
    if (!isRecord(payload.preferences) || Object.values(payload.preferences).some((field) => typeof field !== 'boolean')) throw new Error('global-job.invalidPreferences');
    return;
  }
  if (value.op === 'account-delete') return;
  if (value.op === 'ssh-key-add') {
    if (!isObjectId(target.keyId) || !boundedString(payload.name, 200) || !boundedString(payload.type, 40) || !boundedString(payload.publicKey, 20_000) || typeof payload.fingerprint !== 'string' || payload.fingerprint.length > 500) throw new Error('global-job.invalidSshKey');
    return;
  }
  if (value.op === 'ssh-key-remove') {
    if (!isObjectId(target.keyId)) throw new Error('global-job.invalidSshKey');
    return;
  }
  if (value.op === 'push-save') {
    if (!boundedString(payload.endpoint, 8192) || !boundedString(payload.p256dh, 4096) || !boundedString(payload.auth, 4096) || typeof payload.fullBodyOptIn !== 'boolean') throw new Error('global-job.invalidPush');
    return;
  }
  if (value.op === 'push-remove') {
    if (!boundedString(payload.endpoint, 8192)) throw new Error('global-job.invalidPush');
    return;
  }
  if (value.op === 'pat-revoke') {
    if (!isObjectId(target.patId)) throw new Error('global-job.invalidPat');
    return;
  }
  if (value.op === 'workspace-import') {
    if (!isObjectId(target.workspaceId) || !('bundle' in payload)) throw new Error('global-job.invalidImport');
    return;
  }
  throw new Error('global-job.unknownAction');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).toSorted().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new Error('global-job.nonJsonPayload');
}

export function globalActionIdentity(action: GlobalAction): { id: string; dedupKey: string } {
  const canonical = canonicalJson(action);
  const dedupKey = createHash('sha256').update(canonical).digest('hex');
  return { id: deterministicObjectId(GLOBAL_WRITER_SCOPE, dedupKey, action.op), dedupKey };
}

export function workspaceImportAction(userId: string, bundle: unknown): WorkspaceImportGlobalAction {
  const provisional: WorkspaceImportGlobalAction = { op: 'workspace-import', userId, target: { workspaceId: '000000000000000000000000' }, payload: { bundle } };
  const bundleKey = createHash('sha256').update(canonicalJson({ userId, bundle })).digest('hex');
  return { ...provisional, target: { workspaceId: deterministicObjectId(GLOBAL_WRITER_SCOPE, bundleKey, 'workspace-import') } };
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry) => toPrismaJson(entry));
  if (isRecord(value)) {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) out[key] = toPrismaJson(entry);
    }
    return out;
  }
  throw new Error('global-job.nonJsonResult');
}

function resultFromStored(action: GlobalAction, value: unknown): GlobalActionResult | null {
  if (!isRecord(value)) return null;
  if (action.op === 'account-update' || action.op === 'account-preferences') return typeof value.updated === 'boolean' ? { updated: value.updated } : null;
  if (action.op === 'account-delete') return typeof value.deleted === 'boolean' ? { deleted: value.deleted } : null;
  if (action.op === 'ssh-key-add') return typeof value.id === 'string' ? { id: value.id } : null;
  if (action.op === 'ssh-key-remove' || action.op === 'push-remove') return typeof value.removed === 'number' ? { removed: value.removed } : null;
  if (action.op === 'push-save') return typeof value.subscribed === 'boolean' ? { subscribed: value.subscribed } : null;
  if (action.op === 'pat-revoke') return typeof value.revoked === 'boolean' ? { revoked: value.revoked } : null;
  if (typeof value.ok !== 'boolean' || typeof value.tickets !== 'number' || typeof value.pieces !== 'number' || typeof value.sources !== 'number') return null;
  return {
    ok: value.ok,
    tickets: value.tickets,
    pieces: value.pieces,
    sources: value.sources,
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

function actionFromEncrypted(payloadEnc: string): GlobalAction | null {
  const plain = decryptSecret(payloadEnc);
  if (plain === null || Buffer.byteLength(plain, 'utf8') > MAX_JOB_BYTES) return null;
  const [, parsed] = tryCatchSync(() => JSON.parse(plain) as unknown);
  if (parsed === null) return null;
  const [validationError] = tryCatchSync(() => { assertValidGlobalAction(parsed); });
  if (validationError) return null;
  assertValidGlobalAction(parsed);
  return parsed;
}

async function executeGlobalAction(action: GlobalAction): Promise<GlobalActionResult> {
  if (action.op === 'account-update') {
    const updated = await prisma.user.updateMany({ where: { id: action.userId }, data: action.payload });
    return { updated: updated.count === 1 };
  }
  if (action.op === 'account-preferences') {
    const updated = await prisma.user.updateMany({ where: { id: action.userId }, data: { preferences: action.payload.preferences } });
    return { updated: updated.count === 1 };
  }
  if (action.op === 'account-delete') {
    const existing = await prisma.user.findUnique({ where: { id: action.userId }, select: { id: true } });
    if (existing) {
      await revokeUserSessions(action.userId);
      const adapter = getUserAdapter();
      if (!adapter.delete) throw new Error('global-job.accountDeleteUnsupported');
      await adapter.delete(action.userId);
    }
    await tryCatch(() => unlink(path.join(getUploadsDir(), `${action.userId}.webp`)));
    return { deleted: true };
  }
  if (action.op === 'ssh-key-add') {
    const collision = await prisma.sshKey.findUnique({ where: { id: action.target.keyId }, select: { userId: true } });
    if (collision && collision.userId !== action.userId) throw new Error('global-job.identityCollision');
    const row = await prisma.sshKey.upsert({
      where: { id: action.target.keyId },
      create: { id: action.target.keyId, userId: action.userId, ...action.payload },
      update: action.payload,
      select: { id: true },
    });
    return { id: row.id };
  }
  if (action.op === 'ssh-key-remove') {
    const removed = await prisma.sshKey.deleteMany({ where: { id: action.target.keyId, userId: action.userId } });
    return { removed: removed.count };
  }
  if (action.op === 'push-save') {
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: action.payload.endpoint }, select: { userId: true } });
    if (existing && existing.userId !== action.userId) throw new Error('global-job.pushOwnedByOtherUser');
    await prisma.pushSubscription.upsert({
      where: { endpoint: action.payload.endpoint },
      create: { userId: action.userId, endpoint: action.payload.endpoint, keys: { p256dh: action.payload.p256dh, auth: action.payload.auth }, fullBodyOptIn: action.payload.fullBodyOptIn },
      update: { keys: { p256dh: action.payload.p256dh, auth: action.payload.auth }, fullBodyOptIn: action.payload.fullBodyOptIn, lastUsedAt: new Date() },
    });
    return { subscribed: true };
  }
  if (action.op === 'push-remove') {
    const removed = await prisma.pushSubscription.deleteMany({ where: { endpoint: action.payload.endpoint, userId: action.userId } });
    return { removed: removed.count };
  }
  if (action.op === 'pat-revoke') {
    // luckystack-allow tenant-scope: account owner may revoke an own PAT after leaving the workspace; userId prevents cross-account mutation.
    const revoked = await prisma.personalAccessToken.updateMany({ where: { id: action.target.patId, userId: action.userId }, data: { revoked: true } });
    return { revoked: revoked.count > 0 };
  }

  const existing = await prisma.workspace.findUnique({ where: { id: action.target.workspaceId }, select: { ownerId: true, importCompleted: true, name: true } });
  if (existing?.ownerId !== undefined && existing.ownerId !== action.userId) throw new Error('global-job.identityCollision');
  if (existing?.importCompleted === true) {
    const [tickets, pieces, sources] = await Promise.all([
      prisma.ticket.count({ where: { workspaceId: action.target.workspaceId, labels: { has: 'imported' } } }),
      prisma.contentProject.count({ where: { workspaceId: action.target.workspaceId } }),
      prisma.infoSource.count({ where: { workspaceId: action.target.workspaceId, source: 'import' } }),
    ]);
    return { ok: true, workspaceId: action.target.workspaceId, name: existing.name, tickets, pieces, sources };
  }
  if (existing) await cascadeDeleteWorkspace(action.target.workspaceId);
  return importWorkspaceBundle(prisma, action.userId, action.payload.bundle, action.target.workspaceId);
}

let globalChain: Promise<unknown> = Promise.resolve();

async function processGlobalJob(jobId: string): Promise<GlobalActionResult> {
  const previous = globalChain;
  const current = previous.then(() => withWorkspaceLease(GLOBAL_WRITER_SCOPE, async (lease) => runInWriterContext(GLOBAL_WRITER_SCOPE, async () => {
    const job = await prisma.globalJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error('global-job.notFound');
    const action = actionFromEncrypted(job.payloadEnc);
    if (!action) throw new Error('global-job.invalidPersistedPayload');
    if (job.status === 'completed' && job.result !== null) {
      const storedResult = resultFromStored(action, job.result);
      if (!storedResult) throw new Error('global-job.invalidPersistedResult');
      return storedResult;
    }
    if (job.status === 'failed' || job.attempts >= MAX_JOB_ATTEMPTS) throw new Error(job.lastError ?? 'global-job.failed');

    lease.assertHeld();
    await prisma.globalJob.update({ where: { id: job.id }, data: { status: 'running', attempts: { increment: 1 }, claimedAt: new Date(), lastError: null } });
    const [executionError, result] = await tryCatch(() => executeGlobalAction(action));
    lease.assertHeld();
    if (executionError || !result) {
      const nextAttempts = job.attempts + 1;
      await prisma.globalJob.update({ where: { id: job.id }, data: { status: nextAttempts >= MAX_JOB_ATTEMPTS ? 'failed' : 'pending', lastError: executionError?.message ?? 'global-job.emptyResult' } });
      throw executionError ?? new Error('global-job.emptyResult');
    }
    await prisma.globalJob.update({ where: { id: job.id }, data: { status: 'completed', result: toPrismaJson(result), processedAt: new Date(), lastError: null } });
    return result;
  }, lease, `global-job:${jobId}`)));
  globalChain = current.catch((error: unknown) => { console.error(`[global-job] ${jobId} failed:`, error); });
  return current;
}

export async function enqueueGlobalAction(action: GlobalAction): Promise<GlobalActionResult> {
  assertValidGlobalAction(action);
  const plain = canonicalJson(action);
  if (Buffer.byteLength(plain, 'utf8') > MAX_JOB_BYTES) throw new Error('global-job.payloadTooLarge');
  const identity = globalActionIdentity(action);
  const payloadEnc = encryptSecret(plain);
  const [createError] = await tryCatch(() => prisma.globalJob.create({
    data: { id: identity.id, kind: action.op, userId: action.userId, dedupKey: identity.dedupKey, payloadEnc },
  }));
  if (createError) {
    const existing = await prisma.globalJob.findUnique({ where: { id: identity.id }, select: { dedupKey: true } });
    if (existing?.dedupKey !== identity.dedupKey) throw createError;
  }
  return processGlobalJob(identity.id);
}

export async function runGlobalJobRecovery(now = Date.now()): Promise<{ replayed: number; failed: number }> {
  // luckystack-allow tenant-scope: global account/import jobs intentionally have no tenant; each replay enters the renewable global writer lease.
  const rows = await prisma.globalJob.findMany({
    where: {
      attempts: { lt: MAX_JOB_ATTEMPTS },
      OR: [
        { status: 'pending', createdAt: { lte: new Date(now - GLOBAL_JOB_STALE_MS) } },
        { status: 'running', claimedAt: { lte: new Date(now - GLOBAL_JOB_STALE_MS) } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  let replayed = 0;
  let failed = 0;
  for (const row of rows) {
    const [error] = await tryCatch(() => processGlobalJob(row.id));
    if (error) failed += 1;
    else replayed += 1;
  }
  return { replayed, failed };
}

