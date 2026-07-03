//? Edge-auth for the per-ticket editor/preview subdomains (Track B5). The reverse proxy's
//? `forward_auth`/`auth_request` sends a subrequest HERE before proxying to the container: a
//? valid LuckyStack session → 204 (proceed), else 401 (blocked). This is the seam the proxy's
//? `ProxyRoute.forwardAuth` points at, so a `vscode-<slug>.<domain>` / preview subdomain is
//? gated by the app session — not just the openvscode connection token.
//?
//? Cookie-scoping (deployment note): the browser only sends the session cookie to the editor
//? subdomain if that cookie is scoped to cover subdomains (e.g. `Domain=.<baseDomain>`). With a
//? host-only cookie the subrequest carries no token and every request is 401. Set the cookie
//? domain to the wildcard parent in production. Per-workspace membership (vs any logged-in user)
//? is a follow-up — it needs a host→workspace lookup the proxy layer can carry.

import { readSession } from '@luckystack/core';
import { registerCustomRoute } from '@luckystack/server';

export const EDITOR_AUTH_PATH = '/editor-auth-check';

//? Register the edge-auth subrequest handler (call once at boot). Runs pre-params (no route
//? params needed) and only claims its own path, leaving the normal pipeline untouched otherwise.
export function registerEditorAuthCheck(): void {
  registerCustomRoute(async (req, res, ctx) => {
    if (!(req.url ?? '').startsWith(EDITOR_AUTH_PATH)) return false;
    const session = await readSession(ctx.token);
    if (!session) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'text/plain');
      res.end('unauthorized');
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }, { phase: 'pre-params' });
}
