//? Workspaces — [editor-auth-check] the target Caddy `forward_auth` hits before proxying an
//? editor subdomain (Track B5, ADR 0010 §edge-auth). A GET, login-gated `_api` route: the
//? framework returns HTTP 403 automatically when there is no valid LuckyStack session (verified:
//? unauthenticated `_api` requests get a raw 403), and 200 when a logged-in user's session cookie
//? is valid. So Caddy `forward_auth → /api/workspaces/editorAuthCheck/v1` gates every
//? `vscode-<slug>` subdomain on the SESSION — not just the openvscode connection-token.
//?
//? GET so the framework's origin/CSRF gate (state-changing methods only) doesn't block the
//? server-to-server call from Caddy. Per-WORKSPACE membership is a refinement that needs the raw
//? request Host (X-Forwarded-Host) → a `registerCustomRoute` handler (bootstrap seam, HOSTING.md);
//? the session layer here is the shipping edge-auth.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = false;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

//? Reaching here means the framework already validated the session (else 401/403). Allow.
export const main = ({ user }: ApiParams): Promise<ApiResponse> =>
  Promise.resolve({ status: 'success', result: { ok: true, userId: user.id } });
