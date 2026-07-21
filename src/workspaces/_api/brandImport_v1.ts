//? R3 — import a portable brand-kit JSON into the workspace brand library (upsert). Membership-gated + a
//? mutating capability check. The kit is a JSON STRING (as exported by brandExport); it is parsed + validated
//? server-side before the upsert.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { importBrandKit } from '../../../server/studio/brand';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueWorkspaceRouteWrite } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; kit: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, kit } = data;
  if (!workspaceId || typeof kit !== 'string' || kit.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  if (!(await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings))) return { status: 'error', errorCode: 'auth.forbidden' };
  const [parseErr, parsed] = await functions.tryCatch.tryCatch(() => JSON.parse(kit) as unknown);
  if (parseErr) return { status: 'error', errorCode: 'brand.invalidJson' };
  const ok = await enqueueWorkspaceRouteWrite(
    workspaceId,
    { kind: 'brand.import', userId: user.id },
    () => importBrandKit(functions.db.prisma, workspaceId, parsed),
  );
  //? Direct returns (not a ternary) so the type generator extracts the success variant (extraction
  //? degrades on a ternary return — the caller needs the `status:'success'` branch typed).
  if (!ok) return { status: 'error', errorCode: 'brand.invalidKit' };
  return { status: 'success', result: { imported: true } };
};
