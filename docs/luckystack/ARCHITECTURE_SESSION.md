# Session Architecture

> Session management using Redis with OAuth provider support.

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

Sessions are stored in **Redis** with configurable expiry.

```
Redis Key: {projectName}-session:{token}
Active-users key: {projectName}-activeUsers:{userId}
Value: JSON-encoded SessionLayout
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

The key shape is centralized in `packages/login/src/session.ts` via two helpers:

```ts
import { sessionKeyFor, activeUsersKeyFor } from '@luckystack/login';

const sessionKey = sessionKeyFor(token);          // -> '{projectName}-session:{token}'
const activeKey = activeUsersKeyFor(userId);      // -> '{projectName}-activeUsers:{userId}'
```

Use them whenever you need to read or scan session data from outside `@luckystack/login` — they are the single source of truth for the key shape.

Sliding behavior:
- Session TTL is refreshed on successful authenticated session reads.
- In cookie mode, `Set-Cookie` with matching `Max-Age` is reissued on valid requests.
- Result: active users stay logged in, idle users expire after `session.expiryDays`.

### Session-refresh hooks

`getSession` dispatches `preSessionRefresh` before extending the TTL and `postSessionRefresh` after. Both are async hooks — consumers register via `registerHook(...)` from `@luckystack/core`:

```ts
import { registerHook } from '@luckystack/core';

registerHook('postSessionRefresh', async ({ token, userId, oldTtl, newTtl, applied }) => {
  if (!applied) return;                  // Redis EXPIRE failed or key disappeared
  if (oldTtl != null && oldTtl < 60) {
    // user is on the verge of expiring — log for analytics
  }
});
```

`oldTtl` may be `-1` (key has no TTL) or `null` (TTL command failed). `applied: boolean` on the post payload reflects the actual EXPIRE return.

---

## SessionLayout

Define your session structure in `config.ts`:

```typescript
export interface SessionLayout {
  id: string;
  name: string;
  email: string;
  provider: string;
  admin: boolean;
  avatar: string;
  avatarFallback: string;
  language: string;
  theme: "light" | "dark";
  createdAt: Date;
  updatedAt: Date;
  token: string;
  location?: {
    pathName: string;
    searchParams: { [key: string]: string };
  };
}
```

---

## Configuration

```typescript
// config.ts
const config = {
  // Session behavior
  sessionPerUser: 'single', // 'single' = new login kicks other sessions
  sessionExpiryDays: 7,

  // Redirects
  loginPageUrl: "/login",
  loginRedirectUrl: "/examples",
};
```

---

## Session Flow

```
1. User logs in (OAuth or credentials)
   ↓
2. Server generates random token (UUID)
   ↓
3. Session stored in Redis: {token} → {user data}
   ↓
4. Token sent to client:
   - Cookie-based: Set-Cookie: token={token}; HttpOnly
   - Session-based: Returned in response body
   ↓
5. Subsequent requests include token:
   - WebSocket: socket.handshake.auth.token
   - HTTP: Cookie header or Authorization: Bearer {token}
```

---

## Token Modes

Controlled by `sessionBasedToken` in `config.ts`:

| Mode              | Storage         | Best For                   |
| ----------------- | --------------- | -------------------------- |
| `false` (default) | HttpOnly cookie | Web apps, security-focused |
| `true`            | sessionStorage  | Developing                 |

Notes:
- Token extraction is strict by mode (no fallback between cookie and sessionStorage sources).
- When `sessionBasedToken` is `true`, auth flows do not set token cookies; credentials login returns `X-Session-Token` and OAuth callback redirects with `?token=`.
- When `sessionBasedToken` is `false`, auth flows use HttpOnly cookie delivery.

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
sessionPerUser: 'single'; // Default

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

1. **Tokens are random UUIDs** - Not predictable
2. **HttpOnly cookies** - Not accessible via JavaScript
3. **Session validation** - Every API/sync request validates token
4. **Automatic cleanup** - Redis TTL handles expiry

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
