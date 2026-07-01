import { dispatchHook, getProjectConfig } from '@luckystack/core';
import { revokeUserSessions, updatePasswordHash, verifyPassword } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { sendPasswordChangedNotification } from '../../../server/hooks/notifications';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: { currentPassword: string; newPassword: string; confirmPassword: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { passwordPolicy } = getProjectConfig().auth;
  const passwordMinLength = passwordPolicy.minLength;
  const passwordMaxLength = passwordPolicy.maxLength;
  const { currentPassword, newPassword, confirmPassword } = data;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { status: 'error', errorCode: 'login.empty' };
  }
  if (newPassword.length < passwordMinLength) {
    return { status: 'error', errorCode: 'login.passwordCharacterMinimum' };
  }
  if (newPassword.length > passwordMaxLength) {
    return { status: 'error', errorCode: 'login.passwordCharacterLimit' };
  }
  if (newPassword !== confirmPassword) {
    return { status: 'error', errorCode: 'login.passwordNotMatch' };
  }

  const dbUser = await functions.db.prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser?.password) {
    return { status: 'error', errorCode: 'login.wrongPassword' };
  }

  const ok = await verifyPassword(currentPassword, dbUser.password);
  if (!ok) {
    return { status: 'error', errorCode: 'login.wrongPassword' };
  }

  //? Vetoable pre-hook. Lets 2FA / compliance / approval-flow add-ons
  //? abort the change with their own errorCode before any password write.
  const preChange = await dispatchHook('prePasswordChanged', {
    userId: user.id,
    verifiedCurrent: true,
  });
  if (preChange.stopped) {
    return { status: 'error', errorCode: preChange.signal.errorCode };
  }

  await updatePasswordHash(user.id, newPassword);

  // Sign out every OTHER device — the credential they were using is no
  // longer valid. The current session (the one that just changed the
  // password) stays active so the user isn't kicked from this device.
  const revokedCount = await revokeUserSessions(user.id, user.token);

  void dispatchHook('passwordChanged', {
    userId: user.id,
    verifiedCurrent: true,
    revokedOtherSessions: revokedCount > 0,
  });

  // Fire-and-forget: notification email if the user opted in.
  void sendPasswordChangedNotification(user.id);

  return { status: 'success', result: { revokedSessions: revokedCount } };
};
