//? Workspaces — [accept-suggestion] REALTIME write via `_sync`. Accepts an AI
//? suggestion (status → accepted), then broadcasts its id to the room; every client
//? drops it from the open-suggestion list (no refetch). Workspace-owned effect: requires workTickets.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { suggestionId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'accept-suggestion', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { suggestionId: clientInput.suggestionId }, clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', acceptedSuggestionId: clientInput.suggestionId };
};
