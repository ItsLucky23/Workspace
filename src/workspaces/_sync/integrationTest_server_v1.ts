//? Workspaces — [integration-test] connect to a configured integration and report what happened.
//?
//? The owner asked for a way to test a predefined tool "waar mogelijk". This route is the trigger; the
//? honesty lives in `server/integrations/probe.ts`, which distinguishes an authenticated `ok` from a
//? `reachable` TCP dial so the page never claims a credential works when it only proved a port is open.
//?
//? Only an id crosses the wire. The credentials stay server-side: the Conductor resolves the tool's env
//? vars, decrypts them, uses them and drops them. Nothing about the value comes back — the response is a
//? status word and a redacted one-line detail, and the same pair is persisted on the row so the list
//? still says something on the next visit.
//?
//? @docs owner ItsLucky23

/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { integrationId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { integrationId, clientRequestId } = clientInput;
  if (integrationId.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'integration-test', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { integrationId }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? The verdict goes straight back to the caller so the button can answer immediately; the row itself
  //? carries the same verdict to everyone else on the next snapshot.
  return { status: 'success', result: res.result };
};
