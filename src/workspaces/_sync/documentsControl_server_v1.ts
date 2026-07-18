/** @docs owner ItsLucky23 */
//? Workspaces — [documents] the Documents-module writes via `_sync` (DOC, DOCUMENTS_AND_SKILLS).
//? ONE route for the document ops (create/edit/delete/ai/apply-draft/discard-draft/gen-image), each
//? dispatched through the single-writer Conductor (B-23), RBAC-gated (workTickets) via OP_CAPABILITY.
//? Whitelisted so the client can't drive an arbitrary op; the client refetches the snapshot after
//? the write. The AI op writes ONLY aiDraft — apply-draft is the consent that writes content.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { broadcastContentDirty } from '../../../server/read/broadcast';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export const PUBLIC_DOCUMENT_OPS = new Set<string>(['document-create', 'document-edit', 'document-delete', 'document-ai', 'document-apply-draft', 'document-discard-draft', 'document-gen-image', 'document-export', 'document-restore-revision', 'document-archive', 'document-unarchive', 'doc-template-save', 'doc-template-delete']);
export const isDocumentOp = (op: string): op is ControlOp => PUBLIC_DOCUMENT_OPS.has(op);

export interface SyncParams {
  clientInput: {
    op: string; clientRequestId: string;
    documentId?: string; title?: string; content?: string;
    //? C2 — attach an EXISTING approved asset instead of generating a new one.
    assetId?: string;
    mode?: string; instruction?: string; prompt?: string; format?: string;
    addAssetUrl?: string; addAssetKind?: string; addAssetLabel?: string;
    revisionId?: string;
    //? 2.1 — templates: create-with-template + template CRUD.
    kind?: string; templateSlug?: string; slug?: string; name?: string; description?: string;
    sections?: { heading?: string; hint?: string }[];
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, ...payload } = clientInput;
  if (!isDocumentOp(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({ op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId, payload });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  broadcastContentDirty(roomCode);
  return { status: 'success' };
};
