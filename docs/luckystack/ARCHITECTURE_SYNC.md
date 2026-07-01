# Sync Architecture

<!-- @covers packages/sync/src -->

> Real-time event broadcasting between clients using rooms.

> **Where the code lives (post-package-split):** the runtime described below is in `@luckystack/sync` (`packages/sync/src/handleSyncRequest.ts`, `handleHttpSyncRequest.ts`, `streamThrottle.ts`). Client-side helpers (`syncRequest`, `upsertSyncEventCallback`, `useSyncEvents`) live at `@luckystack/sync/client`. See [`packages/sync/README.md`](../packages/sync/README.md) for the public API surface.

---

## Quick Reference

```typescript
// Client A sends sync event
const response = await syncRequest({
  name: "examples/updateCounter",
  version: "v1",
  data: { amount: 5 },
  receiver: "game-room-123",
  onStream: (stream) => {
    // Requester progress emitted from _server_v{n}.ts
    console.log(stream);
  },
});

if (response.status === "error") {
  console.error(response.errorCode, response.message);
}

// Client B receives (via callback)
const { upsertSyncEventCallback } = useSyncEvents();
upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ clientOutput, serverOutput }) => {
    console.log("Counter updated:", serverOutput.newValue);
  },
});

// Nested page sync
await syncRequest({
  name: "test/nestedTest/room",
  version: "v1",
  data: { step: 1, active: true },
  receiver: "game-room-123",
});

// Invalid shape (missing service segment) fails with routing.invalidServiceRouteName
// await syncRequest({ name: "updateCounter", version: "v1", receiver: "game-room-123" });
```

Naming contract:

- `syncRequest` and sync event callback registrations require service-first names (`service/name`).
- Invalid names are rejected with `routing.invalidServiceRouteName`.

---

## File Structure

```
src/
├── {page}/_sync/
│   ├── {syncName}_server_v1.ts    # Optional: runs once on server
│   ├── {syncName}_client_v1.ts    # Optional: runs once per target client
│   └── ...
Versioned naming is required when a file exists:

- `{syncName}_server_v1.ts`
- `{syncName}_client_v1.ts`

At least one of these files must exist for a sync route.

└── _sockets/
    ├── syncRequest.ts          # Client-side sync caller
    └── apiTypes.generated.ts   # Auto-generated types
```

---

## Creating a Sync Event

### 1. Server handler (optional)

```typescript
// src/examples/_sync/updateCounter_server_v1.ts
import { AuthProps, SessionLayout } from "../../../config";
import {
  Functions,
  SyncServerResponse,
  SyncServerStreamEmitter,
} from "../../../src/_sockets/apiTypes.generated";

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface SyncParams {
  clientInput: {
    // Define the data shape sent from the client e.g.
    amount: number;
  };
  user: SessionLayout; // session data of the user who called the sync event
  functions: Functions; // functions object
  roomCode: string; // room code
  stream: SyncServerStreamEmitter;
}

export const main = async ({
  clientInput,
  user,
  functions,
  roomCode,
}: SyncParams): Promise<SyncServerResponse> => {
  // THIS FILE RUNS JUST ONCE ON THE SERVER

  // Please validate clientInput here and dont just send the data back to the other clients
  // optional: database action or something else

  return {
    status: "success",
    newValue: clientInput.amount + 1,
    // Add any data you want to broadcast to clients
  };
};
```

### 2. Client handler (optional, only when needed)

```typescript
import {
  Functions,
  SyncClientResponse,
  SyncClientInput,
  SyncServerOutput,
  SyncClientStreamEmitter,
} from "../../../src/_sockets/apiTypes.generated";

// Types are imported from the generated file based on the _server_v{n}.ts definition
type PagePath = "examples";
type SyncName = "updateCounter";
export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;

  serverOutput: SyncServerOutput<PagePath, SyncName>;
  // Note: No serverOutput in client-only syncs (no _server_v{n}.ts file)
  token: string | null; // target client token (fetch session only when needed)
  functions: Functions; // contains functions available from server/functions
  roomCode: string; // room code
  stream: SyncClientStreamEmitter;
}

export const main = async ({
  token,
  clientInput,
  serverOutput,
  functions,
  roomCode,
}: SyncParams): Promise<SyncClientResponse> => {
  // CLIENT FILTER/RULE STAGE: runs on server for each target client in the room
  const targetUser = token ? await functions.session.getSession(token) : null;

  // Example: Only allow users on set page to receive the event
  // if (targetUser?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: "success",
    // Add any additional data to pass to the client
  };
};
```

If your `_client_v{n}.ts` only returns `{ status: 'success' }` and does no filtering or payload changes, remove the file. Keeping a no-op client sync file adds unnecessary per-client execution overhead.

Client sync handlers no longer receive `user` automatically. This avoids a Redis session lookup for every target socket. When you need target session data, call `functions.session.getSession(token)` inside `_client_v{n}.ts`.

## Client File Decision Rule (AI + Performance)

Default behavior: create only `_server_v{n}.ts`.

Create `_client_v{n}.ts` only if you need one of these:

- Per-target-client filtering (for example skip users not on a specific page)
- Per-target-client authorization or rejection
- Per-target-client output transformation (custom `clientOutput`)

Do not create `_client_v{n}.ts` for pass-through syncs. Without `_client_v{n}.ts`, the framework still broadcasts successfully with `serverOutput` and an empty `clientOutput`.

## Receiving Sync Events

```typescript
import { useSyncEvents } from "src/_sockets/syncRequest";

const { upsertSyncEventCallback } = useSyncEvents();

useEffect(() => {
  return upsertSyncEventCallback({
    name: "examples/updateCounter",
    version: "v1",
    callback: ({ clientOutput, serverOutput }) => {
      // clientOutput = result from _client_v{n}.ts
      // serverOutput = result from _server_v{n}.ts
      updateUI(serverOutput.newValue);
    },
  });
}, [upsertSyncEventCallback]);

// Register callback for a nested page sync
upsertSyncEventCallback({
  name: "test/nestedTest/room",
  version: "v1",
  callback: ({ serverOutput }) => {
    updateUI(serverOutput.step);
  },
});
```

## Sync Error Contract

- When returning an error from `_server.ts` or `_client.ts`, `errorCode` must be a stable i18n key.
- Do not return human text in `errorCode`.
- Use `errorParams` for dynamic context.
- Optional `message` or `errorMessage` values may be useful for debugging, but UI notifications should rely on translated `errorCode` keys.

Good:

```typescript
return {
  status: 'error',
  errorCode: 'sync.invalidRequest',
};
```

Bad:

```typescript
return {
  status: 'error',
  errorCode: 'Missing date value or invalid date',
};
```

Stream events for recipients can be registered with the same hook:

```typescript
const { upsertSyncEventStreamCallback } = useSyncEvents();

useEffect(() => {
  return upsertSyncEventStreamCallback({
    name: "examples/updateCounter",
    version: "v1",
    callback: ({ stream }) => {
      // stream is emitted by _client_v{n}.ts via stream(...)
      console.log(stream);
    },
  });
}, [upsertSyncEventStreamCallback]);
```

## Streaming

Sync exposes four streaming primitives, each picking a different audience and cost profile. The `_server_v{n}.ts` handler receives all of them in its params object; pick the one whose audience matches your use case.

### The four primitives

| Primitive | Audience | Cost | Use when |
| --- | --- | --- | --- |
| `stream(payload)` | Originator only | Cheapest — single unicast emit | Per-user progress (uploads, query progress, "AI thinking" indicators only the asker sees) |
| `broadcastStream(payload)` | Everyone in `roomCode` | Fan-out across the room | Live AI chat tokens, collaborative editor diffs, anything every viewer should see in real time |
| `streamTo(tokens, payload)` | Specific session tokens only | Targeted fan-out | Selective subscribers (admin viewers, "active reader" markers, low-priority audit logs) |
| `_client_v{n}.ts` stream | Per-recipient (after `_server` finishes) | One run per recipient | Per-target customization (filtering, translating, branding the payload differently per receiver) |

`broadcastStream` always emits via `io.to(roomCode).emit(...)`, which the Redis adapter fans out to every instance sharing the room. It deliberately does NOT inspect the local room size — a per-process "solo" view would miss members connected to other instances.

`streamTo` targets recipients by their session token. Every authenticated socket joins a room named after its own token at connect time, so emitting to a token-room reaches every device/tab signed in as that user.

### Wire format and listeners

- `stream(...)` payloads travel over `buildSyncProgressEventName(responseIndex)` — only the originator's socket listens. Consumed via `syncRequest({ onStream })`.
- `broadcastStream(...)`, `streamTo(...)`, and `_client_v{n}.ts` `stream(...)` all use the same `socketEventNames.sync` envelope with `status: 'stream'`. Recipients consume them indistinguishably via `upsertSyncEventCallback({ callback: ({ stream }) => ... })`.

### Generated types

- `_server_v{n}.ts` emitted payloads (any of `stream`, `broadcastStream`, `streamTo`) generate the `serverStream` route type.
- `_client_v{n}.ts` emitted payloads generate the `clientStream` route type.
- `syncRequest({ onStream })` is typed against `serverStream`.
- `upsertSyncEventCallback` stream payloads are typed against the union of `serverStream` (when emitted via `broadcastStream` / `streamTo`) and `clientStream`.
- A stage that never calls a stream helper falls back to `never` — calling the consumer side won't typecheck.

### Decision tree

```
Does only the originator need to see chunks live?
  → use `stream(payload)`            (cheapest)

Does every viewer in the room need to see chunks live?
  → use `broadcastStream(payload)`   (room fan-out across all instances)

Do only specific subscribers need to see chunks?
  → use `streamTo(tokens, payload)`  (targeted)

Do recipients need different per-target chunks?
  → use `_client_v{n}.ts` `stream`   (one run per recipient, after `_server`)
```

### Performance notes

- The route author's choice of helper is the performance gate. Don't pay broadcast cost for per-user progress, and don't try to "save" bandwidth by streaming-via-`stream`-only when every viewer is going to receive the final result anyway (total bytes are roughly equal — broadcast just spreads them across time instead of one big message at the end).
- For high-frequency streams (LLM token streams), use `createStreamThrottle({ flushEveryMs: 50, flushAtChars: 32 })` to coalesce small pieces. Cuts message count by 10-100× with no perceptible latency hit. See [Stream throttling](#stream-throttling) below.
- Recipients without a registered `upsertSyncEventCallback` for the route never run any handler code — Socket.io still routes the message to their client, but the framework's dispatcher drops it after a hashmap lookup. Negligible cost.

### Examples

**Originator-only progress (cheapest):**

```typescript
// _server_v1.ts
export const main = async ({ clientInput, stream }: SyncParams): Promise<SyncServerResponse> => {
  stream({ phase: "validate", progress: 10 });
  // long operation ...
  stream({ phase: "persist", progress: 70 });

  return { status: "success", updated: true };
};
```

**AI chat — every viewer in the room sees tokens live:**

```typescript
// src/chat/_sync/sendMessage_server_v1.ts
import { createStreamThrottle } from '@luckystack/sync';

export const main = async ({ clientInput, broadcastStream }: SyncParams): Promise<SyncServerResponse> => {
  const throttle = createStreamThrottle({ flushEveryMs: 50, flushAtChars: 32 });
  const aiStream = await callOpenAI(clientInput.prompt);

  let full = "";
  for await (const chunk of aiStream) {
    full += chunk.text;
    throttle.push(chunk.text, broadcastStream);
  }
  throttle.flush(broadcastStream);

  return { status: "success", message: full };
};
```

```typescript
// any page in any tab in the room
upsertSyncEventCallback({
  name: "chat/sendMessage",
  version: "v1",
  callback: ({ stream, status }) => {
    if (status === "stream" && stream?.chunk) {
      appendToken(stream.chunk);
    }
    if (status === "success") {
      finalizeMessage();
    }
  },
});
```

**Selective fanout — only admins see audit chunks:**

```typescript
// _server_v1.ts
export const main = async ({ functions, streamTo }: SyncParams): Promise<SyncServerResponse> => {
  const adminTokens = await functions.user.getOnlineAdminTokens();

  for (const event of auditEvents) {
    streamTo(adminTokens, { audit: event });
  }

  return { status: "success" };
};
```

**Per-recipient customization (still useful, runs after `_server`):**

```typescript
// _client_v1.ts
export const main = async ({ stream, token }: SyncParams): Promise<SyncClientResponse> => {
  stream({ phase: "prepare", progress: 20 });
  // receiver-specific work ...
  stream({ phase: "ready", progress: 100, done: true });

  return { status: "success" };
};
```

### Stream throttling

LLM providers stream tokens in 3-10 character pieces. Without coalescing, a 1000-token response means 1000 socket messages. `createStreamThrottle` buffers small pieces and flushes either at a character threshold or on a timer:

```typescript
import { createStreamThrottle } from '@luckystack/sync';

const throttle = createStreamThrottle({
  flushAtChars: 32,    // flush when buffered text crosses 32 chars
  flushEveryMs: 50,    // OR after 50ms (whichever first)
  field: 'chunk',      // payload field name (default 'chunk')
});

// In your stream loop:
for await (const piece of aiStream) {
  throttle.push(piece.text, broadcastStream);  // works with any of the three emit helpers
}
throttle.flush(broadcastStream);  // drain the buffer at the end
```

The same throttle works with `stream`, `broadcastStream`, or `streamTo` — the second argument to `push` / `flush` is whichever emit callback you're using. Pass `flushEveryMs: false` to disable the timer (only flush at the char threshold or on explicit `flush()`).

Repository note:

- The previous `/streaming` demo page and demo sync handlers were intentionally removed from source. The streaming primitives (`stream` / `streamTo` / `broadcastStream` / `_client`), `createStreamThrottle`, and SSE are documented in the [Streaming](#streaming) section above.

## Offline Request Queue

When the socket is disconnected or the browser is offline, `syncRequest` queues requests in memory and flushes on reconnect or when the browser comes back online.

## syncRequest Return Contract

`syncRequest` resolves to a typed response object:

- Success: `{ status: 'success', message: string, result: serverOutput }`
- Error: `{ status: 'error', message: string, errorCode: string, errorParams?, httpStatus? }`

`result` is typed from the generated sync map for the selected route/version.

This allows the caller to handle validation/network/runtime errors consistently with API-style error contracts while keeping sync delivery asynchronous.

---

### Room-specific sync

```typescript
// Only users in 'game-room-123' receive this
await syncRequest({
  name: "chess/moveChessPiece",
  version: "v1",
  data: { from: "e2", to: "e4" },
  receiver: "game-room-123",
});
```

## HTTP Sync Endpoint

Sync can be triggered through HTTP:

- `POST /sync/{page}/{syncName}/{version}`

Body:

```json
{
  "data": { "some": "payload" },
  "receiver": "room-code",
  "ignoreSelf": false
}
```

Note: HTTP is only the trigger. Actual delivery still happens via Socket.io to users in the target room.

HTTP requester streaming is available via SSE:

- Add `Accept: text/event-stream` header, or
- Add `?stream=true` query parameter

SSE events:

- `event: stream` for `_server_v{n}.ts` progress payloads
- `event: final` for final HTTP sync response

Example:

```typescript
const response = await fetch("/sync/examples/updateCounter/v1?stream=true", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  },
  body: JSON.stringify({
    data: { amount: 1 },
    receiver: "game-room-123",
    ignoreSelf: false,
  }),
});

// Parse SSE chunks from response.body
```

HTTP sync requests are rate-limited using global `config.rateLimiting` settings:

```typescript
rateLimiting: {
  defaultApiLimit: 60, // fallback per-sync-route limit
  defaultIpLimit: 100, // global per-IP cap across all sync routes
  windowMs: 60000,
}
```

When exceeded, handlers return `sync.rateLimitExceeded` with `seconds` in `errorParams`.

---

---

## Type System

| Property       | Source                         | Description              |
| -------------- | ------------------------------ | ------------------------ |
| `clientInput`  | `data` param in syncRequest    | What client sends        |
| `serverOutput` | `_server_v{n}.ts` return            | Server processing result |
| `clientOutput` | `_client_v{n}.ts` clientMain return | Client processing result (or `{}` when no `_client_v{n}.ts`) |

Generated sync output typing preserves direct literal return values in object properties (for example `allowed: true` vs `allowed: false`) so TypeScript can narrow branch-specific shapes safely.

### Error Contract

- Sync errors should return `status: 'error'` with an `errorCode` (and optional `errorParams` / `httpStatus`).
- Server resolves the final `message` through i18n using `errorCode` + `errorParams`.
- Avoid hardcoded human-readable error messages in server sync handlers.

---

## Type Generation Pipeline (Timing-Aware)

In development, sync typing updates follow this sequence:

1. File save
2. Template injection (if applicable, only for new empty files in `_sync/`)
3. Hot reload trigger
4. Type-map regeneration
5. Typed helpers become accurate (`syncRequest`, callback payload inference for `serverOutput`/`clientOutput`)

Regeneration is asynchronous. After a save, there can be a short lag (typically hundreds of milliseconds) before generated helper types fully reflect the latest sync file state.

Generation is strict: unresolved sync type symbols now fail type-map generation instead of falling back to `any` aliases in generated artifacts.

For stable AI and CI inference, keep sync calls on the canonical typed helper signature and avoid local `any` wrappers or alternate loose signatures around `syncRequest` and callback payloads.

Do not add `unsafe*` wrapper aliases around `syncRequest` or `upsertSyncEventCallback`. If runtime-dynamic tooling code needs localized assertions, keep them at the call site and do not hide helper signatures behind wrapper types.

## Timing-Aware AI Workflow

Use a trust-first workflow for sync edits:

1. First pass: implement using the intended typed sync contract and trust server/client payload shapes.
2. Wait/re-check pass: after generation settles, re-open generated types and remove temporary casts/narrowing if no longer needed.

This avoids premature unsafe rewrites while the generator is still catching up.

Temporary exception note:

- If a short generator-lag window forces a cast, keep it local and minimal, then remove it once types refresh.

Good vs bad examples:

```typescript
// Bad: local wrapper erases sync route typing and callback payload inference
const onSyncLoose = (name: string, cb: (payload: any) => void) =>
  upsertSyncEventCallback({ name: name as any, version: "v1" as any, callback: cb as any });

// Good: direct typed callback payload usage
upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ serverOutput, clientOutput }) => {
    console.log(serverOutput, clientOutput);
  },
});
```

AI self-check before finalizing changes:

- Did I rely on generated route/version types?
- Did I avoid adding new unsafe wrappers?
- If I used a temporary cast during generation lag, did I re-check and remove it after types refreshed?

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `server/sockets/handleSyncRequest.ts` | `default export` | Handles socket sync requests (`sync` event), auth checks, executes `_server/_client`, emits responses. |
| `server/sockets/handleHttpSyncRequest.ts` | `default export` | HTTP-triggered sync entrypoint (`POST /sync/...`) that still delivers via Socket.io. |
| `server/utils/runtimeTypeValidation.ts` | `validateInputByType` | Validates sync `clientInput` payloads against extracted runtime types and returns path-first diagnostics. |
| `server/utils/runtimeTypeResolver.ts` | `resolveRuntimeTypeText` | Resolves local/imported/re-exported input type aliases and supported utility wrappers before sync validation. |
| `packages/server/src/loadSocket.ts` | `socket.on('sync', ...)` | Wires incoming sync events to the sync handler. |
| `src/_sockets/syncRequest.ts` | `syncRequest` | Typed client sender for sync events. |
| `src/_sockets/syncRequest.ts` | `useSyncEvents().upsertSyncEventCallback` | Typed callback registry for incoming sync events. |
| `src/_sockets/syncRequest.ts` | `useSyncEvents().upsertSyncEventStreamCallback` | Callback registry for route-level stream updates emitted during sync execution. |
