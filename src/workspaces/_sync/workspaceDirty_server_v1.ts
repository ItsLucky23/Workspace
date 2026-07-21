/** @docs owner ItsLucky23 */
//? Workspaces — [workspace-dirty] BROADCAST-ONLY realtime carrier. The GENERAL "a workspace slice changed"
//? nudge emitted server-side by `broadcastWorkspaceDirty` (server/read/broadcast.ts) at the tail of every
//? drained PUBLIC control action, so every client in the room converges (debounced refetch) — the catch-all
//? that makes every cold settings/infra write live-for-all, generalizing the content-only `contentDirty`.
//? A `gone` payload is the workspace-DELETED lifecycle signal (other members drop the dead tenant + fall
//? back to their picker). This handler exists only to register the route + its `serverOutput` shape in the
//? generated type maps for the client's `upsertSyncEventCallback('workspaces/workspaceDirty')`; a direct
//? call is a no-op (the real payload always comes from `broadcastWorkspaceDirty`).

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

//? Type-carriers: the generator lifts the RETURN TYPE (not the literal value) into the client's serverOutput,
//? so these give `gone`/`workspaceId` their exact types (a bare `false`/`''` literal would narrow to `false`
//? / `''` and break the client's `if (serverOutput.gone)` branch).
function goneFlag(): boolean { return false; }
function goneWorkspaceId(): string { return ''; }

// eslint-disable-next-line @typescript-eslint/require-await -- broadcast-only type carrier; async+literal is required for serverOutput type extraction
export const main = async (): Promise<SyncServerResponse> => {
  return { status: 'success', gone: goneFlag(), workspaceId: goneWorkspaceId() };
};
