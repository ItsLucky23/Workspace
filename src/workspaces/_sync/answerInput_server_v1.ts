//? Workspaces — [answer-input] REALTIME write via `_sync` (#17). A human answers the ticket's open
//? AI question: the Conductor records the answer as a comment, clears the needs-input banner, and
//? RE-FIRES the parked turn with `claude --resume` + the answer (builds on #1's resume path). The
//? updated ticket (banner cleared, status idle) is broadcast so every board reflects it live.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { ticketListDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { ticketKey: string; answer: string; advisoryIndex?: number; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { ticketKey, answer, advisoryIndex, clientRequestId } = clientInput;
  if (answer.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'answer-input', roomCode, userId: user.id, prisma: functions.db.prisma,
    //? #16 — thread advisoryIndex through so the conductor's advisory-resolve path is reachable (W2).
    target: { ticketKey }, payload: { answer, ...(typeof advisoryIndex === 'number' ? { advisoryIndex } : {}) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', tickets: ticketListDelta(res.result) };
};
