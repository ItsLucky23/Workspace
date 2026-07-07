//? Workspaces — [save-ai-instruction] REALTIME write via `_sync` (FREEDOM_PROGRAM Q4). Persists the
//? workspace-wide "how the AI should work here" instruction (Workspace.aiInstruction), prepended to every
//? AI completion's system prompt (server/ai/registry.ts). The Conductor is the single writer; the sanitized
//? value is broadcast back so every client replaces it live. Requires workspaceSettings capability.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { aiInstruction: string; outputLanguage: string; geminiModel: string; geminiTemperature: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { aiInstruction, outputLanguage, geminiModel, geminiTemperature, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'save-ai-instruction', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { aiInstruction, outputLanguage, geminiModel, geminiTemperature }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', aiInstruction, outputLanguage, geminiModel, geminiTemperature };
};
