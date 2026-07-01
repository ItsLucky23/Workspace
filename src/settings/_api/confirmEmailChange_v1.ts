import { dispatchHook } from '@luckystack/core';
import {
  consumeEmailChangeToken,
  getUserAdapter,
  revokeUserSessions,
} from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

//? `login: false` — the token IS the auth. The user may be confirming from a
//? device / browser they were never signed in on (e.g. clicking the link from
//? their phone after submitting from desktop). The one-shot Redis token proves
//? they own the new mailbox.
export const auth: AuthProps = {
  login: false,
  additional: [],
};

export interface ApiParams {
  data: { token: string };
  user: SessionLayout | null;
  functions: Functions;
}

export const main = async ({ data, functions }: ApiParams): Promise<ApiResponse> => {
  const token = data.token.trim();
  if (!token) {
    return { status: 'error', errorCode: 'settings.emailChange.invalidToken' };
  }

  const payload = await consumeEmailChangeToken(token);
  if (!payload) {
    return { status: 'error', errorCode: 'settings.emailChange.invalidToken' };
  }

  const { userId, newEmail } = payload;

  //? Capture the old email for the audit hook before we overwrite it.
  const before = await functions.db.prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const oldEmail = before?.email ?? '';

  //? Race protection: between minting and clicking, the new address could have
  //? been claimed by another sign-up (any provider). Check across all providers
  //? so an OAuth account with the same email is not silently aliased.
  const collision = await functions.db.prisma.user.findFirst({
    where: { email: newEmail, NOT: { id: userId } },
    select: { id: true },
  });
  if (collision) {
    return { status: 'error', errorCode: 'settings.emailChange.emailTaken' };
  }

  //? Pass the typed `Partial<UserRecord>` directly — no `Record<string, unknown>`
  //? intermediary needed; `email` is a valid key on `UserRecord`.
  await getUserAdapter().update(userId, { email: newEmail });

  //? Email is a credential — rotate every session. NO `exceptToken` here:
  //? we want the user to sign in fresh with the new email everywhere.
  const revokedCount = await revokeUserSessions(userId);

  void dispatchHook('postEmailChanged', {
    userId,
    oldEmail,
    newEmail,
  });

  return { status: 'success', result: { revokedSessions: revokedCount } };
};
