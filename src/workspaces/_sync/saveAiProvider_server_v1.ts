//? Workspaces — [save-ai-provider] REALTIME write via `_sync` (FREEDOM_PROGRAM P1). Persists a per-workspace
//? AI provider override for one feature (which backend runs that feature), then broadcasts the full override
//? map so every client replaces `snap.aiOverrides`. This is what finally FEEDS the resolveAssignment override
//? seam. Requires workspaceSettings capability.
//? P4-1 — `feature: '_default'` sets the workspace-wide default backend. P4-2 — optional `model` pins a model
//? on that provider for the feature (stored as `providerId:model`; must be non-empty when sent).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { aiOverrideDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { feature: string; providerId: string; model?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { feature, providerId, model, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'save-ai-provider', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { feature, providerId, ...(model === undefined ? {} : { model }) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', aiOverrides: aiOverrideDelta(res.result) };
};
