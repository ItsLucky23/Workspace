import { dispatchHook, getProjectConfig } from '@luckystack/core';
import { consumePasswordResetToken, revokeUserSessions, updatePasswordHash, validatePassword } from '@luckystack/login';
import { AuthProps } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 5;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: [],
};

export interface ApiParams {
  data: { token: string; password: string; confirmPassword: string };
  functions: Functions;
}

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  const { forgotPassword } = getProjectConfig().auth;
  if (forgotPassword !== 'framework') {
    return { status: 'error', errorCode: 'login.forgotPasswordDisabled' };
  }

  const token = data.token.trim();
  const { password, confirmPassword } = data;

  if (!token) {
    return { status: 'error', errorCode: 'login.resetInvalidToken' };
  }
  if (password !== confirmPassword) {
    return { status: 'error', errorCode: 'login.passwordNotMatch' };
  }

  //? Run the FULL password policy (length + complexity + common-list) BEFORE
  //? consuming the one-time token, so a policy failure returns its SPECIFIC reason
  //? AND leaves the reset link redeemable for a corrected retry. Otherwise
  //? updatePasswordHash throws PasswordPolicyError post-consume → a generic 500
  //? with the token already burned.
  const policyFailure = validatePassword(password);
  if (policyFailure) {
    return { status: 'error', errorCode: policyFailure };
  }

  const userId = await consumePasswordResetToken(token);
  if (!userId) {
    return { status: 'error', errorCode: 'login.resetInvalidToken' };
  }

  //? Vetoable pre-hook. Lets compliance / fraud-detection add-ons abort
  //? the reset with their own errorCode before any password write.
  const preReset = await dispatchHook('prePasswordResetCompleted', { userId });
  if (preReset.stopped) {
    return { status: 'error', errorCode: preReset.signal.errorCode };
  }

  await updatePasswordHash(userId, password);

  //? After a forgot-password reset we don't have a "current session" to keep;
  //? revoke every active session for this user so any compromised credential
  //? becomes useless once the new password is set.
  const revokedCount = await revokeUserSessions(userId, null);

  void dispatchHook('passwordResetCompleted', {
    userId,
    revokedOtherSessions: revokedCount > 0,
  });

  return { status: 'success', result: {} };
};
