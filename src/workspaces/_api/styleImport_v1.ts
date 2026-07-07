//? R1 — import a portable style-set JSON into a workspace (upsert by feature+key; never touches builtin
//? globals). Membership-gated. `styles` is a JSON STRING (as exported by styleExport).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { importStyleSet } from '../../../server/content/styles';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; styles: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, styles } = data;
  if (!workspaceId || typeof styles !== 'string' || styles.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
  const [parseErr, parsed] = await functions.tryCatch.tryCatch(() => JSON.parse(styles) as unknown);
  if (parseErr) return { status: 'error', errorCode: 'style.invalidJson' };
  const written = await importStyleSet(functions.db.prisma, workspaceId, parsed);
  return { status: 'success', result: { imported: written } };
};
