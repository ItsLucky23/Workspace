//? Workspaces — [service-provision] (K1) attach a third-party SERVICE STACK (docker-compose) to the workspace.
//? The compose is SANITIZED (host-escapes rejected, host-ports rewritten) + namespaced per workspace by the
//? Conductor before it runs. Requires workspaceSettings (OP_CAPABILITY). A sanitizer rejection returns a typed
//? error the UI surfaces; a successful dispatch persists + starts the stack.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  //? Either a K2 `preset` key (curated compose) OR a bring-your-own `compose` (K1). `preset` wins when set.
  clientInput: { name: string; compose?: string; preset?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

//? Narrow the Conductor's ProvisionResult without an unsafe cast: a business-level rejection is `{ ok: false }`.
function rejected(result: unknown): boolean {
  return result !== null && typeof result === 'object' && (result as Record<string, unknown>).ok === false;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { name, compose, preset, clientRequestId } = clientInput;
  const hasSource = (preset ?? '').trim().length > 0 || (compose ?? '').trim().length > 0;
  if (name.trim().length === 0 || !hasSource) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'service-provision', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { name: name.trim(), ...(preset ? { preset } : {}), ...(compose ? { compose } : {}) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? The compose was sanitizer-rejected (host-escape / bad shape) → surface a typed error (details logged server-side).
  if (rejected(res.result)) return { status: 'error', errorCode: 'service.rejected' };
  return { status: 'success' };
};
