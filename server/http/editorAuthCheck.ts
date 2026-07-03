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

import { readSession, getPrismaClient } from '@luckystack/core';
import { registerCustomRoute } from '@luckystack/server';

import { getRouteWorkspace } from '../proxy/routeOwnership';
import { hasCapability, CAP } from '../control/rbac';

export const EDITOR_AUTH_PATH = '/editor-auth-check';

//? The original subdomain host the proxy forwarded (Caddy sets X-Forwarded-Host; nginx we set it),
//? stripped of any port. Used to look up which workspace the subdomain serves.
function originalHost(req: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
  return (Array.isArray(raw) ? (raw[0] ?? '') : raw).split(':')[0] ?? '';
}

//? Register the edge-auth subrequest handler (call once at boot). Runs pre-params and only claims
//? its own path. Two gates: (1) a valid session (else 401); (2) if we know which workspace this
//? subdomain serves (recorded in Redis at route-upsert), the user must be a MEMBER of it with the
//? workTickets cap (else 403) — closing cross-workspace access. An unmapped host degrades to
//? logged-in-only, so nothing breaks before the editor route carries its workspaceId.
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
    const host = originalHost(req);
    const workspaceId = host.length > 0 ? await getRouteWorkspace(host) : null;
    if (workspaceId !== null) {
      const member = await hasCapability(getPrismaClient(), workspaceId, session.id, CAP.workTickets);
      if (!member) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain');
        res.end('forbidden');
        return true;
      }
    }
    res.statusCode = 204;
    res.end();
    return true;
  }, { phase: 'pre-params' });
}
