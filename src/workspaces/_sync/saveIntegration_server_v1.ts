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

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { integrationId, name, type, fields, mcp, clientRequestId } = clientInput;
  if (name.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'save-integration', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: integrationId ? { integrationId } : {}, payload: { name, type, fields, mcp }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', integration: integrationDelta(res.result) };
};
