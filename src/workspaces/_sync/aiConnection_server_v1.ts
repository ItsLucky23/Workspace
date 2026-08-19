//? Workspaces — [ai-connection-*] the connected AIs: add one, test its credentials, disconnect it.
//?
//? One route for the three verbs, because they are one feature and share one capability
//? (`workspaceSettings`). Replaces the earlier per-provider config route: the owner asked for a LIST
//? of connected AIs — two OpenAI models side by side, Claude Code as something you connect and
//? disconnect — which a single record per provider could not express.
//?
//? The API key travels IN and never back out: the response carries no credential, and the snapshot
//? reports `hasKey` as a boolean. `baseUrl` is not accepted at all — which host answers is
//? infrastructure, resolved server-side from the provider catalog with an operator env override.
//?
//? @docs owner ItsLucky23

/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const OPS = new Set<string>(['ai-connection-add', 'ai-connection-test', 'ai-connection-remove']);
const isConnectionOp = (op: string): op is ControlOp => OPS.has(op);

export interface SyncParams {
  clientInput: { op: string; providerId?: string; model?: string; apiKey?: string; connectionId?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, providerId, model, apiKey, connectionId, clientRequestId } = clientInput;
  if (!isConnectionOp(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: {
      ...(providerId === undefined ? {} : { providerId }),
      ...(model === undefined ? {} : { model }),
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(connectionId === undefined ? {} : { connectionId }),
    },
    clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? The Conductor's own result carries the outcome the UI reports: whether a test passed, and which
  //? features a removal moved. No delta — the list itself arrives on the next snapshot.
  return { status: 'success', result: res.result };
};
