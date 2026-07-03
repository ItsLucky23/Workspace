//? Boot self-heal for proxy routes (hosting-proxy plan; the reconcile leg the editor/preview
//? flows leave open). After a backend restart or crash, per-ticket routes can point at
//? containers that are gone. On boot we drop every `ws-route-*` whose upstream container is no
//? longer running. Caddy-focused (the default dynamic backend, and what the editor flow drives);
//? for nginx the managed include file persists across restarts, so a full rebuild is a follow-up.

import { tryCatch } from '@luckystack/core';

import { docker } from '../container/runtime';
import { getProxyProvider, proxyKind } from './index';

const CADDY_ADMIN = process.env.WS_CADDY_ADMIN ?? 'http://localhost:2019';
const CADDY_SERVER = process.env.WS_CADDY_SERVER ?? 'srv0';
const ID_PREFIX = 'ws-route-';

interface CaddyRoute { '@id'?: string; handle?: { upstreams?: { dial?: string }[] }[] }

//? Prune stale ws-route-* routes (upstream container no longer running). Best-effort — a
//? missing/unreachable Caddy just yields an empty prune. Returns the pruned route ids.
export async function reconcileProxyRoutesOnBoot(): Promise<{ ok: boolean; pruned: string[] }> {
  if (proxyKind() !== 'caddy') {
    console.log('[proxy] boot-reconcile: nginx routes persist in the include file — skipping (follow-up).');
    return { ok: true, pruned: [] };
  }
  const provider = getProxyProvider();
  if (!(await provider.available())) {
    console.log('[proxy] boot-reconcile: caddy admin unreachable — skipped.');
    return { ok: false, pruned: [] };
  }

  const [fetchErr, res] = await tryCatch(() => fetch(`${CADDY_ADMIN}/config/apps/http/servers/${CADDY_SERVER}/routes`));
  if (fetchErr || !res?.ok) return { ok: false, pruned: [] };
  const [textErr, text] = await tryCatch(() => res.text());
  if (textErr || text === null) return { ok: false, pruned: [] };
  const [parseErr, routes] = await tryCatch(() => JSON.parse(text) as CaddyRoute[]);
  if (parseErr || routes === null) return { ok: false, pruned: [] };

  //? The set of currently-running docker containers (names).
  const ps = await docker(['ps', '--format', '{{.Names}}']);
  const alive = new Set(ps.out.split('\n').map((n) => n.trim()).filter((n) => n.length > 0));

  const pruned: string[] = [];
  for (const r of routes) {
    const id = r['@id'];
    if (!id?.startsWith(ID_PREFIX)) continue;
    const dial = r.handle?.[0]?.upstreams?.[0]?.dial ?? '';
    const container = dial.split(':')[0] ?? '';
    if (container.length > 0 && !alive.has(container)) {
      await provider.removeRoute(id.slice(ID_PREFIX.length));
      pruned.push(id);
    }
  }
  if (pruned.length > 0) console.log(`[proxy] boot-reconcile: pruned ${String(pruned.length)} stale route(s): ${pruned.join(', ')}`);
  return { ok: true, pruned };
}
