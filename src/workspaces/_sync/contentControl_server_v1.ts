//? Workspaces — [content-*] content-generation writes via `_sync` (U2 depth-program). ONE route for the
//? content control-ops (create/advance/archive + every gen op + assemble + request-publish), each
//? dispatched through the single-writer Conductor (B-23) and RBAC-gated per op (OP_CAPABILITY). The op is
//? whitelisted to the content family so the client can't drive an arbitrary op through here. Content is
//? workspace-lane state; the realtime snapshot refresh carries the resulting pieces/assets back.

/** @docs owner ItsLucky23 */
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { broadcastContentDirty } from '../../../server/read/broadcast';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

//? The content-op family this route accepts (a subset of ControlOp — keeps the client scoped).
const CONTENT_OPS = new Set<string>([
  'content-create', 'content-advance', 'content-archive',
  'content-gen-script', 'content-gen-voice', 'content-gen-images', 'content-assemble',
  'content-gen-reference-image', 'content-gen-shortform', 'content-analyze-reference-video',
  'content-gen-avatar', 'content-gen-music', 'content-gen-sfx', 'content-gen-3d',
  'content-request-publish', 'content-from-brief', 'content-import-asset', 'content-regenerate', 'content-inpaint', 'content-reorder-beats', 'content-save-scenes', 'content-decompose-video', 'content-refine-range', 'content-unarchive', 'content-unpublish',
]);
//? Type-guard: a whitelisted content op IS a ControlOp (no cast needed downstream).
const isContentOp = (op: string): op is ControlOp => CONTENT_OPS.has(op);

export interface SyncParams {
  clientInput: {
    op: string; clientRequestId: string;
    contentProjectId?: string; projectId?: string;
    styleKey?: string; extraInstructions?: string; prompt?: string;
    referenceUrl?: string; referenceVideoUrl?: string; newStory?: string;
    title?: string; brief?: string; format?: string; platform?: string; assetId?: string;
    url?: string; kind?: string; tweak?: string; count?: string;
    maskUrl?: string; parentAssetId?: string;
    beats?: { beatId: string; order?: number; durationMs?: number }[];
    //? V1 — the full ordered scene list the timeline editor saves (upsert by id; missing ids are created,
    //? absent ids are removed). A scene is a real clip or a still, with trim + a transition.
    scenes?: { id?: string; videoAssetId?: string; imageAssetId?: string; startTrimMs?: number; endTrimMs?: number; durationMs?: number; transitionIn?: string; prompt?: string }[];
    //? V3/V4 — decompose per-scene duration; range-refine selection + instruction.
    sceneDurationMs?: number; startMs?: number; endMs?: number; instruction?: string;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, contentProjectId, ...payload } = clientInput;
  if (!isContentOp(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId,
    ...(contentProjectId ? { target: { contentProjectId } } : {}), payload,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? Nudge the whole room to refetch the content slice (structural changes carry no fine-grained delta;
  //? the per-asset timer state still flows via broadcastContentAssetDelta). roomCode == workspaceId.
  broadcastContentDirty(roomCode);
  return { status: 'success' };
};
