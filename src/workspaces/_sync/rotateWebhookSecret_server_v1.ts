//? Workspaces — [forge-webhook-rotate] REALTIME write via `_sync` (#27). Mints a fresh per-workspace
//? inbound-webhook secret through the Conductor (single-writer, B-23) and returns it so the settings card
//? can show it once for pasting into the forge's webhook config. Requires workspaceSettings (OP_CAPABILITY).
/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'forge-webhook-rotate', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: {}, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  const secret = typeof res.result === 'object' && res.result !== null && 'webhookSecret' in res.result ? String(res.result.webhookSecret) : '';
  return { status: 'success', webhookSecret: secret };
};
