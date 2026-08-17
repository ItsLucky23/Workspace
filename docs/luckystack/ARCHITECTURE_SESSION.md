# Session Architecture

> Session management with a Redis default adapter, pluggable storage, and OAuth provider support.

> **Where the code lives (post-package-split):** sessions are managed by `@luckystack/login` (`packages/login/src/session.ts`). Import session helpers from the package: `import { saveSession, getSession, deleteSession, getAllSessions, revokeUserSessions } from '@luckystack/login';`. The legacy `server/functions/session` path no longer exists.

---

## Quick Reference

```typescript
// Client: Get current session
const session = await apiRequest({ name: "system/session", version: "v1" });
// Returns: { id, email, name, provider, ... } or null

// Client: Logout
await apiRequest({ name: "system/logout", version: "v1" });
```

---

## Session Storage

Session storage is owned by `@luckystack/login`'s active `SessionAdapter`. The default is `redisSessionAdapter`; consumers can register a DynamoDB, Postgres, signed-JWT-stateless, or test adapter before the first login request.

The adapter receives the raw session value plus storage operations for TTL and active-token tracking. Framework behavior such as CSRF minting, lifecycle hooks, socket broadcasts, and single-session enforcement remains in `@luckystack/login` rather than in the adapter.

For the default Redis adapter, the layout is:

```
Redis key: {projectName}-session:{token}
Active-users key: {projectName}-activeUsers:{userId}
Value: JSON-encoded SessionLayout without the token
Expiry: ProjectConfig.session.expiryDays (default: 7 days)
```

The `{projectName}` prefix is resolved at call time by `getProjectName()` from `@luckystack/core`:

```ts
import { getProjectName } from '@luckystack/core';

getProjectName();
// 1. ProjectConfig.session.projectName if a consumer set it explicitly
// 2. process.env.PROJECT_NAME (read at call time — works after dotenv)
// 3. literal 'luckystack' as the absolute fallback
```

Override it in `registerProjectConfig({ session: { projectName: 'my-app' } })` to share a Redis instance across multiple LuckyStack apps without key collisions. Reach for `getProjectName()` from any framework or project code that needs the prefix string instead of duplicating the env-read pattern.

The default Redis key shape is centralized in `packages/login/src/session.ts` via two helpers:

```ts
import { sessionKeyFor, activeUsersKeyFor } from '@luckystack/login';

const sessionKey = sessionKeyFor(token);          // -> '{projectName}-session:{token}'
const activeKey = activeUsersKeyFor(userId);      // -> '{projectName}-activeUsers:{userId}'
```

Use these helpers only when integrating with the default Redis adapter. A custom adapter owns its own key/table/token representation.

Sliding behavior:
- Session TTL is refreshed on successful authenticated session reads.
- In cookie mode, `Set-Cookie` with matching `Max-Age` is reissued on valid requests.
- Result: active users stay logged in, idle users expire after `session.expiryDays`.

### Session-refresh hooks

`getSession` dispatches `preSessionRefresh` before extending the TTL and `postSessionRefresh` after. Both are async hooks — consumers register via `registerHook(...)` from `@luckystack/core`:

```ts
import { registerHook } from '@luckystack/core';

registerHook('postSessionRefresh', async ({ token, userId, oldTtl, newTtl, applied }) => {
  if (!applied) return;                  // the adapter could not refresh the record
  if (oldTtl != null && oldTtl < 60) {
    // user is on the verge of expiring — log for analytics
  }
});
```

`oldTtl` is adapter-provided and may be `null` when the backend cannot report it. `applied: boolean` on the post payload reflects whether the adapter refreshed an existing record.

---

## SessionLayout

The session shape is project-defined and is checked against the shared `BaseSessionLayout` contract from `@luckystack/core`. Extend it with the fields your UI and authorization rules need; server-side session types normally make `token` required, while client-facing types should omit server-only credential fields.

```typescript
import type { BaseSessionLayout } from '@luckystack/core';

export interface SessionLayout extends BaseSessionLayout {
  token: string;
  theme?: 'light' | 'dark';
}
```

Values crossing the wire are JSON: for example, a `Date` becomes an ISO string. Do not type client-side session fields as server-side `Date` values unless the client explicitly parses them.

---

## Configuration

```typescript
// config.ts
const config = {
  sessionBasedToken: false, // false = HttpOnly cookie; true = tab-scoped sessionStorage bearer
  sessionExpiryDays: 7,
  sessionPerUser: 'single', // a new login revokes older sessions
  loginRedirectUrl: '/examples',
};

// During boot, config.ts maps these public fields into registerProjectConfig:
// session: { basedToken, expiryDays, perUser, ... }
```

---

## Session Flow

```
1. User logs in (OAuth or credentials)
   ↓
2. Server generates a cryptographically random 64-character hex token
   ↓
3. Session stored through the active `SessionAdapter`
   ↓
4. Token sent to client:
   - Cookie-based: Set-Cookie: token={token}; HttpOnly
   - SessionStorage bearer: credentials return `X-Session-Token`; OAuth redirects with `?token=` for one-time client consumption
   ↓
5. Subsequent requests include token:
   - Cookie mode: browser-attached session cookie
   - SessionStorage mode: `socket.handshake.auth.token` or `Authorization: Bearer {token}`
```

---

## Token Modes

Consumers set top-level `config.sessionBasedToken`; `config.ts` maps it to `session.basedToken` in `registerProjectConfig(...)`:

| Mode              | Storage         | Best For                   |
| ----------------- | --------------- | -------------------------- |
| `false` (default) | HttpOnly cookie | Web apps, security-focused |
| `true`            | sessionStorage  | Developing                 |

Notes:
- In cookie mode, token extraction ignores bearer/handshake tokens by default; `http.acceptBearerInCookieMode=true` is the explicit compatibility opt-in.
- In sessionStorage mode, extraction prefers bearer/handshake auth and retains a cookie fallback for compatibility, although framework auth flows do not set a token cookie in this mode.
- With `session.basedToken=true`, credentials login returns `X-Session-Token` and OAuth redirects with `?token=`.
- With `session.basedToken=false`, auth flows use HttpOnly cookie delivery plus CSRF protection.

### Token-exposure contract (which side sees the raw token) — ADR 0018

The raw session token reaches **page JS only in `session.basedToken` mode**, where the client deliberately holds it in `sessionStorage` (and the socket handshake reads it from there). In the default **cookie mode the token is the `HttpOnly` credential and must never reach page JS** — surfacing it there would defeat `HttpOnly` and hand an XSS foothold a stealable credential. This is why:

- The session value passed to the adapter never contains the token; the adapter receives the token separately as its storage key/input (LOGIN-M9 strips it from the serialized value).
- `saveSession`'s `updateSession` broadcast sends the token only in `session.basedToken` mode; in cookie mode it broadcasts the token-stripped projection.
- A security scan that flags "the token reaches page JS" is only correct for **cookie mode**; in `session.basedToken` mode it is by design. See `docs/decisions/0018-*.md`.
- **Known follow-up (ADR 0018):** the `system/session` (`session_v1`) initial-load response still returns the token in cookie mode; fully closing it needs the client session type to stop requiring `token`.

---

## Session Functions

### Server-side

```typescript
import {
  getSession,
  saveSession,
  deleteSession,
  revokeUserSessions,
} from "@luckystack/login";

// Get session from token
const user = await getSession(token);

// Create/update session
await saveSession(token, sessionData, true);

// Delete session (logout)
await deleteSession(token);

// Force-logout every active session for a user
await revokeUserSessions(userId);
```

### Client-side

```typescript
import { useSession } from 'src/_providers/SessionProvider';

function UserProfile() {
  const { session } = useSession();

  if (!session) return <LoginButton />;
  return <div>Welcome, {session.name}</div>;
}
```

---

## Multi-Session Behavior

```typescript
// config.ts
session: { perUser: 'single' }; // Default

// When 'single':
// - User logs in on device A → Session A created
// - User logs in on device B → Session A deleted, Session B created
// - Device A's socket receives 'logout' event

// When true:
// - Both sessions remain active
// - Useful for: multiple browser tabs, phone + desktop
```

---

## Security Notes

1. **Tokens are cryptographically random 64-character hex values** - Not predictable
2. **HttpOnly cookies** - Not accessible via JavaScript
3. **Session validation** - Every API/sync request validates token
4. **Automatic cleanup** - the active adapter's TTL/expiry contract handles session expiry

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `packages/login/src/session.ts` | `saveSession` | Persists session, enforces single-session mode, pushes updates to connected clients. |
| `packages/login/src/session.ts` | `getSession` | Resolves session by token for API/sync/auth flows. Slides TTL on success. |
| `packages/login/src/session.ts` | `deleteSession` | Removes session and emits forced logout event channel. |
| `packages/login/src/session.ts` | `getAllSessions` | Admin/debug helper to inspect active sessions. |
| `packages/login/src/session.ts` | `revokeUserSessions` | Force-logout every active session for a user. |
| `src/_providers/SessionProvider.tsx` | `useSession` | React hook to access `session` and `sessionLoaded` state. |
