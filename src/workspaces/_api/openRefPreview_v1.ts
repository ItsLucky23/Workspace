//? Workspaces — [open-ref-preview] (T1) start the ticket's app at an ARBITRARY git ref (SHA/tag/branch) in an
//? ephemeral, ref-scoped container + expose it at a ref subdomain. A direct `_api` op (NOT a Conductor control-op)
//? — the container launch + dev-server boot are slow and must not block the serial writer, like openPreview.
//? Gated on `workTickets`.

import { randomUUID } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { hasCapability, CAP } from '../../../server/control/rbac';
import { runtimeLaunchIntentId } from '../../../server/orchestrator/actionIds';
import { runDurableRuntimeLaunch } from '../../../server/orchestrator/runtimeJobs';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; ticketKey: string; ref: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketKey, ref } = data;
  if (!workspaceId || !ticketKey || !ref) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const ticket = await functions.db.prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { projectId: true } });
  if (!ticket) return { status: 'error', errorCode: 'api.invalidRequest' };
  const suppliedRequestId = data.clientRequestId?.trim();
  const clientRequestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : randomUUID();
  const result = await runDurableRuntimeLaunch({
    workspaceId,
    op: 'runtime-launch-prepare',
    target: { intentId: runtimeLaunchIntentId(workspaceId, clientRequestId), ticketKey, projectId: ticket.projectId },
    payload: { mode: 'ref-preview-open', ref },
    userId: user.id,
    clientRequestId: `runtime-ref-preview:${clientRequestId}`,
  });
  return { status: 'success', result };
};
