//? Workspaces — [ssh-key-add] (#76) persist a new SSH key on the CALLER'S account (real product,
//? replacing the client-only SSH_KEYS seed). Account-level (login-gated); the key authenticates as
//? the logged-in user (userId from the session, never the client). Account-level authoritative writes
//? serialize through the Conductor's global chain; workspace RBAC is deliberately not involved.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { deterministicObjectId } from '../../../server/orchestrator/actionIds';
import { enqueueGlobalAction } from '../../../server/orchestrator/globalOps';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { name: string; type: string; fingerprint: string; publicKey: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user }: ApiParams): Promise<ApiResponse> => {
  const name = data.name.trim();
  const type = data.type.trim();
  const fingerprint = data.fingerprint.trim();
  const publicKey = data.publicKey.trim();
  if (name.length === 0 || publicKey.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const keyId = deterministicObjectId(user.id, publicKey, 'ssh-public-key');
  const key = await enqueueGlobalAction({
    op: 'ssh-key-add',
    userId: user.id,
    target: { keyId },
    payload: { name, type: type.length > 0 ? type : 'ed25519', fingerprint, publicKey },
  });
  if (!('id' in key)) return { status: 'error', errorCode: 'common.500' };
  return { status: 'success', result: { id: key.id } };
};
