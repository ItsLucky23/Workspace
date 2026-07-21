/** @docs owner ItsLucky23 */
//? Workspaces — [content-piece-delta] BROADCAST-ONLY realtime carrier. A single content piece's fresh state
//? is pushed to the workspace room by `broadcastContentPieceDelta` (server/read/broadcast.ts) after a
//? single-piece structural op (advance/archive/unarchive), so every board UPSERTS that piece by id with no
//? full refetch — the granular alternative to the coarse `contentDirty` nudge. This handler only registers
//? the route + its `serverOutput` shape in the generated type maps, giving the client's
//? `upsertSyncEventCallback('workspaces/contentPieceDelta')` a typed `piece` payload; a direct call is a no-op.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import type { ContentPieceSummary } from '../_data/types';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

//? Type-carrier: the generator lifts this return type into the client callback's `serverOutput.piece`
//? (returns null on a direct call — the real payload always comes from `broadcastContentPieceDelta`).
function contentPieceDeltaPiece(): ContentPieceSummary | null { return null; }

// eslint-disable-next-line @typescript-eslint/require-await -- broadcast-only type carrier; async+literal is required for serverOutput type extraction
export const main = async (): Promise<SyncServerResponse> => {
  return { status: 'success', piece: contentPieceDeltaPiece() };
};
