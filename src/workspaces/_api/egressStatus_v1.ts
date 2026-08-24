//? Workspaces — [egress-status] the read-only egress posture: which mode the HOST runs
//? (enforce / report / off), the effective allowlist, and how many workers launched with
//? unrestricted network since boot. Read-only by design — the mode itself is env-driven
//? (WS_EGRESS / WS_EGRESS_ALLOW, server/container/egress.ts); this route only makes that
//? visible instead of leaving a security posture invisible outside the server log.

/** @docs owner ItsLucky23 */
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { egressReport } from '../../../server/container/egress';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId } = data;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  return { status: 'success', result: { egress: egressReport() } };
};
