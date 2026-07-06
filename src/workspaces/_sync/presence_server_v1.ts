//? Workspaces — [presence] REALTIME who's-viewing (#17). A pure RELAY: a client viewing a ticket
//? pings this event (on open + a heartbeat), and it re-broadcasts {userId, ticketKey, viewing} to the
//? whole workspace room so every client can render live viewer avatars. No server state + no
//? Conductor write (presence is ephemeral, not authoritative) — the socket layer's room fan-out
//? (Redis adapter under WS_MULTI_INSTANCE) makes it multi-instance-safe for free. The authenticated
//? user id comes from the session, never the client, so presence can't be spoofed.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  //? `claiming` (ADR 0048): a soft-claim — this user is ANSWERING the ticket's question. Ephemeral, like
  //? viewing; the client renders "X is answering" + disables the answer input for others (idempotent —
  //? re-announcing the same claim is a no-op).
  clientInput: { ticketKey: string; viewing: boolean; claiming?: boolean; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput, user }: SyncParams): SyncServerResponse => {
  const { ticketKey, viewing, claiming } = clientInput;
  if (!ticketKey) return { status: 'error', errorCode: 'sync.invalidRequest' };
  return { status: 'success', presence: { userId: user.id, ticketKey, viewing, claiming: claiming === true } };
};
