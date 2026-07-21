//? Durable intent wrapper for slow editor/preview runtime launches. The Conductor accepts a bounded,
//? immutable intent under the workspace lease; Docker/proxy work then runs outside the lease; a typed
//? completion closes the intent. The recovery sweep re-drives prepared intents that lost their process.

import { acquireLease, formatKey, getPrismaClient, releaseLease, tryCatch } from '@luckystack/core';

import { closePreviewForTicket, openPreviewForTicket } from '../container/previewSession';
import { openEditorForTicket } from '../container/editorSession';
import { openRefPreview } from '../container/refPreview';
import { runInTenant } from '../tenant/tenantContext';
import { runtimeLaunchCompletionId } from './actionIds';
import {
  enqueueInternalAction,
  internalActionFromSignal,
  type RuntimeLaunchPrepareInternalAction,
} from './internalOps';

const prisma = getPrismaClient();
const RUNTIME_RECOVERY_STALE_MS = 30_000;
export const RUNTIME_JOB_RECOVERY_MS = Math.max(60_000, Number(process.env.WS_RUNTIME_JOB_RECOVERY_MIN ?? '1') * 60_000);
const RUNTIME_JOB_CLAIM_MS = Math.max(300_000, Number(process.env.WS_RUNTIME_JOB_CLAIM_MIN ?? '15') * 60_000);

function runtimeJobClaimKey(action: RuntimeLaunchPrepareInternalAction): string {
  return formatKey('runtime-job', `${action.workspaceId}:${action.target.intentId}`);
}

async function withRuntimeJobClaim<T extends object>(action: RuntimeLaunchPrepareInternalAction, execute: () => Promise<T>): Promise<T | null> {
  const key = runtimeJobClaimKey(action);
  const token = await acquireLease(key, RUNTIME_JOB_CLAIM_MS);
  if (token === null) return null;
  const [executionError, result] = await tryCatch(execute);
  const [releaseError, released] = await tryCatch(() => releaseLease(key, token));
  if (releaseError || released !== true) console.error(`[runtime-job] claim release failed for ${action.target.intentId}`);
  if (executionError) throw executionError;
  if (!result) throw new Error('[runtime-job] claimed execution returned no result');
  return result;
}

export interface RuntimeLaunchResult {
  ok: boolean;
  url?: string;
  host?: string;
  token?: string;
  ref?: string;
  error?: string;
}

export async function executeRuntimeLaunch(action: RuntimeLaunchPrepareInternalAction): Promise<RuntimeLaunchResult> {
  return runInTenant(action.workspaceId, async () => {
    if (action.payload.mode === 'preview-open') return openPreviewForTicket(action.workspaceId, action.target.ticketKey);
    if (action.payload.mode === 'preview-close') return closePreviewForTicket(action.workspaceId, action.target.ticketKey);
    if (action.payload.mode === 'ref-preview-open') return openRefPreview(action.workspaceId, action.target.ticketKey, action.payload.ref ?? '');
    return openEditorForTicket({
      workspaceId: action.workspaceId,
      ticketKey: action.target.ticketKey,
      branch: action.payload.branch ?? '',
      userId: action.userId,
      ...(action.payload.image ? { image: action.payload.image } : {}),
    });
  });
}

export async function completeRuntimeLaunch(action: RuntimeLaunchPrepareInternalAction, result: RuntimeLaunchResult): Promise<void> {
  await enqueueInternalAction({
    workspaceId: action.workspaceId,
    op: 'runtime-launch-complete',
    target: action.target,
    payload: {
      mode: action.payload.mode,
      ok: result.ok,
      ...(result.error === undefined ? {} : { error: result.error }),
    },
    userId: action.userId,
    clientRequestId: `runtime-complete:${action.target.intentId}`,
  });
}

function resultHasTicketKey(result: unknown, ticketKey: string): boolean {
  return result !== null && typeof result === 'object' && 'keys' in result && Array.isArray(result.keys) && result.keys.includes(ticketKey);
}

export async function runDurableRuntimeLaunch(action: RuntimeLaunchPrepareInternalAction): Promise<RuntimeLaunchResult> {
  const prepared = await enqueueInternalAction(action);
  if (!resultHasTicketKey(prepared.result, action.target.ticketKey)) return { ok: false, error: 'runtime.intentRejected' };
  return runPreparedRuntimeLaunch(action);
}

export interface RuntimeJobDependencies {
  execute?: (action: RuntimeLaunchPrepareInternalAction) => Promise<RuntimeLaunchResult>;
  complete?: (action: RuntimeLaunchPrepareInternalAction, result: RuntimeLaunchResult) => Promise<void>;
}

export async function runPreparedRuntimeLaunch(action: RuntimeLaunchPrepareInternalAction, dependencies: RuntimeJobDependencies = {}): Promise<RuntimeLaunchResult> {
  const execute = dependencies.execute ?? executeRuntimeLaunch;
  const complete = dependencies.complete ?? completeRuntimeLaunch;
  const claimed = await withRuntimeJobClaim(action, async () => {
    const [executionError, result] = await tryCatch(() => execute(action));
    const normalized = executionError || !result
      ? { ok: false, error: executionError?.message ?? 'runtime.executionFailed' }
      : result;
    await complete(action, normalized);
    return normalized;
  });
  return claimed ?? { ok: false, error: 'runtime.pending' };
}

export async function runRuntimeJobRecovery(now = Date.now(), dependencies: RuntimeJobDependencies = {}): Promise<{ replayed: number; failed: number }> {
  // luckystack-allow tenant-scope: leader discovery scans prepared intents globally, then executeRuntimeLaunch enters runInTenant for the row workspace.
  const prepared = await prisma.workspaceSignal.findMany({
    where: {
      kind: 'runtime-launch-prepare',
      processedAt: { not: null },
      createdAt: { lte: new Date(now - RUNTIME_RECOVERY_STALE_MS) },
    },
    select: { id: true, workspaceId: true, kind: true, payload: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  let replayed = 0;
  let failed = 0;
  for (const row of prepared) {
    const completionId = runtimeLaunchCompletionId(row.workspaceId, row.id);
    //? Presence of the deterministic completion signal proves external execution already returned. Even if
    //? its short DB apply crashed before processedAt, route-job recovery owns that typed completion; never
    //? duplicate Docker/proxy work merely because the acknowledgement is still pending.
    const completed = await prisma.workspaceSignal.findFirst({ where: { id: completionId, workspaceId: row.workspaceId }, select: { id: true } });
    if (completed) continue;
    const action = internalActionFromSignal(row);
    if (action?.op !== 'runtime-launch-prepare') {
      failed += 1;
      continue;
    }
    const [error, result] = await tryCatch(() => runPreparedRuntimeLaunch(action, dependencies));
    if (error) failed += 1;
    else if (result?.error !== 'runtime.pending') replayed += 1;
  }
  return { replayed, failed };
}
