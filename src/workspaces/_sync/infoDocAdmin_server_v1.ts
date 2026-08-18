//? Workspaces — [info-source-archive | info-source-delete] REALTIME write via `_sync` (ADR 0310).
//? Retiring a context doc: archive (reversible — the doc stops feeding every AI and moves to the
//? Sources page's Archived view) or delete (irreversible; the UI gates it behind a confirm).
//? Mirrors the `addInfoDoc` route: one op, and the full doc list back as the delta so every client
//? in the room replaces its list. Requires editPipeline.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { docListDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  //? `action` picks the op rather than the route carrying two verbs: archive and restore are the
  //? same write with a different value, and delete shares the identical guard + delta shape.
  clientInput: { docId: string; action: 'archive' | 'restore' | 'delete'; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { docId, action, clientRequestId } = clientInput;
  if (docId.length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };

  const res = await dispatchControlSync({
    op: action === 'delete' ? 'info-source-delete' : 'info-source-archive',
    roomCode,
    userId: user.id,
    prisma: functions.db.prisma,
    payload: action === 'delete' ? { infoSourceId: docId } : { infoSourceId: docId, archived: action === 'archive' },
    clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', docs: docListDelta(res.result) };
};
