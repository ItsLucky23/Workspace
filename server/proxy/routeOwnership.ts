//? Route → workspace ownership map (edge-auth membership, Track B5). When a per-ticket editor/
//? preview route is upserted with a `workspaceId`, we record host→workspaceId in Redis so the
//? /editor-auth-check endpoint can verify the logged-in user is a MEMBER of the workspace that
//? subdomain belongs to — not just logged-in (which would let any tenant reach any tenant's
//? editor). Redis-backed (not in-process) so it is correct across instances and survives a route
//? created on another instance. TTL-refreshed on every upsert; a stale entry is benign (the route
//? is gone, so nothing reaches it). Unmapped host ⇒ the auth-check degrades to logged-in-only.

import { redis, formatKey, tryCatch } from '@luckystack/core';

const TTL_S = 24 * 3600;
const key = (host: string): string => formatKey('routeowner', host);

//? Record that `host` serves `workspaceId` (best-effort; never throws into the proxy path).
export async function setRouteWorkspace(host: string, workspaceId: string): Promise<void> {
  await tryCatch(() => redis.set(key(host), workspaceId, 'EX', TTL_S));
}

//? The workspace a host serves, or null if unknown (unmapped / expired / Redis error).
export async function getRouteWorkspace(host: string): Promise<string | null> {
  const [err, val] = await tryCatch(() => redis.get(key(host)));
  return err ? null : val;
}
