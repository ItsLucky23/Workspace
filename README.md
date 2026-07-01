# Test

Generated with [`create-luckystack-app`](https://github.com/ItsLucky23/LuckyStack-v2).

## Get started

```bash
cp .env_template .env
cp .env.local_template .env.local
# Edit .env.local with your DATABASE_URL and (optional) OAuth secrets

npm run prisma:generate
npm run prisma:db:push   # initialize the database schema (creates the User table)

# In one terminal — backend (HTTP + Socket.io):
npm run server

# In another terminal — frontend (Vite, with proxy to the backend):
npm run client
```

Open <http://localhost:5173>.

## What you got out of the box

The scaffolder ships a working starter — all in your `src/` so you have full control. Exactly which files you got depends on the choices you made when scaffolding (auth mode, presence, email, …); the framework itself lives in `node_modules/@luckystack/*`, but everything in your project is YOUR code, customize freely.

### Pages (you can edit these)

| Path | Route | Purpose |
| --- | --- | --- |
| `src/page.tsx` | `/` | App entry route |
| `src/dashboard/page.tsx` | `/dashboard` | Sample landing page — replace with yours |

If you selected an **auth** mode (`credentials` / `credentials+oauth`), you'll also find the auth UI under `src/`: `login/page.tsx`, `register/page.tsx`, `reset-password/page.tsx`, and an account-management `settings/page.tsx`. Scaffolded with `auth: 'none'`? Add them later with `npx luckystack add login`.

### API routes (you can edit these)

| Path | What it does |
| --- | --- |
| `src/_api/session_v1.ts` | Returns the current session payload to the client |

Selecting an **auth** mode also adds the auth-related API handlers — e.g. `logout_v1`, the `reset-password/_api/*` reset flow, and the `settings/_api/*` session / password / profile / account handlers. These ship alongside the auth pages above (and arrive together via `npx luckystack add login`).

### Shared UI primitives (`src/_components/`)

Components you can modify, restyle, or extend:

- `Avatar.tsx` — user avatar with image + first-letter fallback
- `ConfirmMenu.tsx` — typed-confirm modal form
- `ErrorPage.tsx` — route-level error boundary fallback
- `MenuHandler.tsx` — stack-based modal/sheet system
- `dropdown/Dropdown.tsx` + `dropdown/MultiSelectDropdown.tsx` — single / multi-select inputs with keyboard nav
- `templates/TemplateProvider.tsx` — registers the per-page layouts your site uses
- `templates/Home.tsx` — sample shell (no Navbar by default — wire your own header/sidebar here)

If you selected an **auth** mode, `LoginForm.tsx` (the credentials + OAuth form used by `/login` and `/register`) is here too.

### Shared helpers (`src/_functions/`)

- `menuHandler.ts` — imperative `menuHandler.open()` / `confirm()` API
- `confetti.ts` — `canvas-confetti` wrapper, tune the defaults to taste

### Framework-owned plumbing (in `node_modules/@luckystack/*`)

The framework owns these so you don't have to maintain them — but knowing where they come from is useful:

- `useSession()`, `useTheme()`, `useTranslator()`, `useRouter()` — hooks from `@luckystack/core/client`
- `<Middleware>`, `<AvatarProvider>`, `<TranslationProvider>` — providers from `@luckystack/core/client`
- `i18nNotify` (re-exported as `notify`) — i18n-backed toast wrapper from `@luckystack/core/client`
- If you installed `@luckystack/presence`: `<LocationProvider>` + `<SocketStatusIndicator>` (live presence / socket-status) from `@luckystack/presence/client`.
- Theme + language enums come from your `config.ts` (`defaultTheme`, `defaultLanguage`) and `SessionLayout` types — the framework reads them via `getProjectConfig()`.

To customize translations: add JSON to `src/_locales/` and edit `luckystack/i18n/locales.ts` to register them.

To customize page-load auth / redirect rules: each page owns its own guard — add or edit `export const middleware` in that page's `page.tsx`. The `<Middleware>` component (from `@luckystack/core/client`) runs it before the page renders; return `{ success: false, redirect: '/login' }` to bounce, `{ success: true }` to allow. See `docs/luckystack/ARCHITECTURE_ROUTING.md`.

## Where to configure the framework

| Path | What it is |
| --- | --- |
| `config.ts` | Project-wide framework config (CORS, session, logging, rate limiting, …) |
| `deploy.config.ts` | Resource topology (Redis, Mongo) |
| `services.config.ts` | Service / preset definitions for multi-instance deploys |
| `luckystack/core/clients.ts` | Override Prisma / Redis clients (TLS, Accelerate, sentinel, …) |
| `luckystack/server/index.ts` | Hook registrations + `customRoutes` + notification wiring |
| `luckystack/i18n/locales.ts` | Translation registry — register `_locales/*.json` and the language source |
| `prisma/schema.prisma` | Database schema |
| `server/server.ts` | Server entry — usually no need to edit |

With an **auth** mode selected, OAuth providers auto-wire from env at boot (set the vars in `.env.local`; no file needed), the user adapter self-wires via `defaultPrismaUserAdapter` (override with `registerUserAdapter()` in `luckystack/server/index.ts`), and `server/hooks/notifications.ts` wires the transactional new-sign-in / password-change emails.

## File-based routing

- `src/<page>/page.tsx` → route `/<page>` (lowercase folder name)
- `src/<page>/_api/<name>_v{n}.ts` → API endpoint `api/<page>/<name>/v<n>`
- `src/<page>/_sync/<name>_server_v{n}.ts` → sync event `sync/<page>/<name>/v<n>`
- Folders prefixed with `_` are private — they never become routes.

After adding a route, run `npm run generateArtifacts` to regenerate the type maps + Zod schemas.

## Hooks

The framework dispatches lifecycle hooks for every major operation (login, password change, upload, rate-limit, CSRF mismatch, etc.). Subscribe in `luckystack/server/index.ts`:

```ts
import { registerHook } from '@luckystack/core';

registerHook('onUploadComplete', ({ userId, fileName, sizeBytes }) => {
  auditLog.write({ kind: 'upload', userId, fileName, sizeBytes });
});

registerHook('rateLimitExceeded', ({ scope, key, limit }) => {
  // alert ops / increment metric / block IP, your choice
});
```

Full hook list lives in `@luckystack/core/dist/hooks/types.d.ts`.

## Docs

Full framework docs: <https://github.com/ItsLucky23/LuckyStack-v2#readme>
