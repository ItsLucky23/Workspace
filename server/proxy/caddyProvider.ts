//? Caddy backend for the proxy-provider abstraction — drives the Caddy Admin API (dynamic
//? per-route add/remove, NO reload). General host→target routing (distinct from the
//? editor-specific `caddyRoutes.ts`): our routes are `@id`-keyed `ws-route-<id>` so reconcile
//? only ever prunes OUR routes and never touches routes another driver owns on the same server.

import { tryCatch } from '@luckystack/core';
import type { ProxyProvider, ProxyResult, ProxyRoute } from './types';

const ADMIN = process.env.WS_CADDY_ADMIN ?? 'http://localhost:2019';
const SERVER = process.env.WS_CADDY_SERVER ?? 'srv0';
const ID_PREFIX = 'ws-route-';

function routeId(id: string): string {
  return `${ID_PREFIX}${id.toLowerCase()}`;
}

async function caddy(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const [error, res] = await tryCatch(() => fetch(`${ADMIN}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }));
  if (error || res === null) return { ok: false, status: 0, text: String(error ?? 'no-response') };
  const [, text] = await tryCatch(() => res.text());
  return { ok: res.ok, status: res.status, text: text ?? '' };
}

export const caddyProvider: ProxyProvider = {
  kind: 'caddy',

  async available(): Promise<boolean> {
    const res = await caddy('GET', '/config/');
    return res.ok;
  },

  //? Upsert = delete-then-append (idempotent); Caddy has no atomic upsert-by-id for an
  //? array member, so we drop any same-id route first.
  async upsertRoute(route: ProxyRoute): Promise<ProxyResult> {
    await this.removeRoute(route.id);
    const body = {
      '@id': routeId(route.id),
      match: [{ host: [route.host] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: route.target }] }],
      terminal: true,
    };
    const res = await caddy('POST', `/config/apps/http/servers/${SERVER}/routes`, body);
    return res.ok ? { ok: true } : { ok: false, error: `caddy.upsertFailed(${String(res.status)}): ${res.text.slice(0, 200)}` };
  },

  async removeRoute(id: string): Promise<ProxyResult> {
    const res = await caddy('DELETE', `/id/${routeId(id)}`);
    //? 200 = deleted; 404/500-not-found = already gone → both success for our purposes.
    return res.ok || res.status === 404 || res.status === 500 ? { ok: true } : { ok: false, error: `caddy.deleteFailed(${String(res.status)})` };
  },

  //? Boot self-heal: prune any `ws-route-*` route whose id is no longer live. Leaves routes
  //? owned by other drivers (e.g. the editor's `route-vscode-*`) untouched.
  async reconcile(live: ProxyRoute[]): Promise<{ ok: boolean; pruned: string[] }> {
    const res = await caddy('GET', `/config/apps/http/servers/${SERVER}/routes`);
    if (!res.ok) return { ok: false, pruned: [] };
    const [parseErr, parsed] = await tryCatch(() => JSON.parse(res.text) as { '@id'?: string }[]);
    if (parseErr || parsed === null) return { ok: false, pruned: [] };
    const liveIds = new Set(live.map((r) => routeId(r.id)));
    const pruned: string[] = [];
    for (const r of parsed) {
      const rid = r['@id'];
      if (rid?.startsWith(ID_PREFIX) && !liveIds.has(rid)) {
        await this.removeRoute(rid.slice(ID_PREFIX.length));
        pruned.push(rid);
      }
    }
    return { ok: true, pruned };
  },
};
