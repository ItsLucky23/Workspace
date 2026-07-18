//? Workspaces — the shared REALTIME control-dispatch for per-action `_sync` routes.
//?
//? Every user-initiated write is a `[control-API]` op (01 §3.3): validate → RBAC →
//? enqueue on the single-writer Conductor. The realtime write-path keeps a SEPARATE
//? `_sync` event PER action (the user's ask: "aparte events voor iedere actie"), but
//? each route is a thin shell that delegates the identical RBAC+enqueue plumbing here
//? and only differs in the DELTA it maps out of the op result. `roomCode` IS the
//? workspaceId (the client joins room = workspaceId); membership is enforced by the
//? sync layer (`requireRoomMembership`) and re-checked here via `OP_CAPABILITY`.

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { OP_CAPABILITY, hasCapability } from './rbac';
import { enqueueControlAction, isControlActionFailure } from '../orchestrator/conductor';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';

export interface DispatchSyncInput {
  op: ControlOp;
  roomCode: string;                       // = workspaceId
  userId: string;
  prisma: PrismaClient;
  target?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  clientRequestId: string;
}

export type DispatchSyncResult =
  | { ok: true; result: unknown }
  | { ok: false; errorCode: 'sync.invalidRequest' | 'auth.forbidden' };

//? Validate + RBAC-gate + enqueue a control op, awaiting the write so the caller can
//? broadcast its delta. Returns the Conductor's op result (`unknown`) — each route
//? narrows it to a typed delta via the mappers (`ticketListDelta`, `sprintDelta`, …).
export async function dispatchControlSync(input: DispatchSyncInput): Promise<DispatchSyncResult> {
  const { op, roomCode, userId, prisma, target, payload, clientRequestId } = input;
  const workspaceId = roomCode;
  if (!workspaceId) return { ok: false, errorCode: 'sync.invalidRequest' };

  const allowed = await hasCapability(prisma, workspaceId, userId, OP_CAPABILITY[op]);
  if (!allowed) return { ok: false, errorCode: 'auth.forbidden' };

  const [enqueueError, enqueued] = await tryCatch(() => enqueueControlAction({
    workspaceId, op, target: target ?? {}, payload: payload ?? {}, userId, clientRequestId,
  }));
  if (enqueueError || !enqueued || isControlActionFailure(enqueued.result)) {
    return { ok: false, errorCode: 'sync.invalidRequest' };
  }
  return { ok: true, result: enqueued.result };
}
