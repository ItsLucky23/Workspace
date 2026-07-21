//? R1 — import a portable style-set JSON into a workspace (upsert by feature+key; never touches builtin
//? globals). Membership-gated. `styles` is a JSON STRING (as exported by styleExport).

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; styles: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, styles } = data;
  if (!workspaceId || typeof styles !== 'string' || styles.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  if (!(await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings))) return { status: 'error', errorCode: 'auth.forbidden' };
  const [parseErr, parsed] = await functions.tryCatch.tryCatch(() => JSON.parse(styles) as unknown);
  if (parseErr) return { status: 'error', errorCode: 'style.invalidJson' };
  const suppliedRequestId = data.clientRequestId?.trim();
  const requestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : createHash('sha256').update(styles).digest('hex');
  const applied = await enqueueInternalAction({
    workspaceId,
    op: 'style-import',
    target: {},
    payload: { styles: parsed },
    userId: user.id,
    clientRequestId: `style-import:${requestId}`,
  });
  const written = applied.result !== null && typeof applied.result === 'object' && 'imported' in applied.result && typeof applied.result.imported === 'number'
    ? applied.result.imported
    : 0;
  return { status: 'success', result: { imported: written } };
};
