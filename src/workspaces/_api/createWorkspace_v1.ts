//? Workspaces — [create-workspace] login-only control-API route. The new tenant has
//? no workspaceId yet, so the authenticated caller enqueues the global Conductor action.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { enqueueControlAction, isControlActionFailure } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  //? G5 — `presetKey` chooses the seeded pipeline tier; #19 — `packId` seeds the starting content.
  data: { name: string; clientRequestId: string; enabledSections?: string[]; presetKey?: string; packId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const name = data.name.trim();
  if (name.length === 0 || !data.clientRequestId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const [enqueueError, enqueued] = await functions.tryCatch.tryCatch(() => enqueueControlAction({
    workspaceId: '',
    op: 'create-workspace',
    target: {},
    //? #19 — `packId` seeds the workspace's starting content. It has to ride the Conductor PAYLOAD: this
    //? route enqueues an op, it does not create the workspace itself — an earlier version of this fix
    //? assumed a direct call and silently did nothing, which only the browser pass caught.
    payload: { name, ...(data.enabledSections ? { enabledSections: data.enabledSections } : {}), ...(data.presetKey ? { presetKey: data.presetKey } : {}), ...(data.packId ? { packId: data.packId } : {}) },
    userId: user.id,
    clientRequestId: data.clientRequestId,
  }));
  if (enqueueError || !enqueued || isControlActionFailure(enqueued.result)) {
    return { status: 'error', errorCode: 'api.invalidRequest' };
  }
  return { status: 'success', result: { accepted: true, signalSeq: enqueued.signalSeq } };
};
