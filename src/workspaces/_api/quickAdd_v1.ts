//? Workspaces — [quick-add] typed per-action write route (Fase-0 write-path split).
//?
//? One op = one route with a TYPED payload, so the generated type-map makes the
//? client's `apiRequest({ name: 'workspaces/quickAdd', ... })` fully typed instead
//? of the old single `control` route that took a `Record<string, unknown>` envelope
//? (which defeated the type-server — the item-9 complaint). The route stays thin:
//? validate + RBAC (B-28) + ENQUEUE onto the serial Conductor (the single writer +
//? WorkspaceSignal event-recorder is preserved). The Conductor drains + writes the
//? ticket at `unrefined`; the client reconciles by refetching the snapshot.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

//? Skip the strict devkit `validateInputByType` (the depth-64 framework issue that
//? rejects every /api route here — see snapshot_v1). The handler validates its own
//? typed input; the generated Zod schema still guards the shape.
export const validation = 'relaxed' as const;

export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: {
    workspaceId: string;
    title: string;
    description?: string;
    sprintId?: string;
    clientRequestId: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, title, description, sprintId, clientRequestId } = data;
  if (!workspaceId || title.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };

  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  const { signalSeq } = await enqueueControlAction({
    workspaceId, op: 'quick-add', target: {},
    payload: { title, ...(description ? { description } : {}), ...(sprintId ? { sprintId } : {}) },
    userId: user.id, clientRequestId,
  });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
