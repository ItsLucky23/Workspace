//? Route → workspace ownership map (edge-auth membership, Track B5). When a per-ticket editor/
//? preview route is upserted with a `workspaceId`, we record host→workspaceId in Redis so the
//? /editor-auth-check endpoint can verify the logged-in user is a MEMBER of the workspace that
//? subdomain belongs to — not just logged-in (which would let any tenant reach any tenant's
//? editor). Redis-backed (not in-process) so it is correct across instances and survives a route
//? created on another instance. TTL-refreshed on every upsert; a stale entry is benign (the route
//? is gone, so nothing reaches it). Reads preserve the security-relevant distinction between an
//? unmapped host and Redis being unavailable so edge-auth can fail closed with 403 vs 503.

import { redis, formatKey, tryCatch } from '@luckystack/core';

const TTL_S = 24 * 3600;
const key = (host: string): string => formatKey('routeowner', host.toLowerCase());

export type RouteWorkspaceLookup =
  | { status: 'found'; workspaceId: string }
  | { status: 'missing' }
  | { status: 'unavailable' };

export interface RouteWorkspaceDeps {
  get: (routeKey: string) => Promise<string | null>;
}

const redisDeps: RouteWorkspaceDeps = {
  get: (routeKey) => redis.get(routeKey),
};

//? Record that `host` serves `workspaceId` (best-effort; never throws into the proxy path).
export async function setRouteWorkspace(host: string, workspaceId: string): Promise<void> {
  await tryCatch(() => redis.set(key(host), workspaceId, 'EX', TTL_S));
}

//? Resolve the workspace a host serves without collapsing an absent key into a Redis outage.
//? `deps` is injectable so the three Redis outcomes stay unit-testable without a live store.
export async function getRouteWorkspace(host: string, deps: RouteWorkspaceDeps = redisDeps): Promise<RouteWorkspaceLookup> {
  const [error, workspaceId] = await tryCatch(() => deps.get(key(host)));
  if (error) return { status: 'unavailable' };
  if (workspaceId === null) return { status: 'missing' };
  return { status: 'found', workspaceId };
}
