//? Workspaces — multi-project / multi-service admin writes via `_sync` (ADR 0035).
//? `gitlab-resync` is deliberately split: RBAC first, bounded forge fetch outside
//? the writer lease, then public ControlOp dispatch of the credential-free snapshot.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import {
  dispatchControlSync,
  type DispatchSyncInput,
  type DispatchSyncResult,
} from '../../../server/control/dispatchSync';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { broadcastTicketDelta } from '../../../server/read/broadcast';
import { runInTenant } from '../../../server/tenant/tenantContext';
import {
  fetchForgeSnapshot,
  forgeTouchedKeys,
  type ForgeFetchSnapshotResult,
} from '../../../server/git/gitlabSync';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const OPS = new Set<string>(['project-create', 'project-from-template', 'apply-design-tokens', 'service-create', 'service-delete', 'forge-connect', 'env-deploy', 'env-teardown', 'env-rollback', 'env-promote', 'build-export', 'ci-run', 'ci-allow-red', 'root-cause', 'plan-critique', 'index-memory', 'db-connect', 'db-migrate-create', 'db-migrate-apply', 'db-introspect', 'edit-budget', 'raise-cap', 'resume-spend', 'gitlab-resync']);

function isProjectAdminOp(op: string): op is ControlOp {
  return OPS.has(op);
}

export interface SyncParams {
  clientInput: { op: string; clientRequestId: string; projectId?: string; serviceId?: string; envId?: string; ticketKey?: string; kind?: string; fromKind?: string; approved?: boolean; enabled?: boolean; trigger?: string; symptom?: string; template?: string; name?: string; gitUrl?: string; brief?: string; path?: string; buildCmd?: string; deployUnit?: string; mode?: string; baseUrl?: string; token?: string; repoPath?: string; url?: string; envKind?: string; sql?: string; rollbackSql?: string; migrationId?: string; connectionId?: string; pinnedCommit?: string; autoRedeploy?: boolean; subdomain?: string; customDomain?: string; cap?: number; alertPct?: number; budgetId?: string; label?: string; enforcement?: string; create?: boolean };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

type ProjectAdminPrisma = Functions['db']['prisma'];

export interface ForgeResyncDependencies {
  authorize: (prisma: ProjectAdminPrisma, workspaceId: string, userId: string) => Promise<boolean>;
  fetchSnapshot: (prisma: ProjectAdminPrisma, workspaceId: string, projectId: string) => Promise<ForgeFetchSnapshotResult>;
  dispatch: (input: DispatchSyncInput) => Promise<DispatchSyncResult>;
  broadcast: (prisma: ProjectAdminPrisma, workspaceId: string, keys: string[]) => Promise<void>;
}

function defaultForgeResyncDependencies(): ForgeResyncDependencies {
  return {
    authorize: (prisma, workspaceId, userId) => hasCapability(prisma, workspaceId, userId, CAP.workspaceSettings),
    fetchSnapshot: (prisma, workspaceId, projectId) => runInTenant(
      workspaceId,
      () => fetchForgeSnapshot(prisma, workspaceId, projectId),
    ),
    dispatch: dispatchControlSync,
    broadcast: (prisma, workspaceId, keys) => broadcastTicketDelta(prisma, workspaceId, keys),
  };
}

export async function dispatchForgeResync(
  input: {
    prisma: ProjectAdminPrisma;
    workspaceId: string;
    userId: string;
    projectId: string;
    clientRequestId: string;
  },
  dependencies?: ForgeResyncDependencies,
): Promise<DispatchSyncResult> {
  const deps = dependencies ?? defaultForgeResyncDependencies();
  //? The explicit pre-fetch check prevents an unauthorized caller from spending
  //? forge quota or probing connectivity. dispatch re-checks RBAC before apply.
  const allowed = await deps.authorize(input.prisma, input.workspaceId, input.userId);
  if (!allowed) return { ok: false, errorCode: 'auth.forbidden' };

  const fetched = await deps.fetchSnapshot(input.prisma, input.workspaceId, input.projectId);
  if (!fetched.ok) return { ok: false, errorCode: 'sync.invalidRequest' };
  const dispatched = await deps.dispatch({
    op: 'gitlab-resync',
    roomCode: input.workspaceId,
    userId: input.userId,
    prisma: input.prisma,
    clientRequestId: input.clientRequestId,
    target: { projectId: input.projectId },
    payload: { snapshot: fetched.snapshot },
  });
  if (!dispatched.ok) return dispatched;
  const keys = forgeTouchedKeys(dispatched.result);
  if (keys.length > 0) await deps.broadcast(input.prisma, input.workspaceId, keys);
  return dispatched;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, projectId, serviceId, envId, ...payload } = clientInput;
  if (!isProjectAdminOp(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };

  if (op === 'gitlab-resync') {
    if (!projectId) return { status: 'error', errorCode: 'sync.invalidRequest' };
    const [resyncError, resync] = await functions.tryCatch.tryCatch(() => dispatchForgeResync({
      prisma: functions.db.prisma,
      workspaceId: roomCode,
      userId: user.id,
      projectId,
      clientRequestId,
    }));
    if (resyncError || !resync) return { status: 'error', errorCode: 'sync.invalidRequest' };
    if (!resync.ok) return { status: 'error', errorCode: resync.errorCode };
    return { status: 'success' };
  }

  const result = await dispatchControlSync({
    op,
    roomCode,
    userId: user.id,
    prisma: functions.db.prisma,
    clientRequestId,
    target: {
      ...(projectId ? { projectId } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(envId ? { envId } : {}),
    },
    payload,
  });
  if (!result.ok) return { status: 'error', errorCode: result.errorCode };
  return { status: 'success' };
};
