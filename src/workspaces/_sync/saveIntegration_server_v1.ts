//? Workspaces — [save-integration] REALTIME write via `_sync`. Creates or (when
//? `integrationId` is given) updates an integration tool, then broadcasts the row to
//? the workspace room; every client upserts it by id (no refetch). The fields/mcp
//? composites are coerced Conductor-side. Requires workspaceSettings.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import type { IntegrationTool } from '../_data/types';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { integrationDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { integrationId?: string; name: string; type: string; fields: IntegrationTool['fields']; mcp: IntegrationTool['mcp']; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

const isObjectId = (value: string): boolean => /^[a-f\d]{24}$/i.test(value);

//? IntegrationField.envVarId is a loose embedded reference, so Prisma cannot enforce
//? tenant ownership. Validate the COMPLETE non-null ref set before enqueueing: one
//? missing, malformed, or foreign id rejects the whole save without revealing which.
export async function integrationEnvRefsBelongToWorkspace(
  prisma: Functions['db']['prisma'],
  workspaceId: string,
  fields: IntegrationTool['fields'],
): Promise<boolean> {
  const envVarIds = [...new Set(fields.flatMap((field) => field.envVarId === null ? [] : [field.envVarId]))];
  if (!isObjectId(workspaceId) || envVarIds.some((id) => !isObjectId(id))) return false;
  if (envVarIds.length === 0) return true;
  const matching = await prisma.envVar.count({ where: { workspaceId, id: { in: envVarIds } } });
  return matching === envVarIds.length;
}

export type SaveIntegrationResponse =
  | { status: 'error'; errorCode: 'sync.invalidRequest' | 'auth.forbidden' }
  | { status: 'success'; integration: IntegrationTool | null };

export async function saveIntegrationRequest(input: {
  clientInput: SyncParams['clientInput'];
  userId: string;
  prisma: Functions['db']['prisma'];
  roomCode: string;
}): Promise<SaveIntegrationResponse> {
  const { clientInput, userId, prisma, roomCode } = input;
  const { integrationId, name, type, fields, mcp, clientRequestId } = clientInput;
  if (name.trim().length === 0 || !(await integrationEnvRefsBelongToWorkspace(prisma, roomCode, fields))) {
    return { status: 'error', errorCode: 'sync.invalidRequest' };
  }
  const res = await dispatchControlSync({
    op: 'save-integration', roomCode, userId, prisma,
    target: integrationId ? { integrationId } : {}, payload: { name, type, fields, mcp }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', integration: integrationDelta(res.result) };
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const result = await saveIntegrationRequest({ clientInput, userId: user.id, prisma: functions.db.prisma, roomCode });
  if (result.status === 'error') return { status: 'error', errorCode: result.errorCode };
  return { status: 'success', integration: result.integration };
};
