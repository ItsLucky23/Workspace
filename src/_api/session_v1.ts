import { AuthProps, SessionLayout } from '../../config';
import { Functions, ApiResponse, MaybePromise } from '../_sockets/apiTypes.generated';

export const rateLimit: number | false = 60;

export const auth: AuthProps = {
  login: false
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout | null;
  functions: Functions;
}

export const main = ({ user }: ApiParams): MaybePromise<ApiResponse> => {
  console.log(process.env)
  if (!user) return { status: 'success', result: null };
  //? Strip the server-only credential VALUES before returning the session to the
  //? browser, while keeping the `SessionLayout` TYPE so the generated route types
  //? stay precise (a rest-destructure projection degrades codegen to `z.any()`).
  //? `token` is the raw session credential — in the default mode it's an HttpOnly
  //? cookie precisely so client JS can NOT read it (XSS protection); returning its
  //? value would defeat that. `csrfToken` is a CSRF secret (attached at runtime by
  //? @luckystack/login, not on the SessionLayout type) with its own delivery
  //? channel (GET /auth/csrf). Both are deleted from the wire value; JSON omits the
  //? now-undefined keys, so the frontend receives only the non-secret session info.
  const safe: SessionLayout = { ...user };
  delete (safe as { token?: unknown }).token;
  delete (safe as { csrfToken?: unknown }).csrfToken;
  return { status: 'success', result: safe };
};
