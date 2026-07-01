//? Workspaces — [ticket-edit] typed per-action write route (Fase-0 pattern). Edits a
//? ticket's title / description / labels (stage + assignee changes reuse bulkMove /
//? bulkAssign on a single ticket). See quickAdd_v1 for the base pattern.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: {
    workspaceId: string;
    ticketId: string;
    title?: string;
    description?: string;
    labels?: string[];
    clientRequestId: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketId, title, description, labels, clientRequestId } = data;
  if (!workspaceId || !ticketId) return { status: 'error', errorCode: 'api.invalidRequest' };
  if (title?.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  //? Only forward the fields the caller actually sent (a plain `if` with no else so
  //? `description: ''` can clear it, without tripping the negated-condition lint).
  const payload: { title?: string; description?: string; labels?: string[] } = {};
  if (title !== undefined) payload.title = title;
  if (description !== undefined) payload.description = description;
  if (labels !== undefined) payload.labels = labels;

  const { signalSeq } = await enqueueControlAction({
    workspaceId, op: 'ticket-edit', target: { ticketId }, payload, userId: user.id, clientRequestId,
  });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
