# Architecture — Extension Points Reference

> Every registry, adapter slot, and hook a consumer can use to customise
> LuckyStack without forking. Grouped by package. Code samples assume the
> overlay layout in `luckystack/<package>/index.ts`.

The framework's design rule is **per-package config + composable adapter
slots over a central ProjectConfig bag**. Each `@luckystack/*` package
owns its own registry surface and re-exports it for one-import-path use.

---

## `@luckystack/core`

| Symbol | Purpose |
|---|---|
| `registerProjectConfig({...})` | Top-level app config (logging, rate-limit, session, auth, socket, sync, offline queue, paths, http, cors). |
| `registerLogger(logger)` | DI slot for any `Logger`-shaped object (pino, winston, console). |
| `registerNotifier(notifier)` | DI slot for client-side toast UI. |
| `registerPrismaClient(client)` | Swap the Prisma client (multi-tenant, test mocks). |
| `registerRedisClient(client)` | Swap the Redis client. |
| `registerAvatarConfig({...})` | Tune avatar uploads dir + max size. |
| `registerLocaleReloader(cb)` | i18n hot-reload tap. |
| `registerEmailSender(sender)` | Legacy single-adapter slot. |
| `registerEmailSenders({ default, transactional, marketing, ... })` | Multi-adapter — framework routes by convention. |
| `registerRateLimitStrategy(strategy)` | Plug a custom rate-limit backend (token-bucket / sliding-window / edge-KV). Default = in-memory + Redis. |
| `registerRedactedLogKeys([...])` | Extend the masked-keys set for logged payloads. |
| `registerHook(name, handler)` | Subscribe to server-side lifecycle hooks (see below). |
| `registerClientHook(name, handler)` | New. Client-side counterpart to `registerHook`. Subscribe to `postLogin` / `postLogout` transitions detected by the session context. Returns an unsubscribe function. Available via `@luckystack/core/client`. |
| `registerPageMiddleware(path, fn)` | New. Per-page route guard registered automatically when a `page.tsx` exports `middleware`. The framework's `<Middleware>` + `useRouter` check this map FIRST, then fall back to the global `registerMiddlewareHandler` handler. Type: `PageMiddleware<TSession>`. Available via `@luckystack/core/client`. |
| `validatePagePath(srcRelativePath, rules?)` | New. Pure validator for the file-router's invisible-parent convention: `_<folder>` is stripped from the URL, children route, `page.tsx` directly inside an `_<folder>` is invalid. Same helper drives `src/main.tsx`'s `getRoutes()` AND the devkit scaffold CLI. See `docs/ARCHITECTURE_ROUTING.md` for rules + examples. |
| `registerSocketMiddleware(mw)` | New. Wedge an `io.use(...)` middleware into the framework socket bootstrap (license-key gates, observability tags, custom auth). Runs before any `connect` handler. |
| `registerCsrfConfig({...})` | New. Override CSRF cookie name, header name, token length, or cookie options for integration with legacy gateways / FIPS-grade tokens. |

### Hooks fired from core / api / sync

| Hook | When | Stop-signal capable |
|---|---|---|
| `preApiValidate` | Before Zod input check. | yes |
| `postApiValidate` | After validation, before execute. | no |
| `preApiExecute` | Before handler runs. | yes |
| `postApiExecute` | After handler completes. | no |
| `preApiRespond` | Before sending response — **mutable**. | yes |
| `transformApiResponse` | New. After preApiRespond, before emit — **mutable**. | no |
| `postApiRespond` | After emit (observation-only). | no |
| `preSyncAuthorize` | New. After auth check, before rate-limit. Use for room-membership rules. | yes |
| `preSyncFanout` | Before fanout to recipients. | yes |
| `postSyncFanout` | After fanout completes. | no |
| `preSyncStream` | Per chunk before emit (fire-and-forget). | no |
| `postSyncStream` | Per chunk after emit (fire-and-forget). | no |
| `apiError` / `syncError` | Caught errors. | no |
| `rateLimitExceeded` | A request hit a rate cap. | no |
| `corsRejected` | An origin was denied. | no |
| `csrfMismatch` | CSRF token check failed. | no |
| `preSessionRefresh` / `postSessionRefresh` | Sliding-TTL refresh on session reads. | yes / no |
| `onUploadStart` / `onUploadComplete` | Upload lifecycle. | no |
| `preHttpRequest` | New. Before route dispatch on raw HTTP. | yes |

---

## `@luckystack/login`

| Symbol | Purpose |
|---|---|
| `registerOAuthProviders([...])` | Provider list (Google, GitHub, Discord, Facebook, Microsoft, + custom). |
| `registerUserAdapter(adapter)` | Swap the Prisma `User` model behind auth. |
| `registerPostLoginRedirect(resolver)` | Dynamic post-login redirect URL. |
| `registerSessionAdapter(adapter)` | New. Storage backend for sessions (default Redis; supports DynamoDB / Postgres / signed-JWT). |
| `validatePassword(plaintext)` | New. Validates against the active `passwordPolicy`. |
| `PasswordPolicyError` | New. Thrown by `updatePasswordHash` on policy violation. |

### Hooks

`preLogin`, `postLogin`, `preRegister`, `postRegister`, `preLogout`,
`postLogout`, `preSessionCreate`, `postSessionCreate`, `preSessionDelete`,
`postSessionDelete`, `passwordResetRequested`, `passwordResetCompleted`,
`passwordChanged`.

### OAuth provider extensions

```typescript
googleProvider({
  clientId, clientSecret, callbackUrl,
  extraScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  extraSessionFields: async ({ accessToken }) => ({
    googleCalendarToken: accessToken,
  }),
});
```

For strict typing, augment the session shape:

```typescript
declare module '@luckystack/core' {
  interface BaseSessionLayout {
    googleCalendarToken?: string;
  }
}
```

### Session config

```typescript
projectConfig.session = {
  perUser: 'single' | 'multiple',
  maxConcurrentPerUser: number | null,
  onConflict: 'revokeOld' | 'rejectNew',
  notifyOldDeviceOnRevoke: boolean,
  expiryDays: 7,
};
```

Set `perUser: 'multiple'` to allow multiple concurrent sessions per user.

---

## `@luckystack/email`

| Symbol | Purpose |
|---|---|
| `registerEmailSender(sender)` | Single global adapter (legacy). |
| `registerEmailSenders({ default, transactional, marketing, ... })` | Multi-adapter — convention-routed. |
| `registerEmailTemplate(name, { subject, render })` | Named templates (`password-reset`, `welcome`, ...). |
| `sendEmail({ template, data, to, adapterHint })` | Send via a registered template + slot. |
| `sendEmail({ to, subject, html, ... })` | Raw mode (legacy). |
| `ResendSender`, `SmtpSender`, `ConsoleSender` | Built-in adapters. |
| `autoSelectEmailSender({...})` | Heuristic picker from env vars. |

Pre/post hooks: `preEmailSend` (stop-signal capable, can abort send),
`postEmailSend` (audit/DLQ).

---

## `@luckystack/sync`

| Symbol | Purpose |
|---|---|
| `createStreamThrottle({...})` | Coalesce stream chunks. |
| `syncRequest({ ..., offlineDropPolicy })` | New. Per-request override of the queue drop policy. |

Hooks: `preSyncAuthorize` (new — room-auth, see core), `preSyncFanout`,
`postSyncFanout`, `preSyncStream`, `postSyncStream`.

---

## `@luckystack/api`

| Symbol | Purpose |
|---|---|
| Per-route metadata | `rateLimit`, `auth`, `httpMethod`, `validation` exports per `_api/*.ts`. |
| Per-route `validation` | New. `'strict'` (default) / `'relaxed'` / `{ input: 'skip' }` for public webhooks. |

Hooks: `preApiValidate`, `postApiValidate`, `preApiExecute`,
`postApiExecute`, `preApiRespond`, `transformApiResponse` (new — mutate
response before emit), `postApiRespond`.

CORS now supports a function resolver: `projectConfig.http.cors.allowedOrigins`
accepts `string[] | (origin) => boolean`.

---

## `@luckystack/server`

| Symbol | Purpose |
|---|---|
| `bootstrapLuckyStack(...)` | Recommended entry point. |
| `createLuckyStackServer(...)` | Lower-level server factory. |
| `verifyBootstrap(...)` | Pre-flight registry check. |
| `registerCustomRoute(handler)` | Pre-fallback HTTP route registration. |
| `registerSecurityHeaders((req) => Record<string, string>)` | New. Customize CSP, HSTS, Permissions-Policy. |
| `registerErrorFormatter(formatter)` | New. Global error-response shape override. **Per-route override**: `export const errorFormatter` from any `_api/*.ts` or `_sync/*.ts` file — the api + sync handlers (both socket + HTTP transports) read it off the runtime entry and apply it through `applyErrorFormatter`. Resolution order: per-route → global → framework default. Per-route formatter errors are caught + logged; the unformatted envelope is emitted so the error path stays crash-resistant. Re-exported from `@luckystack/core` for handler-side use. |

Hooks: `onSocketConnect`, `onSocketDisconnect`, `preRoomJoin`,
`postRoomJoin`, `preRoomLeave`, `postRoomLeave`, `onLocationUpdate`,
`preHttpRequest` (new — stop-signal capable).

---

## `@luckystack/presence`

| Symbol | Purpose |
|---|---|
| `registerPresenceConfig({ disconnectTimers, afkTimeoutMs, ignoreReasons, allowReasons })` | Tune grace periods + AFK threshold. |
| `registerActivityEvent(name, { trigger, onTrigger, refractoryMs })` | New. Custom activity events (location change, typing, custom AFK semantics). Default `'afk'` event auto-registers. |
| `unregisterActivityEvent(name)` | New. Drop a default event before registering an alternative. |
| `socketLeaveRoom(...)` | Programmatic room leave. |

Hooks: `prePresenceUpdate`, `postPresenceUpdate`, `postSocketReconnect`
(new — fires only on reconnect within the grace window).

---

## `@luckystack/router`

| Symbol | Purpose |
|---|---|
| `startRouter({...})` | Programmatic entry. |
| `registerServiceResolver(resolver)` | New. Host-based / header-based / custom service-key resolution. Return null falls through to first-path-segment default. |

Hooks: `preProxyRequest` (new), `postProxyResponse` (new — includes
latency + status code).

Circuit-breaker SKIPPED for v1.

---

## `@luckystack/error-tracking`

| Symbol | Purpose |
|---|---|
| `ErrorTracker` interface | Adapter contract: captureException, captureMessage, setUser, startSpan, recordMetric, beforeSend. |
| `registerErrorTracker(tracker)` | Single adapter. |
| `registerErrorTrackers([...])` | Multi-adapter fan-out. |
| `captureExceptionAcrossTrackers(...)` | Framework-internal helper. |
| `createSentryAdapter({ beforeSend? })` | Built-in. Wraps `@sentry/node` into the `ErrorTracker` shape. Lazy peer-dep guard — throws a friendly error if `@sentry/node` isn't installed. |
| `createDatadogAdapter({ tracer, statsd?, metricPrefix?, beforeSend? })` | Built-in. Wraps `dd-trace` (spans) + optional `hot-shots` (StatsD metrics). |
| `createPostHogAdapter({ client, anonymousDistinctId?, beforeSend? })` | Built-in. Wraps `posthog-node`; routes `captureException` to PostHog's native API when available, falls back to `$exception` custom event. |

Built-in adapters ship today. Consumers can still implement custom
trackers against any backend (CloudWatch, New Relic, Honeybadger,
Bugsnag) by writing a plain object that satisfies the `ErrorTracker`
interface and passing it to `registerErrorTracker(...)`.

---

## `@luckystack/devkit`

| Symbol | Purpose |
|---|---|
| `registerRoutingRules({...})` | Customise `_api`/`_sync` marker segments, the invisible-parent prefix, the reserved framework folders, and `disableTemplateInjection: (filePath) => boolean` to opt parts of the tree out of scaffold injection. |
| `extractValidation(filePath)` | New. AST-reads `export const validation = 'relaxed'` from API source files. |
| `registerTemplate(kind, content)` | New. Override one of the six bundled scaffold templates (`api`, `sync_server`, `sync_client_paired`, `sync_client_standalone`, `page_plain`, `page_dashboard`). String is substituted for the bundled disk template at injection time; `{{REL_PATH}}` / `{{PAGE_PATH}}` / `{{SYNC_NAME}}` placeholders still apply. |
| `assertNoDuplicatePageRoutes({ srcDir, context })` | New. Build-time validator: throws when two `page.tsx` files compute the same URL after invisible-parent stripping (e.g. `src/_test/admin/page.tsx` + `src/admin/page.tsx` → both `/admin`). Dev-server startup logs a soft warning; the build path asserts. |

The dev loader and the production `scripts/generateServerRequests.ts`
both pass `validation` (and `errorFormatter`) through to the generated
apiEntry / syncEntry, so per-route exports take effect end-to-end. Set
`export const validation = 'relaxed'` (or `{ input: 'skip' }`) in any
`_api/*.ts` or `_sync/*.ts` file for public webhooks where the input
shape can't be modeled in TS.

### Consumer-side template overrides

Override one of the six bundled scaffold templates from an overlay file
in `luckystack/devkit/templates.ts` (or any module that imports devkit
during the consumer's boot):

```typescript
import { registerTemplate, registerRoutingRules } from '@luckystack/devkit';
import myPagePlain from './my-page-plain.template?raw';

//? Replace the bundled `page_plain` template with the project's house
//? style. Same `{{REL_PATH}}` substitution rules apply to the override.
registerTemplate('page_plain', myPagePlain);

//? Opt the entire `src/migrations/` tree out of scaffold injection — the
//? team checks those files in by hand and the dev server should not
//? rewrite them when they're created empty.
registerRoutingRules({
  disableTemplateInjection: (filePath) => filePath.replaceAll('\\', '/').includes('/src/migrations/'),
});
```

**Scope**: this only overrides the SIX existing template kinds (api, sync_server, sync_client_paired, sync_client_standalone, page_plain, page_dashboard). Brand-new template kinds (e.g. a `page_admin` variant the framework doesn't know about) would also need an injector heuristic to decide WHEN to pick them — that's a future extension; for now, customize the existing kinds.

---

## `@luckystack/test-runner`

| Symbol | Purpose |
|---|---|
| `registerTestLayer({ name, run })` | New. Custom test layers (CORS, business rules, GDPR). |
| `registerTestFixture(typeKey, { valid, invalid })` | New. Realistic payloads for the fuzz layer. |
| `registerTestReporter({ onResult, onSummary, webhookUrl })` | New. Per-result + summary + optional webhook POST. |

---

## `@luckystack/docs-ui`

| Symbol | Purpose |
|---|---|
| `mountDocsUi({ routePath, pageTitle, branding, template, enableTryItOut, enabledInProd })` | Mount the docs page. |
| `branding: { logoUrl, brandColor, fontFamily }` | New. Visual customisation. |
| `template: (input) => string` | New. Custom HTML template override. |
| `enableTryItOut: true` | New. Inline live request runner. |

JSDoc extension fields shipped in `apiDocs.generated.json`:
`@docs owner <name>`, `@docs tags <comma,list>`, `@docs deprecated [reason]`.
The devkit-side parser (`extractDocsMeta` in `packages/devkit/src/typeMap/apiMeta.ts`)
walks every top-level statement's JSDoc tags in `_api/*.ts` and
`_sync/*_server_v*.ts` files. Unknown sub-keys are silently ignored
(forward-compat). Example:

```typescript
/**
 * Returns the invoice for a customer.
 * @docs owner mathijs
 * @docs tags billing, internal
 * @docs deprecated use api/billing/getInvoice/v2 instead
 */
export const main = async (...) => { ... };
```

**Note**: `@docs owner` values should be plain text — TypeScript's JSDoc
tokenizer treats anything starting with `@` as a new tag, so `@docs owner
@github-handle` would only capture `owner ` (empty value). Use plain
names (`@docs owner mathijs`) or emails (`@docs owner mathijs@company.com`
— the email's `@` is fine because it's not the leading character).

`@docs deprecated` without a reason renders as the deprecated badge with
no explanation; with text it renders the explanation. `@docs tags` is
comma-split + trimmed. Add new sub-keys by extending `DocsMeta` +
`extractDocsMeta` (and the docs-ui renderer if a new field needs
custom styling).

---

## `@luckystack/create-luckystack-app`

| Flag | Purpose |
|---|---|
| `--no-install` | Skip `npm install` + `npx prisma generate`. |
| `--no-prompt` | New. Skip interactive prompts; use defaults (Mongo + credentials + console email). |

Interactive prompts cover: dbProvider, authMode, oauthProviders,
emailProvider, monitoringProvider, i18n. Choices flow into the template
as `{{DB_PROVIDER}}`, `{{AUTH_MODE}}`, `{{OAUTH_PROVIDERS}}`,
`{{EMAIL_PROVIDER}}`, `{{MONITORING_PROVIDER}}`, `{{I18N_ENABLED}}`.

Post-scaffold runs `npm install` + `npx prisma generate`. We do NOT run
`prisma db push` / `migrate dev` — DATABASE_URL isn't populated yet.

---

## `@luckystack/secret-manager` (new)

| Symbol | Purpose |
|---|---|
| `initSecretManager({ url, token, source?, pointerPattern?, fetchImpl?, dev? })` | Boot-time call. Resolves committed `.env` pointers against the central server and overwrites `process.env` with the real values. |
| `refreshSecretManager()` | Hot reload — re-resolves the captured pointers (used by dev watch/poll). |
| `getCachedResolution()` | Inspect the in-memory cache (pointer -> value). |

Commit pointers, not secrets: `OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5` in `.env`
is resolved to the real `sk-...` value. The shared bearer token lives in a
gitignored single-line file (`token: { fromFile: '.secret-manager-token' }`).
A value that is not pointer-shaped (`<BASE>_V<n>`) is treated as a literal and
left untouched — local overrides win for free.

Server-side of the secret-manager system lives in a separate, running repo
(`luckystack-secret-manager`); its `POST /resolve` wire contract is summarized in
`docs/ARCHITECTURE_SECRET_MANAGER.md`.

---

## Prisma Client extensions

LuckyStack does NOT provide a `prePrismaQuery` / `postPrismaQuery` hook. Instead, Prisma's own `$extends` API in `luckystack/core/clients.ts` is the canonical path for query interception, result transformation, soft-delete logic, multi-tenant routing, audit logging, and so on. A single extended client is registered via `registerPrismaClient(...)` so every framework-internal query AND every project query goes through the same chain.

### Pattern

```typescript
// luckystack/core/clients.ts (consumer-side override)
import { PrismaClient } from '@prisma/client';
import { registerPrismaClient } from '@luckystack/core';

const basePrisma = new PrismaClient({
  log: ['warn', 'error'],
});

export const prisma = basePrisma.$extends({
  name: 'audit-log',
  query: {
    $allModels: {
      async create({ model, args, query }) {
        const start = Date.now();
        const result = await query(args);
        console.log(`[audit] ${model}.create — ${Date.now() - start}ms`);
        return result;
      },
    },
  },
  result: {
    user: {
      displayName: {
        needs: { firstName: true, lastName: true },
        compute(user) {
          return `${user.firstName} ${user.lastName}`;
        },
      },
    },
  },
});

registerPrismaClient(prisma);
```

### Multi-tenant routing example

```typescript
export const prisma = basePrisma.$extends({
  name: 'tenant-scoped',
  query: {
    $allModels: {
      async findMany({ args, query }) {
        const tenantId = getTenantFromContext();
        return query({
          ...args,
          where: { ...args.where, tenantId },
        });
      },
    },
  },
});
```

### Soft-delete example

```typescript
export const prisma = basePrisma.$extends({
  name: 'soft-delete',
  query: {
    $allModels: {
      async findMany({ args, query }) {
        return query({ ...args, where: { ...args.where, deletedAt: null } });
      },
      async delete({ model, args }) {
        return (basePrisma as PrismaClient)[model as Uncapitalize<Prisma.ModelName>].update({
          where: args.where,
          data: { deletedAt: new Date() },
        });
      },
    },
  },
});
```

### What this affects

- Every framework-internal Prisma call (`@luckystack/login`'s session lookups, presence writes, etc.) AND your own handler queries go through the extended client — single source of truth.
- Type-safe: `$extends` produces a new client type with the new methods + result transformations. No casts needed at call sites.
- Composable: chain multiple `.$extends({...})` calls for audit-log + tenant-scope + soft-delete in one client.

### What it does NOT do

- Cannot intercept the underlying database connection (use Prisma's `datasources` config for that).
- Extensions are per-PrismaClient instance — instantiating multiple clients defeats the pattern. Always register the single extended client via `registerPrismaClient(...)` and import the same instance from `clients.ts` everywhere you need it.
- `$extends` runs in the application process; for cross-process invariants (replica routing, connection-pool tuning) reach for Prisma Accelerate or Pulse instead.

---

## Raw Socket events (outside the `_api` / `_sync` system)

Most real-time work belongs in `_sync/` files because they get auth, rate-limit, hook dispatch, room fanout, streaming, and offline queueing for free. But for integrations that speak a non-LuckyStack envelope (legacy clients, third-party SDKs that emit their own socket events), you can attach raw handlers at three documented points.

### Client-side — attach to the framework's connected socket

```typescript
import { socket } from '@luckystack/core/client';

socket?.on('vendor:legacy-event', (payload) => {
  // your handler — runs alongside framework socket events
});
```

The `socket` export is the same `socket.io-client` instance the framework uses internally. Attach inside a `useEffect` if you're in React-land, and remove the listener in the cleanup function.

### Server-side, per-connection — via `onSocketConnect` hook

```typescript
import { registerHook } from '@luckystack/core';

registerHook('onSocketConnect', ({ socket }) => {
  socket.on('vendor:legacy-event', (payload) => {
    // runs every time a client connects + emits
  });
  socket.on('disconnect', () => {
    // optional cleanup
  });
});
```

This is the canonical path. The hook runs after the framework's auth + middleware chain (including any `registerSocketMiddleware` wedges), so by the time your handler attaches the connection is fully authorised.

### Server-side, framework-wide — direct `io` access (advanced)

```typescript
import { getIoInstance } from '@luckystack/core';

const io = getIoInstance();
io?.of('/vendor').on('connection', (socket) => {
  // dedicated namespace — fully outside the LuckyStack envelope
});
```

Use only when you need a separate namespace (e.g. an OpenAI-streaming bridge that mounts its own protocol). Avoid attaching to the default namespace this way — `onSocketConnect` is safer because it runs after middleware.

### What this does NOT replace

Custom socket events are an **escape hatch** for integration shims. They do NOT get LuckyStack's auth-check, rate-limit, room broadcasting, streaming throttle, or offline queue. If you find yourself reimplementing any of those, lift the feature into an `_sync/` file instead.

---

## Scheduled jobs (cron / background work)

LuckyStack does NOT ship a cron primitive. Scheduling is intentionally out-of-scope for v1 because every production deployment has a preferred scheduler — Kubernetes CronJob, AWS EventBridge, Vercel Cron, Render Cron, or an in-process library (`node-cron`, `bull`, `agenda`). Wrapping these in a framework abstraction would just be a leaky shim.

### Recommended patterns

**In-process for simple recurring work (single-instance deploys, dev):**

```typescript
import cron from 'node-cron';
import { logger } from '@luckystack/core';

cron.schedule('0 3 * * *', async () => {
  logger.info('[cron] nightly cleanup');
  // call your existing api/sync handler logic by importing its `main`
  // function directly — they're plain functions, no framework wiring needed
});
```

**Queue-based for retries + visibility:**

```typescript
import { Queue, Worker } from 'bullmq';
// Use the same Redis client you registered via registerRedisClient(...)
const queue = new Queue('reports', { connection: redisClient });
new Worker('reports', async (job) => { /* ... */ }, { connection: redisClient });
```

**External scheduler for multi-instance prod:** point a Kubernetes CronJob / EventBridge rule at a custom HTTP route registered via `registerCustomRoute(...)`. Gates auth with a shared secret header. This keeps scheduling out of your app process entirely.

### Why no built-in

A `registerScheduledJob({name, cron, run})` primitive would either: (a) run in-process — fails in multi-instance deploys without a distributed lock, OR (b) demand a Redis-backed leader-election — which is what bull/agenda already do better. The framework deliberately leaves this slot empty.
