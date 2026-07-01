# Socket Architecture

> Socket.io-based real-time communication layer.

> **Where the code lives (post-package-split):** the Socket.io server is set up in `@luckystack/server` (`packages/server/src/loadSocket.ts`, `createServer.ts`). The Redis adapter is attached via `attachSocketRedisAdapter` from `@luckystack/core`. Client-side socket helpers (`socket`, `waitForSocket`, `setSocket`) are exported from `@luckystack/core/client`. Most code paths previously in `server/sockets/` now live in `packages/api/`, `packages/sync/`, and `packages/server/` respectively.

---

## Quick Reference

```typescript
// Client: Access socket instance
import { socket, waitForSocket } from "src/_sockets/socketInitializer";
import { socketEventNames } from "shared/socketEvents";

await waitForSocket(); // Ensure connected
socket.emit(socketEventNames.sync, data);
```

Socket event names and dynamic response event builders are centralized in `shared/socketEvents.ts` and reused by both server and client runtime modules.

---

## Bootstrap order

Full boot sequence executed by `createLuckyStackServer` from `@luckystack/server`:

1. `applyServerArgv()` — parses positional `<bundles> [port]`; writes `process.env.SERVER_PORT`.
2. `registerProjectConfig(...)` — installer overlay merged over defaults.
3. `verifyBootstrap()` — pre-flight check that ProjectConfig / DeployConfig / RuntimeMapsProvider are registered. Throws one descriptive error on miss.
4. `http.createServer(...)` with the HTTP request dispatcher (csrf -> health -> /_test/reset -> favicon -> uploads -> auth -> api -> sync -> custom routes -> static).
5. `new SocketIOServer(httpServer, ...)` instantiated; `setIoInstance(io)` writes it into the core DI slot.
6. `attachSocketRedisAdapter(io)` wires `@socket.io/redis-adapter` for multi-instance fanout (see Multi-Instance section below).
7. `applySocketMiddlewares(io)` runs every middleware registered via `registerSocketMiddleware(mw)` in registration order.
8. Connect handler registered: validates origin via `allowedOrigin`, resolves token via `extractTokenFromSocket`, calls `getSession(token)`, dispatches `onSocketConnect`, wires `apiRequest` / `sync` / `joinRoom` / `leaveRoom` handlers, and forwards disconnects to `@luckystack/presence`'s `socketDisconnecting` lifecycle.
9. `httpServer.listen(port, ip)` — resolved address recorded via `registerBindAddress`.

There is no monkey-patching path that bypasses this sequence. Every step is observable or extendable through a registry / hook listed in the sections below.

---

## Core Events

| Event                 | Direction        | Purpose                      |
| --------------------- | ---------------- | ---------------------------- |
| `apiRequest`          | Client → Server  | RPC-style API calls          |
| `apiResponse-{index}` | Server → Client  | API response by index        |
| `sync`                | Client → Server  | Sync event to broadcast      |
| `sync`                | Server → Clients | Broadcasted sync payloads    |
| `joinRoom`            | Client → Server  | Join a specific room         |
| `leaveRoom`           | Client → Server  | Leave a specific room        |
| `getJoinedRooms`      | Client → Server  | Get current room membership  |
| `updateLocation`      | Client → Server  | Track user's current page    |

---

## Room System

```typescript
// Server-side: socket joins room
socket.join(roomCode);

// Server-side: broadcast to room
io.to(roomCode).emit("sync", data);

// Client triggers room join
socket.emit("joinRoom", { roomCode: "game-123" });
```

Room codes are automatically extracted from URL paths:

- `/games/chess/room-abc` → room code = `room-abc`

---

## Token extraction at handshake

Two helpers in `@luckystack/core` resolve the session token from incoming connections:

```typescript
import { extractTokenFromSocket, extractTokenFromRequest } from '@luckystack/core';

extractTokenFromSocket(socket);    // -> string | null
extractTokenFromRequest(request);  // -> string | null
```

Both check the same sources in priority order:

| Source | Socket.io handshake | Node HTTP request |
|---|---|---|
| Cookie (name from `http.sessionCookieName`) | `socket.handshake.headers.cookie` | `request.headers.cookie` |
| Bearer / session-mode token | `socket.handshake.auth.token` | `Authorization: Bearer <token>` |

The framework calls these internally before `getSession(token)` in `handleApiRequest`, `handleSyncRequest`, `handleHttpApiRequest`, and `handleHttpSyncRequest`. Custom transports (queue worker, gRPC bridge, Lambda adapter) should reuse them rather than reading cookies or headers manually — that is the only way to stay consistent with the cookie-name registry and the `sessionBasedToken` mode toggle.

---

## CORS / Origin check

`allowedOrigin(origin)` from `@luckystack/core` enforces the project's CORS allow-list. It runs at two boot points:

- **Socket.io handshake** — rejects with `connect_error` before the connect handler fires.
- **HTTP request entry** — returns 403 before any route handler runs.

The check matches in order:

1. Same-origin (request origin equals server origin).
2. Explicit list in `projectConfig.http.cors.allowedOrigins` (`string[]` or predicate function).
3. `EXTERNAL_ORIGINS` env var (comma-separated, parsed once at boot).

State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) with **no** `Origin` and **no** `Referer` are rejected with 403 (closes the previous `host`-fallback bypass for non-browser clients). Read-only methods (`GET`, `HEAD`, `OPTIONS`) without either header are still allowed for legitimate server-to-server `curl`-style usage.

On rejection, `corsRejected` is dispatched as a **sync** hook with `{ origin, method, route }` — register a handler for audit logging:

```typescript
import { registerSyncHook } from '@luckystack/core';

registerSyncHook('corsRejected', ({ origin, method, route }) => {
  myAuditLog({ event: 'cors_rejected', origin, method, route });
});
```

---

## Socket middleware registry

For composable `io.use(...)` middleware (auth pre-check, telemetry, rate-limit at handshake, IP allow-list) without forking `loadSocket`:

```typescript
import { registerSocketMiddleware } from '@luckystack/core';

registerSocketMiddleware((socket, next) => {
  if (suspiciousIp(socket.handshake.address)) return next(new Error('blocked'));
  next();
});
```

Registered middleware runs **before** the framework's connect handler, in the order it was registered. Useful properties:

- **Idempotent**: re-registering the same function reference is a no-op.
- **Test-resettable**: `clearSocketMiddlewares()` drops every entry between scenarios.
- **Read-only introspection**: `getSocketMiddlewares()` returns a frozen list.

Wire-up happens automatically inside `createLuckyStackServer`'s bootstrap; you do NOT need to call `applySocketMiddlewares` from your overlay — it is reserved for the framework.

---

## Connection State

```typescript
import { useSocketStatus } from 'src/_providers/socketStatusProvider';

function ConnectionIndicator() {
  const { connected, reconnecting } = useSocketStatus();

  if (!connected && reconnecting) return <Spinner />;
  if (!connected) return <Offline />;
  return <Online />;
}
```

---

## Activity Broadcasting

When `config.socketActivityBroadcaster = true`:

```typescript
// Other users in same room can see status
const { socketStatus } = useSocketStatus();
// socketStatus['user-id'] = { status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' }
```

---

## Connection lifecycle hooks

Every connect / disconnect / room operation fans out through the hook bus. Register handlers via `registerHook(...)` from `@luckystack/core`:

| Hook | Payload | Fired when |
|---|---|---|
| `onSocketConnect` | `{ token, socket, userId? }` | Connect handler completes successfully (after origin check + token resolution + session lookup). |
| `onSocketDisconnect` | `{ token, reason }` | Socket disconnects for any reason (browser close, network drop, server kick, presence grace expiry). |
| `postSocketReconnect` | `{ token, userId, roomCodes }` | Reconnect lands **within** `@luckystack/presence`'s grace window. NOT fired for cold connects. |
| `preRoomJoin` | `{ token, roomCode }` | Just before the socket joins a room. Stop signal aborts the join. |
| `postRoomJoin` | `{ token, roomCode, peerCount }` | After the join completes and roommates have been notified. |
| `preRoomLeave` | `{ token, roomCode }` | Just before leaving a room. Stop signal aborts. |
| `postRoomLeave` | `{ token, roomCode, peerCount }` | After leave completes. |
| `onLocationUpdate` | `{ token, pathName, searchParams }` | Client emits `updateLocation` (route change). |

The `postSocketReconnect` distinction matters: cold connects fire only `onSocketConnect`; warm reconnects fire BOTH `onSocketConnect` AND `postSocketReconnect`. State-rehydration logic (refetch presence, replay missed events, rejoin rooms automatically) belongs in `postSocketReconnect` — putting it in `onSocketConnect` runs it on every cold boot too, which is usually wrong.

### Disconnect grace windows

Grace windows are owned by `@luckystack/presence`. Defaults (overrideable via `registerPresenceConfig(...)`):

| `disconnectReason` | Window | Rationale |
|---|---|---|
| `'transport close'` / `'transport error'` | `transportCloseMs` (60s) | Browser refresh, network blip, mobile suspend. |
| Intentional tab switch | `tabSwitchMs` (20s) | `intentionalDisconnect` socket event fired by the client before unload. |
| Other | `defaultMs` (2s) | Catch-all for ping timeout etc. (`'ping timeout'` is in `ignoreReasons` by default — no timer, no session delete). |

A disconnect inside the grace window does NOT delete the session. If the same token reconnects within the window, the framework treats it as a continuous session and fires `postSocketReconnect`. If the grace expires without reconnect, the session is deleted and `onSocketDisconnect` is dispatched as the final event.

---

## Configuration

```typescript
// config.ts
const config = {
  backendUrl: 'http://localhost:80',
  socketActivityBroadcaster: false,  // Enable presence tracking
  locationProviderEnabled: true,     // Enable route-to-session location syncing
};

// .env
SERVER_IP=127.0.0.1
SERVER_PORT=80
```

---

## Error Handling

```typescript
socket.on("connect_error", (error) => {
  console.error("Connection failed:", error);
});

socket.on("disconnect", (reason) => {
  if (reason === "io server disconnect") {
    // Server forced disconnect - try reconnect
    socket.connect();
  }
});
```

---

## Client-side socket + offline queue

The client-side socket is a module-level singleton exposed from `@luckystack/core/client`:

```typescript
import { socket, setSocket, waitForSocket } from '@luckystack/core/client';

await waitForSocket();
socket.emit('joinRoom', { roomCode });
```

`setSocket(io(...))` is called once at boot from `src/_sockets/socketInitializer.ts`. Framework client code reads through the `socket` proxy export so tests can swap the underlying client cleanly.

### Offline queue

When the socket is disconnected (`isOnline() === false`), `apiRequest` and `syncRequest` enqueue rather than throw. On the next successful connect the framework calls `flushApiQueue` and `flushSyncQueue` to replay queued items in order:

```typescript
import {
  isOnline,
  enqueueApiRequest, removeApiQueueItem, removeApiQueueItemsByKey, getApiQueueSize, flushApiQueue,
  enqueueSyncRequest, removeSyncQueueItem, getSyncQueueSize, flushSyncQueue,
} from '@luckystack/core/client';
```

Queue behavior is configured under `projectConfig.offlineQueue`:

| Key | Default | Effect |
|---|---|---|
| `maxSize` | `100` | Cap on queued items per kind (API + Sync counted separately). |
| `maxAgeMs` | `5 * 60_000` | Items older than this are dropped on flush rather than replayed. |
| `dropPolicy` | `'reject'` | `'reject'` — overflow returns `offline.queueFull`. `'drop-oldest'` — evict the tail to make room. `'drop-newest'` — evict the incoming item. |

Per-request override: `syncRequest({ ..., offlineDropPolicy: 'drop-oldest' })`.

### Visibility-based reconnect

When the browser tab regains focus (`document.visibilitychange`), the client probes the socket and forces a reconnect if the connection had dropped silently while the tab was hidden. This catches mobile suspend / laptop sleep scenarios that don't surface a normal `disconnect` event. The probe is idempotent — visible tabs with a healthy socket no-op.

---

## Multi-Instance / Cross-Server Broadcasting

When you run more than one backend instance behind a load balancer (including the built-in `@luckystack/router`), a room broadcast fired from instance A must still reach clients connected to instance B. Socket.io solves this with an adapter.

LuckyStack attaches `@socket.io/redis-adapter` automatically on every backend via `attachSocketRedisAdapter(io)` in `@luckystack/server`'s `loadSocket` (`packages/server/src/loadSocket.ts`). The adapter:

- Reuses the `redis` handle from `@luckystack/core` (no extra config).
- Creates two `redis.duplicate()` connections — one for publish, one for subscribe. A subscribe-mode Redis connection cannot issue other commands, so duplicating is required.
- Works identically in single-instance deploys (the pub/sub channel has no peers) and in multi-instance deploys (all backends sharing the same Redis exchange room events).

Without this adapter, `io.to(roomCode).emit('sync', ...)` only reaches sockets connected to the same process — a silent failure mode when scaling horizontally. It's on by default; do not remove it.

The router's WebSocket proxy routes socket.io upgrades to the `system` service by convention. Because the adapter fans broadcasts out across instances, a client doesn't need to be on the "right" service's socket.io — any instance sharing the Redis will receive and re-emit room events.

> **How sync reaches across instances.** Two mechanisms ride on the adapter: the streaming emitters (`broadcastStream` / `streamTo`) use `io.to(room).emit(...)`; the **regular `syncRequest` fan-out** uses `io.in(room).fetchSockets()` to enumerate the room's members on **all** instances and then delivers per-recipient (preserving per-recipient `_client` payloads) via `RemoteSocket.emit()`. Both reach every instance sharing the Redis. Full model, costs + pitfalls table: **`docs/ARCHITECTURE_MULTI_INSTANCE.md`**.

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `shared/socketEvents.ts` | `socketEventNames` + builders | Canonical socket event names and indexed response/progress event helpers shared across client/server. |
| `packages/server/src/loadSocket.ts` | `loadSocket` | Initializes Socket.io server, registers all socket event handlers (incl. rejoining `session.roomCodes` on (re)connect). |
| `packages/core/src/socketRedisAdapter.ts` | `attachSocketRedisAdapter` | Wires `@socket.io/redis-adapter` onto the Socket.io server so room fanout works across instances. |
| `packages/core/src/socketState.ts` | `setIoInstance` / `getIoInstance` | Module-level slot for the running Socket.io server; framework code broadcasts via this. |
| `packages/core/src/socketMiddleware.ts` | `registerSocketMiddleware` / `getSocketMiddlewares` / `clearSocketMiddlewares` / `applySocketMiddlewares` | Composable `io.use(...)` registry. `applySocketMiddlewares` is framework-internal. |
| `packages/core/src/extractToken.ts` | `extractTokenFromSocket` | Resolve session token from a Socket.io handshake (cookie + `auth.token`). |
| `packages/core/src/extractTokenFromRequest.ts` | `extractTokenFromRequest` | Resolve session token from a Node `IncomingMessage` (cookie + `Authorization: Bearer`). |
| `packages/core/src/checkOrigin.ts` | `allowedOrigin` | Same-origin + allow-list CORS check; dispatches `corsRejected` sync hook on miss. |
| `packages/core/src/offlineQueue.ts` | `isOnline` / `enqueueApiRequest` / `enqueueSyncRequest` / `flushApiQueue` / `flushSyncQueue` / `getApiQueueSize` / `getSyncQueueSize` | Client-side offline queue with configurable drop policy + per-item TTL. |
| `packages/core/src/socketTypes.ts` | `socket` / `setSocket` / `waitForSocket` / `incrementResponseIndex` | Client-side socket singleton + response-index counter (exposed via `@luckystack/core/client`). |
| `src/_sockets/socketInitializer.ts` | `useSocket` | Initializes client socket, listeners, queue flushing, visibility reconnection behavior. |
| `src/_sockets/socketInitializer.ts` | `joinRoom` / `leaveRoom` / `getJoinedRooms` | Client room management helpers. |
| `packages/api/src/handleApiRequest.ts` | `default export` | Handles incoming `apiRequest` socket messages. |
| `packages/sync/src/handleSyncRequest.ts` | `default export` | Handles incoming `sync` socket messages and room fanout. |
| `packages/presence/src/socketConnected.ts` | `socketConnected` | Reconnect handling — clears disconnect timer, fires `postSocketReconnect`, notifies roommates. |
| `packages/presence/src/socketDisconnecting.ts` | `socketDisconnecting` | Disconnect lifecycle — opens grace timer per reason; on expiry deletes session. |
| `packages/router/src/wsProxy.ts` | `createWsProxy` | Router-side WebSocket upgrade forwarder. Routes `/socket.io/` upgrades to the `system` service's backend. |
