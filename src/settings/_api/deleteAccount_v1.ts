import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { dispatchHook, getUploadsDir } from '@luckystack/core';
import { revokeUserSessions, verifyPassword, getUserAdapter } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 3;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: { confirmation: string; password?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  if (data.confirmation !== 'DELETE') {
    return { status: 'error', errorCode: 'auth.forbidden' };
  }

  // Credentials accounts must reconfirm with their password.
  //? Gate on `provider` (not `password`) so a credentials account with a null/empty
  //? hash still requires the field — preventing silent bypass on hash-less rows.
  const dbUser = await functions.db.prisma.user.findUnique({ where: { id: user.id } });
  if (user.provider === 'credentials') {
    const ok = data.password && dbUser?.password
      ? await verifyPassword(data.password, dbUser.password)
      : false;
    if (!ok) {
      return { status: 'error', errorCode: 'login.wrongPassword' };
    }
  }

  //? Vetoable pre-hook — lets compliance / legal-hold / active-subscription
  //? add-ons block the deletion with their own errorCode before anything is
  //? destroyed. Mirrors the pre-hook on every sibling auth mutation (HOK-05).
  const preDelete = await dispatchHook('preAccountDelete', {
    userId: user.id,
    email: dbUser?.email ?? undefined,
  });
  if (preDelete.stopped) {
    return { status: 'error', errorCode: preDelete.signal.errorCode };
  }

  //? Route deletion through the UserAdapter (soft-delete consumers override it)
  //? instead of reaching past it to `prisma.user.delete`. Resolve the deleter
  //? BEFORE wiping sessions so an adapter that doesn't support hard-delete fails
  //? CLEANLY (clear error) instead of silently no-opping the `?.` — which would
  //? otherwise log the user out everywhere yet leave the account undeleted.
  const adapter = getUserAdapter();
  if (!adapter.delete) {
    return { status: 'error', errorCode: 'api.internalServerError' };
  }

  //? Wipe every session through the adapter. `revokeUserSessions` calls
  //? `adapter.untrackActive` for each token, so a raw `redis.del(activeUsersKeyFor(…))`
  //? bypass is not needed — it would skip custom adapters and leave the active-set
  //? intact for any token `revokeUserSessions` couldn't delete.
  await revokeUserSessions(user.id);

  await adapter.delete(user.id);

  //? Remove the avatar the user uploaded (updateUser writes `${id}.webp` under
  //? the uploads dir) so no PII file survives the account (GDPR residue).
  await functions.tryCatch.tryCatch(() => unlink(path.join(getUploadsDir(), `${user.id}.webp`)));

  //? Observational post-hook — cascade-clean external state (Stripe / S3),
  //? audit, goodbye email.
  void dispatchHook('postAccountDelete', {
    userId: user.id,
    email: dbUser?.email ?? undefined,
  });

  return { status: 'success', result: {} };
};
