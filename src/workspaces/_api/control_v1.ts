//? Workspaces — the [control-API] route (Fase 1 single dispatching handler).
//?
//? THE user-initiated write path: validate → `preApiExecute`-style RBAC (here,
//? inline: WorkspaceRole.perms[requiredCap]) → enqueue a Conductor action → return
//? the `ControlAck`. The handler NEVER writes authoritative state inline — the
//? Conductor is the only writer (B-23, CONTROL_API §7). One route keyed by `op`
//? for Fase 1 (per-op split is a later mechanical change — decision 0002).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import type { ControlOp } from '../_functions/controlApi';
import { OP_CAPABILITY } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';
import { createBlankWorkspace } from '../../../server/bootstrap/seedWorkspace';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

//? Skip the strict devkit `validateInputByType` (depth-64 framework issue — see
//? snapshot_v1). The handler validates op + RBAC; the zod input schema still guards.
export const validation = 'relaxed' as const;

export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  //? The transport envelope (CONTROL_API §6.1). `target`/`payload` are loosely
  //? typed at the edge; each op reads the fields it needs (Conductor-side).
  data: {
    workspaceId: string;
    op: ControlOp;
    target: Record<string, unknown>;
    payload: Record<string, unknown>;
    clientRequestId: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, op, target, payload, clientRequestId } = data;
  const { prisma } = functions.db;

  //? Reject an unknown op (a malformed request can send a string outside the union).
  if (!Object.hasOwn(OP_CAPABILITY, op)) {
    return { status: 'error', errorCode: 'api.invalidRequest' };
  }
  const requiredCap = OP_CAPABILITY[op];

  //? create-workspace is login-only (the caller becomes Owner) and CREATES the
  //? tenant, so it can't be scoped/enqueued by workspaceId — it's a direct
  //? RBAC-gated bootstrap write (MIGRATION §5, CONTROL_API §9). Uses
  //? `createBlankWorkspace` (NOT the bare `bootstrapWorkspace`) so the new
  //? workspace ships with a Project + the default pipeline stages + a light
  //? starter seed — otherwise the board/pipeline pages are blank and the first
  //? quick-add finds no project (item 8).
  if (op === 'create-workspace') {
    const name = typeof payload.name === 'string' ? payload.name : '';
    if (!name.trim()) return { status: 'error', errorCode: 'api.invalidRequest' };
    const { workspaceId: newId } = await createBlankWorkspace(prisma, user.id, name.trim());
    return { status: 'success', result: { accepted: true, signalSeq: 0, workspaceId: newId } };
  }

  //? accept-invite is ALSO login-only: the caller may have no active workspace yet
  //? (onboarding join path), so it arrives with an empty `workspaceId` and must not
  //? be rejected by the workspace-scoped guard below (that was the `api.invalidRequest`
  //? 400 that broke the join flow — item 9). Enqueue it on the Conductor's
  //? login-only path (no signal/tenant); the invite carries its own target workspace.
  if (op === 'accept-invite') {
    const { signalSeq } = await enqueueControlAction({ workspaceId: '', op, target, payload, userId: user.id, clientRequestId });
    return { status: 'success', result: { accepted: true, signalSeq } };
  }

  if (!workspaceId) {
    return { status: 'error', errorCode: 'api.invalidRequest' };
  }

  //? RBAC (CONTROL_API §5): a null capability = login-only own-resource op (e.g.
  //? mark-read); otherwise the caller's WorkspaceRole must grant the capability.
  if (requiredCap !== null) {
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id } });
    if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
    const role = await prisma.workspaceRole.findFirst({ where: { workspaceId, key: member.roleKey } });
    if (!role?.perms[requiredCap]) {
      return { status: 'error', errorCode: 'auth.forbidden' };
    }
  }

  //? Enqueue → the Conductor drains it serially and writes (never inline, §7).
  const { signalSeq } = await enqueueControlAction({
    workspaceId, op, target, payload, userId: user.id, clientRequestId,
  });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
