# Routing Architecture

> File-based routing for pages, APIs, and real-time sync events.

> **Where the code lives (post-package-split):** route discovery, version-token validation, and the dev-mode loaders are in `@luckystack/devkit` (`packages/devkit/src/`). Production route maps are emitted into `server/prod/generatedApis.<preset>.ts` and selected at runtime via the first positional argv to `server.ts` (parsed by `@luckystack/server/parseArgv`; comma-separated for multi-preset boots). The matching logic that turns an inbound request into a handler lives in `@luckystack/api` (`packages/api/src/handleApiRequest.ts`) and `@luckystack/sync` (`packages/sync/src/handleSyncRequest.ts`). HTTP-fallback dispatch is split across `packages/server/src/httpRoutes/*` (one handler per concern: csrf, health, /_test/reset, favicon, uploads, auth, api, sync, custom routes, static fallback) — see [`packages/server/README.md`](../packages/server/README.md#http-route-handler-layout) for the table.

> **Framework `system/logout` is exact-match.** Earlier builds short-circuited any API whose final path segment was `logout` (so `admin/logout/v1` would silently invoke the framework logout instead of the consumer's handler). The framework now matches the full normalized route name (`system/logout`); consumer routes that happen to end in `logout` reach their own handler unchanged.

---

## Overview

LuckyStack uses file-based routing inspired by Next.js. There are three types of routes:

1. **Page routes** - React components that render at URL paths
2. **API routes** - Server-side functions callable via WebSocket or HTTP
3. **Sync routes** - Real-time event handlers for room-based broadcasting

All three follow the same convention: place files in the correct folder structure and they are automatically registered.

---

## Page Routing

### How It Works

`src/main.tsx` uses Vite's `import.meta.glob` to scan all `.tsx` files at build time. It finds files named `page.tsx` in non-underscore folders and registers them as routes with React Router.

### File Convention

```
src/{page}/page.tsx  -->  renders at /{page}
src/page.tsx         -->  renders at /
```

### Rules

- Only files named `page.tsx` (or `page.jsx`) become routes
- Folders starting with `_` are **invisible-parent** — they group files structurally but are NOT part of the URL. Children of an `_<folder>` still route from their visible siblings onward.
- A `page.tsx` placed directly inside an `_<folder>` is **invalid** (no URL segment left after stripping the invisible parent). Dev console logs a warning; the page is skipped.
- A `page.tsx` placed inside a reserved framework folder (`_api`, `_sync`, `_function(s)`, `_component(s)`, `_provider(s)`, `_locale(s)`, `_socket(s)`, `_shared`, `_server`) is **invalid** — those folders are framework-internal.
- Each page can export a `template` constant to control its layout wrapper.
- If no template is exported, defaults to `'plain'`.

### Invisible-parent examples

```
src/admin/page.tsx                  -> /admin              OK
src/_housing/renting/page.tsx       -> /renting            OK    (_housing invisible)
src/_marketing/landing/page.tsx     -> /landing            OK    (group marketing pages without URL prefix)
src/page.tsx                        -> /                   OK
src/_housing/page.tsx               -> INVALID (no URL segment left after stripping underscore folders)
src/_api/playground/page.tsx        -> INVALID (cannot live inside reserved folder _api)
src/_housing/_drafts/page.tsx       -> INVALID (every folder is invisible; no URL left)
```

### Reusing the validator

The same rules power the scaffold CLI and dev-time warnings. The validator is exported as `validatePagePath` from `@luckystack/core` (consumer + devkit side) — pass a `src`-relative path and it returns `{ valid, route?, reason? }`. Override `privateFolderPrefix` or extend `scaffoldIgnoredFolders` via `registerRoutingRules(...)` in `@luckystack/devkit` if your project uses a different folder convention.

### Templates

```typescript
// src/settings/page.tsx
export const template = 'dashboard';

export default function SettingsPage() {
  return <div>...</div>;
}
```

Available templates:

| Template    | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `plain`     | Minimal wrapper, no UI chrome. Sets theme to `config.defaultTheme`. |
| `dashboard` | Side navigation bar with main content area.                         |

The `dashboard` template includes `Middleware` for route authentication guards.

### Page Guards (per-page middleware)

Routes that require auth or role checks declare their guard **on the page itself** via an `export const middleware`. The framework's `<Middleware>` component (and the programmatic-navigation `useRouter` hook) auto-runs the per-page middleware before painting the page; if no per-page middleware is registered, the framework allows the route by default.

```typescript
// src/admin/page.tsx
import type { PageMiddleware } from '@luckystack/core/client';
import { i18nNotify as notify } from '@luckystack/core/client';
import type { SessionLayout } from 'config';

export const template = 'dashboard';

//? Logged-out users → /login. Logged-in non-admins → toast + history-back.
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  if (session.admin) return { success: true };
  notify.error({ key: 'middleware.notAdmin' });
  return; // navigate(-1)
};

export default function AdminPage() { /* ... */ }
```

**Return contract:**

| Return value | Effect |
|---|---|
| `{ success: true }` | Page renders. |
| `{ success: false, redirect: '/some-path' }` | `navigate('/some-path')`. |
| `undefined` (or no return) | `navigate(-1)` (browser history back). Pair with `notify.error(...)` for user feedback. |

**Resolution order** (per route hit):

1. Per-page middleware (`export const middleware`) registered via `getRoutes()` auto-discovery.
2. Global handler registered via `registerMiddlewareHandler(...)` — optional escape-hatch for cross-cutting hooks (telemetry, server-reachability check, maintenance banner).
3. Framework default: allow.

There is **no central `src/_functions/middlewareHandler.ts` file** in the canonical pattern. Pages own their guards; the global handler is reserved for cross-cutting concerns (rarely needed). To add a global hook, import `registerMiddlewareHandler` from `@luckystack/core/client` and call it from `src/main.tsx` directly.

The validator helper `validatePagePath` (also from `@luckystack/core`) and the scaffold CLI (`npm run scaffold:page <path>`) enforce the invisible-parent rules above when creating new pages.

### Auto-injection of new page.tsx files

When the dev server is running, creating an **empty** `page.tsx` anywhere under `src/` triggers `@luckystack/devkit`'s template injector — same mechanism as for new `_api/*_v<N>.ts` and `_sync/*_(server|client)_v<N>.ts` files. The injector picks a template based on the path:

- Paths containing `admin`, `dashboard`, `settings`, `billing`, `account`, or `profile` → dashboard template (sidebar layout + login guard skeleton).
- Everything else → plain template (no chrome, middleware export commented out).
- **Invalid placement** (page directly inside an `_<folder>`, or inside a reserved framework folder) → a commented diagnostic block explaining the placement issue and a suggested fix, **not** the plain/dashboard template. Move/rename the file to fix and the dev server will re-inject a real template.

### Duplicate-route detection

Because the invisible-parent rule strips `_<folder>` segments, two `page.tsx` files in different folder trees can compute the **same URL**. Example: `src/_test/admin/page.tsx` and `src/admin/page.tsx` both resolve to `/admin`. The framework catches this at three points:

- **Dev startup** (`initializeAll` in `@luckystack/devkit/loader.ts`): logs a soft warning listing every colliding route + the files involved. Does NOT block startup.
- **Build time** (`generateTypeMapFile` in `@luckystack/devkit/typeMapGenerator.ts`): throws via `assertNoDuplicatePageRoutes`, blocking the build. Move or rename one of the files to ship.
- **Runtime** (`src/main.tsx` `getRoutes()`): when two modules register the same `finalPath`, `console.error` prints both file paths and the second registration is skipped (React Router would otherwise silently keep one).

### Consumer overrides for scaffold templates

The bundled scaffold templates (`api`, `sync_server`, `sync_client_paired`, `sync_client_standalone`, `page_plain`, `page_dashboard`) can be replaced via `registerTemplate(kind, content)` from `@luckystack/devkit`. Plus `registerRoutingRules({ disableTemplateInjection })` lets consumers opt sections of the tree out of injection entirely. See `docs/ARCHITECTURE_EXTENSION_POINTS.md` for the full code example.

### Route Resolution Logic

From `main.tsx`:

1. Scan all `.tsx` files via `import.meta.glob('./**/*.tsx', { eager: true })`
2. For each file, split the path into segments
3. Skip if any segment starts with `_`
4. Check if the file ends with `page.tsx`
5. Extract the route path by removing `page` suffix
6. Register as a child route of the root `'/'` path

---

## API Routing

### File Convention

```
src/{page}/_api/{name}_v1.ts  -->  accessible as api/{page}/{name}/v1
```

### How It Works

**Development:** The server's `dev/loader.ts` scans `src/` recursively and registers files inside `_api/` as API handlers.
After initial load, the dev watcher performs incremental in-memory updates for changed `_api` files instead of rebuilding the entire API map on every save.

**Production:** The `scripts/generateServerRequests.ts` build script statically generates one route map per preset, emitted as `server/prod/generatedApis.{presetName}.ts`. At runtime the **first positional argv** to `server.ts` (parsed by `@luckystack/server/parseArgv`) selects which file(s) are loaded — comma-separated for multi-preset boots; no argv falls back to `generatedApis.default.ts`. Preset definitions live in `services.config.ts`.

### Name Resolution

The API route sent from the client uses a full route name in `name` (`{page}/{apiName}` for page APIs or just `{apiName}` for root APIs):

```
Client calls apiRequest({ name: 'examples/publicApi', version: 'v1' })
  --> fullname = "api/examples/publicApi/v1"
  --> matches src/examples/_api/publicApi_v1.ts

Client calls apiRequest({ name: 'test/nestedTest/info', version: 'v1' })
  --> fullname = "api/test/nestedTest/info/v1"
  --> matches src/test/nestedTest/_api/info_v1.ts
```

For nested pages:

```
Client calls apiRequest({ name: 'games/chess/getGameState', version: 'v1' })
  --> fullname = "api/games/chess/getGameState/v1"
  --> matches src/games/chess/_api/getGameState_v1.ts
```

### Required Exports

Each API file must export:

```typescript
// Required
export const main = async ({
  data,
  user,
  functions,
}: ApiParams): Promise<ApiResponse> => {
  return {
    status: "success",
    result: {
      /* ... */
    },
  };
};

// Required
export const auth: AuthProps = {
  login: true, // Require authentication
  additional: [], // Extra checks (e.g., admin role)
};

// Required for type generation
export interface ApiParams {
  data: {
    /* typed input from client */
  };
  user: SessionLayout;
  functions: Functions;
}

// Optional
export const rateLimit: number | false = 60; // Requests per minute (false = use global config)
export const httpMethod: "GET" | "POST" | "PUT" | "DELETE" = "POST"; // Override HTTP method inference
```

### WebSocket Access

The primary way to call APIs. The client sends a socket event and gets a response:

```typescript
// Client
const result = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
});
```

Flow:

1. Client emits `apiRequest` event with `{ name, data, responseIndex }`
2. Server looks up handler in `devApis` (dev) or `apis` (prod)
3. Validates auth requirements
4. Checks rate limits
5. Executes `main()` function
6. Emits response on `apiResponse-{responseIndex}`

### HTTP Access

All APIs are also accessible via HTTP for testing, webhooks, or non-socket clients:

```
GET    /api/{page}/{name}?key=value
POST   /api/{page}/{name}  with JSON body
PUT    /api/{page}/{name}  with JSON body
DELETE /api/{page}/{name}
```

HTTP method is either explicitly exported from the API file or inferred from the name:

| Name Prefix                  | Inferred Method |
| ---------------------------- | --------------- |
| `get*`, `fetch*`, `list*`    | GET             |
| `delete*`, `remove*`         | DELETE          |
| `update*`, `edit*`, `patch*` | PUT             |
| Everything else              | POST            |

Authentication via HTTP: include token as cookie (`token=...`) or `Authorization: Bearer ...` header.

### Built-In APIs

Two APIs are handled internally without files:

| Name      | Purpose                          |
| --------- | -------------------------------- |
| `session` | Returns the current user session |
| `logout`  | Logs out the user                |

### Type Generation

Types are automatically generated by `server/dev/typeMapGenerator.ts`:

1. Watches `_api/` folders for file changes
2. Extracts `ApiParams` interface and `main` return type from each file
3. Applies configured route aliases during emission (example: `afas` also emits `timeregister2`)
4. Generates `src/_sockets/apiTypes.generated.ts`
5. Validates generated types and fails on unresolved identifiers before writing files
6. Provides full autocomplete for API names, input data, and output types

---

## Sync Routing

### File Convention

```
src/{page}/_sync/{name}_server_v1.ts  -->  Server-side validation (runs once)
src/{page}/_sync/{name}_client_v1.ts  -->  Client-side handler (runs per client in room)
```

At least one of the two files must exist. Both are optional individually.

### How It Works

**Development:** The server's `dev/loader.ts` scans `src/` recursively and registers files inside `_sync/` that end with `_server_v{number}.ts` or `_client_v{number}.ts`.
After initial load, the dev watcher performs incremental in-memory updates for changed `_sync` files instead of rebuilding the entire sync map on every save.

For non-route dependency changes in `src`, `shared`, or `server/functions`, the watcher resolves the dependency graph and reloads only affected API/sync routes in memory.

**Production:** Same build script generates static route maps.

### Name Resolution

Similar to APIs, sync uses a full route name in `name` (`{page}/{syncName}`):

```
Client calls syncRequest({ name: 'examples/updateCounter', version: 'v1', ... })
  --> fullname = "sync/examples/updateCounter/v1"
  --> server looks for sync/examples/updateCounter/v1_server and sync/examples/updateCounter/v1_client

Client calls syncRequest({ name: 'test/nestedTest/room', version: 'v1', ... })
  --> fullname = "sync/test/nestedTest/room/v1"
  --> server looks for sync/test/nestedTest/room/v1_server and sync/test/nestedTest/room/v1_client
```

### Sync Flow

```
1. Client A sends syncRequest({ name, data, receiver: roomCode })
   |
2. Server validates message format
   |
3. If _server_v{n}.ts exists:
   |  a. Check auth requirements
   |  b. Run main() for validation/DB operations
   |  c. Get serverOutput
   |
4. Get all sockets in the target room
   |
5. For each socket in room:
  |  a. Resolve target token from socket
  |  b. If ignoreSelf and it's the sender, skip
  |  c. If _client_v{n}.ts exists:
  |     - Run main() with { clientInput, serverOutput, token, functions, roomCode }
  |     - If returns { status: 'error' }, emit error to this client and continue
   |     - If returns { status: 'success' }, emit to this client
  |  d. If no _client_v{n}.ts, emit serverOutput directly
   |
6. Confirm success back to sender via sync-{responseIndex}
```

### Required Exports

**Server file (`_server_v{number}.ts`):**

```typescript
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: {
    /* data from sender */
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({
  clientInput,
  user,
  functions,
  roomCode,
}: SyncParams): Promise<SyncServerResponse> => {
  // Validate and transform data
  return { status: "success" /* additional data for clients */ };
};
```

**Client file (`_client_v{number}.ts`):**

```typescript
export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  token: string | null;
  functions: Functions;
  roomCode: string;
}

export const main = async ({
  clientInput,
  serverOutput,
  token,
  functions,
  roomCode,
}: SyncParams): Promise<SyncClientResponse> => {
  const targetUser = token ? await functions.session.getSession(token) : null;
  // Filter: return error to skip this client, success to deliver
  return { status: "success" /* additional client-specific data */ };
};
```

Use `_client_v{number}.ts` only when needed for per-target-client behavior. If a client file only returns `{ status: 'success' }` and does no filtering or transformation, omit it to avoid unnecessary per-client execution overhead.

Important: `_client_v{number}.ts` handlers do not receive `user` directly. Use `token` and fetch session data only when needed via `functions.session.getSession(token)`.

### Receiving Sync Events

On the client, register callbacks to handle incoming sync events:

```typescript
const { upsertSyncEventCallback } = useSyncEvents();

upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ clientOutput, serverOutput }) => {
    // clientOutput = return from _client_v{n}.ts (success only)
    // serverOutput = return from _server_v{n}.ts
  },
});
```

### Data Flow Types

| Type           | Source                | Description                                           |
| -------------- | --------------------- | ----------------------------------------------------- |
| `clientInput`  | Sender's `data` param | Original data passed to `syncRequest({ data: ... })`  |
| `serverOutput` | `_server_v{n}.ts` return   | Data returned from server-side handler                |
| `clientOutput` | `_client_v{n}.ts` return   | Data returned from client-side handler (success only) |

---

## Template Injection and Generated Type Maps

Template injection is a development scaffold step, not the long-term type source of truth.

### Filename conventions that control injector behavior

- API files must end with `_v{number}.ts` (example: `getUser_v1.ts`)
- Sync files must end with `_server_v{number}.ts` or `_client_v{number}.ts`
- Invalid route names are treated as errors during dev server startup and build generation (type maps + server request map generation)
- Route tokens under `_api/` and `_sync/` must be file-based (`<name>_v{n}`, `<name>_server_v{n}`, `<name>_client_v{n}`) and must not include nested path segments after `_api/` or `_sync/`
- Request helper names are service-first only (`service/name`), and invalid request route names fail with `routing.invalidServiceRouteName`
- Runtime resolution does not fall back from page-scoped routes to legacy root routes
- Naming patterns are centralized in `server/dev/routeConventions.ts` so loader, type-map discovery, and generation stay in sync

### Paired sync behavior

- Adding a new empty/whitespace/comment-only `_sync/*_client_v{n}.ts` while `_server_v{n}.ts` exists injects a paired client template that references generated sync types.
- Adding a new empty/whitespace/comment-only `_sync/*_server_v{n}.ts` while `_client_v{n}.ts` exists can migrate client input typing into the server scaffold, then update the client to use generated `SyncClientInput`/`SyncServerOutput` references.
- Deleting `_server_v{n}.ts` while `_client_v{n}.ts` remains can rewrite client typing to preserve standalone behavior.

Injector note for AI-assisted editing: scaffolding can run on both add and change events when the file is still a placeholder (empty, whitespace-only, or comment-only).

Because this runs on file events, types may appear/disappear briefly as files are added/removed before regeneration settles.

### Source of truth

- Template output is scaffolding for fast authoring.
- Generated type maps (`src/_sockets/apiTypes.generated.ts`) are the contract source of truth for request/response typing.

---

## Private Folders

Any folder prefixed with `_` is private and excluded from routing:

| Folder         | Purpose                                  |
| -------------- | ---------------------------------------- |
| `_api/`        | API handlers (registered separately)     |
| `_sync/`       | Sync handlers (registered separately)    |
| `_components/` | Page-specific or shared React components |
| `_functions/`  | Utility functions                        |
| `_providers/`  | React context providers                  |
| `_sockets/`    | Socket.io client utilities               |
| `_locales/`    | i18n translation JSON files              |

---

## Hot Reload

In development mode, the server watches for file changes:

1. `server/dev/hotReload.ts` monitors `src/` for changes in `_api/` and `_sync/` folders
2. On change, `server/dev/loader.ts` re-imports the modified module
3. `server/dev/typeMapGenerator.ts` regenerates `apiTypes.generated.ts` and API docs only when generated content actually changes
4. No server restart needed for API/sync changes
5. Vite ignores `_api/`, `_sync/`, and generated server artifacts (`src/_sockets/apiTypes.generated.ts`, `src/docs/apiDocs.generated.json`) so server-side edits do not trigger client HMR
6. Vite HMR still handles frontend component changes

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `src/main.tsx` | `getRoutes` | Builds page route tree from `page.tsx` modules. |
| `server/dev/loader.ts` | `initializeApis` | Loads `_api` handlers dynamically in development. |
| `server/dev/loader.ts` | `initializeSyncs` | Loads `_sync` handlers dynamically in development. |
| `scripts/generateServerRequests.ts` | script entry | Generates static API/sync maps for production. |
| `server/dev/hotReload.ts` | `setupWatchers` | Watches source changes, reloads modules, regenerates types/docs artifacts. |
