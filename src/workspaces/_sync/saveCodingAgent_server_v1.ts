//? Workspaces — [save-coding-agent] REALTIME write via `_sync` (ADR 0322). Persists which subscription seat
//? (claude | codex) + harness (claude-code | pi-agent) writes the code in the pipeline, plus the stage-tier →
//? model map, then broadcasts the normalised config so every client replaces `snap.codingAgent`. The Conductor
//? enforces the seat rule (Codex ⇒ pi). Requires workspaceSettings capability.
//? @docs owner ItsLucky23

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { codingAgentDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { subscription: string; harness?: string; tierModels?: Record<string, string>; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { subscription, harness, tierModels, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'save-coding-agent', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { subscription, ...(harness === undefined ? {} : { harness }), ...(tierModels === undefined ? {} : { tierModels }) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', codingAgent: codingAgentDelta(res.result) };
};
