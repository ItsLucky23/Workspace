//? nginx backend for the proxy-provider abstraction — the zero-downtime, debounced
//? config-generator (hosting-proxy plan). The wildcard DNS is STATIC (never changes per
//? ticket), so only nginx's internal routing changes; nginx `reload` is already GRACEFUL
//? (new workers, drain old → no dropped connections). The only cost is reload overhead under
//? container churn, so route changes are COALESCED: upsert/remove mutate an in-memory desired
//? set and schedule ONE debounced flush (regenerate the include file → `nginx -t` → reload).
//? A failed config test does NOT reload — the previous (working) config stays live, so a bad
//? route can never take the proxy down.
//?
//? Host-side only: it writes an nginx include file + runs the reload command where nginx runs
//? (the prod host). In dev (no nginx on PATH) `available()` is false and a flush is a
//? best-effort no-op — never throws.

import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tryCatchSync } from '@luckystack/core';
import type { ProxyProvider, ProxyResult, ProxyRoute } from './types';

const CONF = process.env.WS_NGINX_CONF ?? '/etc/nginx/conf.d/workspaces-routes.conf';
const SSL_CERT = process.env.WS_NGINX_SSL_CERT ?? '/etc/nginx/ssl/workspaces-wildcard.crt';
const SSL_KEY = process.env.WS_NGINX_SSL_KEY ?? '/etc/nginx/ssl/workspaces-wildcard.key';
const RELOAD_CMD = process.env.WS_NGINX_RELOAD_CMD ?? 'nginx -s reload';
const TEST_CMD = process.env.WS_NGINX_TEST_CMD ?? 'nginx -t';
const DEBOUNCE_MS = Number(process.env.WS_NGINX_DEBOUNCE_MS ?? '1000');

//? The desired route set (id → route). The include file is regenerated from this on flush.
const routes = new Map<string, ProxyRoute>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

//? Run a shell command, never throwing. Returns ok + combined output (for diagnostics).
function run(cmd: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, { shell: true, windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.stderr.on('data', (d) => { out += String(d); });
    proc.on('error', (e) => { resolve({ ok: false, out: String(e) }); });
    proc.on('close', (code) => { resolve({ ok: code === 0, out: out.trim() }); });
  });
}

//? One nginx `server` block per route — TLS-terminated with the wildcard cert, WebSocket-ready
//? (Upgrade/Connection) so dev-server previews + HMR proxy correctly. Edge-auth (Track B5): when
//? `forwardAuth` is set, gate `location /` behind an `auth_request` subrequest to the
//? /editor-auth-check endpoint (2xx proceeds, else 401).
function renderRoute(r: ProxyRoute): string {
  const target = r.target.startsWith('http') ? r.target : `http://${r.target}`;
  const authLoc = r.forwardAuth === undefined ? '' : `
    location = /editor-auth-check {
        internal;
        proxy_pass http://${r.forwardAuth}/editor-auth-check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header Cookie $http_cookie;
    }`;
  const authReq = r.forwardAuth === undefined ? '' : '\n        auth_request /editor-auth-check;';
  return `server {
    listen 443 ssl;
    http2 on;
    server_name ${r.host};
    ssl_certificate ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};${authLoc}
    location / {${authReq}
        proxy_pass ${target};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}`;
}

function renderConf(): string {
  //? Deterministic order for a stable config file. `[...values()]` is a fresh copy, so the
  //? in-place sort mutates nothing shared (the server TS lib predates `toSorted`).
  // eslint-disable-next-line unicorn/no-array-sort
  const blocks = [...routes.values()].sort((a, b) => a.id.localeCompare(b.id)).map((r) => renderRoute(r));
  return `# Managed by Workspaces — DO NOT EDIT BY HAND. Regenerated on every route change.\n${blocks.join('\n\n')}\n`;
}

//? Regenerate the include file, validate, and reload — atomically + gracefully. Returns
//? ok=false (without reloading) if the generated config fails `nginx -t`, keeping the last
//? good config live. Best-effort: a missing nginx just yields ok:false.
async function flushNow(): Promise<{ ok: boolean; error?: string }> {
  flushTimer = null;
  const [wErr] = tryCatchSync(() => {
    mkdirSync(path.dirname(CONF), { recursive: true });
    const tmp = `${CONF}.tmp`;
    writeFileSync(tmp, renderConf(), 'utf8');
    renameSync(tmp, CONF); //? atomic swap — nginx never reads a half-written file
  });
  if (wErr) return { ok: false, error: `nginx.writeFailed: ${String(wErr)}` };
  const test = await run(TEST_CMD);
  if (!test.ok) return { ok: false, error: `nginx.configTestFailed: ${test.out.slice(0, 200)}` };
  const reload = await run(RELOAD_CMD);
  return reload.ok ? { ok: true } : { ok: false, error: `nginx.reloadFailed: ${reload.out.slice(0, 200)}` };
}

//? Coalesce rapid route changes into one graceful reload after the debounce window.
function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { void flushNow(); }, DEBOUNCE_MS);
}

export const nginxProvider: ProxyProvider = {
  kind: 'nginx',

  //? Usable if the include dir exists/creatable and `nginx -t` runs (binary present).
  async available(): Promise<boolean> {
    const [mkErr] = tryCatchSync(() => { mkdirSync(path.dirname(CONF), { recursive: true }); });
    if (mkErr) return false;
    const test = await run(TEST_CMD);
    return test.ok;
  },

  //? Optimistic: mutate the desired set + schedule the coalesced reload. The route is live
  //? after the debounce window (≤~1s); callers needing a hard barrier call `reconcile`.
  upsertRoute(route: ProxyRoute): Promise<ProxyResult> {
    routes.set(route.id, route);
    scheduleFlush();
    return Promise.resolve({ ok: true });
  },

  removeRoute(id: string): Promise<ProxyResult> {
    routes.delete(id);
    scheduleFlush();
    return Promise.resolve({ ok: true });
  },

  //? Boot self-heal: make the desired set EXACTLY `live` and flush immediately (no debounce).
  //? Everything previously in our include file that isn't live is dropped by the regenerate.
  async reconcile(live: ProxyRoute[]): Promise<{ ok: boolean; pruned: string[] }> {
    const prevIds = new Set(routes.keys());
    routes.clear();
    for (const r of live) routes.set(r.id, r);
    const liveIds = new Set(live.map((r) => r.id));
    const pruned = [...prevIds].filter((id) => !liveIds.has(id));
    const res = await flushNow();
    return { ok: res.ok, pruned };
  },
};
