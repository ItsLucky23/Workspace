# Authentication Architecture

> OAuth and credentials-based authentication system.

> **Where the code lives (post-package-split):** the runtime described below is in `@luckystack/login` (`packages/login/src/`). The OAuth provider list is no longer hardcoded in `server/auth/loginConfig.ts` — it is registered via `registerOAuthProviders([...])` from a `luckystack/login/oauthProviders.ts` overlay file. Built-in provider factories: `googleProvider`, `githubProvider`, `discordProvider`, `facebookProvider`, `microsoftProvider`, `credentialsProvider`. See [`packages/login/README.md`](../packages/login/README.md) for the current API.

---

## Quick Reference

```typescript
// Trigger OAuth login (redirects)
window.location.href = "/auth/api/google";

// Credentials login
const response = await fetch("/auth/api/credentials", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Session-Based-Token": "false", // optional: force cookie-mode response
  },
  body: JSON.stringify({ email, password }),
  credentials: "include",
});
```

---

## Supported Providers

| Provider    | Type           | Config Required   |
| ----------- | -------------- | ----------------- |
| Credentials | Email/Password | None (built-in)   |
| Google      | OAuth 2.0      | Client ID, Secret |
| GitHub      | OAuth 2.0      | Client ID, Secret |
| Discord     | OAuth 2.0      | Client ID, Secret |
| Facebook    | OAuth 2.0      | Client ID, Secret |
| Microsoft   | OAuth 2.0      | Client ID, Secret |

---

## Configuration

### Environment Variables

```bash
# .env
# Public origin (where users browse) is derived in config.ts — dev defaults to the
# Vite dev server, prod reads PUBLIC_URL. The OAuth callback uses the BACKEND origin
# (dev http://localhost:80, derived from SERVER_IP/SERVER_PORT).
# PUBLIC_URL=https://myapp.com                # production only
EXTERNAL_ORIGINS=https://myapp.com           # Extra allowed origins (comma-separated)

# OAuth Providers
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
FACEBOOK_CLIENT_ID=...
FACEBOOK_CLIENT_SECRET=...
```

### Provider registry (overlay file)

Provider config now lives in your overlay folder, not in framework code:

```typescript
// luckystack/login/oauthProviders.ts
import { registerOAuthProviders, googleProvider, microsoftProvider, credentialsProvider } from '@luckystack/login';

registerOAuthProviders([
  credentialsProvider(),
  googleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: `http://localhost:80/auth/callback/google`,
  }),
  microsoftProvider({
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackUrl: `http://localhost:80/auth/callback/microsoft`,
    tenant: process.env.MICROSOFT_TENANT_ID,
  }),
]);
```

Self-hosted instances (GitHub Enterprise, Azure custom tenant) override the default URLs via `endpoints?.{authorizationURL, tokenExchangeURL, userInfoURL}`. `facebookProvider` and `microsoftProvider` also accept `apiVersion?`; `microsoftProvider` additionally accepts `tenant?` (default `'common'`) and `graphApiVersion?` (default `'v1.0'`). See [`packages/login/README.md`](../packages/login/README.md#provider-options) for the full options table.

---

## Login Flows

### OAuth Flow

```
1. User clicks "Login with Google"
   ↓
2. Redirect to: /auth/api/google
   ↓
3. Server generates and stores one-time OAuth state (short TTL)
  ↓
4. Server redirects to Google OAuth URL with code + state parameters
   ↓
5. User authenticates with Google
   ↓
6. Google redirects to: /auth/callback/google?code=...&state=...
   ↓
7. Server validates and consumes OAuth state (anti-CSRF)
   ↓
8. Server exchanges code for token
   ↓
9. Server fetches user profile from Google
   ↓
10. Server creates/finds user in database
   ↓
11. Server creates session in Redis
  ↓
12. Redirect to frontend with token cookie
```

### Credentials Flow

```
1. User submits email + password
   ↓
2. POST to: /auth/api/credentials
   ↓
3. Server validates credentials
   ↓
4. If action='register': Create user, hash password
   If action='login': Verify password hash
   ↓
5. Server creates session in Redis
   ↓
6. Return { status: true, session, newToken }
```

### Direct entry points

The HTTP `/auth/api/credentials` route is a thin dispatcher around three exported functions in `@luckystack/login`:

- `loginWithCredentials(params)` — legacy combined dispatcher; routes to `register*` or `login*` based on the body shape (presence of `confirmPassword`). Kept for backwards compatibility.
- `registerWithCredentials({ email, password, name, confirmPassword })` — register-only path.
- `loginWithCredentialsCore({ email, password })` — login-only path.

Reach for the dedicated functions when you wire up a custom auth surface (admin invite flow, programmatic provisioning, signup wizard with extra steps) and want to avoid the dispatcher's body-shape branching. They share the same hook surface (`preRegister` / `postRegister` for register, `preLogin` / `postLogin` for login).

---

## Auth Endpoints

| Endpoint                       | Method | Purpose                                                        |
| ------------------------------ | ------ | -------------------------------------------------------------- |
| `/auth/api/{provider}`         | GET    | Initiate OAuth login                                            |
| `/auth/api/credentials`        | POST   | Credentials login/register (may return a 2FA challenge)         |
| `/auth/callback/{provider}`    | GET    | OAuth callback (from provider)                                  |
| `/auth/api/email-code/request` | POST   | Passwordless login: mail a one-time code (ADR 0024; always "ok" — anti-enumeration) |
| `/auth/api/email-code/verify`  | POST   | Passwordless login: verify the code, mint the session (or return a 2FA challenge) |
| `/auth/api/2fa`                | POST   | Complete a pending 2FA challenge (`{ challengeToken, code, method? }`) → session |
| `/auth/api/2fa/email-code`     | POST   | Send the 2FA email-fallback code for an active challenge        |
| `/auth/api/2fa/setup`          | POST*  | Begin authenticator enrollment → `{ secret, otpauthUri }`       |
| `/auth/api/2fa/enable`         | POST*  | Confirm enrollment with the first code → `{ recoveryCodes[] }` (shown once) |
| `/auth/api/2fa/disable`        | POST*  | Turn 2FA off (requires a valid TOTP or recovery code)           |
| `/auth/api/2fa/recovery-codes` | POST*  | Replace the recovery-code set (requires a valid TOTP code)      |

`*` = authenticated (live session required); these are CSRF-enforced in cookie
mode. The login-completing routes are CSRF-bootstrap-exempt like
`/auth/api/credentials`. Authenticator apps work via the open TOTP standard
(RFC 6238) — no vendor integration.

### Enabling email-code login / 2FA on an EXISTING project (upgrade runbook)

Both features ship OFF (`auth.emailCodeLogin: false`, `auth.twoFactor:
'disabled'`) and every new config key auto-seeds to a safe default via the
config deep-merge — so bumping `@luckystack/*` and running `npm install`
changes nothing until you opt in. To turn them on in a project that was NOT
re-scaffolded:

1. **Config (`config.ts`).** Set `auth.emailCodeLogin: true` and/or
   `auth.twoFactor: 'optional'`. *Skipping this keeps the feature off — safe.*
2. **User columns (2FA only) — REQUIRED, manual.** Add three OPTIONAL columns
   to your `prisma/schema.prisma` `User` model (or your data layer's user
   table) and run `prisma generate` + `db push`/`migrate`:
   ```prisma
   twoFactorEnabled Boolean @default(false)
   totpSecret       String?
   recoveryCodes    Json?
   ```
   *If you flip `twoFactor: 'optional'` but skip this, plain logins keep
   working, but the first enrollment attempt fails LOUDLY — the server log
   names the exact missing columns and the user gets `login.twoFactorPersistFailed`.*
3. **Email adapter (email-code login + the 2FA email fallback).** Ensure
   `@luckystack/email` is installed and a sender is registered. *Skipping this
   fails LOUDLY — the send logs "@luckystack/email is not installed" and the
   flow returns `login.emailCodeSendFailed`.*
4. **`TOTP_ENCRYPTION_KEY` in `.env.local` (recommended).** A long random
   string; encrypts TOTP secrets at rest (AES-256-GCM). *Skipping stores them
   plaintext with a one-time boot warning; adding the key later upgrades new
   enrollments. Use a random value, not a memorable passphrase (it is not
   stretched).*
5. **UI — `npx luckystack update --app`** (ADR 0025). The phase-based
   `LoginForm` (email-code + 2FA challenge views) and the settings
   `TwoFactorSection` are consumer-owned `src/` files that a plain `npm install`
   / framework-scope `update` can't deliver. Run `npx luckystack update --app`:
   it renders a fresh scaffold with your recorded choices and delivers the new
   `TwoFactorSection` (a genuinely new file) + a `LoginForm.tsx.new` sidecar if
   you edited yours (an AI agent can apply the `dump/UPDATE_*.log` merge note).
   Files you never touched are refreshed in place; your own code + `prisma/` +
   secrets are never touched. Review with `git diff` before committing.

### Security posture notes (ADR 0024)

- **Recovery codes** (80-bit, one-time, sha256-at-rest) are the lost-device
  path. `twoFactorEmailFallback` (default `true`) additionally lets an enrolled
  user complete the challenge with a code mailed to their account address —
  convenient, but it means mailbox possession can satisfy the second factor
  (the same trust level as password reset). Set it `false` to require the
  authenticator app (or a recovery code) only.
- **2FA verification is rate-limited three ways:** a per-challenge attempt
  budget (`twoFactorMaxAttempts`), a per-IP shield, and a cross-IP per-account
  lockout (10 failed second-factor attempts / 15 min) that a botnet can't scale
  past. Re-enrollment requires disabling first (which proves current
  possession), so a hijacked session cannot silently overwrite the factor.

---

## API And SYNC Authorization

### Basic login requirement

```typescript
// In _api/*.ts
export const auth: AuthProps = {
  login: true, // User must be logged in
  additional: [], // No extra requirements
};
```

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `packages/login/src/login.ts` | `loginWithCredentials` | Handles credentials login/register, password checks, session creation. |
| `packages/login/src/login.ts` | `loginCallback` | Handles OAuth callback flow and provider profile mapping. |
| `packages/login/src/oauthProviders.ts` | `registerOAuthProviders`, `googleProvider`, … | Provider registry + built-in provider factories. Replace `server/auth/loginConfig.ts` calls with a `luckystack/login/oauthProviders.ts` overlay. |
| `packages/login/src/userAdapter.ts` | `registerUserAdapter`, `defaultPrismaUserAdapter` | Pluggable user-store adapter for projects with non-default Prisma schemas. |
| `packages/login/src/redirectResolver.ts` | `registerPostLoginRedirect` | Dynamically compute the OAuth callback destination per user/tenant/provider. |
| `packages/core/src/checkOrigin.ts` | `default export` | Validates allowed origins for HTTP/socket requests. |
| `packages/core/src/validateRequest.ts` | `validateRequest` | Enforces `auth.additional` checks for APIs and sync handlers. |

### Role-based access

```typescript
export const auth: AuthProps = {
  login: true,
  additional: [
    {
      key: "admin",
      value: true, // User must have 'admin' role
    },
  ],
};
```

---

## Frontend Components

### Login Buttons

```tsx
function LoginPage() {
  return (
    <div>
      <button onClick={() => (window.location.href = "/auth/api/google")}>
        Login with Google
      </button>
      <button onClick={() => (window.location.href = "/auth/api/github")}>
        Login with GitHub
      </button>
    </div>
  );
}
```

### Middleware

```ts
switch (location) {
  case "/test":
    if (session?.email && session?.provider) {
      return { success: true };
    }
    return { redirect: "/login" };

  case "/admin":
    if (session?.email && session?.provider && session?.admin === true) {
      return { success: true };
    } else if (!session?.email || !session?.provider) {
      return { redirect: "/login" };
    } else if (!session?.admin) {
      notify.error({ key: "middleware.notAdmin" });
    }
    return;

  default:
    return { success: true };
}
```

---

## Security Considerations

1. **OAuth state** - One-time state is generated/validated to mitigate OAuth login CSRF
2. **CORS (fail-closed)** - Only the configured origins (the public origin + backend origin from `config.ts`) and `EXTERNAL_ORIGINS` are allowed. As of 2026-05-06, requests where neither `Origin` nor `Referer` is present are now allowed only for read-only methods (GET, HEAD, OPTIONS); state-changing methods (POST, PUT, PATCH, DELETE) are rejected with 403. This closes the previous `host`-fallback bypass for non-browser clients (`curl`, server-to-server).
3. **`csrfMismatch` hook** - The CSRF middleware dispatches `csrfMismatch` before returning 403, with `{ route, method?, requestId?, userId?, providedToken: boolean }`. The token *value* is never included in the payload — only its presence — so audit-log handlers cannot accidentally leak it.
4. **Framework `system/logout` is exact-match** - Earlier builds short-circuited any API whose final path segment was `logout`. The framework now matches the full normalized route name (`system/logout`), so consumer routes like `admin/logout/v1` reach their own handler.
5. **Token delivery by mode** - `sessionBasedToken=false` uses HttpOnly cookies; `sessionBasedToken=true` uses session-token delivery for development workflows
6. **Mode negotiation for credentials login** - client can send `X-Session-Based-Token` so backend responds with cookie/token transport that matches the active frontend DNS config
7. **Token extraction fallback** - server prefers the configured mode but can read both cookie and bearer/session auth token to prevent DNS-mode mismatch lockouts
8. **bcrypt** - Passwords hashed with salt rounds. The framework no longer pipes the password or the email through `validator.escape()` before hashing/lookup — that was a no-op for HTML safety (neither value ever reaches HTML) and silently mangled passwords containing `& < > " '`. The `name` field is still escaped (it ends up rendered) — see the OAuth-name stored-XSS note in `packages/login/README.md`.
9. **CSRF** - WebSocket architecture inherently prevents CSRF; the HTTP fallback adds a token middleware that emits `csrfMismatch` on rejection (see #3).
10. **Origin check** - Every request validates origin header (see #2).
11. **`/_test/reset` endpoint** - Now fail-closed. Requires both `NODE_ENV` exactly `development` or `test` AND a non-empty `TEST_RESET_TOKEN` env var; an unset token returns 403. See `docs/HOSTING.md` for the deployment checklist.
12. **`prePasswordResetCompleted` hook ordering** - In `src/reset-password/_api/confirmReset_v1.ts`, the one-time reset token is consumed via `consumePasswordResetToken` **before** the `prePasswordResetCompleted` hook is dispatched. This is intentional: a hook veto (`.stopped`) causes the link to be invalidated without resetting the password, forcing the user to request a new link. This prevents replay attacks but means a stop signal burns the token. Implementations that need to inspect the token's validity before consuming it should be wired as a `prePasswordReset` guard on the send-reset flow instead.
