/** @docs owner ItsLucky23 */
//? Workspaces — [skills] the universal AI-skills layer writes via `_sync` (SK1, DOCUMENTS_AND_SKILLS).
//? ONE route for the workspace-settings-scoped skill ops (ai-skill-save / -toggle / -delete / -reset),
//? each dispatched through the single-writer Conductor (B-23), RBAC-gated (workspaceSettings) via
//? OP_CAPABILITY. Whitelisted so the client can't drive an arbitrary op; the client refetches the
//? snapshot after the write.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { broadcastContentDirty } from '../../../server/read/broadcast';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const SKILL_OPS = new Set<string>(['ai-skill-save', 'ai-skill-toggle', 'ai-skill-delete', 'ai-skill-reset']);
const isSkillOp = (op: string): op is ControlOp => SKILL_OPS.has(op);

export interface SyncParams {
  clientInput: {
    op: string; clientRequestId: string;
    skillId?: string; name?: string; instruction?: string; examples?: string;
    applyPoints?: string[]; enabled?: boolean; on?: boolean;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, ...payload } = clientInput;
  if (!isSkillOp(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({ op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId, payload });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? Skill changes steer every AI surface → nudge the room to refetch the snapshot.
  broadcastContentDirty(roomCode);
  return { status: 'success' };
};
