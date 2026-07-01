# Secret Manager architecture

> Replaces the older `ARCHITECTURE_SECRETS.md` design. The client (`@luckystack/secret-manager`) is implemented; the companion server lives in a separate repo (`luckystack-secret-manager`) and only its wire contract is captured here.

LuckyStack treats secrets as **rotation-aware pointers**, not literal strings in `.env`. The app commits a `.env` containing pointer names; at boot the secret-manager client resolves them against a central server and writes the real values into `process.env`. `.env` is safe to commit, and old git branches keep booting because they pin their own version.

## Pointer model

A pointer is any `.env` value matching `^(.+)_V(\d+)$` (configurable):

```bash
# .env (safe to commit)
OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5
STRIPE_KEY=STRIPE_SECRET_KEY_V2
```

The env **name** (`OPENAI_KEY`) is decoupled from the secret **base name** (`OPENAI_AUTHORIZATION_KEY`). The client sends the full pointer string to the server; the server splits `<BASE>_V<n>`, looks up base + version, and returns the real value. The client then overwrites `process.env.OPENAI_KEY` with it.

| `.env` value | After `initSecretManager` | Reason |
| --- | --- | --- |
| `OPENAI_AUTHORIZATION_KEY_V5` | resolved value from the server | Matches `_V\d+` |
| `sk-abc123` | `sk-abc123` | Literal, no match — left untouched |
| `production` | `production` | Literal, no match |

Because non-pointer values are never touched, a developer can paste a real value locally and it always wins — no special override logic needed.

### Rotation

Rotating a secret = publishing a NEW version on the server (`..._V6`), never editing `..._V5`. A PR bumps `.env` from `..._V5` to `..._V6` and merges; old branches still resolve `..._V5` until you retire it. The `.env` git history is not a leak vector — the pointer name is opaque.

## Consumer wiring

Two touch-points, both wired in this repo. First, `config.ts` exposes a `secretManager` slot on the exported config object (NOT `registerProjectConfig` — this is consumer boot glue, not framework config):

```ts
const config = {
  // ...
  secretManager: {
    url: env('LUCKYSTACK_SECRET_MANAGER_URL') ?? '',
    token: { fromFile: '.secret-manager-token' },
    // Which `.env` names are eligible for off-host resolution. SECURE DEFAULT:
    // omitting this resolves NOTHING (deny-all) and emits a one-time boot warning,
    // so the server is never contacted and no pointer is sent off-host. `() => true`
    // opts in to resolving every pointer-shaped (`NAME=BASE_V<n>`) value — the
    // "install secret-manager → it just works" path. Restrict by passing an
    // allowlist array instead, e.g. `['OPENAI_KEY', 'DB_URL']`.
    envNames: () => true,
  },
};
```

> **`envNames` is the gate.** Without it the resolver is deny-all: `initSecretManager` captures zero pointers, returns early before any network call, and the `'remote'` fail-fast below CANNOT fire (you only get the boot warning). The scaffolder and `luckystack add secret-manager` inject `envNames: () => true` for exactly this reason — keep it (or replace it with an allowlist) when wiring by hand.

Second, `server.ts` resolves it through the boot seam in `server/bootstrap/initSecrets.ts`, right after the `.env` files load and before any secret is read (the email sender reads `RESEND_API_KEY`, Sentry reads `SENTRY_DSN`, Prisma/Redis/JWT read theirs lazily):

```ts
import { resolveSecretsIfConfigured } from './bootstrap/initSecrets';
import projectConfig from '../config';

await resolveSecretsIfConfigured(projectConfig.secretManager);

// ... registerEmailConfig / initializeSentry / bootstrapLuckyStack
```

The seam decides remote-vs-local for you, so a project without the package — or with the URL unset — boots unchanged:

| Situation | Behavior |
| --- | --- |
| `url` empty | Skip resolution — boot on the plain local env files. |
| `url` set, package **not** installed | Warn + skip — boot on local env files (no crash). |
| `url` set, package installed, `envNames` **unset** | Deny-all no-op: NO pointer captured, the server is never contacted, a one-time boot warning is logged — the fail-fast below cannot fire. |
| `url` set, package installed, `envNames` set | `initSecretManager` in `'remote'` mode — **fail-fast**: an unresolved pointer or an unreachable server throws and stops the boot. |

> A top-level `await` in `server.ts` is fine — it is an ESM entry and the prod bundle emits `format: esm`. Resolution finishes before `bootstrapLuckyStack` / any `process.env` secret read. `@luckystack/secret-manager` is marked external in `scripts/bundleServer.mjs`, so the prod bundle builds and boots whether or not the package is installed.

## Modes

The boot seam pins `source: 'remote'` (fail-fast) and treats an empty `url` as "off" (plain local env) — the recommended setup. The package itself supports three modes; call `initSecretManager` directly if you need `'local'` / `'hybrid'`:

| `source` | Behavior |
| --- | --- |
| `'remote'` (default, used by the seam) | Resolve from the server. A missing pointer or an unreachable server **throws** — production hard-stop. |
| `'local'` | No network. Pointers untouched. Tests + offline dev. |
| `'hybrid'` | Try the server; on failure warn and keep whatever `process.env` already holds. |

## Dev hot reload (opt-in)

Pass `dev` to live-reload while a long-running dev process is up (ignored in production):

```ts
secretManager: {
  url: '...',
  token: { fromFile: '.secret-manager-token' },
  dev: { watch: true, pollIntervalMs: 5000 },
}
```

- `watch` (default `true`) — debounced `fs.watch` on `dev.envFiles` (default `.env` + `.env.local`). On change the files are **re-parsed**: plain values (`ENVIRONMENT=production`, `PORT=123`) are injected straight into `process.env` (live config reload), pointer values are re-resolved against the server. A pointer added/bumped after boot is picked up — no restart.
- `pollIntervalMs` (default off) — periodic re-resolve of the current pointers, catching server-side rotations. Lives in `config.ts`, so the interval is changeable in one place.
- `envFiles` — override which files are watched (default `['.env', '.env.local']`).

So `.env` (plain config) and `.env.local` (pointers) each get a role: `.env` values are injected as-is on change, `.env.local` pointers are resolved from the server.

## The token

The shared bearer token is the only real secret on the developer machine. Keep it in a gitignored single-line file (`.secret-manager-token`) and reference it via `token: { fromFile }` — read at resolve time, so rotating the file is picked up by the next poll. CI runners inject the file from their secret store. The `.gitignore` already excludes `.secret-manager-token`.

## Server wire contract (separate repo)

The client only depends on one endpoint (below). The full server + admin-UI implementation lives in the separate, running `luckystack-secret-manager` repo.

### `POST /resolve`

```json
// request — the app sends only the pointers it references
{ "keys": ["OPENAI_AUTHORIZATION_KEY_V5", "STRIPE_SECRET_KEY_V2"] }

// response
{ "values": { "OPENAI_AUTHORIZATION_KEY_V5": "sk-...", "STRIPE_SECRET_KEY_V2": "rk-..." } }
```

Auth: `Authorization: Bearer <shared token>`. Unresolvable pointers are omitted from `values` (fatal in `'remote'` mode, a warning in `'hybrid'`).

The server additionally serves an append-only admin webpage (`GET /keys` masked listing, `POST /keys` to append a new version) used only by an operator — the client never calls those.

## What this layer does NOT do

- **No secret storage / versioning** in the app. That is the server's job.
- **No app-key validation.** Whether `DATABASE_URL` is well-formed is the app's concern — validate after `initSecretManager` returns.
- **No per-request rotation guarantee.** Resolution happens at boot (+ optional dev poll). For sub-second rotation use a dedicated SDK at the call site.

## Related

- Package function index: `packages/secret-manager/CLAUDE.md` (post-install: `node_modules/@luckystack/secret-manager/CLAUDE.md`).
- Package concept doc: `packages/secret-manager/docs/architecture.md`.
- External server: the separate `luckystack-secret-manager` repo (running).
- Packaging map: `docs/PACKAGE_OVERVIEW.md`.
