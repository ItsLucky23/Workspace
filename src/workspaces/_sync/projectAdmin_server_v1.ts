//? Workspaces — multi-project / multi-service admin writes via `_sync` (ADR 0035). Three control-ops
//? through the single-writer Conductor (B-23), RBAC-gated (workspaceSettings): `project-create` adds
//? a project to the workspace, `service-create` / `service-delete` manage a project's build/deploy
//? units. These change rarely → the client refetches the snapshot after the write.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const OPS = new Set<string>(['project-create', 'service-create', 'service-delete', 'forge-connect', 'env-deploy', 'env-teardown', 'env-promote', 'build-export']);

export interface SyncParams {
  clientInput: { op: string; clientRequestId: string; projectId?: string; serviceId?: string; envId?: string; kind?: string; fromKind?: string; approved?: boolean; name?: string; gitUrl?: string; path?: string; buildCmd?: string; deployUnit?: string; mode?: string; baseUrl?: string; token?: string; repoPath?: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, projectId, serviceId, envId, ...payload } = clientInput;
  if (!OPS.has(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: op as ControlOp, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId,
    target: { ...(projectId ? { projectId } : {}), ...(serviceId ? { serviceId } : {}), ...(envId ? { envId } : {}) }, payload,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
