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
  'content-request-publish', 'content-from-brief', 'content-import-asset', 'content-regenerate', 'content-inpaint', 'content-reorder-beats', 'content-save-scenes', 'content-decompose-video', 'content-refine-range', 'content-run-pipeline', 'content-save-audio-mix', 'content-trim-audio', 'content-critique-image', 'content-gen-thumbnail', 'content-reply-comment', 'content-video-restyle', 'content-edit-image', 'content-transcode', 'shortlink-create', 'capture-run', 'channel-create', 'channel-edit', 'channel-delete', 'account-disconnect', 'reference-add', 'reference-delete', 'content-unarchive', 'content-unpublish', 'studio-send-to-content',
]);
//? Type-guard: a whitelisted content op IS a ControlOp (no cast needed downstream).
const isContentOp = (op: string): op is ControlOp => CONTENT_OPS.has(op);

export interface SyncParams {
  clientInput: {
    //? F1 — thumbnail composition params (headline + optional AI background / explicit background asset).
    headline?: string; backgroundPrompt?: string; backgroundAssetId?: string;
    //? F5 — reply to a comment in the inbox (the text the user approved).
    commentId?: string; replyText?: string;
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
    //? V3/V4 — decompose per-scene duration; range-refine selection + instruction. O-C — pipeline mode.
    sceneDurationMs?: number; startMs?: number; endMs?: number; instruction?: string; mode?: string;
    //? V5 audio-track — per-piece voice gain + ducked music gain (content-save-audio-mix).
    voiceVolume?: number; musicVolume?: number;
    //? A2 — channel/account management (channel-create/edit/delete, account-disconnect). `platform` +
    //? `projectId` are already declared above; only the genuinely-new fields here.
    channelId?: string; name?: string; handle?: string; brandVoice?: string; defaultStyleId?: string; accountId?: string;
    //? Channel-binding + autopilot + disclosure-default (gap-fix).
    aiDisclosureDefault?: boolean; defaultAccountId?: string; autopilot?: boolean;
    //? Inspiration/reference library (reference-add/delete).
    referenceId?: string; description?: string; assetUrl?: string; tags?: string[];
    //? M3 — long-form target duration for content-run-pipeline (was missing from the contract).
    durationMs?: number;
    //? F1/F2 — render aspect ratio + caption delivery mode ('sidecar'|'burn'|'soft'), persisted on the piece.
    aspectRatio?: string; captionMode?: string; ctaText?: string;
    //? F9 — audio-editor-lite: linear gain for content-trim-audio (assetId/startMs/endMs are declared above).
    gain?: number;
    //? H3 — trackable short link (shortlink-create).
    targetUrl?: string; slug?: string; variant?: string;
    //? I1 — demo capture (capture-run): the app url + an optional scenario (viewport + goto/wait/click steps).
    scenario?: { viewport: { width: number; height: number }; steps: { goto?: string; waitMs?: number; click?: string }[] };
    //? I2 — AI-authored scenario from a goal + the app's routes.
    goal?: string; routes?: string[];
    //? G1 — per-platform publish composer: caption/hashtags/privacy persisted into publishVariants on publish.
    caption?: string; hashtags?: string[]; privacy?: string;
    //? C1 schedule + AI-disclosure (gap-fix): declared so the contract matches what the composer sends.
    scheduledAt?: string; syntheticMedia?: boolean;
    //? Send-to-Content (gap-fix): the Studio artifact to hand over to the content lane.
    artifactId?: string;
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
