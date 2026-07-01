import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ports } from './config.ports';

//? The dev backend writes its ACTUALLY-bound port to
//? `node_modules/.luckystack/dev-server.json` (it may have auto-incremented off
//? a busy port). Read it so the proxy targets the real port; fall back to the
//? `config.ports.ts` backend port when the file is absent (backend not up yet, or
//? a production build). Re-read per request via `bypass` (below) so a backend
//? that hops ports mid-session is followed live.
const readBackendPort = (fallback: string): string => {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'node_modules', '.luckystack', 'dev-server.json'),
      'utf8',
    );
    const info = JSON.parse(raw) as { port?: number };
    return info.port ? String(info.port) : fallback;
  } catch {
    return fallback;
  }
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ip = env.SERVER_IP || '127.0.0.1';
  //? Proxy target resolution (config-driven, single source = config.ports.ts):
  //?   1. ports.devBackendUrl — develop against a REMOTE backend (deployed/staging).
  //?      The browser stays same-origin (localhost), the proxy makes the cross-origin
  //?      hop with changeOrigin, so cookies stay first-party + no CORS needed.
  //?   2. ROUTER_PORT (env) — cluster-dev: proxy the @luckystack/router, which fans
  //?      out per service-key (deploy.config.ts bindings).
  //?   3. the local backend on ports.backend (following an auto-incremented port via
  //?      node_modules/.luckystack/dev-server.json). SERVER_PORT is no longer read.
  const remoteBackend = ports.devBackendUrl?.trim() || undefined;
  const routerPort = env.ROUTER_PORT && /^\d+$/.test(env.ROUTER_PORT) ? env.ROUTER_PORT : undefined;
  const backendTarget = (): string =>
    remoteBackend
      ? remoteBackend
      : routerPort
        ? `http://${ip}:${routerPort}`
        : `http://${ip}:${readBackendPort(String(ports.backend))}`;

  //? Vite's proxy (node-http-proxy) has NO `router` option, but `bypass` runs per
  //? request with the live options object — set `target` there so every proxied
  //? request hits the CURRENT backend port. socket.io always does an HTTP polling
  //? handshake before upgrading; that handshake passes through here and mutates
  //? the shared options object, so the subsequent websocket upgrade (which reuses
  //? the same object) is carried to the right port too. Returning undefined lets
  //? the proxy continue as normal.
  const followBackend = (_req: IncomingMessage, _res: ServerResponse, options: ProxyOptions): undefined => {
    options.target = backendTarget();
    return undefined;
  };

  //? Fresh options object per route (spread) so each entry's `bypass` mutates its
  //? own `target` and routes never cross-contaminate.
  const entry = (extra: ProxyOptions = {}): ProxyOptions => ({
    target: backendTarget(),
    //? A remote backend (ports.devBackendUrl) sits on a different host, so rewrite
    //? the Host header to match it (vhost routing + TLS SNI); the local/router
    //? target is same-host so it stays off.
    changeOrigin: Boolean(remoteBackend),
    bypass: followBackend,
    ...extra,
  });

  return {
    plugins: [
      react(),
      tsconfigPaths({ projects: ['tsconfig.json'] }),
    ],
    resolve: {
      //? Client build only: `config.ts` is shared by client + server and pulls
      //? `registerProjectConfig` from the bare `@luckystack/core` server barrel,
      //? which statically imports Node `crypto` (randomBytes) and can't be
      //? bundled for the browser. The browser-safe `/client` entry exports the
      //? same `registerProjectConfig`, so redirect the bare specifier to it for
      //? Vite only — the Node server still imports the real barrel, so each
      //? runtime keeps a single, consistent project-config registry. Exact-match
      //? regex so `@luckystack/core/client` itself is left untouched.
      alias: [
        { find: /^@luckystack\/core$/, replacement: '@luckystack/core/client' },
      ],
    },
    server: {
      port: ports.frontend,
      host: true,
      proxy: {
        // Forward API + sync + auth + uploads + framework dev endpoints to the
        // backend on SERVER_IP + config.ports.ts `backend` (or its auto-incremented
        // port advertised in node_modules/.luckystack/dev-server.json), or to the
        // router when ROUTER_PORT is set (cluster-dev).
        '/api': entry(),
        '/sync': entry(),
        '/auth': entry(),
        '/uploads': entry(),
        '/_health': entry(),
        '/livez': entry(),
        '/readyz': entry(),
        '/_docs': entry(),
        '/socket.io': entry({ ws: true }),
      },
    },
  };
});
