//? Workspaces — [create-workspace] login-only control-API route. The new tenant has
//? no workspaceId yet, so the authenticated caller enqueues the global Conductor action.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { enqueueControlAction, isControlActionFailure } from '../../../server/orchestrator/conductor';

//? 10 → 30/min (owner decision 2026-07-21): the deterministic Playwright suite creates ~16
//? workspaces per full run, so back-to-back runs tripped the old limit and read as flaky specs.
//? 30 keeps abuse-protection while letting two consecutive full suites pass cleanly.
export const rateLimit: number | false = 30;
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
  //? The new workspace's id rides back with the op result: the caller had no workspace before this call,
  //? so there is nothing for it to poll or merge against — it needs to be TOLD which one is now theirs.
  const created = enqueued.result;
  const workspaceId = typeof created === 'object' && created !== null && 'workspaceId' in created && typeof created.workspaceId === 'string' ? created.workspaceId : '';
  return { status: 'success', result: { accepted: true, signalSeq: enqueued.signalSeq, ...(workspaceId ? { workspaceId } : {}) } };
};
