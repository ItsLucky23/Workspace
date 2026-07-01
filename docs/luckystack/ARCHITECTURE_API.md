# API Architecture

<!-- @covers packages/api/src -->

> Type-safe API request system with WebSocket-first architecture and HTTP fallback.

> **Where the code lives (post-package-split):** the runtime described below is implemented in `@luckystack/api` (`packages/api/src/handleApiRequest.ts`, `handleHttpApiRequest.ts`) and shared utilities in `@luckystack/core` (`packages/core/src/`). The `server/` directory in this repo is the *consumer* of those packages — most files referenced here have moved into `packages/`. See the [Runtime Function Reference](#runtime-function-reference) at the bottom for current paths.

---

## Quick Reference

```typescript
// Full route-name API call
const result = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
  abortable: true, // Optional: auto-cancels if called again before response
});

// Nested page API call
const nestedResult = await apiRequest({
  name: "test/nestedTest/info",
  version: "v1",
});

// Global API call (service-first)
const session = await apiRequest({ name: "system/session", version: "v1" });

// HTTP fallback (same API, no WebSocket needed)
// GET /api/examples/getUserData/v1?userId=123
// POST /api/examples/getUserData/v1 with JSON body
```

Request naming contract:

- `apiRequest` requires service-first route names (`service/name`).
- Invalid route names return `routing.invalidServiceRouteName`.

---

## File Structure

```
src/
├── _api/                       # Global system APIs (mapped to service key 'system')
│   ├── session_v1.ts           # → api/system/session/v1
│   └── logout_v1.ts            # → api/system/logout/v1
├── {page}/_api/
│   ├── {apiName}_v1.ts         # → api/{page}/{apiName}/v1
│   └── {subfolder}/            # Nested: api/{page}/{subfolder}/{apiName}/v1
│       └── {apiName}_v1.ts
└── _sockets/
    ├── apiRequest.ts           # Client-side API caller
    └── apiTypes.generated.ts   # Auto-generated types
```

---

## Creating an API

### 1. Create the file

Template is injected automatically for empty files.

```typescript
// src/examples/_api/getUserData_v1.ts
import { AuthProps, SessionLayout } from "config";
import { Functions, ApiResponse, ApiStreamEmitter } from "src/_sockets/apiTypes.generated";

// Rate limit: requests per minute (false = use global config)
export const rateLimit: number | false = 60;

// HTTP method (optional - inferred from name if not set)
// export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true, // Require authentication
  additional: [], // Extra requirements: 'admin', etc.
};

export interface ApiParams {
  data: {
    userId: string; // Input from client
  };
  user: SessionLayout;
  functions: Functions;
  stream: ApiStreamEmitter;
}

export const main = async ({
  data,
  user,
  functions,
}: ApiParams): Promise<ApiResponse> => {
  const userData = await functions.db.prisma.user.findUnique({
    where: { id: data.userId },
  });

  return {
    status: "success",
    // Optional per-response HTTP status (for network response)
    // httpStatus: 201,
    userData,
  };
};

// Error shape is strict:
// { status: 'error', errorCode: string, errorParams?: { key: string; value: string | number | boolean }[], httpStatus?: number }
// Message is resolved server-side from errorCode + errorParams using i18n.

// Success shape is strict too:
// Must include status: 'success' and may include any additional payload keys.
```

### 2. Use from client

```typescript
// Types are auto-generated - full autocomplete!
const result = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
});

if (result.status === "success") {
  console.log(result.userData); // Typed correctly
}
```

---

## HTTP API Access

APIs are accessible via HTTP for testing, webhooks, or non-socket clients.

### RESTful Routes

Examples:

- `GET /api/examples/getUserData/v1?userId=123`
- `POST /api/examples/createUser/v1`
- `PUT /api/settings/updateProfile/v1`
- `DELETE /api/examples/deleteUser/v1`

### Versioning Rules

- API filenames are required to end with `_v{number}.ts`.
- URLs are required to end with `/{version}`.
- Invalid unversioned API filenames do not get route templates injected.

### Method Inference

If `httpMethod` is not exported, it's inferred from the API name:

| Name Prefix                  | Inferred Method |
| ---------------------------- | --------------- |
| `get*`, `fetch*`, `list*`    | GET             |
| `delete*`, `remove*`         | DELETE          |
| `update*`, `edit*`, `patch*` | PUT             |
| Everything else              | POST            |

### Authentication

Include token via:

- **Cookie mode (`sessionBasedToken=false`)**: `token=your-token` (set automatically on login)
- **Session-token mode (`sessionBasedToken=true`)**: `Authorization: Bearer your-token`

For translated error responses over HTTP, send one of:

- `Accept-Language: en`
- `X-Language: en`

### Response Contract

- API handlers must return exactly one of:
  - success: `{ status: 'success', ...payload }`
  - error: `{ status: 'error', errorCode: string, errorParams?: [...], httpStatus?: number }`
- HTTP responses normalize errors to include localized `message` and final `httpStatus`.
- Generated output typing preserves direct literal return values in object properties (for example `submitted: true` and `submitted: false`) so branch-specific unions stay discriminated in TypeScript.

### Error Code Rules (Do Not Skip)

- `errorCode` is a translation key, not a human-readable sentence.
- Never pass raw exception text into `errorCode`.
- Use `errorParams` for dynamic details (for example `{ key: 'reason', value: 'timeout' }`).
- If you choose to include `errorMessage` for debugging, keep it optional and never use it as a replacement for `errorCode`.

Good:

```typescript
return {
  status: 'error',
  errorCode: 'timeregister_customer_fetch_failed',
  errorParams: [{ key: 'reason', value: 'timeout' }],
};
```

Bad:

```typescript
return {
  status: 'error',
  errorCode: error?.message ?? 'Request failed',
};
```

### Framework-emitted error codes

These error codes are emitted by framework code (not by individual handlers). Consumer code should add localized strings for them — fallback rendering is the raw key.

| Code | Where it fires | Notes |
| --- | --- | --- |
| `auth.required` | API/sync handlers when `auth.login: true` and the session is missing or invalid | Returned before validation runs (auth-before-validate ordering) so route existence and input shape are not leaked to unauthenticated callers. |
| `session.notFound` | Socket `joinRoom` / `leaveRoom` when no session is associated with the socket | Same idea as `auth.required` but for room ops that don't go through the API/sync pipeline. |
| `room.invalid` | Socket `joinRoom` / `leaveRoom` when the room name fails validation | Empty string, missing, or otherwise rejected by the room-name validator. |
| `room.joinBlocked` | `preRoomJoin` returned a stop signal without overriding `errorCode` | Handlers that want a custom code should set `signal.errorCode`. |
| `room.leaveBlocked` | `preRoomLeave` returned a stop signal without overriding `errorCode` | Same. |
| `offline.queueFull` | `enqueueApiRequest` / `enqueueSyncRequest` rejects under `dropPolicy: 'reject'` (configured via `ProjectConfig.offlineQueue.maxSize`) | Surfaces the rejection in the response envelope instead of silently swallowing the queued call. |
| `routing.invalidServiceRouteName` | `apiRequest` / `syncRequest` called with a non-`service/name` route literal | Generated route maps enforce service-first names; this catches hand-written calls that drift. |

---

## Abort Controller

GET-style APIs automatically use abort controllers to cancel in-flight requests.

```typescript
// These automatically cancel previous calls if called again:
await apiRequest({ name: 'examples/getUserData', version: 'v1', data: {...} });

// Explicit control:
await apiRequest({ name: 'examples/createUser', version: 'v1', data: {...}, abortable: true });  // Force
await apiRequest({ name: 'examples/getUser', version: 'v1', data: {...}, abortable: false });    // Disable
```

## Streaming

API streaming is available on both transports:

- Socket: `apiRequest({ onStream })`
- HTTP: Server-Sent Events (SSE) using `Accept: text/event-stream` or `?stream=true`

### Socket Streaming

Client usage:

```typescript
const response = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
  onStream: (stream) => {
    // stream is the payload you emit from stream(...)
    console.log(stream);
  },
});
```

Server usage in an API file:

```typescript
export const main = async ({ stream }: ApiParams): Promise<ApiResponse> => {
  stream({ phase: "started", progress: 0 });
  // long operation ...
  stream({ phase: "fetching", progress: 50 });
  // long operation ...
  stream({ phase: "done", progress: 100, done: true });

  return { status: "success" };
};
```

### HTTP Streaming (SSE)

```typescript
const response = await fetch("/api/examples/getUserData/v1?stream=true", {
  method: "GET",
  headers: { Accept: "text/event-stream" },
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (reader) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value, { stream: true });
  // SSE events are emitted as:
  // event: stream  -> partial payloads
  // event: final   -> final API response object
}
```

### Strict Stream Payload Typing (Generated)

Stream payload types are generated per route from your actual `stream(...)` calls in `main`.

- The generator infers a union of all emitted payload shapes.
- `apiRequest({ onStream })` receives this exact inferred type per route/version.
- If no `stream(...)` call exists yet, fallback is `never` (so `onStream` is not allowed for that route/version).

This matches how final return output typing is already generated from route return objects.

Repository note:

- The previous `/streaming` demo page and demo handlers were intentionally removed from source.

## Offline Request Queue

When the socket is disconnected or the browser is offline, `apiRequest` automatically queues requests in memory. The queue flushes on reconnect or when the browser comes back online. Aborted requests are removed from the queue.

## Rate Limiting

Configure globally in `config.ts`:

```typescript
rateLimiting: {
  store: 'memory',      // 'memory' (default) or 'redis' for multi-instance consistency
  redisKeyPrefix: 'rate-limit',
  defaultApiLimit: 60,   // Fallback requests/min per API when no per-API rateLimit is exported
  defaultIpLimit: 100,   // Global requests/min cap per IP across all APIs combined
  windowMs: 60000,       // Request window size in milliseconds
}
```

Or per-API:

```typescript
// In any _api/*.ts file
export const rateLimit = 30; // Override global
export const rateLimit = false; // Disable for this API
```

---

## Type Generation Pipeline (Timing-Aware)

In development, API typing updates follow this sequence:

1. File save
2. Template injection (if applicable, only for new empty files in `_api/`)
3. Hot reload trigger
4. Type-map regeneration
5. Typed helpers become accurate (`apiRequest`, route-name unions, input/output inference)

Regeneration is asynchronous. After a save, there can be a short lag (typically hundreds of milliseconds) before generated helper types fully reflect the latest file changes.

Generation is strict: unresolved API type symbols now fail type-map generation instead of falling back to `any` aliases in generated artifacts.

## Timing-Aware AI Workflow

Use a trust-first workflow for API edits:

1. First pass: implement using the intended typed API contract and trust the server payload shape.
2. Wait/re-check pass: after generation settles, re-open generated types and remove temporary casts/narrowing if no longer needed.

This avoids premature unsafe rewrites while the generator is still catching up.

Temporary exception note:

- If a short generator-lag window forces a cast, keep it local and minimal, then remove it once types refresh.

Good vs bad examples:

```typescript
// Bad: local unknown/any wrapper around typed helper
const apiLoose = (name: string, version: string, data: unknown) =>
  apiRequest({ name: name as any, version: version as any, data: data as any });

// Good: direct typed call with route/version literals
const result = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
});
```

AI self-check before finalizing changes:

- Did I rely on generated route/version types?
- Did I avoid adding new unsafe wrappers?
- If I used a temporary cast during generation lag, did I re-check and remove it after types refreshed?
- Did I avoid creating alternate API call signatures (for example local `any` wrappers) that can hide the typed `apiRequest` signature from static analyzers used in AI and CI?

Do not add `unsafe*` wrapper aliases around `apiRequest`. If runtime-dynamic tooling code needs localized assertions, keep them at the call site and avoid hiding helper signatures behind local wrapper types.

---

## Hook Reference

LuckyStack dispatches typed hooks at every key lifecycle stage so consumers can extend behavior without forking framework code. There are two registries:

- **Async hooks** — registered with `registerHook(name, handler)`. Handler may be `async` and may return a `HookStopSignal` (`{ stop: true, errorCode, httpStatus? }`) to short-circuit a `pre*` event. Failures inside one handler are isolated and surfaced via `getLogger()` + Sentry; they never affect the main flow. Dispatched via `dispatchHook(name, payload)` from `@luckystack/core`.
- **Sync hooks** — registered with `registerSyncHook(name, handler)`. Handler must be synchronous (no `async`). Cannot stop the flow. Used for hot-path mutators where `await` is too expensive (the error normalizer is synchronous and called from many code paths). Dispatched via `dispatchSyncHook(name, payload)`.

Both registries share `clearAllHooks()` for tests.

### Pipeline ordering

The hook dispatch order is fixed and identical for the socket and HTTP transports.

| Pipeline | Order |
| --- | --- |
| **API request** | `auth → rate-limit → method → preApiValidate → validate → postApiValidate → preApiExecute → main(...) → postApiExecute → preApiRespond → emit → postApiRespond` |
| **Sync request** | `auth → rate-limit → preApiValidate → validate → postApiValidate → preApiExecute → _server_v{n}.ts → postApiExecute → preSyncFanout → fanout → postSyncFanout` |

Auth runs before validation by design, so unauthenticated callers get a generic `auth.required` envelope before route existence or input shape can leak.

### Mutation pattern

`pre*Respond` / `pre*Normalize` hooks pass a payload object whose mutable field can be rewritten by the handler:

```ts
import { registerHook, registerSyncHook } from '@luckystack/core';

registerHook('preApiRespond', async ({ response, routeName, user }) => {
  // PII redaction example: mutate `response` in place
  if (!user?.admin && 'internalId' in response) {
    delete response.internalId;
  }
});

registerSyncHook('preErrorNormalize', ({ response }) => {
  if (response.status === 'error' && response.errorCode === 'auth.required') {
    response.errorCode = 'session.expired';
  }
});
```

Handlers do not return a new value — they mutate the shared payload object. The hook dispatcher reserves return values for stop signals.

### Hooks emitted by `@luckystack/api` and `@luckystack/sync`

| Hook | Stop? | Where it fires | Payload (key fields) |
| --- | --- | --- | --- |
| `preApiValidate` | yes | Before `validateInputByType` (socket + HTTP) | `routeName`, `data`, `user` |
| `postApiValidate` | no | After validation, success or failure | `routeName`, `data`, `user`, `validation` |
| `preApiExecute` | yes | Before the route's `main(...)` (socket + HTTP) | `routeName`, `data`, `user` |
| `postApiExecute` | no | After `main(...)` returns or throws | `routeName`, `data`, `user`, `result`, `error`, `durationMs` |
| `preApiRespond` | no (mutate `response`) | Right before the response is emitted | `routeName`, `user`, `response: ApiResponseEnvelope` |
| `postApiRespond` | no | After the response is emitted (read-only audit) | `routeName`, `user`, `response: ApiResponseEnvelope` |
| `apiError` | no | When `main(...)` throws | `route`, `method?`, `requestId?`, `user?`, `error` |
| `preSyncFanout` | yes | Before `_server_v{n}.ts` runs | `routeName`, `data`, `user`, `receiver`, `serverOutput` |
| `postSyncFanout` | no | After fanout completes | `routeName`, `data`, `user`, `receiver`, `serverOutput`, `recipientCount` |
| `syncError` | no | When `_server_v{n}.ts` throws | `route`, `method?`, `requestId?`, `user?`, `error` |
| `rateLimitExceeded` | no | When per-API or per-IP bucket rejects (socket + HTTP) | `scope`, `key`, `limit`, `windowMs`, `count`, `route?`, `ip?`, `userId?` |
| `corsRejected` | no | When `allowedOrigin()` rejects | `origin`, `normalizedOrigin`, `allowedOrigins`, `allowLocalhost`, `route?` |
| `csrfMismatch` | no | When the CSRF middleware rejects a write | `route`, `method?`, `requestId?`, `userId?`, `providedToken: boolean` (presence-only) |

### Sync hooks (`registerSyncHook` / `dispatchSyncHook`)

| Hook | Where it fires | Payload (mutable fields) |
| --- | --- | --- |
| `preErrorNormalize` | Inside `normalizeErrorResponse`, before localization | `response: ErrorResponseInput` (mutate to remap codes/messages) |
| `postErrorNormalize` | Inside `normalizeErrorResponse`, before returning | `normalized: NormalizedErrorResponse` (mutate to rewrite the final shape) |

### Hooks emitted by feature packages

These augment `HookPayloads` via TypeScript module augmentation from each package — install the package and the type appears on `HookName`. See per-package READMEs for payload field details.

| Hook | Source package | Notes |
| --- | --- | --- |
| `preLogin` / `postLogin`, `preRegister` / `postRegister`, `preLogout` / `postLogout`, `preSessionCreate` / `postSessionCreate`, `preSessionDelete` / `postSessionDelete` | `@luckystack/login` | Auth + session lifecycle. |
| `preSessionRefresh` / `postSessionRefresh` | `@luckystack/login` (payload type lives in `@luckystack/core`) | Fires on every authenticated `getSession` call (sliding TTL). `oldTtl` may be `-1` (no TTL) or `null` (TTL command failed). `applied: boolean` on the post payload reflects the actual Redis EXPIRE return. |
| `preEmailSend` / `postEmailSend` | `@luckystack/email` | Fires for every `sendEmail` call, including framework-mode password-reset emails. |
| `prePresenceUpdate` / `postPresenceUpdate` | `@luckystack/presence` | Fires when a peer goes AFK or comes back, around the `userAfk` / `userBack` socket emit. `recipientCount` on the post payload reflects how many peer sockets actually got the event. |
| `onSocketConnect` / `onSocketDisconnect`, `preRoomJoin` / `postRoomJoin`, `preRoomLeave` / `postRoomLeave`, `onLocationUpdate` | `@luckystack/server` | Socket lifecycle. |
| `onUploadStart` / `onUploadComplete` | `@luckystack/core` (dispatched by `processUpload`) | Generic upload hooks — payload includes `uploadKind` so future kinds (documents, attachments) reuse the same surface. Consumer upload routes call `processUpload({ userId, contentType, buffer, fileName, encodeAndSave, uploadKind? })` from `@luckystack/core`; the helper dispatches `onUploadStart` (stoppable), runs the consumer's `encodeAndSave` callback, then dispatches `onUploadComplete`. The `'avatar'` kind is the default. See [`src/settings/_api/updateUser_v1.ts`](../../src/settings/_api/updateUser_v1.ts) for the canonical avatar usage. |

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `packages/api/src/handleApiRequest.ts` | `default export` | Handles WebSocket API requests (`apiRequest`), validates auth / rate-limit, executes API module, emits response. |
| `packages/api/src/handleHttpApiRequest.ts` | `handleHttpApiRequest` | Handles HTTP API calls (`/api/...`) with shared auth / validation / error-normalization behavior, plus SSE streaming. |
| `packages/core/src/runtimeTypeValidation.ts` | `validateInputByType` | Validates request payloads against extracted runtime input types with path-level error messages. Lazy-imports `@luckystack/devkit` for deep alias resolution in dev. |
| `packages/devkit/src/runtimeTypeResolver.ts` | `resolveRuntimeTypeText` | Resolves local / imported / re-exported type aliases and expands utility wrappers (`Partial`, `Required`, `Pick`, `Omit`, `Record`) before validation. |
| `packages/core/src/localizedNormalizer.ts` | `createLocalizedNormalizer` / `registerLocalizedNormalizer` / `normalizeErrorResponse` | Framework factory + DI registry. Framework packages call `normalizeErrorResponse` / `extractLanguageFromHeader` from `@luckystack/core`; the project registers its translate-backed normalizer on boot. |
| `server/utils/responseNormalizer.ts` (this repo) | `registerLocalizedNormalizer` (side-effect) | Loads JSON locales, builds a translate function, registers the resulting normalizer with the framework. Imported for side effects at server boot. |
| `packages/core/src/rateLimiter.ts` | `checkRateLimit` | Applies configured rate-limit windows and limits. Backed by either in-memory or Redis store per `ProjectConfig.rateLimiting.store`. |
| `packages/core/src/csrf.ts` | `getCsrfToken`, `httpFetch` | Auto-attaches CSRF tokens to HTTP fallback calls; `apiRequest` does this for you. |
| `packages/core/src/apiRequest.ts` | `apiRequest` | Typed client request API with queueing, abort-controller support, and CSRF auto-attachment. Exported via `@luckystack/core/client`. |
