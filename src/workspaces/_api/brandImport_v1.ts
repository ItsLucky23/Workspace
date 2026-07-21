//? R3 — import a portable brand-kit JSON into the workspace brand library (upsert). Membership-gated + a
//? mutating capability check. The kit is a JSON STRING (as exported by brandExport); it is parsed + validated
//? server-side before the upsert.

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import { ENTITY_VERSION_KEYS, readEntityVersion } from '../../../server/orchestrator/entityVersion';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; kit: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, kit } = data;
  if (!workspaceId || typeof kit !== 'string' || kit.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  if (!(await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings))) return { status: 'error', errorCode: 'auth.forbidden' };
  const [parseErr, parsed] = await functions.tryCatch.tryCatch(() => JSON.parse(kit) as unknown);
  if (parseErr) return { status: 'error', errorCode: 'brand.invalidJson' };
  const expectedVersion = await readEntityVersion(functions.db.prisma, workspaceId, ENTITY_VERSION_KEYS.brandLibrary);
  const suppliedRequestId = data.clientRequestId?.trim();
  const requestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : createHash('sha256').update(kit).digest('hex');
  const applied = await enqueueInternalAction({
    workspaceId,
    op: 'brand-import',
    target: { expectedVersion },
    payload: { kit: parsed },
    userId: user.id,
    clientRequestId: `brand-import:${requestId}`,
  });
  const ok = applied.result !== null && typeof applied.result === 'object' && 'applied' in applied.result && applied.result.applied === true;
  //? Direct returns (not a ternary) so the type generator extracts the success variant (extraction
  //? degrades on a ternary return — the caller needs the `status:'success'` branch typed).
  if (!ok) return { status: 'error', errorCode: 'brand.invalidKit' };
  return { status: 'success', result: { imported: true } };
};
