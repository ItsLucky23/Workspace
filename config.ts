//? Project-level config. Registered into `@luckystack/core` at module load
//? (side-effect import) so framework packages read your overrides via
//? `getProjectConfig()`. Edit values here to tune the framework's behavior.

import { registerProjectConfig } from '@luckystack/core';
//? Frontend + backend ports live in ONE pure-data file (no side-effects) so
//? `vite.config.ts` can read them without importing this config. Re-exported so
//? app code + `server.ts` share the same single source of truth.
import { ports } from './config.ports';
export { ports } from './config.ports';

//? This file is imported by BOTH the Node server and the Vite browser bundle.
//? `process` is a Node global — referencing `process.env.X` directly in the
//? client bundle throws `ReferenceError: process is not defined`. Always read
//? env vars through `env(...)`, which returns undefined when `process` is absent.
const env = (key: string): string | undefined =>
  typeof process === 'undefined' ? undefined : process.env[key];

//? Honors LUCKYSTACK_ENV first (the framework canonical, mirroring core's
//? `resolveEnvKey()`), then NODE_ENV — via the browser-safe `env()` helper so
//? this dual-bundle file never references `process` directly in the client.
export const dev = (env('LUCKYSTACK_ENV') ?? env('NODE_ENV')) !== 'production';

//? Backend HTTP origin as the BROWSER reaches it — where the framework's own
//? routes live (notably the OAuth `/auth/callback/<provider>` handler). We use
//? `localhost` for the host (NOT SERVER_IP, which is just the bind address) so it
//? shares a host with the frontend on localhost — the session cookie set during
//? the OAuth callback is then visible to the app. The port defaults to
//? `config.ports.ts` (`backend`) — so in dev this is http://localhost:80 — but a
//? positional argv port (`npm run server -- <preset> <port>`, which parseArgv
//? writes to process.env.SERVER_PORT) overrides it, mirroring createServer.
const backendOrigin = `http://localhost:${env('SERVER_PORT') ?? ports.backend}`;

//? Public origin — where users actually browse the app. Drives post-login
//? redirects, transactional email links, and the CORS allow-list. In dev that's
//? the Vite dev server on `config.ports.ts` `frontend`; in production set
//? PUBLIC_URL to your deployed domain (frontend + backend share one origin
//? there, so PUBLIC_URL also covers the OAuth callback host).
const publicUrl = dev ? `http://localhost:${ports.frontend}` : (env('PUBLIC_URL') ?? backendOrigin);

//? In the browser the app talks to its API surface same-origin — the Vite dev
//? proxy forwards /api, /sync, /auth, /socket.io, … to the backend in dev, and in
//? prod the frontend is served from the same origin. So client code uses the
//? current window origin; on the server we fall back to the public origin.
const browserOrigin = typeof window === 'undefined' ? undefined : window.location.origin;
export const backendUrl = browserOrigin ?? publicUrl;

//? OAuth callback base = the redirect_uri host you register with each provider.
//? `/auth/callback/<provider>` is a BACKEND route, so in dev this is the backend
//? origin — register e.g. http://localhost:80/auth/callback/google with Google.
//? In prod it's the public domain (same origin as the backend).
export const oauthCallbackBase = dev ? backendOrigin : publicUrl;

const config = {
  pageTitle: 'Test',
  loginPageUrl: '/login',
  loginRedirectUrl: '/dashboard',
  defaultLanguage: 'en' as const,
  defaultTheme: 'light' as const,
  /** false = HttpOnly cookie, true = sessionStorage. */
  sessionBasedToken: false,
  sessionExpiryDays: 7,
  //? `'single'` (default): logging in on a new device kicks the previous one.
  //? `'multiple'` enables multiple concurrent sessions per user across devices.
  sessionPerUser: 'single' as const,
  //? Presence/activity broadcasting + route-change location syncing. Opt-in.
  socketActivityBroadcaster: true,
  socketStatusIndicator: true,
  locationProviderEnabled: true,
  //? Dev-only console logging toggles.
  logging: {
    devLogs: dev,
    devNotifications: dev,
    socketStatus: dev,
    socketStartup: true,
    stream: dev,
  },
  //? Rate limiting for API requests (Redis-backed so counters are shared across
  //? instances). Per-route override: `export const rateLimit = 60;` (or `false`)
  //? in any `_api/*.ts`. Read by the framework limiter + the docs-ui explorer.
  rateLimiting: {
    store: 'redis' as 'memory' | 'redis',
    redisKeyPrefix: 'rate-limit',
    defaultApiLimit: 60 as number | false,
    defaultIpLimit: 100 as number | false,
    windowMs: 60_000,
  },
  //? Optional @luckystack/secret-manager (opt-in). Uncomment + set
  //? LUCKYSTACK_SECRET_MANAGER_URL to resolve `.env` pointers (NAME=BASE_V<n>)
  //? against an external secret server at boot (see server.ts + the docs).
  secretManager: {
    url: env('LUCKYSTACK_SECRET_MANAGER_URL') ?? '',
    token: { fromFile: '.secret-manager-token' },
    //? Which `.env` names are eligible for off-host resolution. The package's
    //? secure default (omitting this) resolves NOTHING — so the scaffold opts in
    //? to resolving every pointer-shaped (`NAME=BASE_V<n>`) value here, which is
    //? what "install secret-manager → it just works" expects. To restrict, replace
    //? `() => true` with an allowlist array of names, e.g. `['OPENAI_KEY', 'DB_URL']`.
    envNames: () => true,
  },
};

registerProjectConfig({
  app: { publicUrl },
  logging: config.logging,
  rateLimiting: config.rateLimiting,
  session: {
    basedToken: config.sessionBasedToken,
    expiryDays: config.sessionExpiryDays,
    perUser: config.sessionPerUser,
  },
  http: {
    cors: {
      //? The backend's own origin is always allowed. Add extra hosts (a separate
      //? frontend domain, OAuth provider origins, …) to EXTERNAL_ORIGINS in
      //? `.env`, comma-separated — e.g. EXTERNAL_ORIGINS=https://app.example.com,https://accounts.google.com
      allowedOrigins: [publicUrl, backendOrigin, ...(env('EXTERNAL_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)],
      //? In dev (NODE_ENV !== 'production') accept ANY localhost origin, so the
      //? Vite dev server on http://localhost:5173 (and :5174, :5175, … when the
      //? port is taken) can talk to the backend without listing each port. Stays
      //? false in production so deployments fail closed.
      allowLocalhost: dev,
      //? NOTE: the initial Socket.io polling handshake is an origin-less GET in
      //? BOTH dev (Vite proxy → backend) and prod-with-router (single origin),
      //? because browsers omit the `Origin` header on same-origin requests. The
      //? framework's CORS layer admits origin-less handshakes unconditionally
      //? (see @luckystack/server loadSocket.ts) — this list only gates requests
      //? that DO carry an `Origin` header (cross-origin browsers, OAuth
      //? callbacks). So you do NOT need to list every same-origin variant here.
    },
  },
  defaultLanguage: config.defaultLanguage,
  loginRedirectUrl: config.loginRedirectUrl,
  //? Backend origin for OAuth callback redirect URIs. Read by
  //? @luckystack/login/register's env-driven provider scan so adding an OAuth
  //? provider is just env vars + restart (no code edit).
  oauthCallbackBase,
  socketActivityBroadcaster: config.socketActivityBroadcaster,
  socketStatusIndicator: config.socketStatusIndicator,
  locationProviderEnabled: config.locationProviderEnabled,
  auth: {
    //? forgot-password is a @luckystack/login feature: it ONLY works with
    //? @luckystack/login installed. 'framework' mode ALSO needs @luckystack/email
    //? installed + a sender registered in server.ts to deliver the reset mail.
    //? Set to 'disabled' or 'custom' to opt out.
    forgotPassword: 'framework',
    //? Email+password auth. Set `false` for an OAuth-only app — the login form
    //? hides the email/password fields and the credentials route rejects.
    credentials: true,
  },
});

export default config;
export const {
  pageTitle,
  loginPageUrl,
  loginRedirectUrl,
  defaultLanguage,
  defaultTheme,
  sessionBasedToken,
  sessionExpiryDays,
  sessionPerUser,
  socketActivityBroadcaster,
  socketStatusIndicator,
  locationProviderEnabled,
  logging,
  rateLimiting,
} = config;

// Project-specific session shape. Extend the framework's BaseSessionLayout
// with whatever extra fields your User model has. Keep it structurally
// compatible with BaseSessionLayout (the type-check below enforces it).
import type { BaseSessionLayout } from '@luckystack/core';
import type { User } from '@prisma/client';

//? Re-export AuthProps so file-based `_api` / `_sync` handlers can
//? `import { AuthProps } from '../../config'` (mirrors the framework's config.ts).
//? It originates in @luckystack/core (login re-exports it too); we import from
//? core so this file compiles identically with or without @luckystack/login.
export type { AuthProps } from '@luckystack/core';

export interface SessionLayout extends Omit<User, 'password'> {
  avatarFallback: string;
  token: string;
  roomCodes?: string[];
}

export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never;
