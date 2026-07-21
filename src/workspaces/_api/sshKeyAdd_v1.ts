//? Workspaces — [ssh-key-add] (#76) persist a new SSH key on the CALLER'S account (real product,
//? replacing the client-only SSH_KEYS seed). Account-level (login-gated); the key authenticates as
//? the logged-in user (userId from the session, never the client). Account-level authoritative writes
//? serialize through the Conductor's global chain; workspace RBAC is deliberately not involved.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { enqueueGlobalRouteWrite } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { name: string; type: string; fingerprint: string; publicKey: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const name = data.name.trim();
  const type = data.type.trim();
  const fingerprint = data.fingerprint.trim();
  const publicKey = data.publicKey.trim();
  if (name.length === 0 || publicKey.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const key = await enqueueGlobalRouteWrite(
    { kind: 'ssh-key.add', userId: user.id },
    () => functions.db.prisma.sshKey.create({
      data: { userId: user.id, name, type: type.length > 0 ? type : 'ed25519', fingerprint, publicKey },
    }),
  );
  return { status: 'success', result: { id: key.id } };
};
