//? `validator` is CommonJS; its .d.ts does not declare a default export but
//? Node's CJS interop provides one at runtime. ESM named-import trips the
//? runtime ESM loader. Using namespace-access on the default import is the
//? canonical CJS-interop pattern that lint-rules also accept.
// eslint-disable-next-line import-x/default
import validator from 'validator';

import { getProjectConfig } from '@luckystack/core';
import { sendPasswordResetEmail } from '@luckystack/login';
import { AuthProps } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 5;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: [],
};

export interface ApiParams {
  data: { email: string };
  functions: Functions;
}

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  const { forgotPassword } = getProjectConfig().auth;
  if (forgotPassword !== 'framework') {
    return { status: 'error', errorCode: 'login.forgotPasswordDisabled' };
  }

  const email = data.email.trim().toLowerCase();
  // eslint-disable-next-line import-x/no-named-as-default-member
  if (!email || !validator.isEmail(email)) {
    return { status: 'error', errorCode: 'login.invalidEmailFormat' };
  }

  // Always returns ok=true even if the email isn't recognized (anti-enumeration).
  await sendPasswordResetEmail({ email });

  return { status: 'success', result: {} };
};
