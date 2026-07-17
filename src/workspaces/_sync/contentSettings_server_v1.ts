/** @docs owner ItsLucky23 */
//? Workspaces — [content-settings] media €-budget + provider-key + brand-style writes via `_sync` (U3).
//? ONE route for the workspace-settings-scoped content ops (edit-media-budget / save-media-provider /
//? save-style), each dispatched through the single-writer Conductor (B-23), RBAC-gated (workspaceSettings)
//? via OP_CAPABILITY. Whitelisted so the client can't drive an arbitrary op. Settings are workspace-level
//? → the client refetches the snapshot after the write.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { broadcastContentDirty } from '../../../server/read/broadcast';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const SETTINGS_OPS = new Set<string>(['edit-media-budget', 'save-media-provider', 'save-style', 'delete-style', 'content-edit-brand', 'content-edit-product']);
const isSettingsOp = (op: string): op is ControlOp => SETTINGS_OPS.has(op);

export interface SyncParams {
  clientInput: {
    op: string; clientRequestId: string;
    capCents?: number; alertPct?: number; enabled?: boolean;
    providerId?: string; apiKey?: string; feature?: string; model?: string;
    key?: string; label?: string; systemPrompt?: string;
    previewAssetUrl?: string; previewKind?: string;   // #155 — style preview thumbnail
    channelId?: string; brandVoice?: string; productContext?: string;
    //? Gap-fix — the brand logo (/media upload) the render watermark overlays.
    brandLogoUrl?: string;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, ...payload } = clientInput;
  if (!isSettingsOp(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({ op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId, payload });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? Media budget/provider/brand changes affect the content snapshot → nudge the whole room to refetch.
  broadcastContentDirty(roomCode);
  return { status: 'success' };
};
