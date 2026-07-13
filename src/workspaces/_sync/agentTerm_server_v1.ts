//? Workspaces — [agent-term] BROADCAST-ONLY realtime carrier (#20). The stage-runner tees the CODE agent's
//? live PTY output (throttled) to the workspace room via `broadcastAgentTerm` (server/read/broadcast.ts), so a
//? "Live agent" view can tail the turn as it happens. This handler only registers the route + its payload shape
//? ({ ticketKey, chunk }) in the generated type maps for the client's `upsertSyncEventCallback('workspaces/agentTerm')`;
//? a direct call is a no-op. NOT authoritative state (single-writer untouched) — pure observability.
/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

// eslint-disable-next-line @typescript-eslint/require-await -- broadcast-only type carrier; async+literal is required for serverOutput type extraction
export const main = async (): Promise<SyncServerResponse> => {
  //? Typed as `string` (not the literal '') so the extracted client payload widens correctly.
  const ticketKey: string = '';
  const chunk: string = '';
  return { status: 'success', ticketKey, chunk };
};
