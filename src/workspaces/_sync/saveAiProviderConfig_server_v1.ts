//? Workspaces — [save-ai-provider-config] the credentials + settings for ONE text backend (ADR 0007).
//?
//? Distinct from `saveAiProvider`, which routes a FEATURE to a backend; this configures the backend
//? itself: its API key, model, endpoint and temperature. It lives on the workspace AI page rather than
//? beside the media keys, because the text backend runs the entire product — pipeline agents, the
//? assistant, docs, reviews — and sending someone to a content settings page to set it up is what made
//? that page read as "Gemini's settings".
//?
//? The key is write-only: it is never returned, and an unchanged form submits no `apiKey` at all, so
//? saving a model can never clear a stored credential. Requires workspaceSettings.
//?
//? @docs owner ItsLucky23

/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { providerId: string; apiKey?: string; model?: string; baseUrl?: string; temperature?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { providerId, apiKey, model, baseUrl, temperature, clientRequestId } = clientInput;
  if (providerId.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'save-ai-provider-config', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: {
      providerId,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(model === undefined ? {} : { model }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(temperature === undefined ? {} : { temperature }),
    },
    clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? No delta: the settings themselves come back on the next snapshot (presence-only for the key), and
  //? returning anything key-shaped here would put a credential on the wire for every room member.
  return { status: 'success' };
};
