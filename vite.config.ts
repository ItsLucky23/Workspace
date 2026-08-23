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

export default defineConfig(({ command, mode }) => {
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

  //? Vite creates ONE http-proxy server per route at startup and closes over the
  //? options object it was constructed with; `proxy.web` is invoked with an EMPTY
  //? per-request override and `proxy.ws` with none at all, so the target is always
  //? re-read from that closed-over object — mutating it per request DOES work. The
  //? catch (Vite 6): `bypass` is handed a shallow COPY of the options, so mutating
  //? its `target` is a no-op (that was the bug — a backend that hopped ports was
  //? never followed until Vite restarted). `configure` IS handed the real object:
  //? capture it there and mutate it from `bypass`. Assign a fresh STRING each time —
  //? the ws pass rewrites `target` in place into a parsed URL object, and only a
  //? string is re-parsed. Fresh closure per route so entries never cross-contaminate.
  const entry = (extra: ProxyOptions = {}): ProxyOptions => {
    let live: ProxyOptions | undefined;
    return {
      target: backendTarget(),
      //? A remote backend (ports.devBackendUrl) sits on a different host, so rewrite
      //? the Host header to match it (vhost routing + TLS SNI); the local/router
      //? target is same-host so it stays off.
      changeOrigin: Boolean(remoteBackend),
      configure: (_proxy, options) => {
        live = options;
      },
      //? Runs for both http and the websocket upgrade (gated on `ws: true`), so the
      //? socket.io polling handshake AND the upgrade follow the port. `copy` is the
      //? clone Vite logs from under DEBUG=vite:proxy — keep it truthful too.
      bypass: (_req: IncomingMessage, _res: ServerResponse | undefined, copy: ProxyOptions): undefined => {
        const target = backendTarget();
        if (live) live.target = target;
        copy.target = target;
        return undefined;
      },
      ...extra,
    };
  };

  return {
    // Production builds must never inherit an ambient development condition. Besides enabling
    // React's production runtime, this keeps shared config.ts on its production branch in-browser.
    define: command === 'build' ? {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'process.env.NODE_ENV': JSON.stringify('production'),
    } : undefined,
    esbuild: command === 'build' ? { jsxDev: false } : undefined,
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
    build: {
      //? Monaco's TypeScript worker/editor and Mermaid are already route-level lazy chunks; splitting their
      //? internally coupled bundles further is unsafe and does not reduce bytes loaded by those routes. Keep
      //? the warning threshold just above the largest known lazy vendor chunk so NEW growth still warns.
      chunkSizeWarningLimit: 4_100,
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
        '/media': entry(),
        '/_health': entry(),
        '/livez': entry(),
        '/readyz': entry(),
        '/_docs': entry(),
        '/socket.io': entry({ ws: true }),
      },
    },
    optimizeDeps: {
      include: [
        'framer-motion',
        'motion',
        '@xterm/xterm',
        '@fortawesome/fontawesome-svg-core',
      ]
    }
  };
});
