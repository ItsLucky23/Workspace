//? Edge-auth for the per-ticket editor/preview subdomains (Track B5). The reverse proxy's
//? `forward_auth`/`auth_request` sends a subrequest HERE before proxying to the container.
//? Access requires BOTH a valid LuckyStack session and the route workspace's workTickets
//? capability; missing ownership and dependency outages fail closed. This is the seam the
//? proxy's `ProxyRoute.forwardAuth` points at, so a `vscode-<slug>.<domain>` / preview
//? subdomain is gated by workspace RBAC — not just the openvscode connection token.
//?
//? Cookie-scoping (deployment note): the browser only sends the session cookie to the editor
//? subdomain if that cookie is scoped to cover subdomains (e.g. `Domain=.<baseDomain>`). With a
//? host-only cookie the subrequest carries no token and every request is 401. Set the cookie
//? domain to the wildcard parent in production.

import { readSession, getPrismaClient } from '@luckystack/core';
import { registerCustomRoute } from '@luckystack/server';

import { getRouteWorkspace, type RouteWorkspaceLookup } from '../proxy/routeOwnership';
import { hasCapability, CAP } from '../control/rbac';

export const EDITOR_AUTH_PATH = '/editor-auth-check';

export type EditorAuthFacts =
  | { sessionValid: false }
  | { sessionValid: true; routeStatus: 'missing' }
  | { sessionValid: true; routeStatus: 'unavailable' }
  | { sessionValid: true; routeStatus: 'found'; hasCapability: boolean };

export type EditorAuthDecision =
  | { statusCode: 204 }
  | { statusCode: 401 | 403 | 503; body: string };

//? Pure policy table for the edge-auth boundary. Authentication is evaluated first; once a
//? session is valid, route ownership is mandatory and Redis failure is distinguishable from
//? an absent mapping. There is deliberately no login-only fallback.
export function decideEditorAuth(facts: EditorAuthFacts): EditorAuthDecision {
  if (!facts.sessionValid) return { statusCode: 401, body: 'unauthorized' };
  if (facts.routeStatus === 'unavailable') return { statusCode: 503, body: 'service unavailable' };
  if (facts.routeStatus === 'missing') return { statusCode: 403, body: 'forbidden' };
  return facts.hasCapability ? { statusCode: 204 } : { statusCode: 403, body: 'forbidden' };
}

//? The original subdomain host the proxy forwarded (Caddy sets X-Forwarded-Host; nginx we set it),
//? stripped of any port. Used to look up which workspace the subdomain serves.
function originalHost(req: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
  return ((Array.isArray(raw) ? (raw[0] ?? '') : raw).split(':')[0] ?? '').toLowerCase();
}

//? Register the edge-auth subrequest handler (call once at boot). Runs pre-params and only claims
//? its own path. A valid session is necessary but never sufficient: the forwarded host MUST map
//? to a workspace, Redis MUST be available, and the user MUST hold workTickets in that workspace.
export function registerEditorAuthCheck(): void {
  registerCustomRoute(async (req, res, ctx) => {
    if (!(req.url ?? '').startsWith(EDITOR_AUTH_PATH)) return false;

    const respond = (decision: EditorAuthDecision): true => {
      res.statusCode = decision.statusCode;
      if (decision.statusCode === 204) {
        res.end();
        return true;
      }
      res.setHeader('Content-Type', 'text/plain');
      res.end(decision.body);
      return true;
    };

    const session = await readSession(ctx.token);
    if (!session) return respond(decideEditorAuth({ sessionValid: false }));

    const host = originalHost(req);
    const routeWorkspace: RouteWorkspaceLookup = host.length === 0
      ? { status: 'missing' }
      : await getRouteWorkspace(host);

    if (routeWorkspace.status === 'missing') {
      return respond(decideEditorAuth({ sessionValid: true, routeStatus: 'missing' }));
    }
    if (routeWorkspace.status === 'unavailable') {
      return respond(decideEditorAuth({ sessionValid: true, routeStatus: 'unavailable' }));
    }

    const capability = await hasCapability(getPrismaClient(), routeWorkspace.workspaceId, session.id, CAP.workTickets);
    return respond(decideEditorAuth({ sessionValid: true, routeStatus: 'found', hasCapability: capability }));
  }, { phase: 'pre-params' });
}
