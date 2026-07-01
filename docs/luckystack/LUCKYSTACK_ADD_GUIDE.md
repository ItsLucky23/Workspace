# `luckystack add` — adding an optional feature later

> You scaffolded a BASE (or partial) project and now want to add `login`, `presence`,
> `sync`, `email`, `error-tracking`, or `docs-ui`. `npx luckystack add <feature>` is the
> inverse of the scaffold's opt-out pruner: it installs the package AND injects the
> consumer-`src/` assets a plain `npm i` cannot (Vite can't statically import an
> uninstalled package, and file-based routing only scans `src/`).

## When `npm i` is enough vs when you need `luckystack add`

| Feature | `npm i` alone? | Why |
|---|---|---|
| `error-tracking` (Sentry/PostHog) | **yes** (in BASE) | Env (`SENTRY_DSN`) + restart; `./register` self-wires. |
| `email` (Resend/SMTP) | **yes** | `npm i @luckystack/email <driver>` + env + restart. |
| OAuth provider (google, …) | **yes** | Set the provider's env vars + restart (login's env-scan picks it up). |
| `sync` | **yes** | `npm i @luckystack/sync` (the client bridge is dynamic-imported). |
| `docs-ui` | **yes** | `npm i @luckystack/docs-ui` + its `./register` mounts the route. |
| `login` BACKEND (auth routes, session, OAuth) | **yes** | `npm i @luckystack/login` + env + restart. |
| `login` PAGES (`/login`, `/register`, `/settings/**` + `LoginForm`) | **no** | `npx luckystack add login` copies the editable pages into your `src/`. |
| `presence` SERVER (lifecycle/hooks) | **yes** | `npm i @luckystack/presence` + `./register`. |
| `presence` CLIENT mounts (`LocationProvider`, `SocketStatusIndicator`) | **no** | `npx luckystack add presence` injects the JSX mounts. |

**Rule of thumb:** anything that needs **routable pages or JSX mount-points in your `src/`** needs `luckystack add`; pure backend / self-wiring features are a plain `npm i` + env + restart.

## Usage

```bash
npx luckystack add login          # installs @luckystack/login + copies the auth pages/_api + LoginForm into src/
npx luckystack add presence       # installs @luckystack/presence + injects the LocationProvider + SocketStatusIndicator mounts
npx luckystack add sync           # backend-only: dependency + install (self-wires)
npx luckystack add email          # backend-only
npx luckystack add error-tracking # backend-only
npx luckystack add docs-ui        # backend-only

npx luckystack add login --no-install   # copy/inject only; run npm install yourself
```

The command is **idempotent**: copied files are skipped if they already exist (you own + edit them, shadcn-style), and JSX injections are guarded against double-insertion.

## Per-feature checklists (what to verify after)

**login**
- [ ] `@luckystack/login` is in `package.json`; `npm install` ran.
- [ ] `src/login/`, `src/register/`, `src/reset-password/`, `src/settings/**` pages + their `_api` exist; `src/_components/LoginForm.tsx` exists.
- [ ] `config.ts` — `auth.credentials` reflects whether you want the email/password form; OAuth buttons appear iff a provider's `*_CLIENT_ID` + `*_CLIENT_SECRET` (DEV_-prefixed in dev) are set.
- [ ] **Route guards** (NOT auto-wired — consumer-owned). `add login` installs the backend + pages but does not edit your page guards, so a project scaffolded `auth: 'none'` still routes `/` → `/dashboard` and leaves the dashboard ungated. To auth-gate routing, add a per-page `export const middleware` to the pages you want protected:
  ```ts
  // src/dashboard/page.tsx
  export const middleware: PageMiddleware<SessionLayout> = ({ session }) =>
    session ? { success: true } : { success: false, redirect: '/login' };
  ```
  and have `src/page.tsx` redirect `/` to `/login` (or your entry) when there's no session.
- [ ] Restart the server; visit `/login`.

**presence**
- [ ] `@luckystack/presence` installed.
- [ ] `main.tsx` has `<LocationProvider/>` at the root; `TemplateProvider.tsx` renders `<SocketStatusIndicator/>` (re-added by the injector).
- [ ] `config.ts` — `socketActivityBroadcaster` / `socketStatusIndicator` / `locationProviderEnabled` set as you want (defaults `false`). For production AFK/activity events see `@luckystack/presence` CLAUDE.md.
- [ ] Restart.

**sync / email / error-tracking / docs-ui (backend-only)**
- [ ] Package installed; relevant env set (`SENTRY_DSN`, `RESEND_API_KEY`, etc.).
- [ ] Restart — the package's `./register` subpath self-wires at boot (`bootstrapLuckyStack` auto-imports it before the overlay).
- [ ] sync: migrate app code to `@luckystack/sync/client` if you call `syncRequest` from a place that statically imported it before.

## Troubleshooting

- **"Vite can't resolve `@luckystack/<pkg>`"** after a plain `npm i` of a CLIENT-asset feature → you needed `luckystack add` (it injects the `src/` mounts/pages); run it.
- **Backend feature didn't activate** → it's env-gated. An env key set with the peer package NOT installed is a **hard boot crash** by design (never a silent fallthrough) — install the peer. Exception: `secret-manager` fails OPEN.
- **OAuth button missing** → set BOTH `*_CLIENT_ID` and `*_CLIENT_SECRET` (DEV_ prefix in dev) and restart; the button is driven by the live `/auth/providers` registry, not a static list.
- **Windows CRLF noise in injected files** → the CLI normalizes `\r\n`→`\n` before matching; if an injection can't find its anchor it throws loudly (template drift) rather than silently half-editing.
- **Re-running `add`** is safe — existing files are skipped, edits are idempotent.

## Related

- `@luckystack/cli` CLAUDE.md (`packages/cli/CLAUDE.md`) — the `add` implementation + `check-env` / `check-i18n` audits.
- `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` — the install-anything-anytime architecture.
- `docs/PACKAGE_OVERVIEW.md` — per-package use-case + peer-dep map.
