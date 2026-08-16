# Optional package architecture

<!-- @covers packages/server/src/capabilities.ts, packages/server/src/bootstrap.ts, packages/cli/src/commands -->

> Current contract for installing and removing optional LuckyStack packages.
> Historical implementation plans are preserved by git history and ADRs, not mixed into this current
> architecture reference.
>
> Last reviewed: 2026-08-15

## Status

The install-anything-anytime model is implemented in the current release line. `@luckystack/server`
boots with optional login, presence, sync, email, error-tracking, cron, docs-ui, and devkit peers when
they are installed, and degrades only the missing capability when they are absent.

The exact peer ranges and optional flags are defined by package manifests. The public package surfaces
are documented in each package's `CLAUDE.md` and README.

## 1. Optional server capabilities

| Capability | Package | Installed behavior | Absent behavior |
|---|---|---|---|
| Auth/session routes | `@luckystack/login` | Registers the login session provider and auth routes | Auth routes return the disabled contract; core session access stays null-safe |
| Realtime sync | `@luckystack/sync` | Registers the Socket.io and HTTP/SSE sync handlers | Socket sync listener is not attached; HTTP sync returns `sync.disabled` |
| Presence | `@luckystack/presence` | Registers connect/disconnect, AFK, room, and activity behavior | Presence lifecycle and peer notifications are skipped |
| Transactional email | `@luckystack/email` | Registers configured sender adapters | Email is unavailable unless another sender is registered |
| Error tracking | `@luckystack/error-tracking` | Registers configured tracker adapters and instrumentation | Capture is a safe no-op until a tracker is configured |
| Recurring jobs | `@luckystack/cron` | Registers the scheduler and `luckystack/cron/*.ts` jobs | No scheduler or jobs run |
| API docs UI | `@luckystack/docs-ui` | Registers the development API explorer | The docs route is absent |
| Dev tooling | `@luckystack/devkit` | Enables route discovery, generation, hot reload, and dev supervision | Production artifacts can still run; dev generation requires the tool |

`@luckystack/router` is not an in-process server capability. It is a separate HTTP/WebSocket process for
multi-instance routing. `@luckystack/secret-manager` is initialized explicitly because its source mode
controls whether unresolved pointers fail open or fail closed.

## 2. Detection and registration

`packages/server/src/capabilities.ts` detects optional packages once and lazy-loads them only when present.
`bootstrapLuckyStack` then imports the installed packages' `./register` subpaths before consumer overlays.
This ordering gives the framework a safe default while preserving the consumer's overlay as the last writer.

The current auto-registered package order is defined by `OPTIONAL_PACKAGES` in `capabilities.ts`. The sync
package has no server-side register entry; its browser receive bridge is attached from
`@luckystack/sync/client`. Secret-manager is deliberately outside this list because it has a separate
explicit initialization path.

## 3. Sessions and CSRF without login

Session reads and writes are owned by the core session-provider registry. `@luckystack/login` registers the
normal provider when installed; API, sync, presence, and server code use core accessors rather than taking a
hard runtime dependency on login.

When login is absent, the app has no user identity. Cookie-mode state-changing framework requests therefore
use the stateless double-submit CSRF contract: the server-issued CSRF cookie must match the
`x-csrf-token` header. When login is installed, the existing session-bound CSRF path remains authoritative.

## 4. `npm i` versus `luckystack add`

Use a plain package install when the package can self-register at boot:

```sh
npm i @luckystack/email
npm i @luckystack/error-tracking
npm i @luckystack/cron
npm i @luckystack/sync
```

Use `npx luckystack add <feature>` when the feature also needs consumer-owned files that file-based routing
or Vite cannot discover from an uninstalled package:

- `login` copies editable login/register/reset/settings assets;
- `presence` injects the browser-side provider and indicator mounts;
- `router` copies topology config and wires its server imports;
- `docs-ui` copies the consumer docs page;
- `error-tracking` copies the consumer shim;
- `secret-manager` wires the explicit config/server blocks.

`luckystack remove` reverses supported additions. It never deletes user-owned login pages automatically.

## 5. Scaffold and upgrade propagation

`create-luckystack-app` bundles the framework's root `CLAUDE.md`, `docs/`, `skills/`,
`.claude/commands/`, and `branch-logs/README.md` into its `framework-docs/` directory at package build time.
A fresh scaffold receives those files under `docs/luckystack/` and the corresponding root locations.

Existing consumers update framework-owned copied files with:

```sh
npx luckystack update
```

Pristine files are updated; user-modified files receive `.new` sidecars for an AI-assisted merge. Upgrading
an installed `@luckystack/*` package refreshes that package's own `CLAUDE.md` and deep docs in
`node_modules/`.

## 6. Stable references

- Package dependency truth: `packages/<name>/package.json`.
- Package API guidance: `packages/<name>/CLAUDE.md` and README.
- Server bootstrap details: `packages/server/docs/create-server.md` and `packages/server/src/capabilities.ts`.
- Multi-instance behavior: `docs/ARCHITECTURE_MULTI_INSTANCE.md`.
- Package update behavior: `docs/UPGRADING.md` and `docs/ARCHITECTURE_PACKAGING.md`.
