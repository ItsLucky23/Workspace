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
  //? G5 — `presetKey` chooses the seeded pipeline tier (simple/advanced/professional).
  data: { name: string; clientRequestId: string; enabledSections?: string[]; presetKey?: string };
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
    payload: { name, ...(data.enabledSections ? { enabledSections: data.enabledSections } : {}), ...(data.presetKey ? { presetKey: data.presetKey } : {}) },
    userId: user.id,
    clientRequestId: data.clientRequestId,
  }));
  if (enqueueError || !enqueued || isControlActionFailure(enqueued.result)) {
    return { status: 'error', errorCode: 'api.invalidRequest' };
  }
  return { status: 'success', result: { accepted: true, signalSeq: enqueued.signalSeq } };
};
