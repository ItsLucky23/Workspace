# Developer Guide

> Getting started with LuckyStack development.

> **Two paths in:**
> - **Building an app on top of the framework** — run `npx create-luckystack-app my-app` and follow the README it generates. The scaffolder writes the smallest possible project that boots against `@luckystack/*` packages.
> - **Contributing to the framework** — clone this monorepo and follow the steps below. You will be working in `packages/*` (framework code) plus `src/`, `server/`, and `scripts/` (this repo's own playground app that doubles as the test surface).

---

## Quick Start (monorepo contributors)

### 1. Setup

```bash
# Install dependencies
npm install

# Build all @luckystack/* packages once
npm run build

# Copy environment templates
cp .env_template .env
cp .env.local_template .env.local

# Keep placeholders in .env and add real secrets in .env.local
# Edit config.ts with your settings
```

Environment file model:

- `.env` is safe config context for ports, flags, and expected keys
- `.env` may intentionally contain placeholders like `ID_IN_ENV_LOCAL` and `SECRET_IN_ENV_LOCAL`
- `.env.local` stores real secrets and overrides `.env`
- `.env.local_template` shows which secret keys should exist in `.env.local`

### 2. Start Development

```bash
# Terminal 1: Start backend
npm run server

# Terminal 2: Start frontend (Vite)
npm run client
```

`npm run server` now uses a core-file supervisor: route logic (`_api`/`_sync`) stays on incremental hot reload, while core backend files (auth/bootstrap/socket/server) trigger a fast process restart.

If you need to run without the supervisor, use:

```bash
npm run server:direct
```

#### Ports & config

The dev frontend port and the single-instance backend listen port live in **`config.ports.ts`** (`export const ports = { frontend, backend }`) — the single source of truth. `config.ts` re-exports `ports`, `server.ts` passes `ports.backend` to the server as its `defaultPort`, and `vite.config.ts` reads `ports.frontend`, so a port only ever changes in one place. There is **no `SERVER_PORT` in `.env`** anymore — to run a one-off / multi-instance boot on another port, pass it as the positional argv (`npm run server -- <preset> <port>`), which overrides `config.ports.ts`. `SERVER_IP` stays in `.env`.

**Develop against a remote backend.** Set `devBackendUrl` in `config.ports.ts` (e.g. `'https://staging-api.example.com'`) to point the local frontend at a deployed/staging API instead of a local one — run just `npm run client`, no local server needed. The Vite proxy forwards `/api`, `/sync`, `/socket.io`, … there (with `changeOrigin`), so the browser stays **same-origin** on `localhost:frontend`: session cookies stay first-party and no CORS is required. (For full remote *auth* — OAuth callbacks — also point `PUBLIC_URL` / `oauthCallbackBase` at the remote; the proxy alone already covers same-origin session cookies + sockets.) Leave it undefined for the local backend.

**How the client follows the backend port (dev).** In dev the browser talks to the app **same-origin**: Vite serves the frontend on `ports.frontend` and **proxies** `/api`, `/sync`, `/auth`, `/socket.io`, … to the backend — so the client never needs to know the backend port. If `ports.backend` is already in use, the server **auto-increments** to the next free port (`SERVER_PORT_AUTO_INCREMENT`, default ON in dev) and writes the *actually-bound* port to `node_modules/.luckystack/dev-server.json`. The Vite proxy re-reads that file per request and follows the hop automatically. Net effect: starting the server while `:80` is taken Just Works, transparently to the client.

This auto-follow only works **through the Vite dev proxy** (the default single-instance model). It is **not** picked up by:

- A client that talks **directly** to a fixed `backendUrl` (no proxy — e.g. a cross-origin or remote-backend setup): it keeps using the configured port, so a hop would break the connection. Run such a setup on a known-free fixed port, or disable hopping with `SERVER_PORT_AUTO_INCREMENT=0`.
- The **router** (cluster / multi-instance): it routes by the fixed per-service `bindings` in `deploy.config.ts`, not `dev-server.json` — so each backend must listen on the exact port its binding declares (pass it via `npm run server -- <preset> <port>`), never an auto-incremented one.

Auto-increment is dev-only (OFF in prod by default), so production binds exactly `ports.backend` (or the argv port).

The router topology (`services.config.ts` + `deploy.config.ts`) is **not** part of a base install; opt in later with `npx luckystack add router` (and `npx luckystack remove router` to undo).

### 3. Create Your First API

```typescript
// src/mypage/_api/hello_v1.ts
import { AuthProps, SessionLayout } from "config";
import { Functions, ApiResponse, ApiStreamEmitter } from "src/_sockets/apiTypes.generated";

export const auth: AuthProps = { login: false, additional: [] };

export interface ApiParams {
  data: { name: string };
  user: SessionLayout;
  functions: Functions;
  stream: ApiStreamEmitter;
}

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  return {
    status: "success",
    message: `Hello, ${data.name}!`,
  };
};
```

Types are auto-generated! Just save the file and use:

```typescript
const result = await apiRequest({ name: "mypage/hello", version: "v1", data: { name: "World" } });
```

---

## Project Structure

```
luckystack/
├── src/                    # Frontend (React)
│   ├── _components/        # Shared UI components
│   ├── _functions/         # Client utilities
│   ├── _providers/         # React context providers
│   ├── _sockets/           # Socket client utilities
│   ├── _locales/           # i18n translations
│   ├── admin/              # Admin pages
│   └── {page}/             # Feature pages
│       ├── page.tsx        # Main page component
│       ├── _components/    # Page-specific components
│       ├── _api/           # API handlers for this page
│       └── _sync/          # Sync handlers for this page
│
├── server/                 # Backend (Node.js)
│   ├── auth/               # Authentication logic
│   ├── sockets/            # Socket event handlers
│   ├── functions/          # Server-only functions
│   ├── utils/              # Server utilities
│   ├── dev/                # Hot reload & type generation
│   └── server.ts           # Entry point
│
├── shared/                 # Isomorphic functions (client + server)
│
├── docs/                   # Architecture documentation
├── config.ts               # App configuration
└── .env                    # Environment variables
```

---

## Paths and Aliases

- Runtime/server path constants are centralized in `server/utils/paths.ts`.
- Use these constants for filesystem paths (uploads, public, generated files, server functions) instead of hardcoding `process.cwd()` joins.
- Alias resolution source of truth is TypeScript config paths (`tsconfig.server.json` and `tsconfig.client.json`).
- `vite.config.ts` uses `vite-tsconfig-paths`, and server runtime type resolution reuses those same tsconfig path mappings.

---

## Common Patterns

### Route Guards (per-page middleware)

Restrict who can see a page by exporting a `middleware` function from `page.tsx`. The framework auto-registers it against the page's URL and runs it on every navigation (and on programmatic `useRouter` navigations too).

```typescript
// src/billing/page.tsx
import type { PageMiddleware } from '@luckystack/core/client';
import { i18nNotify as notify } from '@luckystack/core/client';
import type { SessionLayout } from 'config';

export const template = 'dashboard';

export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  if (!session.paidTier) {
    notify.error({ key: 'billing.upgradeRequired' });
    return; // navigate(-1) — sends the user back in history
  }
  return { success: true };
};

export default function BillingPage() { /* ... */ }
```

Returns: `{ success: true }` to render, `{ success: false, redirect: '/path' }` to redirect, or `undefined` to go back. No `success: false` without a `redirect` — use `undefined` for that case.

Pages without a `middleware` export are public by default. For a cross-cutting global hook (telemetry, server-reachability), call `registerMiddlewareHandler(...)` from `src/main.tsx` once; per-page middleware always takes precedence.

Deep dive: [`docs/ARCHITECTURE_ROUTING.md` § Page Guards](./ARCHITECTURE_ROUTING.md).

### Page with API and Sync

```
src/game/
├── page.tsx                # Main game UI
├── _components/
│   ├── Board.tsx
│   └── ScoreBoard.tsx
├── _api/
│   ├── createGame_v1.ts       # POST - create new game
│   ├── getGameState_v1.ts     # GET - fetch game state
│   └── deleteGame_v1.ts       # DELETE - end game
└── _sync/
    ├── movePlayer_server_v1.ts  # Server validates move
    └── movePlayer_client_v1.ts  # Client processes move
```

### Using in Components

```tsx
import { apiRequest } from "src/_sockets/apiRequest";
import { syncRequest, useSyncEvents } from "src/_sockets/syncRequest";

function GameBoard() {
  const [state, setState] = useState(null);
  const { upsertSyncEventCallback } = useSyncEvents();

  // Fetch initial state
  useEffect(() => {
    apiRequest({ name: "game/getGameState", version: "v1", data: { gameId } }).then((result) =>
      setState(result),
    );
  }, [gameId]);

  // Listen for moves
  useEffect(() => {
    upsertSyncEventCallback({
      name: "game/movePlayer",
      version: "v1",
      callback: ({ serverOutput }) => {
        setState((prev) => ({ ...prev, ...serverOutput }));
      },
    });
  }, []);

  // Send a move
  const handleMove = (move) => {
    syncRequest({
      name: "game/movePlayer",
      version: "v1",
      data: move,
      receiver: "game-room-123",
      onStream: (stream) => {
        console.log("Requester progress", stream);
      },
    });
  };

  return <Board onMove={handleMove} {...state} />;
}
```

For receiver-side stream updates from `_client_v{n}.ts`, register `upsertSyncEventStreamCallback` via `useSyncEvents`.

Strict stream typing note:

- If a route does not call `stream(...)`, its generated stream type is `never`.
- For those routes, TypeScript disallows `onStream`/stream callback registration.

This repository no longer ships the standalone `src/streaming` demo route. (The kept `src/playground` dev tool is unrelated — it is an in-repo surface for testing core features and is never shipped to consumers.)

The previous `/streaming` demo was removed, but the streaming capability is fully documented in [`docs/ARCHITECTURE_SYNC.md`](./ARCHITECTURE_SYNC.md#streaming) (the four stream primitives, `createStreamThrottle`, and SSE) and [`packages/sync/docs/streaming.md`](../packages/sync/docs/streaming.md).

---

## Hot Reload

The dev server watches for file changes and automatically:

1. **API files** (`_api/*.ts`) - Regenerates types and incrementally reloads only changed API handlers in memory
2. **Sync files** (`_sync/*.ts`) - Injects templates, regenerates types, and incrementally reloads only changed sync handlers in memory
3. **Function files** (`server/functions/*.ts`, `shared/*.ts`) - Reloads functions and regenerates `apiTypes.generated.ts`
4. **Components** - Vite HMR handles the rest

For direct `_api` and `_sync` edits, the watcher reloads only the changed route module in memory.
Type-map regeneration for route files runs on add/delete events, not on every save.

For non-route dependencies in `src/`, `shared/`, and `server/functions/`, the watcher computes affected imports and reloads only dependent API/sync routes.

Type regeneration is asynchronous and can lag briefly (usually hundreds of milliseconds).

Runtime defaults for watcher debounce, watcher stability thresholds, HTTP request body size, session cookie name, and HTTP stream flags are centralized in `server/config/runtimeConfig.ts`.

Timing-aware workflow:

1. First pass: write against intended route literals and generated helper contracts.
2. Wait/re-check pass: after generation settles, remove any temporary casts/narrowing added during the lag window.

Just save and your types are updated.

## CI Type Safety

To keep AI tooling, local TypeScript, and CI aligned, always generate artifacts before type-check/build steps in pipelines:

```bash
npm run generateArtifacts
tsc -b
```

The type-map generator is strict: unresolved symbols fail generation instead of emitting `any` fallbacks.

## Build Caches

Build tooling now uses explicit cache locations so local runs and CI jobs can reuse work between runs:

- TypeScript build mode: `.cache/tsbuild/client.tsbuildinfo` and `.cache/tsbuild/server.tsbuildinfo`
- Vite cache: `.cache/vite`
- ESLint cache: `.eslintcache`

For GitLab CI, cache both `.cache/` and `.eslintcache` between jobs to reduce repeated type-check and bundling work.

---

## Testing APIs

### Via HTTP (curl/Postman)

```bash
# GET-style API
curl http://localhost/api/mypage/getGameState/v1?gameId=123

# POST-style API
curl -X POST http://localhost/api/mypage/createGame/v1 \
  -H "Content-Type: application/json" \
  -d '{"name": "My Game"}'

# With auth
curl http://localhost/api/mypage/getGameState/v1?gameId=123 \
  -H "Authorization: Bearer your-token-here"

# Optional translated error messages
curl http://localhost/api/mypage/getGameState/v1?gameId=123 \
  -H "Cookie: token=your-token-here" \
  -H "Accept-Language: en"
```

### HTTP Streaming (SSE)

You can stream API or sync progress over HTTP using either:

- `Accept: text/event-stream`
- `?stream=true`

```bash
# API streaming over SSE
curl -N "http://localhost/api/mypage/getGameState/v1?gameId=123&stream=true" \
  -H "Accept: text/event-stream"

# Sync streaming over SSE (requester receives _server_v{n}.ts stream payloads)
curl -N -X POST "http://localhost/sync/game/movePlayer/v1?stream=true" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"data":{"x":1,"y":2},"receiver":"game-room-123","ignoreSelf":false}'
```

SSE event names:

- `stream` = partial updates
- `final` = final JSON response envelope

### Via Browser Console

```javascript
// If socket is connected
socket.emit("apiRequest", {
  name: "api/mypage/hello/v1",
  data: { name: "Test" },
  responseIndex: 999,
});

socket.on("apiResponse-999", console.log);
```

---

## Debugging

### Server Logs

Colorized console output:

- **Blue** - API calls
- **Green** - Success
- **Red** - Errors
- **Yellow** - Warnings
- **Magenta** - HTTP requests

Logging is now configurable in `config.ts` via `logging`:

```typescript
logging: {
  devLogs: true,          // general API/sync/client/server debug logs
  devNotifications: true, // dev-only notify.error toasts
  socketStatus: true,     // connect/disconnect/reconnect status logs
  socketStartup: true,    // "SocketIO server initialized" startup log
  stream: true,           // API/sync stream payload logs
}
```

Use this to disable noisy logs without turning off all development diagnostics.

### Dev REPL

In server terminal, type commands directly:

```
> session.get('token-123')  // Check session
> io.sockets.sockets.size   // Connected sockets
```

### Sentry Integration

Errors are automatically captured when Sentry DSNs are configured:

- `SENTRY_DSN` for the server
- `VITE_SENTRY_DSN` for the client
- `SENTRY_ENABLED` and `VITE_SENTRY_ENABLED` can be set to `true` to force-enable Sentry in development

---

## Best Practices

1. **Keep APIs small** - One responsibility per file
2. **Use type inference** - Don't manually type API responses
3. **Handle errors** - Always return `{ status: 'error', errorCode, errorParams? }` on failure
4. **Clean up callbacks** - Register sync callbacks inside `useEffect` and return the disposer from `upsertSyncEventCallback`
5. **Use rooms** - Don't broadcast to everyone, use targeted rooms
6. **Avoid unsafe wrappers** - Do not create local `unsafe*` wrapper aliases around `apiRequest`, `syncRequest`, or sync callbacks
7. **Prisma model type convention** - Create app-level model aliases in `src/_types/{ModelName}.ts` and export from `@prisma/client` before extending with app-specific fields

See architecture deep dives:

- `docs/ARCHITECTURE_API.md`
- `docs/ARCHITECTURE_SYNC.md`
- `docs/ARCHITECTURE_SOCKET.md`
- `docs/ARCHITECTURE_PACKAGING.md`
