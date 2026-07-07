//? Workspaces — [content-asset-delta] BROADCAST-ONLY realtime carrier. Mid-generation media jobs
//? push their live status (queued → running → done, with queuePosition/startedAt) to the workspace
//? room via `broadcastContentAssetDelta` (server/read/broadcast.ts), NOT through a client-initiated
//? call. This handler exists solely so the route + its `serverOutput` shape are registered in the
//? generated type maps, giving the client's `upsertSyncEventCallback('workspaces/contentAssetDelta')`
//? a typed payload to merge (upsert the asset by id into its content piece). A direct call is a no-op.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import type { ContentAssetSummary } from '../_data/types';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

//? Type-carrier for the delta's `asset` field: returns null (this route is a no-op on a direct call),
//? but its RETURN TYPE is what the generator lifts into the client callback's `serverOutput.asset`.
//? Mirrors the ticketDelta pattern — the generator reads a call's return type, not a literal's value.
function contentAssetDeltaAsset(): ContentAssetSummary | null { return null; }

//? Must be `async` with a DIRECT object-literal return — that is the only shape the type generator
//? extracts the serverOutput from (a Promise.resolve(...) or a variable return degrades to unknown).
//? No await needed (pure no-op carrier), hence the targeted disable.
// eslint-disable-next-line @typescript-eslint/require-await -- broadcast-only type carrier; async+literal is required for serverOutput type extraction
export const main = async (): Promise<SyncServerResponse> => {
  return { status: 'success', contentProjectId: '', asset: contentAssetDeltaAsset() };
};
