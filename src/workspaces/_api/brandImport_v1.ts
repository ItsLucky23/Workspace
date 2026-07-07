//? R3 — import a portable brand-kit JSON into the workspace brand library (upsert). Membership-gated + a
//? mutating capability check. The kit is a JSON STRING (as exported by brandExport); it is parsed + validated
//? server-side before the upsert.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { importBrandKit } from '../../../server/studio/brand';

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
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
  const [parseErr, parsed] = await functions.tryCatch.tryCatch(() => JSON.parse(kit) as unknown);
  if (parseErr) return { status: 'error', errorCode: 'brand.invalidJson' };
  const ok = await importBrandKit(functions.db.prisma, workspaceId, parsed);
  return ok ? { status: 'success', result: { imported: true } } : { status: 'error', errorCode: 'brand.invalidKit' };
};
