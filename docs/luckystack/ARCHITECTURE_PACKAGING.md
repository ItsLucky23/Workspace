# Packaging Architecture

<!-- @covers packages/server/src, packages/cli/src, packages/create-luckystack-app/src, scripts/generateServerRequests.ts -->

> Current package boundaries, consumer wiring, generated artifacts, and multi-service packaging contracts.
> This document records stable contracts only. Historical migration logs belong in git history, branch logs,
> ADRs, or dated findings — not in the current architecture reference.
>
> Last reviewed: 2026-08-15

## 1. Source-of-truth rule

Use the following authority order:

1. **Runtime behavior:** source code and tests.
2. **Package identity and dependency contract:** `packages/<name>/package.json`.
3. **Public package surface:** `packages/<name>/README.md` and `packages/<name>/CLAUDE.md`.
4. **Stable cross-package contracts:** this document and the relevant `ARCHITECTURE_*.md` deep dive.
5. **Why a choice was made:** `docs/decisions/`.

This document must not become a line-by-line description of implementation. If a detail can be generated
from a manifest, route map, or TypeScript source, use that generated artifact instead.

## 2. Package boundaries

LuckyStack is distributed as composable `@luckystack/*` packages plus `create-luckystack-app`.
The package list and use-case matrix live in [`PACKAGE_OVERVIEW.md`](./PACKAGE_OVERVIEW.md); exact versions,
exports, dependencies, and peer dependencies live in each package's `package.json`.

The main runtime boundaries are:

| Boundary | Responsibility |
|---|---|
| `@luckystack/core` | Registries, transport contracts, Redis/DB seams, hooks, CSRF, rate limiting, shared primitives |
| `@luckystack/api` | API route execution over Socket.io and HTTP |
| `@luckystack/sync` | Room-based realtime fan-out, streaming, and offline replay |
| `@luckystack/server` | Raw Node HTTP + Socket.io bootstrap and framework route wiring |
| `@luckystack/login` | Credentials/OAuth authentication, sessions, password reset, and 2FA |
| `@luckystack/presence` | Presence, AFK, reconnect, and activity awareness |
| `@luckystack/email` | Transactional email adapters and sender registry |
| `@luckystack/error-tracking` | Backend-agnostic error-tracker adapters and hook instrumentation |
| `@luckystack/devkit` | Route discovery, type/Zod generation, template injection, and dev tooling |
| `@luckystack/router` | Separate-process HTTP/WebSocket routing for multi-instance deployments |
| `@luckystack/cron` | Redis-backed leader-elected recurring jobs with best-effort lease semantics |
| `@luckystack/secret-manager` | Rotation-aware secret-pointer resolution client |
| `@luckystack/test-runner` | Generated-map-driven integration and contract sweeps |
| `@luckystack/docs-ui` | Development API explorer over generated API docs |
| `@luckystack/mcp` | Read-only AI-context query server |
| `@luckystack/cli` | Consumer-side feature management and framework-file update commands |
| `create-luckystack-app` | Fresh-project scaffolding and framework-doc bundling |

## 3. Optional package contract

`@luckystack/server` treats login, presence, sync, email, error tracking, cron, docs-ui, and devkit as
optional peers where declared in its manifest. `bootstrapLuckyStack` detects installed optional packages
and imports their `./register` side-effect entrypoints before consumer overlays. Registration is idempotent;
an absent optional package degrades only the capability that depends on it.

| Capability | Installed package | Absent behavior |
|---|---|---|
| Authentication and sessions | `@luckystack/login` | Auth routes are disabled; core's session provider remains null-safe |
| Realtime sync | `@luckystack/sync` | Sync socket listener is not registered; sync requests return the disabled error envelope |
| Presence | `@luckystack/presence` | Presence lifecycle and peer broadcasts are skipped |
| Transactional email | `@luckystack/email` | Available only when an email adapter is installed/configured |
| Error tracking | `@luckystack/error-tracking` | Capture/instrumentation is a no-op until a tracker is configured |
| Cron | `@luckystack/cron` | No jobs are registered or scheduled |
| API docs UI | `@luckystack/docs-ui` | The development docs route is absent |
| Dev tooling | `@luckystack/devkit` | Production boot remains possible; dev generation/hot reload requires the package |

`@luckystack/secret-manager` is resolved explicitly by the consumer/server bootstrap because it has a
separate fail-open/fail-closed configuration contract. `@luckystack/router` is a separate process, not a
server peer used inside each backend.

## 4. Consumer overlays and installation paths

Framework-owned consumer configuration lives under `luckystack/<package>/`. The server imports overlays in
the canonical order exported as `OVERLAY_ORDER`; package register entrypoints run before consumer overlays so
consumer configuration remains the last writer.

There are two valid ways to add a feature later:

- **Backend-only/self-wiring feature:** install the package with `npm i` or the consumer's selected package
  manager, configure its environment, and restart.
- **Feature requiring consumer files:** run `npx luckystack add <feature>`. The CLI installs the package and
  injects the required route/UI/config assets that a package install cannot create safely.

`npx luckystack remove` reverses supported additions. Login removal is guarded and never deletes user-owned
pages automatically.

## 5. Function injection

The consumer's `functions/` and `shared/` directories are walked to build the injected `functions.*` object
available to API and sync handlers. The merge order is:

1. consumer functions;
2. installed package defaults;
3. framework fallbacks.

The generated `Functions` interface in `src/_sockets/apiTypes.generated.ts` is the typing contract. Full
rules live in [`ARCHITECTURE_FUNCTION_INJECTION.md`](./ARCHITECTURE_FUNCTION_INJECTION.md).

## 6. Hooks and extension points

Package-owned registries and typed hooks are the extension mechanism. A package owns its config and adapter
slots; `@luckystack/core` owns cross-cutting registries and the shared hook bus. Consumers should extend a
registry or hook instead of forking a package. The complete public surface is in
[`ARCHITECTURE_EXTENSION_POINTS.md`](./ARCHITECTURE_EXTENSION_POINTS.md).

## 7. Multi-service and multi-instance packaging

Router topology is opt-in. A base/single-instance scaffold does not need these files:

- `services.config.ts`;
- `deploy.config.ts`;
- `server/config/presetLoader.ts`.

`npx luckystack add router` installs them and wires their imports; `npx luckystack remove router` removes
them again. With no topology config, generation emits one `default` runtime bundle.

When topology config is present:

- root `src/` is the reserved `system` service;
- every service belongs to exactly one preset;
- `generatedApis.<preset>.ts` is emitted per preset;
- a backend can load one or multiple preset bundles;
- cross-instance sockets and sync require shared Redis and the Redis Socket.io adapter;
- Socket.io upgrades are pinned to the `system` service by the router;
- the separate router process must run on Node while Bun's `node:http` upgrade primitive remains broken.

See [`ARCHITECTURE_MULTI_INSTANCE.md`](./ARCHITECTURE_MULTI_INSTANCE.md) for the operational model and
[`HOSTING.md`](./HOSTING.md) for deployment steps.

## 8. Generated artifacts

`@luckystack/devkit` derives route and handler artifacts from source files. Do not hand-edit these files:

- `src/_sockets/apiTypes.generated.ts` — request/response and `Functions` types;
- `src/_sockets/apiInputSchemas.generated.ts` — runtime Zod input schemas;
- `src/docs/apiDocs.generated.json` — API explorer metadata;
- `src/docs/apiTypeDiagnostics.generated.json` — extraction degradation diagnostics;
- `server/prod/generatedApis.<preset>.ts` — production route maps.

They are regenerated by `npm run generateArtifacts`, the dev hot-reload pipeline, and the build pipeline as
appropriate. Generated snapshots are structure; source code and tests remain runtime truth.

## 9. Package build, release, and documentation propagation

Package manifests are the authority for versions, exports, dependencies, peers, and published files.
`npm run build:packages` builds every publishable package; the release workflow runs the package build,
quality gates, pack checks, and publication in dependency order.

The framework-doc bundle is built by:

```sh
node packages/create-luckystack-app/scripts/bundleFrameworkDocs.mjs
```

The bundle copies the root `CLAUDE.md`, `docs/`, `skills/`, `.claude/commands/`, and
`branch-logs/README.md` into `packages/create-luckystack-app/framework-docs/`. That directory is generated;
do not edit it by hand.

A fresh scaffold receives this bundle as `CLAUDE.md`, `docs/luckystack/`, `skills/`, and `.claude/commands/`.
An existing consumer refreshes framework-owned copied files with:

```sh
npx luckystack update
```

The update command preserves user edits by writing `.new` sidecars instead of overwriting modified files.
Package-local `CLAUDE.md` and `docs/` are refreshed by upgrading the corresponding `@luckystack/*` package.

## 10. Runtime bundle selection

The first positional argument selects generated backend bundles; the optional second argument selects the
listen port:

```sh
npm run server                              # default bundle
npm run server -- billing                   # one bundle
npm run server -- billing,vehicles 4001     # merge bundles and listen on 4001
```

No topology config means `generatedApis.default.ts`. With `services.config.ts`, the argument names one or
more preset bundles. The runtime shallow-merges their API, sync, and function maps and fails on key
collisions; a service must belong to exactly one preset.

Ports are single-sourced in `config.ports.ts` for the frontend and default backend. A positional port is an
explicit multi-instance override and wins over the default. The actual bound dev port is advertised through
`node_modules/.luckystack/dev-server.json` so the Vite proxy and test scripts can follow an auto-incremented
port.

### 10.1a Boot-time shared-resource contract

Multi-instance deployments must use the same Redis and database resource identities where the topology
requires shared state. Boot UUID and synchronized-environment checks make divergent resource configuration
visible to the router/health handshake. See [`ARCHITECTURE_MULTI_INSTANCE.md`](./ARCHITECTURE_MULTI_INSTANCE.md)
and [`ARCHITECTURE_SECRET_MANAGER.md`](./ARCHITECTURE_SECRET_MANAGER.md).

## 11. Documentation maintenance rule

Current implementation details belong in code-generated artifacts or package-local docs. This document and
the other architecture docs should contain only stable contracts, invariants, security boundaries, and
operator/developer decisions. Historical work belongs in:

- `branch-logs/` for per-prompt progress;
- `docs/decisions/` for durable rationale;
- `docs/lessons/` for non-obvious failures;
- `docs/findings/<date>-<topic>/` for dated scans and their status.

There is intentionally no root session-checkpoint file. Use `/save_handoff`, which writes under `handoffs/`,
for temporary session continuity.

## Related

- [`PACKAGE_OVERVIEW.md`](./PACKAGE_OVERVIEW.md) — package use cases and peer-dependency guidance
- [`ARCHITECTURE_MULTI_INSTANCE.md`](./ARCHITECTURE_MULTI_INSTANCE.md) — router, sockets, Redis, and scaling
- [`ARCHITECTURE_FUNCTION_INJECTION.md`](./ARCHITECTURE_FUNCTION_INJECTION.md) — injected handler functions
- [`ARCHITECTURE_EXTENSION_POINTS.md`](./ARCHITECTURE_EXTENSION_POINTS.md) — registries, adapters, hooks
- [`HOSTING.md`](./HOSTING.md) — deployment and runtime verification
- [`UPGRADING.md`](./UPGRADING.md) — updating installed framework files safely
