//? Workspaces — [content-dirty] BROADCAST-ONLY realtime carrier. A coarse "the content slice changed"
//? nudge emitted server-side by `broadcastContentDirty` (server/read/broadcast.ts) after any content
//? control/settings op, so every client in the room refetches (debounced) — the catch-all that keeps
//? structural content changes (piece create/advance/archive, script gen, settings) in sync across the
//? whole workspace. This handler only registers the route in the generated type maps for the client's
//? `upsertSyncEventCallback('workspaces/contentDirty')`; a direct call is a no-op.

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
  return { status: 'success' };
};
