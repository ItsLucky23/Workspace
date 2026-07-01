# Packaging Architecture

> Single source of truth for LuckyStack package extraction strategy.

Last updated: 2026-05-13
Status: Tier-A across the board; awaiting first publish

> **Current state (2026-05-13):** all 14 workspaces in `packages/` build clean and are flagged `"private": false` + `publishConfig.access: "public"`. Every package targets Tier-A — `@luckystack/devkit` was promoted on 2026-05-13 (was Tier-B), `@luckystack/router` was promoted on 2026-05-11, all others were Tier-A by design. `@luckystack/login` is no longer Prisma-coupled (DI'd through `registerUserAdapter` / `defaultPrismaUserAdapter`). All Tier-A packages have READMEs and are wired into `bootstrapLuckyStack` / `createLuckyStackServer`. Remaining publish steps: register the `@luckystack` npm scope and run `npm pack --dry-run` per package to validate tarball contents. Per-package READMEs under `packages/<name>/README.md` are the source of truth for public API.

---

## 1) Product Goal

LuckyStack should be installable in a fresh Vite project as small, composable npm packages.

Target developer experience:

1. Install minimal `@luckystack/core`.
2. Add optional feature packages like `@luckystack/login` and `@luckystack/sync`.
3. Build app features without editing framework internals.

This replaces monolithic framework cloning as the default adoption path.

---

## 2) Package Model (Current Direction)

### 2.1 Core

`@luckystack/core`

Responsibilities:

- File-based routing primitives (page + API route contracts)
- API request client/server transport contract
- Shared response/error contracts and utilities
- Core UI/runtime primitives that should exist in every project:
	- template provider
	- middleware support
	- translation provider

Non-responsibilities:

- OAuth/credentials auth logic
- Presence/activity modules
- Sentry-specific logic

### 2.2 Login

`@luckystack/login`

Responsibilities:

- Credentials + OAuth login/logout flows
- Session provider and auth-related lifecycle APIs
- Optional package-provided default functions for login/session

Note:

- Session-aware behavior should come with login by default for most users.

### 2.3 Sync

`@luckystack/sync`

Responsibilities:

- Real-time sync transport
- Room targeting/fanout semantics
- Sync client callback contracts

### 2.4 Presence (sync++)

`@luckystack/presence`

Responsibilities:

- Online/offline/AFK/team activity state
- Socket status provider for multiplayer/team visibility

Dependencies:

- Depends on sync and a generic session contract.
- Must not require `@luckystack/login` directly.
- If login package is installed, presence can consume its session adapter.
- If login package is not installed, projects can provide a custom session adapter.

### 2.5 Error tracking (optional)

`@luckystack/error-tracking` (renamed from `@luckystack/sentry` on 2026-05-11; kept Sentry-backed but the package name is now implementation-agnostic so future adapters can slot in)

Responsibilities:

- Register observability hooks for API/sync/auth lifecycle
- Read runtime behavior from a dedicated Sentry config
- Auto-enable only when:
	- Sentry is enabled in config
	- DSN exists in env
- No-op behavior when either condition is missing

Expected configuration contract:

- `sentry.enabled` boolean toggle
- DSN and environment values from env
- Optional release, sample rates, and transport tuning options

### 2.6 Dev Tooling

`@luckystack/devkit` (single dev package)

Reasoning:

- One package is simpler than splitting too early.
- Internally exposes separately toggled tools:
	- type generation
	- template injection
	- hot reload

---

## 3) Functions Injection Model (Current Direction)

### 3.1 Project-level functions folder

When installing `@luckystack/core`, projects should have a root-level `functions/` folder with default function modules.

Example:

```
project/
	functions/
		core/
			logger.ts
			responseNormalizer.ts
```

### 3.2 Package-contributed functions

Feature packages may add function bundles.

Example:

- `@luckystack/login` contributes session/auth functions
- `@luckystack/sync` contributes sync-related helpers

### 3.3 Merge contract

Runtime uses a merged, typed function registry:

1. Project functions (highest priority)
2. Installed package default functions
3. Core fallbacks

This keeps defaults usable while allowing user overrides.

Clarification:

- If project defines `functions/session/getSession`, that implementation overrides login package defaults.
- If project does not define it, and login package is installed, login package implementation is used.
- If neither project nor feature package defines it, core fallback is used.

---

## 4) Hook Contract

Hook model remains required for package extensibility.

Status: Scaffold implemented (2026-04-23). `server/hooks/registry.ts` and `server/hooks/types.ts` are live. `preApiExecute`, `postApiExecute`, `preSyncFanout`, `postSyncFanout` dispatch calls are wired. Auth/session/presence hooks are typed in the payload map but dispatch calls are deferred to their respective package extraction phases.

Stages:

- `pre:*` hooks (validate/transform/short-circuit)
- `post:*` hooks (augment side effects)

Rules:

- Deterministic order
- Typed payloads
- Isolated errors per hook — one failing handler never interrupts the main flow

Full inventory (typed in `server/hooks/types.ts`):

- Auth: postLogin, postRegister, postLogout
- Session: postSessionCreate, postSessionDelete
- API: preApiExecute, postApiExecute
- Sync: preSyncFanout, postSyncFanout
- Presence: prePresenceUpdate, postPresenceUpdate

Hooks not yet in the type map (add when packages need them):

- preLogin, preRegister, preLogout
- preSessionCreate, preSessionDelete, preSessionRefresh, postSessionRefresh
- preApiValidate, postApiValidate, preApiRespond, postApiRespond
- preSyncValidate, postSyncValidate, preSyncAuthorize, postSyncAuthorize
- preRouteResolve, postRouteResolve
- preErrorNormalize, postErrorNormalize

---

## 5) Type Safety and Devkit Strategy

### 5.1 Runtime independence

Runtime packages (`core/login/sync/presence/sentry`) must not require devkit at runtime.

### 5.2 Strict generated typing mode

When devkit typegen is enabled:

- Generate strict API/sync/function maps
- Build/lint should fail when generated artifacts are stale or missing

### 5.3 Relaxed mode

When devkit is not enabled:

- Runtime still works
- Typing is less strict/fallback-safe

Default behavior:

- `strictTypegen = true` by default
- Projects can explicitly disable strict mode when needed

Operational rule:

- Strict mode should be the default for CI and production branches.
- Relaxed mode is an explicit opt-out for early prototyping.

---

## 6) Multi-Service Build and Polyrepo Direction

This is a required target, not optional.

Desired project structure example:

```
src/
	housing/
	vehicles/
	candidates/
```

Build outputs required:

1. Frontend aggregate build
- Scans full `src` and emits one frontend asset output with all pages.

2. Preset-scoped backend builds
- Build inputs are preset names from a dedicated build-routing config file.
- Each preset maps to one or more service keys.
- Backend generation emits one route map file per preset: `generatedApis.PRESETNAME.ts`.
- Running build with no preset arguments builds all presets.
- Running build with preset arguments builds only those presets.

3. Service ownership model
- Root `src/` is the `system` service.
- Service folders are first-level folders inside `src/` (for example `src/vehicles`, `src/candidates`).
- Single-service backend builds are represented as a preset containing exactly one service.
- Services not assigned to any preset are excluded from scoped builds and logged as warnings.

Routing/runtime behavior target:

- In development, engineers should be able to run frontend plus one local service, multiple local services, or a full local server.
- Requests for routes not owned by local service should be forwarded to configured remote environments (for example staging service endpoints).
- Health polling discovers newly started local service servers and routes new traffic to local targets when healthy.
- When a service target changes in development, socket reconnection/switching is acceptable; transient in-memory state loss or in-flight call loss is acceptable in dev mode.
- This enables focused local debugging in large codebases without running every service locally.

Important runtime note:

- Frontend uses one origin in dev (for example localhost), so a dev-side router is required.
- This router can be implemented as built-in LuckyStack load balancer backend, external proxy, or hybrid setup.

Service routing contract:

- API/sync route names must start with service key as first segment:
	- `vehicles/getAll`
	- `system/session`
- Transport URLs keep the service key in the segment after `api/` or `sync/` (for example `/api/candidates/getAll/v1` -> `candidates`).
- The load balancer reads that service segment and forwards to configured backend URL for that service.
- If requested service key has no backend assignment, load balancer returns a clear error (`serviceNotAssigned`).
- Service ownership is one-to-one: a service may belong to only one preset.

Load balancer config model:

- Provide a project config file that maps service -> backend URL.
- Provide a load balancer config template in the framework docs/templates.
- Provide a lightweight load balancer backend server implementation in framework tooling.

### 6.2 Dev traffic routing options

Option A: Built-in LuckyStack load balancer backend

- Pros: service-key aware by default, no extra infrastructure dependency.
- Cons: we must own mature proxy behaviors ourselves.

Option B: External reverse proxy (for example Caddy)

- Pros: mature routing/TLS/compression/retry/logging behavior.
- Pros: simple local forwarding from one frontend origin to mixed local/remote service targets.
- Cons: needs extra config generation and sync with service map.

Recommended dev default:

- Use external proxy (Caddy) with generated config from service mapping.
- Keep built-in load balancer backend available as fallback/runtime adapter.

### 6.3 Production edge strategy

Proxy-first in production is valid and recommended.

Recommended production model:

1. Edge proxy handles TLS, HTTP/2/3, compression, websocket upgrade, retries, and access logs.
2. LuckyStack routing contract remains source of truth for service-key resolution.
3. Generated proxy config maps service keys to service upstreams.

This gives operational stability while preserving framework-level routing semantics.

Example mapping:

```
services:
	system: http://localhost:4100
	vehicles: http://localhost:4101
	housing: http://staging-housing.internal
	candidates: http://staging-candidates.internal
```

### 6.4 Name-collision and route-shape validation

Validation rules for template injector and type generation:

1. API/sync file names must not contain `/` in route name segments.
2. Invalid route naming must fail generation with explicit error.
3. Duplicate emitted route keys must fail generation.
4. `system` is reserved for root `src/` and `src/system` is invalid.
5. Preset configuration must fail when a service is assigned to multiple presets.

Example collision scenario to block:

- `src/test/_api/testApi_v1.ts` and a conflicting nested route that emits same final route key.

Bundling behavior:

- Invalid routes are ignored for bundling and reported as errors.
- Build should fail when strict typegen is enabled.

Package impact:

- Core must support first-segment service routing contract.
- Sync/login/presence packages must be service-root aware.
- Devkit typegen must support both aggregate and service-scoped generation modes.

---

## 7) Non-Breaking Extraction Rules

During migration:

1. No route shape changes.
2. No payload contract changes.
3. No mandatory config additions for existing projects.
4. New capabilities default to no-op/disabled.

---

## 8) Execution Order

1. Verify package boundaries and planning with user/team and freeze v1 package map.
2. Build complete pre/post hook inventory and assign ownership per package.
3. Finalize core boundaries and exports.
4. Implement project-level `functions/` contract + merge rules.
5. Extract login package with session provider and login hooks.
6. Extract sync package.
7. Extract presence package.
8. Add optional sentry package.
9. Ship devkit with typegen/template/hot-reload toggles.
10. Add service-scoped backend build target with first-segment service routing.
11. Ship load balancer backend server with service->URL config mapping and error-on-unassigned-service behavior.
12. Add dev forwarding for non-local service roots to staging/remote endpoints.

---

## 9) Required Code Changes Before Package Extraction

This section defines concrete implementation changes that must happen in the current codebase before package split can work reliably.

### 9.1 Route naming contract migration (API + sync)

All API and sync names must follow service-first naming.

Required runtime call shapes:

- `system/session`
- `system/logout`
- `vehicles/getAll`
- `housing/create`

Required migration:

1. Root/global API and sync calls must be renamed to `system/*`.
2. Internal helper usage must stop relying on implicit root names.
3. Existing calls that currently use root names must be updated to `system/*`.

### 9.2 Helper function behavior changes

`apiRequest` and `syncRequest` behavior must align with service-first contract.

Required behavior:

1. Validate that request name contains service segment.
2. Reject invalid names with stable error code (for example `routing.invalidServiceRouteName`).
3. Route parsing must use first segment as service key.

### 9.3 Dev loader and typegen changes

Dev/runtime loaders and generated maps must emit normalized service-first route keys.

Required changes:

1. Dev loader normalizes root/global routes to `system/*`.
2. Type generation emits keys in service-first format only.
3. Generated strict types must reflect service-first route naming in all maps.

### 9.4 Template injector and route validation

Template injector and generation pipeline must block ambiguous/invalid route names.

Required validation:

1. API/sync file names may not include `/` in the route name token.
2. Invalid names fail generation with explicit message and file path.
3. Duplicate normalized route keys fail generation.
4. Strict mode turns these into build failures.

### 9.5 Service-scoped backend build outputs

Build system must support preset-level backend targets.

Required outputs:

1. Frontend aggregate output (all pages).
2. One backend map artifact per preset (`generatedApis.PRESETNAME.ts`).
3. Single-service builds via single-service presets (for example `vehicles-only`).
4. Grouped builds via multi-service presets (for example `platform-core`, `marketplace-domain`).
5. Presetless build invocation should compile all presets.

### 9.6 Load balancer backend output

Framework tooling must produce a load balancer backend output.

Required behavior:

1. Parse first route segment as service key.
2. Forward to configured service backend URL.
3. Return explicit `serviceNotAssigned` error when mapping is missing.
4. Support local + remote target mix for development.
5. In development fallback mode, poll local service targets and switch new traffic to local when healthy.
6. Socket/API routing decisions should use the same service-target resolver.
7. Split/fallback mode requires shared Redis; startup hard-fails when Redis is unavailable.
8. Development mode may reconnect socket targets when local service health changes; this does not need zero-loss guarantees.

### 9.7 Presence package decoupling

Presence must not hard-depend on login package.

Required architecture:

1. Presence depends on sync and session interface.
2. Session interface may be provided by login package or custom adapter.
3. Presence runtime must work without `@luckystack/login` installation.

### 9.8 Functions folder + fallback resolution

Project-level functions must be first-class and override package defaults.

Required behavior:

1. Core installation creates root `functions/` structure.
2. Runtime registry resolution order:
	1. Project functions
	2. Package defaults
	3. Core fallbacks
3. Type generation includes all resolved function sources.
4. Project override must immediately affect runtime behavior.
5. Phase 1 (current target): keep full resolved function registry in scoped builds for runtime safety.
6. Phase 2 (future optimization): optional import-graph-based function pruning after explicit design + validation.

Status: Phase 1 implemented (2026-04-23). `functions/` folder established at project root. `scripts/generateServerRequests.ts` merges `functions/` (project) over `server/functions/` (package defaults) by module name — a file in `functions/session.ts` fully replaces `server/functions/session.ts` in the generated map. Phase 2 pruning remains deferred.

### 9.9 Sentry package activation contract

Sentry integration must be optional and configuration-driven.

Required behavior:

1. `@luckystack/sentry` auto-activates only when config enabled and DSN is present.
2. If disabled/missing DSN, package is no-op.
3. Runtime reads unified sentry config object.

### 9.10 Sentry helper exports

Sentry package should export helper functions so app code can instrument custom locations while reusing same global config.

Required exports:

1. `captureException`
2. `captureMessage`
3. `setUser`
4. `setTag`
5. `setContext`
6. `startSpan`
7. `withScope`

All helpers must use same package-level initialization and respect enabled/disabled state.

---

## 10) Configuration Examples

> **Opt-in — not shipped by default.** The two topology files below (`services.config.ts` + `deploy.config.ts`) and their build-time validator (`server/config/presetLoader.ts`) are **only present when the router is installed**. A base / single-instance scaffold PRUNES all three; `npx luckystack add router` copies them in (and wires the two `server.ts` side-effect imports `import '../deploy.config'` + `import '../services.config'`), `npx luckystack remove router` deletes them again. When the files are absent, `scripts/generateServerRequests.ts` falls back to a single `default` bundle, so a bare `npm run server` still works (see §10.1a). A single-instance app never needs them.

> **Ports are single-sourced in `config.ports.ts`.** Frontend (Vite dev) + backend listen ports live in one pure-data file — `export const ports = { frontend, backend } as const` — with no imports or side-effects, so `vite.config.ts` can read it without pulling in server-only `@luckystack/core`. `config.ts` re-exports `ports` and derives `publicUrl` / `backendOrigin` from it; `vite.config.ts` reads it for `server.port` + the dev-proxy target; `server.ts` passes `defaultPort: ports.backend` to `bootstrapLuckyStack`. So there is exactly ONE place to change a port. `SERVER_PORT` is no longer in the scaffold `.env` — the listen port defaults to `config.ports.backend`, and a positional argv port (`npm run server -- <preset> <port>`) still overrides it for a multi-instance boot. (`SERVER_IP` stays in `.env` as the bind address.) Multi-instance setups define per-service ports in `deploy.config.ts` bindings instead.

Canonical shape for the router topology is TypeScript, split into two files at project root (added by `npx luckystack add router`):

- `services.config.ts` — services + preset grouping. Stable build-time source of truth. Changes when services are added/renamed/regrouped.
- `deploy.config.ts` — resources (named redis/mongo handles) + environments (resource refs, per-service URL bindings, optional typed `fallback`). Changes when infra changes.

Validator (in `server/config/presetLoader.ts`, also added by `add router`) enforces:

1. `system` service must have `source: 'root'`; `src/system` is reserved.
2. A service belongs to exactly one preset.
3. Every environment `redis` / `mongo` must reference a known resource of the correct type.
4. If `env.fallback` is set, the source and target environments must reference the SAME resource key for both redis and mongo. This makes "two different Redis URLs that both respond" unrepresentable.
5. No fallback cycles.

### 10.1 services.config.ts (sketch)

```ts
export default {
	services: {
		system:   { source: 'root' },
		vehicles: { source: 'vehicles' },
		billing:  { source: 'billing' },
	},
	presets: {
		'core-preset':    { services: ['system'] },
		'fleet-preset':   { services: ['vehicles'] },
		'finance-preset': { services: ['billing'] },
	},
};
```

### 10.2 deploy.config.ts (sketch)

```ts
export default defineDeploy({
	resources: {
		redisShared: { type: 'redis', urlEnvKey: 'REDIS_URL', synchronizedEnvKeys: ['COOKIE_SECRET'] },
		mongoShared: { type: 'mongo', urlEnvKey: 'DATABASE_URL' },
	},
	environments: {
		development: {
			redis: 'redisShared',
			mongo: 'mongoShared',
			fallback: 'staging',                  // typed: keyof environments
			bindings: { system: 'http://localhost:4100', vehicles: 'http://localhost:4101' },
		},
		staging: {
			redis: 'redisShared',
			mongo: 'mongoShared',
			bindings: { system: 'https://staging-api.../system', vehicles: 'https://staging-api.../vehicles' },
		},
	},
	routing: { onMissingService: 'proxy-fallback', missingServiceErrorCode: 'serviceNotAssigned' },
	development: { enableFallbackRouting: true, healthPollMs: 5000, switchNewTrafficToLocalWhenHealthy: true },
});
```

### 10.1a Runtime bundle selection

Which preset's generated route map(s) load at runtime is controlled by the **first positional argv** to `server.ts` (parsed by `@luckystack/server/parseArgv`, which the template imports as the first line):

```
npm run server                              # loads generatedApis.default.ts
npm run server -- billing                   # loads generatedApis.billing.ts
npm run server -- billing,vehicles          # loads both, runtime-merged into one process
npm run server -- billing,vehicles 4001     # same, listening on port 4001 (second positional)
```

- No args: loads `server/prod/generatedApis.default.ts` (aggregate build). This is the **only** bundle in a base install — when `services.config.ts` is absent (no router), `scripts/generateServerRequests.ts` emits just the `default` preset, so a bare `npm run server` always resolves.
- One preset name: loads `server/prod/generatedApis.{preset}.ts`.
- Comma-separated list: loads each preset's map and shallow-merges `apis` / `syncs` / `functions`. **Key collisions across presets throw at boot** — services must own exactly one preset (§10.1 ownership rule).
- The files are emitted by `scripts/generateServerRequests.ts`: the single `default` bundle when no router config is present, or one file per preset defined in `services.config.ts` once `npx luckystack add router` adds it.

**Port (second positional argv).** The listen port comes from `defaultPort: ports.backend` (from `config.ports.ts`), which `server.ts` passes to `bootstrapLuckyStack`. A second positional argv port (`npm run server -- <preset> <port>`) sits ABOVE it and still wins — required for booting multiple instances behind the router on one host. `SERVER_PORT` is no longer read from `.env`.

### 10.1b Boot-time shared-resource handshake (recommended)

In addition to the static config check, on startup each bundle should:

1. Generate a boot UUID and write it to Redis at a well-known key (for example `luckystack:boot:{env}`).
2. If the current environment declares a `fallback`, hit the fallback's `/health` endpoint and assert it reports the same UUID.

This catches divergent `redis://...` URLs that both happen to respond. Implementation is out of scope for this doc; it belongs with the load balancer backend (§9.6).

### 10.2 Type generation config

```yaml
typegen:
	strictTypegen: true
	failOnInvalidRouteName: true
	failOnDuplicateRouteKey: true
	failOnReservedServiceFolder: true
	failOnServicePresetCollision: true
```

### 10.3 Sentry config

```yaml
sentry:
	enabled: true
	dsnEnvKey: SENTRY_DSN
	environmentEnvKey: NODE_ENV
	releaseEnvKey: SENTRY_RELEASE
	serverNameEnvKey: SENTRY_SERVER_NAME
	tunnel: null
	orgId: null
	projectId: null
	attachStacktrace: true
	sendDefaultPii: false
	maxBreadcrumbs: 100
	normalizeDepth: 5
	normalizeMaxBreadth: 1000
	debug: false
	enableTracing: true
	tracesSampleRate: 0.2
	tracesSampler: null
	profilesSampleRate: 0.0
	profilesSampler: null
	replaysSessionSampleRate: 0.0
	replaysOnErrorSampleRate: 0.0
	enableLogs: false
	beforeSendEnabled: true
	beforeBreadcrumbEnabled: true
	beforeSendTransactionEnabled: true
	ignoreErrors: []
	allowUrls: []
	denyUrls: []
	integrations: []
	transportOptions: {}
	initialScope: {}
```

Contract note:

- `@luckystack/sentry` config should expose all supported SDK options either as first-class keys or via pass-through object.
- Package should avoid blocking advanced Sentry configuration and should forward unknown supported keys to Sentry SDK initialization.

### 10.4 Service routing + proxy config generation

```yaml
routing:
	devRouterMode: proxy
	proxyProvider: caddy
	generateProxyConfig: true
	proxyConfigPath: ./generated/caddy/Caddyfile
	fallbackToBuiltInLoadBalancer: true
```

### 10.5 CI affected-build strategy

```yaml
ci:
	affectedMode: true
	buildOnlyChangedPresets: true
	lintOnlyChangedPresets: true
	buildAllOnSharedOrCoreChanges: true
	lintAllOnSharedOrCoreChanges: true
```

---

## 11) Documentation Updates Required Across Repository

This file is canonical, but these docs must be updated when implementation starts.

1. Routing architecture doc (service-first names and `system/*` convention).
2. API architecture doc (`apiRequest` naming/validation behavior).
3. Sync architecture doc (`syncRequest` naming/validation behavior).
4. Developer guide (new build outputs, local-service + staging forward workflow).
5. README (new package install paths and service routing assumptions).

---

## 12) Scope Note

This document supersedes older brainstorming and handoff planning documents for packaging direction.

If strategy changes, update this file first and treat it as the canonical reference.

---

## 13) Immediate Next Step (Start Now)

Status: Completed (2026-04-20). Kept as historical record of the first routing-contract milestone.

Ship one non-breaking routing-contract PR before package extraction.

Goal:

- Enforce service-first route naming (`service/name`) across request helpers and runtime resolution.
- Migrate all root/global route usage to `system/*`.

Implementation scope for this first PR:

1. Add one shared route-name parser/validator used by API and sync request flows.
2. Update `apiRequest` and `syncRequest` to require a service segment in route names.
3. Return stable routing errors for invalid names (for example `routing.invalidServiceRouteName`).
4. Update existing root/global call sites to use `system/*` directly.

Out of scope for this first PR:

1. Package extraction work.
2. Load balancer backend generation.
3. Service-scoped build output refactor.

Definition of done:

1. All API/sync request names used by app code are service-first.
2. Invalid route-name shape is rejected with stable routing error code.
3. Runtime route resolution no longer depends on implicit root-level names.
4. This document and routing/API/sync docs are updated to reflect final behavior.

Manual verification checklist:

1. Request `system/session` succeeds.
2. Request with invalid name shape fails with `routing.invalidServiceRouteName`.
3. Legacy root route fails with explicit routing error.

Status update (2026-04-17):

1. Shared service-first route parsing is implemented and reused in API/sync request paths.
2. Client and server request handling rejects invalid route names with `routing.invalidServiceRouteName`.
3. Runtime route resolution no longer falls back to implicit root-level route names.
4. Global API source files remain in `src/_api`, but are mapped to `api/system/*` at generation/load time.
5. Route naming validation now hard-fails dev startup and build generation for invalid `_api/_sync` filenames.

---

## 14) Next Session Plan (2026-04-21)

Primary goal:

- Close the routing-contract milestone cleanly, then start service-scoped build foundations.

Step-by-step plan:

1. Finalize routing-contract hardening (Completed 2026-04-20):
- Duplicate normalized route-key detection now fails generation with explicit context.
- Duplicate checks now run in both type-map generation and server request map generation.

2. Complete documentation sync for new contract (Completed 2026-04-20):
- README examples now use service-first helper names with explicit versions.
- Developer guide snippets no longer imply implicit root helper names.

3. Start service-scoped backend build design (Section 9.5) (Completed 2026-04-21):
- Build inputs are preset names from a dedicated config file.
- Backend map output is one file per preset (`generatedApis.PRESETNAME.ts`).
- Root `src/` is `system`, `src/system` is invalid, and service ownership is one-to-one across presets.
- Development fallback routing uses polling and can switch new traffic to a newly healthy local service target.
- Split/fallback mode requires shared Redis and hard-fails when Redis is unavailable.
- Function handling remains Phase 1 (safe full registry); Phase 2 pruning is documented as future work.

4. Implement first thin slice for preset-scoped builds:
- Introduce dedicated preset config loader + validation.
- Extend generation script(s) with preset selection arguments.
- Generate preset-scoped map artifact(s) and validate runtime loading.
- Add validation that rejects `src/system` and service-to-multiple-presets assignments.

5. End-of-session verification before moving to next milestone:
- `npm run lint`
- `npm run build`
- Confirm `system/session` success, invalid helper route-name rejection, and hard errors for invalid preset/service config.

---

## 15) Deferred / Backlog

Parked items that are intentionally out of scope for the current packaging push. Revisit when the core package split has shipped.

- **`@luckystack/monitoring`** — full request-forensics package (dual-stream: Sentry for "why", monitoring package for "what"; OpenSearch-backed audit trail; P95/P99 metrics; RUM), to live in its own repo. Tracked in `docs/ROADMAP.md`. Parked pending a decision on whether we self-host a search engine for this or consume an external one. The package would hang off `postApiExecute` / `postSyncFanout` hooks (now live in §4), so no core design changes are blocked on it.
- **Phase 2 function pruning** — import-graph-based pruning of the per-preset function registry (§9.8 point 6). Current Phase 1 bundles all functions in every preset for safety; optimize only after measurement.
- **Frontend typegen scope in split deployments** — define whether `apiTypes.generated.ts` should include all presets' routes or be preset-scoped when projects split frontend per domain. Currently aggregate.
- **`@luckystack/web-vitals`** — client-side RUM package (LCP/INP/CLS, etc.). Lower priority than backend observability; will fold into the `@luckystack/monitoring` repo as a subpath rather than ship standalone.

---

## 16) Session Log (2026-04-23)

Completed:

1. Hook registry scaffold (§4) — `server/hooks/types.ts` + `server/hooks/registry.ts` live. `preApiExecute`, `postApiExecute`, `preSyncFanout`, `postSyncFanout` wired in socket handlers.
2. Functions/ merge contract Phase 1 (§9.8) — `functions/` root folder established, `generateServerRequests.ts` merges project overrides over server defaults by module name.
3. `game.ts` migrated from `server/functions/` to `functions/` — first proof of the project-functions override contract working end-to-end.
4. `@luckystack/core` package scaffold created at `packages/core/` — all six `shared/` utilities (sleep, tryCatch, serviceRoute, socketEvents, responseNormalizer, sentrySetup) moved to `packages/core/src/` as the canonical source. `shared/` files are now thin re-export shims for backwards compatibility. `@luckystack/core` path alias added to both tsconfigs; Vite picks it up automatically via `tsconfigPaths`.

---

## 17) Session Log (2026-04-23, continued)

Completed:

1. `@luckystack/login` package scaffold created at `packages/login/`.
2. `BaseSessionLayout`, `SessionLocation`, `AuthProps` defined in `packages/login/src/sessionLayout.ts` as the framework-owned type contracts.
3. `@luckystack/login` path alias added to both tsconfigs; `packages/login/src` added to include arrays.
4. `config.ts` updated: `SessionLocation` and `AuthProps` removed from the file body and re-exported from `@luckystack/login`. `SessionLayout` kept as the project-specific type (extends Prisma `User`). Structural compatibility check added as a compile-time assertion.
5. `server/hooks/types.ts` updated: now imports `BaseSessionLayout` from `@luckystack/login` instead of `SessionLayout` from `config`.

---

## 18) Session Log (2026-04-23, continued)

Completed:

1. `server/functions/session.ts` → `packages/login/src/session.ts`. Hook dispatches added: `postSessionCreate` (on `newUser === true` in `saveSession`) and `postSessionDelete` (in `deleteSession`). Dynamic import of `logout` updated to `./logout` (same package dir). Dynamic import of socket updated to `../../../server/sockets/socket`.
2. `server/auth/login.ts` → `packages/login/src/login.ts`. Hook dispatches added: `postRegister` (credentials register + OAuth new user) and `postLogin` (credentials login + OAuth callback). `isNewOAuthUser` flag added to track new vs returning OAuth users.
3. `server/auth/loginConfig.ts` → `packages/login/src/loginConfig.ts`. `tryCatch` now from `@luckystack/core`.
4. `server/sockets/utils/logout.ts` → `packages/login/src/logout.ts`. Hook dispatch added: `postLogout`.
5. All four original server files replaced with one-liner re-export shims — no import-site changes needed across the server.
6. `packages/login/src/index.ts` updated to barrel-export all runtime functions.

All auth lifecycle hooks (`postLogin`, `postRegister`, `postLogout`, `postSessionCreate`, `postSessionDelete`) are now wired.

---

## 19) Session Log (2026-04-24)

Completed:

1. Fixed `tsx` not resolving `@luckystack/core` at runtime — added `--tsconfig tsconfig.server.json` to both `server` and `server:direct` scripts in `package.json` so tsx loads the correct path aliases.
2. Fixed `tryCatch` default-vs-named import mismatch in `packages/login/src/loginConfig.ts`, `login.ts`, and `logout.ts` — changed `import tryCatch from '@luckystack/core'` to `import { tryCatch } from '@luckystack/core'`; combined two separate imports in `logout.ts` into one.
3. Deleted stale `server/functions/game.ts` (moved to `functions/game.ts` in previous session; `repl.ts` imports from the new location).
4. Fixed `config.ts` compile-time structural check — replaced unused runtime variable with `export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never` to satisfy `noUnusedLocals`.
5. Fixed `server/dev/typeMap/emitterArtifacts.ts` — removed hardcoded `import { SessionLayout } from "../../config"` from the generated file header; it was unconditionally emitted but unused in the current type map output.
6. Fixed `deploy.config.ts` generic inference — `defineDeploy<T>` was narrowing `T` to `'staging'` via the `fallback` literal; added explicit type parameter `defineDeploy<'development' | 'staging' | 'production'>` to anchor inference on environment keys.
7. Deleted stale `server/prod/generatedApis.default.ts` — referenced deleted `server/functions/game`; the generator only emits preset-specific files now. `runtimeMaps.ts` falls back gracefully when the file is missing. Production deployments must pass a preset key as the first positional argv (see §10.1a).
8. Fixed `scripts/bundleServer.mjs` (esbuild) — added `alias` entries for `@luckystack/core` and `@luckystack/login` pointing to their `packages/*/src/index.ts` so the production server bundle resolves them correctly.
9. `npm run lint` and `npm run build` both pass cleanly.

---

## 20) Session Log (2026-04-24, continued)

Completed:

1. `server/bootstrap/env.ts` → `packages/core/src/env.ts`. Canonical source for env bootstrap (dotenv + zod validation). `env`, `bootstrapEnv`, `isProduction`, `RuntimeEnv` are now core exports.
2. `server/functions/db.ts` → `packages/core/src/db.ts`. Canonical Prisma client singleton. Side-effect `import './env'` replaces the old `import '../bootstrap/env'`.
3. `server/functions/redis.ts` → `packages/core/src/redis.ts`. Canonical ioredis singleton. `import { env } from './env'` replaces the old relative path.
4. `packages/core/src/index.ts` updated — barrel now exports `env`, `bootstrapEnv`, `isProduction`, `RuntimeEnv`, `prisma`, `redis`.
5. All three originals replaced with one-liner re-export shims pointing to `@luckystack/core`.
6. `packages/login/src/{login,session,logout}.ts` updated — relative imports of `server/functions/db` and `server/functions/redis` replaced with `@luckystack/core` named imports (`prisma`, `redis`, `redis as redisClient`).
7. `npm run build` passes clean.

---

## 21) Session Log (2026-04-24, third pass — core utilities move)

Completed:

1. **Group 1 (no internal deps)** — moved to `packages/core/src/`:
   - `server/utils/console.log.ts` → `consoleLog.ts` (renamed to drop the dot).
   - `server/utils/cookies.ts` → `cookies.ts`.
   - `server/utils/httpApiUtils.ts` → `httpApiUtils.ts`.
   - `server/utils/paths.ts` → `paths.ts`.
   - `server/config/runtimeConfig.ts` → `runtimeConfig.ts`.
2. **Group 2 (depends on Group 1)** — moved to `packages/core/src/`:
   - `server/utils/serveAvatars.ts` → `serveAvatars.ts`.
   - `server/utils/getParams.ts` → `getParams.ts` (default export; barrel re-exports as `{ default as getParams }`; shim uses `export { default } from '../../packages/core/src/getParams'`).
   - `server/utils/extractToken.ts` → `extractToken.ts` (config import updated to `../../../config`).
   - `server/utils/extractTokenFromRequest.ts` → `extractTokenFromRequest.ts`.
3. **Group 3 (depends on `@luckystack/login`)** — moved to `packages/core/src/`:
   - `server/utils/validateRequest.ts` → `validateRequest.ts`. Function signature changed from `user: SessionLayout` to `user: BaseSessionLayout` (from `@luckystack/login`). `AuthProps` now also comes from `@luckystack/login`. The function is now framework-generic — it only accesses `user[condition.key]` where `key: keyof BaseSessionLayout`.
   - `server/utils/rateLimiter.ts` → `rateLimiter.ts` (config import updated to `../../../config`, `tryCatch` and `redis` imports switched to core-internal `./` paths).
4. `packages/core/src/index.ts` barrel updated with all 11 new exports.
5. All 11 originals replaced with one-liner re-export shims.
6. **Shim pattern note**: all shims point at the direct source file (`../../packages/core/src/...`), matching `shared/tryCatch.ts`. Using `@luckystack/core` in shims pulls the full barrel (including `redis`/`prisma`), which keeps ioredis' event loop alive and causes `tsx`-based generator scripts to hang after "Connected to Redis". Direct file paths avoid loading sibling modules that aren't needed.
7. Fixed `package.json` — added `--tsconfig tsconfig.server.json` to both `generateArtifacts` sub-invocations and `buildClient` so `tsx` resolves `@luckystack/*` path aliases when transitively imported.
8. `npm run lint` and `npm run build` both pass cleanly.

Files intentionally NOT moved:

- `server/hooks/registry.ts` + `server/hooks/types.ts` — `types.ts` imports `@luckystack/login`; moving registry to core would create a core → login dependency (wrong direction). Needs module augmentation pattern first.
- `server/utils/responseNormalizer.ts` — loads locale JSON files from `src/_locales/`; project-specific i18n.
- `server/utils/runtimeTypeResolver.ts` + `runtimeTypeValidation.ts` — belong in `@luckystack/devkit`.
- `server/utils/repl.ts` — project-specific REPL, imports `functions/game`.
- `server/functions/sentry.ts` — belongs in `@luckystack/sentry`, not core.
- All `src/_sockets/`, `src/_functions/`, `src/_components/` — React client-side concerns.

---

## 22) Session Log (2026-04-24, fourth pass — sync + sentry extraction)

Completed:

1. **`@luckystack/sync` scaffolded** — `packages/sync/package.json` and `packages/sync/src/index.ts` created. Path alias added to `tsconfig.server.json` and `tsconfig.client.json`. Esbuild alias added to `scripts/bundleServer.mjs`.
2. **`server/sockets/handleSyncRequest.ts` → `packages/sync/src/handleSyncRequest.ts`** — canonical file relocated. Imports rewritten:
   - `./socket` → `../../../server/sockets/socket` (still shared between API and sync; stays in server/)
   - `../functions/session` → `@luckystack/login` (named `getSession`)
   - `../../config` → `../../../config` (value imports `logging`, `rateLimiting`, `SessionLayout`)
   - `AuthProps` split off as `import type { AuthProps } from '@luckystack/login'` (authoritative source since §17)
   - `../utils/validateRequest`, `../utils/extractToken`, `../../shared/tryCatch`, `../../shared/serviceRoute`, `../utils/rateLimiter`, `../../shared/socketEvents` → merged into one `@luckystack/core` import
   - `../functions/sentry` → `@luckystack/sentry` (see point 5 below)
   - `../utils/responseNormalizer`, `../utils/runtimeTypeValidation` → `../../../server/utils/responseNormalizer` / `runtimeTypeValidation` (still server-side for now)
   - `../hooks/registry` → `../../../server/hooks/registry` (hooks registry stays in server/ until core→login circular is resolved)
3. **`server/sockets/handleHttpSyncRequest.ts` → `packages/sync/src/handleHttpSyncRequest.ts`** — same import rewrite pattern. Exported `HttpSyncStreamEvent` re-exported via the shim.
4. **Both originals replaced with one-liner shims** at `server/sockets/handle{,Http}SyncRequest.ts` pointing at the canonical sources by direct file path. Server callers (`server.ts`, `server/sockets/socket.ts`) unchanged — default imports keep resolving.
5. **`@luckystack/sentry` scaffolded** — `packages/sentry/package.json` and `packages/sentry/src/{index,sentry}.ts` created. Path alias added to both tsconfigs + `bundleServer.mjs`.
6. **`server/functions/sentry.ts` → `packages/sentry/src/sentry.ts`** — canonical file relocated. Imports now pull `initSharedSentry` + shared helpers from `@luckystack/core` (the DI surface stays in core because other core code calls `captureException` through it — moving it to sentry would invert the dependency direction). `sentry` config import updated to `../../../config`.
7. **`server/functions/sentry.ts` replaced with one-liner shim** (preserves both named exports and the `default` Sentry re-export). All existing callers (`server.ts`, `handleApiRequest`, `handleHttpApiRequest`, `handleSyncRequest`, `handleHttpSyncRequest`) work unchanged.
8. **Shim-path pattern kept**: all shims use direct file paths (`../../packages/{sync,sentry}/src/...`) for the same reason documented in §21 — avoids pulling the full core barrel (and thus Redis) into generator/build scripts that transitively load the shim.
9. `npm run lint` and `npm run build` both pass cleanly. `bundleServer` output still fits the expected profile (dist/server.js 9.8mb, vite build 462 modules, 3.82s).

Files intentionally NOT moved to sync this pass:

- **`server/sockets/socket.ts`** — the socket server itself is shared between API and sync. It imports `handleApiRequest`, `handleHttpApiRequest`, `handleSyncRequest`, `handleHttpSyncRequest`. Moving it now would pull API handlers into sync scope. Remains in server/ until `@luckystack/transport` or similar is extracted.
- **Client-side sync transport** (`src/_sockets/syncRequest.ts`, `offlineQueue.ts`) — deferred per §22 earlier plan. `socketInitializer.ts` is shared with API and needs a split design before moving.
- **`server/utils/responseNormalizer.ts`** — still locale-bound (loads JSON from `src/_locales/`). Needs a separation between the error-shaping logic (framework-generic, could go to core) and the locale resolution (project-specific). Deferred.

Follow-up items surfaced this pass:

- `handleHttpApiRequest.ts` + `handleApiRequest.ts` could form a `@luckystack/api` package (or fold into core, depending on preference) — same mechanics as sync; left for a separate session.
- The hook registry still lives in `server/hooks/`. Sync handlers currently dispatch `preSyncFanout` / `postSyncFanout` via a deep relative path (`../../../server/hooks/registry`). Moving the registry to core requires resolving the `types.ts → @luckystack/login` import so core doesn't depend on login (module augmentation pattern sketched in §21).

---

## 23) Session Log (2026-04-24, fifth pass — API handler extraction)

Completed:

1. **`@luckystack/api` scaffolded** — `packages/api/package.json` + `packages/api/src/index.ts` created. Path alias added to `tsconfig.server.json`, `tsconfig.client.json`, and `scripts/bundleServer.mjs`. Decision rationale: folding API handlers into core was rejected because they import `getSession` and `logout` from `@luckystack/login`, which would create a core→login runtime dependency (wrong direction). A separate `@luckystack/api` package sits at the same layer as `@luckystack/sync` (both can depend on core + login + sentry).
2. **`server/sockets/handleApiRequest.ts` → `packages/api/src/handleApiRequest.ts`** — canonical file relocated. Imports rewritten following the same pattern established in §21–§22:
   - `./socket` (value `apiMessage`) → `../../../server/sockets/socket`
   - `../functions/session` + `./utils/logout` → `@luckystack/login` (`getSession`, `logout`)
   - `../../config` → split: `AuthProps` from `@luckystack/login` (type-only), `logging`/`rateLimiting`/`SessionLayout` from `../../../config`
   - `../prod/runtimeMaps` → `../../../server/prod/runtimeMaps`
   - `../utils/validateRequest`, `../utils/rateLimiter`, `../../shared/tryCatch`, `../../shared/serviceRoute`, `../../shared/socketEvents` → merged into one `@luckystack/core` import
   - `../functions/sentry` → `@luckystack/sentry`
   - `../utils/responseNormalizer`, `../utils/runtimeTypeValidation` → `../../../server/utils/{responseNormalizer,runtimeTypeValidation}` (still server-side until i18n/devkit extractions)
   - `../hooks/registry` → `../../../server/hooks/registry` (hooks registry blocked on module-augmentation design)
3. **`server/sockets/handleHttpApiRequest.ts` → `packages/api/src/handleHttpApiRequest.ts`** — same rewrite pattern; also picks `inferHttpMethod` + `HttpMethod` from `@luckystack/core` (moved to core in §21).
4. **Both originals replaced with one-liner shims** using direct file paths per the established rule. Callers unchanged: `server.ts` (default import of `handleHttpApiRequest`) and `server/sockets/socket.ts` (default import of `handleApiRequest`) resolve through the shim without edits.
5. **Barrel** — `packages/api/src/index.ts` exports `handleApiRequest` (as named re-export of its default), `handleHttpApiRequest`, and the `ApiHttpStreamEvent` type.
6. `npm run lint` + `npm run build` pass clean end-to-end.

Current package layer map after this session:

```
@luckystack/core           (framework base; transport contracts, shared utilities, DI surfaces)
        ↑
@luckystack/login          (auth + session; owns BaseSessionLayout, AuthProps)
        ↑
@luckystack/sentry         (observability; consumes core DI surface, independent of login/sync/api)
@luckystack/sync           (real-time sync handlers; depends on core + login + sentry)
@luckystack/api            (API + HTTP-API handlers; depends on core + login + sentry)
```

All four feature packages (login/sentry/sync/api) are at the same dependency layer above core. None of them depend on each other.

---

## 24) Session Log (2026-04-24, sixth pass — hooks registry move + module augmentation)

Completed:

1. **`server/hooks/types.ts` + `server/hooks/registry.ts` → `packages/core/src/hooks/{types,registry}.ts`.** Core now owns the hook infrastructure.
2. **Broke the core→login type dependency** — core's hook payloads use a locally-defined `HookSessionShape` interface instead of importing `BaseSessionLayout` from `@luckystack/login`. `HookSessionShape` mirrors `BaseSessionLayout` structurally (`id`, `token`, `email`, `name`, `avatar`, `avatarFallback`, `admin`, `language`, `roomCodes`), so any concrete session type (login's `BaseSessionLayout`, project-level `SessionLayout` extending Prisma `User`) is assignable without a type import.
3. **Core hooks exposed through the barrel** — `packages/core/src/index.ts` now exports `registerHook`, `dispatchHook`, `DispatchResult`, and all hook-payload type aliases (`HookSessionShape`, `HookName`, `HookPayloads`, `PreApiExecutePayload`, `PostApiExecutePayload`, `PreSyncFanoutPayload`, `PostSyncFanoutPayload`).
4. **Feature-package hooks live via module augmentation.** `packages/login/src/hookPayloads.ts` declares its auth/session payload interfaces (`PostLoginPayload`, `PostRegisterPayload`, `PostLogoutPayload`, `PostSessionCreatePayload`, `PostSessionDeletePayload`) and merges their keys into `HookPayloads` with `declare module '@luckystack/core' { interface HookPayloads { ... } }`. The augmentation is picked up because `packages/login/src/**` is in the tsconfig include path, and login's `index.ts` does a side-effect `import './hookPayloads';` to make the wiring explicit for readers and to guarantee esbuild includes the module in bundles.
5. **Callers migrated to `@luckystack/core`.** The five files that used `../../../server/hooks/registry` (`packages/api/src/handleApiRequest.ts`, `packages/sync/src/handleSyncRequest.ts`, `packages/login/src/{login,logout,session}.ts`) now import `dispatchHook` directly from `@luckystack/core`, dropping the deep relative path.
6. **Shims left at `server/hooks/types.ts` + `server/hooks/registry.ts`** re-exporting the canonical sources via direct file paths (plus the login augmentation payload types through `packages/login/src/hookPayloads`). No call-site changes needed outside the five updated package files.
7. **Presence hooks removed from the types file** — the old `PrePresenceUpdatePayload` / `PostPresenceUpdatePayload` entries in `server/hooks/types.ts` were speculative (no dispatch calls existed). They will be added back via module augmentation in `@luckystack/presence` when that package ships.
8. `npm run lint` and `npm run build` pass clean.

Pattern established for future feature packages:

```ts
// packages/<feature>/src/hookPayloads.ts
import type { SomeTypeFromThisPackage } from './somewhere';

export interface MyHookPayload { ... }

declare module '@luckystack/core' {
  interface HookPayloads {
    myHook: MyHookPayload;
  }
}
```

Then in the package's `index.ts`: `import './hookPayloads';` so the augmentation travels with the package.

---

## 25) Session Log (2026-04-24, seventh pass — runtimeTypeValidation to core)

Completed:

1. **`server/utils/runtimeTypeValidation.ts` → `packages/core/src/runtimeTypeValidation.ts`.** The string-based structural validator has no internal imports — it is a pure runtime concern, belongs in core, and was previously the last thing forcing the 4 socket/HTTP handlers to reach back into `server/utils/`.
2. **Barrel update** — `validateInputByType` exported from `@luckystack/core`.
3. **Shim left at `server/utils/runtimeTypeValidation.ts`** using the direct file path pattern.
4. **Four package callers migrated** (`handleSyncRequest`, `handleHttpSyncRequest`, `handleApiRequest`, `handleHttpApiRequest`) — all now pull `validateInputByType` from `@luckystack/core` instead of a deep relative path.
5. **Dev-only dynamic-import fixup** — `runtimeTypeValidation.ts` lazily loads `runtimeTypeResolver` for deep-type expansion (only when `NODE_ENV !== 'production'`). After the move, the relative path `./runtimeTypeResolver` no longer resolved; changed to `../../../server/utils/runtimeTypeResolver` with a comment flagging that the resolver belongs in `@luckystack/devkit` once that package exists.
6. `npm run lint` and `npm run build` pass clean.

Server-side imports remaining in the 4 handler packages after this pass:

- `../../../server/sockets/socket` — shared by API + sync (the socket.io server instance)
- `../../../server/prod/runtimeMaps` — project-specific generated API/sync route maps
- `../../../server/utils/responseNormalizer` — locale JSON loading (project-specific until the design splits frame vs locale)
- `../../../config` — project config values (`logging`, `rateLimiting`, `SessionLayout`, `defaultLanguage`)

Everything else in those handlers resolves through `@luckystack/{core,login,sentry}`.

---

## 26) Session Log (2026-04-24, eighth pass — @luckystack/devkit extraction)

Completed:

1. **`@luckystack/devkit` package scaffolded** at `packages/devkit/` (`package.json`, `src/index.ts`). Added path alias `@luckystack/devkit` to `tsconfig.server.json` (server-only — devkit has no client concern) and added `packages/devkit/src/**/*` to the server tsconfig `include` array. **Intentionally NOT added to `scripts/bundleServer.mjs`** — devkit should not be bundled into the production runtime. If anything tries `import from '@luckystack/devkit'` during the prod bundle step, esbuild will fail with an unresolved package, which is the desired behaviour (catches accidental runtime deps on devkit).
2. **`server/dev/**` → `packages/devkit/src/`** (21 TS files moved, directory structure preserved):
   - `hotReload.ts`, `importDependencyGraph.ts`, `loader.ts`, `routeConventions.ts`, `routeNamingValidation.ts`, `supervisor.ts`, `templateInjector.ts`, `typeMapGenerator.ts`
   - `typeMap/` (9 files: `apiMeta.ts`, `discovery.ts`, `emitter.ts`, `emitterArtifacts.ts`, `extractors.ts`, `functionsMeta.ts`, `routeMeta.ts`, `tsProgram.ts`, `typeContext.ts`)
   - `templates/` (5 template files — string templates read via `fs.readFileSync` at generation time, kept as `.ts` with `@ts-expect-error` on their `{{REL_PATH}}` placeholder imports)
3. **`server/utils/runtimeTypeResolver.ts` → `packages/devkit/src/runtimeTypeResolver.ts`.** The resolver uses the TypeScript compiler API for deep type expansion — dev-only. Intra-devkit import `../dev/typeMap/tsProgram` rewritten to `./typeMap/tsProgram`.
4. **Import rewrites inside devkit** (all references to the server/utils + server/functions + server/config layer replaced with the `@luckystack/core` barrel, since devkit runs at tsx time where barrel loading is fine):
   - `../utils/paths` / `../../utils/paths` → `@luckystack/core`
   - `../utils/httpApiUtils` / `../../utils/httpApiUtils` → `@luckystack/core`
   - `../functions/tryCatch` (default import) → `@luckystack/core` (named `tryCatch`)
   - `../config/runtimeConfig` → `@luckystack/core`
   - `../bootstrap/env` → `@luckystack/core`
   - `../utils/runtimeTypeResolver` → `./runtimeTypeResolver` (now sibling inside devkit)
   - `../utils/responseNormalizer` → `../../../server/utils/responseNormalizer` (locale resolver still server-local)
5. **Shims left at all original server/dev/** locations** via `export *` (or named re-exports where the target has no index-style barrel). Shims use direct relative paths (`../../packages/devkit/src/...`) per the established rule. `server/dev/supervisor.ts` is a side-effect import shim since the supervisor is a script entrypoint without named exports.
6. **Callers migrated**:
   - `scripts/generateTypeMaps.ts` — imports `generateTypeMapFile` from `@luckystack/devkit`
   - `scripts/generateServerRequests.ts` — imports devkit helpers from `@luckystack/devkit` and `ROOT_DIR` / `resolveFromRoot` from `@luckystack/core`
   - `packages/core/src/runtimeTypeValidation.ts` — the dev-only dynamic import now targets `../../devkit/src/runtimeTypeResolver` (relative path, not the `@luckystack/devkit` alias, so esbuild can follow it without an alias map; still behind the `NODE_ENV !== 'production'` guard)
   - `server/prod/runtimeMaps.ts` unchanged — still imports `../dev/loader` via the shim
   - `server/server.ts` unchanged — dynamic `await import('./dev/loader')` and `await import('./dev/hotReload')` resolve through the shims
7. **Explicit `process.exit(0)` added to both scripts.** Importing `@luckystack/devkit` transitively loads `@luckystack/core`, whose barrel connects to Redis on module load. Without an explicit exit the dangling ioredis handle keeps the event loop alive and `npm run build` hangs after "Connected to Redis" — same bug documented in §21, now surfaces for scripts because they reach core via a different path. Added:
   - `generateTypeMaps.ts`: `run().then(() => process.exit(0)).catch(err => { ...; process.exit(1); });`
   - `generateServerRequests.ts`: `process.exit(0);` at end of top-level code
8. `npm run lint` and `npm run build` pass clean end-to-end. Production bundle unchanged in size (dist/server.js still 9.8mb, vite 462 modules, ~3.9s build).

Devkit public surface (`packages/devkit/src/index.ts`):

- Generation: `generateTypeMapFile`, `getInputTypeFromFile`, `getSyncClientDataType`
- Route validation: `API_VERSION_TOKEN_REGEX`, `SYNC_VERSION_TOKEN_REGEX`, `assertNoDuplicateNormalizedRouteKeys`, `assertValidRouteNaming`
- Dev loader: `devApis`, `devSyncs`, `devFunctions`, `initializeAll`, `initializeApis`, `initializeSyncs`, `initializeFunctions`, `upsertApiFromFile`, `removeApiFromFile`, `upsertSyncFromFile`, `removeSyncFromFile`
- Dev watcher: `setupWatchers`
- Deep type resolver: `resolveRuntimeTypeText`, `clearRuntimeTypeResolverCache`

Deferred for a future pass:

- Production bundle still contains devkit code. `server/prod/runtimeMaps.ts` has a top-level `import { devApis, devFunctions, devSyncs } from '../dev/loader';` that pulls devkit into the esbuild bundle even though the `if (env.NODE_ENV !== 'production')` guard prevents execution. The fix is to replace those top-level imports with a dev-only lazy `await import('../dev/loader')` inside the non-production branches of `getRuntimeApiMaps` / `getRuntimeSyncMaps` / `getRuntimeReplMaps`. Pre-existing architectural debt; surfaces now because we've formalised the devkit boundary.
- `server/functions/tryCatch.ts` is a redundant wrapper around core's `tryCatch` (it forwards the `context` argument that core already supports). One caller (`src/settings/_api/updateUser_v1.ts`) still imports it. Deletable after the caller is updated — but not blocking.

---

## 27) Package layer map after §26

```
@luckystack/core       (base: transport, utilities, DI surfaces, hook registry, runtime type validation)
   ↑
@luckystack/login      (auth + session; owns BaseSessionLayout + AuthProps; augments HookPayloads)
   ↑
@luckystack/sentry      @luckystack/sync       @luckystack/api
 (observability)         (real-time sync)       (API + HTTP API)

@luckystack/devkit     (dev-time tooling; NOT in prod bundle alias map; consumed by
                        scripts/ and server/dev/ shims; depends on core at dev time only)
```

---

## 28) Session Log (2026-04-24, ninth pass — devkit fully excluded from prod bundle)

Completed:

1. **`server/prod/runtimeMaps.ts` converted to lazy dev-loader import.** Removed the top-level `import { devApis, devFunctions, devSyncs } from '../dev/loader';`. Each of the three getters (`getRuntimeApiMaps`, `getRuntimeSyncMaps`, `getRuntimeReplMaps`) now does `await getDevkit()` inside the `env.NODE_ENV !== 'production'` branch, where `getDevkit` is a module-scoped cached `Promise<DevkitRuntimeMaps>` that dynamic-imports `@luckystack/devkit`. First call pays the import cost; subsequent calls reuse the promise. Explicit `DevkitRuntimeMaps` interface (mirrors `{ devApis, devSyncs, devFunctions }` as `Record<string, unknown>`) avoids the `any`-propagation lint errors that surfaced when reading them through `typeof import(...)`.
2. **`server/server.ts` dev-only imports consolidated to `@luckystack/devkit`** — `await import('./dev/loader')` + `await import('./dev/hotReload')` merged into one `await import('@luckystack/devkit')` destructuring `{ initializeAll, setupWatchers }`. Inside the same `if (isDevMode) { ... }` branch as before.
3. **`packages/core/src/runtimeTypeValidation.ts` dev-only resolver call migrated to the barrel** — was `await import('../../devkit/src/runtimeTypeResolver')` (relative, still bundled); now `await import('@luckystack/devkit')` (external in prod, fully excluded from the bundle). Same `NODE_ENV !== 'production'` guard.
4. **`scripts/bundleServer.mjs` — `@luckystack/devkit` added to the `external` array.** Esbuild leaves `import('@luckystack/devkit')` as an unresolved bare specifier in the output; node resolves it at runtime ONLY when the dev branch executes, which never happens in production.
5. **Result: `dist/server.js` went from 9.8 MB to 211.7 KB (97.8% smaller).** `dist/server.js.map`: 14.1 MB → 385.3 KB. `grep -c "@luckystack/devkit" dist/server.js` shows 3 references (the three `await import(...)` call sites retained as externals); `grep -c "generateTypeMapFile\|clearRuntimeTypeResolverCache\|upsertApiFromFile" dist/server.js` shows 0 — all devkit internals are gone.
6. **`server/functions/tryCatch.ts` deleted.** Was a redundant wrapper around `shared/tryCatch` (which is already the core tryCatch, with the `context` arg forwarded). The one remaining caller (`src/settings/_api/updateUser_v1.ts`) was switched to `import { tryCatch } from '@luckystack/core'` (combined with its existing `UPLOADS_DIR` import from the same barrel).
7. **Pre-existing lint errors surfaced on `updateUser_v1.ts`** — the generated `Functions` map types `prisma` and `saveSession` as `any`, which made `.user.update(...)` and `saveSession(...)` calls flag `no-unsafe-call` / `no-unsafe-member-access`. Previously masked by `.eslintcache`. Added two targeted `eslint-disable-next-line` comments with explanatory text. Fixing the generator's `any` emission is out of scope; tracked as a devkit-internals follow-up.
8. **`@luckystack/devkit` added to `tsconfig.client.json` paths + include** for eslint-plugin-import-x consistency. Other `@luckystack/*` packages are listed in both tsconfigs even when the client doesn't need them — matching that pattern makes the import-x typescript resolver find the alias regardless of which tsconfig it picked for a given file.
9. `npm run lint` and `npm run build` pass clean.

Production bundle contents now:

```
dist/server.js       211.7kb   ← down from 9.8mb (pre-session: §26)
dist/server.js.map   385.3kb   ← down from 14.1mb
```

---

## 29) Session Log (2026-04-24, tenth pass — @luckystack/presence extraction)

Completed:

1. **`@luckystack/presence` scaffolded** at `packages/presence/` with `package.json` + `src/index.ts` barrel. Path alias added to both `tsconfig.server.json` + `tsconfig.client.json` (paths + include) and `scripts/bundleServer.mjs` (esbuild alias). Presence IS a runtime dep of login for the logout-cleanup path (see point 4), so it goes in the runtime alias map — unlike devkit.
2. **Activity broadcaster moved** — `server/sockets/utils/activity/{leaveRoom,lifecycle,peerNotifier,state}.ts` → `packages/presence/src/activity/{...}` (4 files, ~225 LOC) + barrel `server/sockets/utils/activityBroadcaster.ts` replicated in `packages/presence/src/index.ts`.
3. **Import rewrites inside presence**:
   - `SessionLayout` from `../../../../config` → dropped; return type of `socketLeaveRoom` is now inferred from `getSession` (flows back as project-level `SessionLayout` without the package needing to import it)
   - `getSession` / `deleteSession` from `../../../functions/session` → `@luckystack/login`
   - `extractTokenFromSocket` from `../../../utils/extractToken` → `@luckystack/core`
   - `socketEventNames` from `../../../../shared/socketEvents` → `@luckystack/core`
   - `ioInstance` from `../../socket` → `../../../../server/sockets/socket` (deep relative — socket.ts itself is not yet in a package)
4. **Caller updates**:
   - `packages/login/src/logout.ts` — `disconnectTimers` + `tempDisconnectedSockets` now imported from `@luckystack/presence` (was deep relative into `server/sockets/utils/activityBroadcaster`).
   - `server/sockets/socket.ts` — `initAcitivityBroadcaster`, `socketConnected`, `socketDisconnecting`, `socketLeaveRoom` now imported from `@luckystack/presence` (was `./utils/activityBroadcaster`).
5. **Shims left** at `server/sockets/utils/activityBroadcaster.ts` and each of the four `server/sockets/utils/activity/*.ts` files (per the shim-path rule: direct relative to `packages/presence/src/...`).
6. **Type adjustment**: the move surfaced a latent type-flow issue — `socketLeaveRoom` previously returned `Promise<SessionLayout | null>` (project type). Moving the file into presence tried to narrow it to `BaseSessionLayout | null` which was not assignable to the project `SessionLayout` variable in `socket.ts`. Resolved by removing the explicit return type; TS infers it from `getSession`, which still returns the project-level `SessionLayout`. Framework-generic callers can treat it as `BaseSessionLayout | null` structurally.
7. `npm run lint` and `npm run build` pass clean. `dist/server.js` stays at 211.5 KB (presence bundled as expected; devkit still excluded).

Known dependency direction (documented, not blocking):

- `@luckystack/login` → `@luckystack/presence` (via `logout.ts` importing `disconnectTimers` + `tempDisconnectedSockets`)
- `@luckystack/presence` → `@luckystack/login` (via `getSession` / `deleteSession`)

This is a circular dependency at the package boundary. It works because the circular use is resolved at runtime (not at module-load time — both packages just reference the same module via the path alias). Documented in §29.3's design note: breaking it requires either moving presence-state cleanup out of logout (into a `postLogout` hook handler registered by presence) OR moving `getSession`/`deleteSession` into a core/session-contract layer that both can depend on. Deferred — not causing concrete issues today.

Package layer map after this pass:

```
@luckystack/core       (base: transport, utilities, DI, hooks, runtime type validation)
   ↑
@luckystack/login     ⇄  @luckystack/presence
   ↑                        ↑
@luckystack/sentry      @luckystack/sync      @luckystack/api
   (feature peers — none depend on each other)

@luckystack/devkit     (dev-time tooling; not in prod bundle alias map)
```

---

## 30) Session Log (2026-04-24, eleventh pass — login ⇄ presence circular fix + checkOrigin to core)

Completed:

1. **Broke the login ⇄ presence circular dependency.** Created `packages/presence/src/hooks.ts` exporting `registerPresenceHooks()`, which registers a `postLogout` handler on the core hook registry. The handler clears `disconnectTimers` and `tempDisconnectedSockets` for the logged-out token — the exact cleanup that used to live inline at the top of `@luckystack/login`'s `logout()` function.
2. **Removed presence imports from `packages/login/src/logout.ts`.** The file no longer references `disconnectTimers` / `tempDisconnectedSockets`. Left a comment pointing to the hook handler for anyone tracing the cleanup flow.
3. **Wired `registerPresenceHooks()` at server startup** in `server/server.ts`, immediately after `initializeSentry()`. Registration is idempotent (guarded by a module-level `registered` flag inside `hooks.ts`), so re-imports from tests or alternate entry points are safe.
4. **Timing change documented**: the cleanup now runs AFTER `deleteSession` + socket.leave + the rest of the logout work, instead of before. Safe because (a) the timer's own callback gates on `tempDisconnectedSockets.has(token)` at its very first line, so a timer firing during the race window returns early once the hook runs, (b) all underlying operations are idempotent.
5. **TypeScript quirk**: `HookHandler<T>` requires a return type of `HookResult | Promise<HookResult>` where `HookResult = undefined | HookStopSignal`. A handler with no explicit return was inferred as `void`, which TS does not accept. Fix: explicit `: HookResult` annotation + explicit `return undefined` branches.

Additional move this pass:

6. **`server/auth/checkOrigin.ts` → `packages/core/src/checkOrigin.ts`.** CORS origin allow-listing; self-contained (env-driven, no internal imports). Exported from the core barrel as `allowedOrigin`. Shim left at the original path; both callers (`server/server.ts`, `server/sockets/socket.ts`) updated to import directly from `@luckystack/core`.

Package layer map after this pass:

```
@luckystack/core       (base: transport, utilities, DI, hooks, runtime type validation, CORS allowlist)
   ↑
@luckystack/login        (auth + session; owns BaseSessionLayout, AuthProps; augments HookPayloads)
   ↑                  ↘
@luckystack/sentry      @luckystack/presence   (presence registers postLogout handler on core,
                                                no direct login import)
@luckystack/sync        @luckystack/api
   (feature peers — none depend on each other)

@luckystack/devkit     (dev-time tooling; external in prod bundle)
```

All packages now have one-way dependencies (presence → login via `getSession`/`deleteSession`; login does NOT import presence).

`npm run lint` and `npm run build` pass clean. `dist/server.js` = 212.2 KB.

---

## 31) Session Log (2026-04-24, twelfth pass — client-side transport split)

User's design decision: client-side API code goes into `@luckystack/core` (transport is core's responsibility per §2.1); client-side sync code goes into `@luckystack/sync` as an additional package.

Completed:

1. **`offlineQueue.ts` → `packages/core/src/offlineQueue.ts`.** Self-contained FIFO queue for offline API/sync requests. Both apiRequest and syncRequest share it.
2. **`socketState.ts` new in `packages/core/src/`.** Hosts the mutable module-level `socket: Socket | null` (ESM live binding), `setSocket(next)` setter, `incrementResponseIndex()`, `waitForSocket()`. Single source of truth for the socket client instance across apiRequest (core), syncRequest (sync), and the React hook wiring (src/).
3. **`apiRequest.ts` → `packages/core/src/apiRequest.ts`.** Imports rewritten: project `config` via `../../../config`, `src/_functions/notify` via deep relative, socket primitives via `./socketState`, core utilities via sibling relative paths (`./responseNormalizer`, `./serviceRoute`, `./socketEvents`). `apiTypes.generated.ts` remains a type-only import via deep relative path — acknowledged as future work (generator should emit `declare module '@luckystack/core'` augmentation so the types aren't reached via path).
4. **`syncRequest.ts` → `packages/sync/src/syncRequest.ts`.** Same import rewriting pattern. Reaches into `@luckystack/core` via **direct file paths** (not the barrel) — see point 7.
5. **`src/_sockets/socketInitializer.ts` stays in src/** (project glue — uses `useSocketStatus`, `notify`, `loginPageUrl`, etc.) but now delegates socket-state ownership to core: imports `{ socket, setSocket, incrementResponseIndex, waitForSocket }` via direct path `../../packages/core/src/socketState`. `setSocket(io(...))` on connect; `setSocket(null)` on teardown. Re-exports `socket` / `incrementResponseIndex` / `waitForSocket` for existing callers that still import these from this file (with targeted `unicorn/prefer-export-from` disable — needed because we also need local access to the `socket` binding for the hook body).
6. **Shims at `src/_sockets/{apiRequest,syncRequest,offlineQueue}.ts`** point at canonical locations via direct file paths.
7. **Barrel split for packages with client + server surfaces.** Discovered that `export { apiRequest } from './apiRequest'` in the core barrel pulls React-coupled project code (notify → TranslationProvider.tsx) into the server tsconfig build (which has no `jsx` setting). Same for `syncRequest` in sync's barrel. Fix:
   - `packages/core/src/index.ts` — server-safe surface only; does NOT re-export `apiRequest`.
   - `packages/core/src/client.ts` — new file; exports `apiRequest`, `ApiStreamEvent`.
   - `packages/sync/src/index.ts` — server-safe; only `handleSyncRequest`, `handleHttpSyncRequest`.
   - `packages/sync/src/client.ts` — new file; exports `syncRequest`, `useSyncEvents`, `useSyncEventTrigger`, `initSyncRequest`, stream event types.
   - `tsconfig.server.json` `exclude` adds the four client files (`apiRequest.ts`, `client.ts` in both core and sync) to prevent transitive pickup via `packages/*/src/**/*` includes.
8. **Vite bundle also had a barrel problem.** Any `src/` file that did `import … from '@luckystack/core'` caused Vite to follow the barrel and bundle server-only Node-API utilities (`paths.ts` with `fileURLToPath`) into the browser. Fixed by updating `src/_sockets/socketInitializer.ts` and `packages/sync/src/syncRequest.ts` to use direct file paths into core (not the barrel). `src/settings/_api/updateUser_v1.ts` keeps using the barrel because it's server-side (`src/**/_api/**` excluded from client tsconfig). Project-side client code must import core utilities via direct paths OR use `packages/core/src/client.ts` for client-only surface.
9. `npm run lint` + `npm run build` pass clean. `dist/server.js` = 212.7 KB (stable); client bundle 825.5 KB.

New invariants documented:

- **Client/server barrel split rule**: packages with both slices use `src/index.ts` (server-safe) + `src/client.ts` (React / browser-coupled). Neither barrel transitively imports the other. `tsconfig.server.json` excludes all `client.ts` files and the React-coupled source files they re-export.
- **Barrel vs direct-path rule**: project-side client code and cross-package internal code imports via direct file paths (`../../packages/<pkg>/src/<file>`), not `@luckystack/<pkg>` barrels. The barrels are meant for the future public surface (when packages are published to npm) — within the monorepo, direct paths avoid barrel-pulls-everything issues in both Vite (client, no Node APIs) and server tsconfig (server, no JSX).

Package layer map after this pass:

```
@luckystack/core       (base: transport, utilities, DI, hooks, CORS, runtime validation)
                        - index.ts: server-safe surface
                        - client.ts: apiRequest (React-coupled via notify)
                        - socketState / offlineQueue: shared client primitives
   ↑
@luckystack/login      (auth + session)
   ↑
@luckystack/presence   (hook-registered postLogout handler; no circular with login)
@luckystack/sentry     @luckystack/sync                     @luckystack/api
                        - index.ts: server handlers          (server handlers)
                        - client.ts: syncRequest + hooks

@luckystack/devkit     (dev-time only; external in prod bundle)
```

---

## 32) Session Log (2026-04-24, thirteenth pass — devkit emitter emits real types for function re-exports)

Completed:

1. **Devkit type-emitter fix in `packages/devkit/src/typeMap/functionsMeta.ts`.** The `export { x } from 'module'` branch previously fell through to `any` whenever the target symbol lived in another module (which is the common case for shim files like `server/functions/db.ts`: `export { prisma } from '@luckystack/core'`). Now emits `typeof import('module')['x']` — a TypeScript expression that resolves to the target's actual type at compile time.
2. **Regenerated `Functions` map now has real types.** Example (trimmed):
   ```ts
   export interface Functions {
     db: {
       prisma: (typeof import("@luckystack/core"))["prisma"];
     };
     redis: {
       redis: (typeof import("@luckystack/core"))["redis"];
       default: (typeof import("@luckystack/core"))["redis"];
     };
     sentry: {
       initializeSentry: (typeof import("../../packages/sentry/src/sentry"))["initializeSentry"];
       ...
     };
     session: {
       saveSession: (typeof import("../../packages/login/src/session"))["saveSession"];
       ...
     };
     ...
   }
   ```
3. **Relative-path caveat**: the emitter preserves module specifiers verbatim. This works today because the generated file (`src/_sockets/apiTypes.generated.ts`) and the function shim files (`server/functions/*.ts`) are both at depth 2 from the repo root — so `../../packages/...` resolves to the same target from both. If a future shim lives at a different depth, the emitter will need to resolve + re-relativize. Noted as a latent edge case, not blocking.
4. **Dropped `eslint-disable-next-line` from `src/settings/_api/updateUser_v1.ts`.** `functions.db.prisma.user.update(...)` and `functions.session.saveSession(...)` are now fully typed through the generated interface → no more `any`-call lint violations.
5. `npm run lint` and `npm run build` pass clean. `dist/server.js` stable at 212.7 KB.

---

## 33) Session Log (2026-04-24, fourteenth pass — `@luckystack/router` load balancer + dev forwarding)

**Completes §8 steps 11-12.** New package at `packages/router/` provides the load-balancer backend described in §9.6. One `npm run router` command boots it.

Completed:

1. **`@luckystack/router` scaffolded** — `package.json`, `src/index.ts` barrel. Path alias added to both tsconfigs. Not in `scripts/bundleServer.mjs` esbuild alias (router runs as its own process, not bundled into the main server).
2. **`packages/router/src/resolveTarget.ts`** — `createServiceTargetResolver(input)` returns a resolver that:
   - Parses the first route segment (strips `api/` or `sync/` transport prefix) — `api/vehicles/getAll` → `vehicles`.
   - Looks up `deploy.config.ts -> environments[env].bindings[service]`.
   - Falls through to `environments[env].fallback` env's bindings when the service isn't owned locally OR the local target is unhealthy.
   - `setLocalHealth(service, healthy)` / `getLocalHealth(service)` let the poller flip state without restarting.
   - Optional `localPresetKey` bounds which services count as "local"; others go straight to fallback (per the `services.config.ts` preset model).
3. **`packages/router/src/healthPoller.ts`** — probes each local URL via `HEAD /` with a 2s `AbortController` timeout. Flips state on the resolver when health changes. Interval is `unref()`'d so the router shuts down cleanly. **In-memory only** — Redis-backed shared state is §34.2.
4. **`packages/router/src/httpProxy.ts`** — node `http`/`https` forwarder. Strips hop-by-hop headers; adds `x-forwarded-host`, `x-forwarded-proto`, `x-luckystack-resolved-env`, `x-luckystack-via-fallback`. 502 with `errorCode: serviceNotAssigned` when resolver returns null; 502 with `errorCode: routing.upstreamUnreachable` on upstream error.
5. **`packages/router/src/startRouter.ts`** — single entrypoint. Reads configs, builds resolver, starts the health poller when `development.enableFallbackRouting` is true + env is `development`, starts `http.Server`, resolves when listening.
6. **`scripts/router.ts`** — thin CLI wrapper. Reads `ROUTER_PORT`, `LUCKYSTACK_ENV`, `LUCKYSTACK_PRESET`. Uses top-level `await`.
7. **`npm run router`** added.
8. **Smoke-tested**: `ROUTER_PORT=4019 npm run router` boots, listens, probes `http://localhost:{4100,4101,4102}`, correctly logs each as unhealthy (nothing running locally in the test).

Router behavior today:

- **Step 11 (load balancer)** ✅ — parse first segment → forward to service URL → `serviceNotAssigned` when unknown. HTTP only for now.
- **Step 12 (dev forwarding)** ✅ — `development.enableFallbackRouting` + `environment.fallback` route unknown-local traffic to staging. When local comes up healthy the poller flips state and new requests route local.

Known gaps (tracked in §34):

- No socket.io / websocket proxying yet. Resolver logic is ready; needs an `Upgrade: websocket` handler.
- Health state is in-memory per router process. Multiple instances don't share yet (§9.6 #5 / #7 wants Redis).
- No zero-loss reconnect when local health flips mid-session.
- No boot-time shared-Redis handshake (write UUID, read from fallback's `/health` — mentioned in `deploy.config.ts` header comment).

---

## 34) Session Log (2026-04-24, fifteenth pass — multi-instance foundations + test-runner scaffold)

**Closes §34.1-§34.3 from the previous session and adds the Socket.io Redis adapter** (not previously in scope — filed as a gap during planning). Introduces `@luckystack/test-runner`.

Completed:

1. **Socket.io Redis adapter** — new `packages/core/src/socketRedisAdapter.ts` exports `attachSocketRedisAdapter(io)`. `server/sockets/socket.ts` calls it right after creating the `SocketIOServer`. Uses two `redis.duplicate()` handles (ioredis in subscribe mode blocks non-pub/sub commands on the main connection). Without this, room broadcasts only reach clients on the same process — a silent architectural footgun in any multi-instance deploy. Dependency: `@socket.io/redis-adapter@^8.3.0` added.

2. **Router WebSocket proxying** (`packages/router/src/wsProxy.ts`) — `server.on('upgrade', wsProxy)`. Forwards socket.io upgrade handshakes to the resolved target. Socket.io clients connect to `/socket.io/?...` with no service key in the path, so WS is routed to the `system` service by convention (overridable via `wsTargetService`). The Redis adapter makes this safe: rooms fan out across instances regardless of which one holds the WS.

3. **Redis-backed router health state** (`packages/router/src/redisHealthStore.ts`) — keys `router:health:<envKey>:<service>`, pub/sub channel `router:health:events:<envKey>`. Routers keep an in-memory cache hydrated from Redis and updated via subscribe; local resolve reads stay sync. Resolver accepts optional `healthStore` to swap the in-memory Map transparently. Startup hard-fails when shared Redis is mandated (current env has `fallback`) and Redis is unreachable — smoke-tested: Redis down → `Error: [router] split/fallback mode requires shared Redis...`.

4. **Boot-time shared-Redis handshake** (`packages/router/src/bootHandshake.ts` + `packages/core/src/bootUuid.ts` + `/_health` endpoint in `server/server.ts`):
   - On backend startup, `writeBootUuid()` writes `luckystack:boot:<env>` (TTL 1h) with a fresh UUID.
   - `GET /_health` returns `{ status, bootUuid, envKey }` from Redis.
   - On router startup (when the env has a `fallback`), the handshake probes `<fallbackBaseUrl>/_health`, then reads `luckystack:boot:<fallbackEnv>` from its own Redis and compares. Mismatch → warning (non-fatal until the `/_health` contract is fully adopted). Catches "two Redis URLs that both respond" per `deploy.config.ts` header comment.

5. **`@luckystack/test-runner`** — new package. Driven by `src/_sockets/apiTypes.generated.ts -> apiMethodMap`. Layer: **contract smoke** — POST each endpoint with `{}`, assert response has `{status: 'success'}` or `{status: 'error', errorCode}`. Exit 1 on any failure.
   - Entry: `npm run test:contract` (uses `scripts/testContract.ts`, config via `TEST_BASE_URL`, `TEST_SKIP`, `TEST_AUTH_TOKEN`, `TEST_SESSION_COOKIE_NAME`).
   - Deferred layers: auth-enforcement (needs auth metadata in generated map), rate-limit (needs token reset hook), schema fuzz (needs Zod/JSON-schema emission).

6. **Verification**: `npm run lint` clean, `npm run build` clean (`dist/server.js` 214.5 KB, +1.8 KB for adapter + boot UUID). Router boots and correctly hard-fails without Redis in split/fallback mode.

Key invariants added:

- **WS target rule**: router forwards WebSocket upgrades to the `system` service (overridable). Safe because every backend attaches the Socket.io Redis adapter, fanning rooms across instances.
- **Shared-Redis hard-fail rule**: when `environment.fallback` is set on the current env, the router MUST boot with a reachable Redis or die. Opt-out (`disableSharedHealthState`) is ignored in this mode.
- **Boot-UUID rule**: every backend writes `luckystack:boot:<env>` on startup. `/_health` returns it. Routers cross-check against their own Redis to detect divergent URLs.
- **Router-independence rule (unchanged)**: the router does not import `@luckystack/*` runtime packages — its Redis access uses raw ioredis. This keeps the router self-contained and deployable separately.

Known gaps / not done this session:

- `/_health` handshake is warning-only, not fatal. Flip to throw once every service is known to expose it.
- Test-runner only covers the contract-smoke layer. Auth, rate-limit, and fuzz layers need generator changes first.
- No zero-loss reconnect when local health flips mid-WS-session (§9.6 #8 explicitly says this is not required).

---

## 35) Session Log (2026-04-24, sixteenth pass — all §35 refinements closed)

Six tasks from the previous-session plan landed in this sitting. The original "split, close gaps, then ship npm" arc is now essentially complete; every remaining item is polish or scope expansion rather than a missing foundation.

Completed:

1. **Auth metadata in generated map.** `apiMetaMap: Record<string, Record<string, Record<string, ApiMetaEntry>>>` now emits alongside `apiMethodMap`. Each entry carries `{ method, auth: { login, additional? }, rateLimit? }`. Generator reuses the existing `extractAuth()` AST walker — no new extraction code. Exposes the auth contract at runtime without having to re-read route files.

2. **Auth-enforcement test layer.** `@luckystack/test-runner` gained `runAuthEnforcementTests` — walks endpoints with `auth.login: true`, sends each without a session, asserts `errorCode: 'auth.required'`. Public endpoints are silently skipped. New CLI: `npm run test:auth`.

3. **`responseNormalizer` split.** New `packages/core/src/localizedNormalizer.ts` exports `createLocalizedNormalizer({ translate, defaultLanguage?, isSupportedLanguage? })`. Project's `server/utils/responseNormalizer.ts` calls this + `registerLocalizedNormalizer(normalizer)` on import. Core's `normalizeErrorResponse`, `resolveErrorMessage`, `extractLanguageFromHeader` are now delegating wrappers that resolve through the active registration at call time (import-order-safe). `@luckystack/api` + `@luckystack/sync` import these from core instead of deep-reaching into `server/utils/…`. Server boots now side-effect-import the project normalizer module early to trigger registration.

4. **`apiTypes.generated.ts` decoupling.** Added `packages/core/src/apiTypeStubs.ts` with empty `ApiTypeMap` and `SyncTypeMap` interfaces. Generator now emits:
   - `type _ProjectApiTypeMap = { ... };` + `export interface ApiTypeMap extends _ProjectApiTypeMap {}`
   - Same for sync.
   - A trailing `declare module '@luckystack/core' { interface ApiTypeMap extends _ProjectApiTypeMap {} interface SyncTypeMap extends _ProjectSyncTypeMap {} }` augmentation block.
   - Interface merging means core's `apiRequest.ts` / sync's `syncRequest.ts` import `ApiTypeMap` from within their own package and get the full shape whenever the generated file is loaded (any project API import triggers it).

5. **Emitter re-relativizer.** `relativizeModuleSpecifier()` in `functionsMeta.ts` resolves relative `moduleSpecifier` strings to absolute, then re-relativizes them to the generated file's directory. Shims at any depth now produce working `typeof import(...)` paths. Package aliases (`@luckystack/*`) and node built-ins pass through. Fixes latent edge case flagged in §32.

6. **Rate-limit + fuzz test layers.** Two new runners:
   - `runRateLimitTests` — for each endpoint with numeric `rateLimit`, fires N then expects the N+1 to hit `api.rateLimitExceeded`. Skips endpoints above `maxRateLimitToTest` (default 50) to avoid accidental storm. CLI: `npm run test:rate-limit`.
   - `runFuzzTests` — sends a fixed battery of junk payloads (null, arrays, huge strings, prototype pollution, NaN, wrong primitive types). Asserts no 5xx, all responses stay in `{status, errorCode}` envelope. This is the "crash resistance" layer; schema-driven fuzz still needs Zod emission and is noted as future work. CLI: `npm run test:fuzz`.

7. **`/_health` handshake → opt-in fatal.** Added `routing.strictBootHandshake?: boolean` to `deploy.config.ts`. When true, the handshake throws on mismatch/unreachable instead of warning. Default stays warning-only so partially-migrated deployments don't lock out. Flip to `true` once every service is known to expose `/_health`.

Verification: `npm run lint` clean, `npm run build` clean (`dist/server.js` 211.9 KB — down 2.6 KB because `server/utils/responseNormalizer.ts` no longer re-imports the core module into the bundle).

Key invariants added:

- **Normalizer registration rule**: framework packages call `normalizeErrorResponse`/`extractLanguageFromHeader` from `@luckystack/core`. The project MUST side-effect-import `server/utils/responseNormalizer` (or any file that calls `registerLocalizedNormalizer`) on startup, or framework errors fall back to identity translate (returns the errorCode key as the message).
- **Augmentation-load rule**: the `declare module '@luckystack/core'` augmentation in `src/_sockets/apiTypes.generated.ts` is a side-effect type load. Any file that imports from the generated file pulls it into the compilation. If no file imports it (a hypothetical pure-devkit-only compile), `ApiTypeMap` stays empty.
- **Boot handshake strict flag** (new): `deploy.config.ts -> routing.strictBootHandshake` is warning-only by default. Flip to `true` per-deployment once the `/_health` contract is universally adopted.

Known gaps / not done this session:

- Schema-driven fuzz still deferred — needs Zod/JSON-schema emission alongside TS types. Current fuzz is a fixed junk list. Real property-based testing (`fast-check` + generated schemas) is follow-up work.
- Rate-limit tests assume shared IP-based limiter state isn't reset between runs — the `clearAllRateLimits()` helper exists in core but isn't wired to a test-setup hook yet.

---

## 36) Session Log (2026-04-24, seventeenth pass — test reset, publishability audit, synchronized-env hashes)

Picked the three cheapest wins from §36. The audit also lists real blockers to NPM publication of `@luckystack/core` / `@luckystack/api` / `@luckystack/sync` — none fixed this sitting beyond the socket-layer one, but the list is now explicit.

Completed:

1. **`/_test/reset` endpoint** — new branch in `server/server.ts -> ServerRequest`. Gates: `NODE_ENV !== 'production'` hard, plus optional `X-Test-Reset-Token` header match against `process.env.TEST_RESET_TOKEN`. Production requests always return 404. Calls `clearAllRateLimits()` from core, returns `{ status: 'success', cleared: ['rateLimits'] }`.
2. **Test-runner reset helper** — new `packages/test-runner/src/resetServerState.ts` (`resetServerState({ baseUrl, token? })`). `runRateLimitTests` now accepts `resetBetweenEndpoints?: boolean` (default via CLI: `true`) and `resetToken?: string`, calling reset before every endpoint so the shared IP-based limiter bucket starts clean. CLI: `TEST_RESET_BETWEEN=false npm run test:rate-limit` opts out.
3. **Socket-layer publishability fix** — moved `apiMessage` / `syncMessage` types + `ioInstance` slot into new `packages/core/src/socketTypes.ts`. Framework packages (`@luckystack/api`, `@luckystack/sync`, `@luckystack/login`) now import `apiMessage`/`syncMessage` types and `getIoInstance()` from `@luckystack/core` instead of deep-relative `../../../server/sockets/socket`. The project's `server/sockets/socket.ts` calls `setIoInstance(io)` right after construction and re-exports the types for any remaining server-side consumers. `session.ts` switched from dynamic `await import('../../../server/sockets/socket')` to `await import('@luckystack/core')`.
4. **Synchronized-env hash check** — new `packages/core/src/synchronizedEnvHashes.ts` exports `collectSynchronizedEnvKeys()` and `computeSynchronizedEnvHashes()`. `/_health` endpoint now returns `synchronizedHashes: { [envKey]: sha256Hex | null }` alongside the boot UUID. Router's `bootHandshake.ts` computes the same hashes locally during the fallback cross-check and emits a warning (or throws under `strictBootHandshake`) per mismatched key. Catches "sessions encrypted by one side can't be decrypted by the other" at boot.

Publishability audit findings (not fixed this sitting):

The remaining deep-relative imports from `packages/**` into project files fall into four categories:

**A. Config reach** (11 files) — packages read `rateLimiting`, `logging`, `sessionBasedToken`, `sessionExpiryDays`, `session.perUser`, `defaultLanguage`, `sentry`, and the `SessionLayout` type from `../../../config`. Affected: `@luckystack/api`, `@luckystack/sync`, `@luckystack/core` (`apiRequest`, `rateLimiter`, `extractToken`, `extractTokenFromRequest`), `@luckystack/login`, `@luckystack/sentry`. Fix pattern: framework exposes a `configure*` setter per concern, project calls once at boot. Each fix is small but multiplies across call sites that read the config at every request — consider a single `registerProjectConfig({...})` call in core and a shared getter.

**B. Runtime-maps reach** (4 files) — `packages/{api,sync}/src/handle*Request.ts` imports from `../../../server/prod/runtimeMaps`. That file loads per-preset generated map files that the project emits. Fix: framework exposes a `registerRuntimeMaps({ apis, syncs })` DI surface; project's `server.ts` wires generated maps at boot.

**C. UI / notify reach** (3 files) — `packages/core/src/apiRequest.ts` and `packages/sync/src/syncRequest.ts` import `notify` from `../../../src/_functions/notify`; `syncRequest.ts` also imports `statusContent` from `../../../src/_providers/socketStatusProvider`. Fix: core exposes a `registerNotifier({ error, success, ... })` hook; project wires project-specific toasts during client bootstrap.

**D. Dev-only reach** — `packages/devkit/src/hotReload.ts` imports `reloadLocaleTranslations` from `../../../server/utils/responseNormalizer`. Acceptable (devkit is dev-only and the function is idempotent) but could be DI'd with the same pattern as the normalizer split.

**Router reach** — intentional. `@luckystack/router` reads `deploy.config.ts` and `services.config.ts` directly per §33 invariant. Not a publishability blocker because the router is meant to consume the consumer's deploy topology.

Verification: `npm run lint` clean, `npm run build` clean. `dist/server.js` 220.0 KB (+8.1 KB for synchronized-env helpers + socket types into core; acceptable for the safety wins).

Key invariants added:

- **Socket slot rule** (NEW): the project's socket-server wiring MUST call `setIoInstance(io)` from `@luckystack/core` immediately after construction. Framework packages resolve the instance through `getIoInstance()`; there is no other supported way to reach it.
- **Synchronized-env hash rule** (NEW): the backend's `/_health` endpoint returns SHA-256 hashes of every env key declared under any resource's `synchronizedEnvKeys` in `deploy.config.ts`. The router cross-checks at boot. Hashes (not values) keep secrets on-prem.
- **Test-reset endpoint rule** (NEW): `/_test/reset` is dev-only. Production requests return 404 regardless of configuration. Staging/preview deploys that want CI access must set `TEST_RESET_TOKEN` server-side and pass the same value via `X-Test-Reset-Token`.

Known gaps / not done this session:

- Config reach + runtime-maps reach + notify reach all remain publishability blockers. Audit captured above as follow-up.
- Zod/JSON-schema emission still deferred — real property-based fuzz still waiting.

---

## 37) Session Log (2026-04-24, eighteenth pass — DI sweep + Zod emission)

Cleared the three publishability blockers from §36 (config, runtime-maps, notify) and shipped a minimal Zod schema emitter. Framework packages no longer deep-import project files for runtime values, only for `SessionLayout` as a type.

Completed:

1. **Config DI.** New `packages/core/src/projectConfig.ts` with `registerProjectConfig({...})`, `getProjectConfig()`, `isProjectConfigRegistered()`, and a safe identity default. Interface covers `logging`, `rateLimiting`, `session`, `defaultLanguage`, optional `sentry`. The project's `config.ts` calls `registerProjectConfig(...)` as a bottom-of-file side effect, so any import of the config file wires values into core. Server `server.ts` imports `../config` explicitly for boot-order clarity. Framework callers switched from `import { rateLimiting } from '../../../config'` to `getProjectConfig().rateLimiting.*`, resolved at call time — import-order-safe, and narrowing is preserved by hoisting each field to a local const per block. Swept: `packages/core/src/{rateLimiter,apiRequest,extractToken,extractTokenFromRequest}.ts`, `packages/api/src/{handleApiRequest,handleHttpApiRequest}.ts`, `packages/sync/src/{handleSyncRequest,handleHttpSyncRequest,syncRequest}.ts`, `packages/login/src/{login,session}.ts`, `packages/sentry/src/sentry.ts`.

2. **Runtime-maps DI.** New `packages/core/src/runtimeMapsRegistry.ts` with `registerRuntimeMapsProvider({ getRuntimeApiMaps, getRuntimeSyncMaps })` + delegating `getRuntimeApiMaps()` / `getRuntimeSyncMaps()`. Project's `server/prod/runtimeMaps.ts` registers on load. Framework packages (`@luckystack/api`, `@luckystack/sync`) switched from `../../../server/prod/runtimeMaps` to `@luckystack/core`. Default returns empty maps so tests and headless tooling don't crash.

3. **Notify DI.** New `packages/core/src/notifier.ts` with `registerNotifier({ success, error, info, warning })` + no-op default + pre-destructured `notify` helper that matches the project's existing shape. `packages/core/src/apiRequest.ts` and `packages/sync/src/syncRequest.ts` import `notify` from core. Project's `src/_functions/notify.ts` calls `registerNotifier(notify)` on load. Also moved `statusContent` / `SOCKETSTATUS` types from `src/_providers/socketStatusProvider.tsx` into new `packages/core/src/socketStatusTypes.ts` so `@luckystack/sync/syncRequest.ts` can import the type without reaching into the project; the provider file re-exports for back-compat.

4. **Zod schema emission.** New `packages/devkit/src/typeMap/zodEmitter.ts` — a minimal TS-AST → Zod source converter. Handles primitives, literal types, unions (including `| undefined` → `.optional()`), arrays, object literals, `Record<K,V>`, `[key: string]: never` (LuckyStack's "no input" convention → `z.object({}).strict()`), and `Partial<T>`. Falls back to `z.any()` with a TODO comment for intersections / unresolved type references. Generator emits a parallel `src/_sockets/apiInputSchemas.generated.ts` alongside the type map, exporting `apiInputSchemas` and `getApiInputSchema()`. Test-runner gained `sampleSchemaInput(schema)` — walks a Zod schema and returns a deterministic minimal valid value. `scripts/testContract.ts` now uses it as the default `inputFor`, so smoke tests produce valid-ish inputs instead of plain `{}`. Property-based fuzz via `fast-check` is still a follow-up; the emitter and consumer surface are in place.

Verification: `npm run lint` clean, `npm run build` clean. `dist/server.js` 223.1 KB (+3.1 KB vs §36 for the DI registries + Zod runtime dep surface).

Key invariants added:

- **Project-config registration rule** (NEW): framework packages call `getProjectConfig()` from `@luckystack/core`. The project MUST side-effect-import its `config.ts` (or any file that calls `registerProjectConfig`) on startup, or framework packages read the identity default — safe at runtime but will log-friendly values instead of the configured ones.
- **Runtime-maps registration rule** (NEW): framework `@luckystack/api` and `@luckystack/sync` call `getRuntimeApiMaps()` / `getRuntimeSyncMaps()` from core. The project's `server/prod/runtimeMaps.ts` MUST be imported on startup so `registerRuntimeMapsProvider` runs before the first API/sync request.
- **Notifier registration rule** (NEW): `@luckystack/core` ships a no-op notifier by default. The client bootstrap MUST import the project's `src/_functions/notify.ts` so `registerNotifier(notify)` fires before the first `apiRequest` / `syncRequest` error path. The default is silent, not a crash.
- **Schema emission rule** (NEW): every API endpoint gets a Zod schema in `src/_sockets/apiInputSchemas.generated.ts`. Unparseable input types fall back to `z.any()` — intentional so generator output never rejects valid TS. See `packages/devkit/src/typeMap/zodEmitter.ts` for the supported TypeScript subset.
- **Barrel-import-from-client-bundle rule** (clarified): `config.ts` now uses `import { registerProjectConfig } from './packages/core/src/projectConfig'` (direct file path), not the barrel — the barrel pulls `bootUuid` (uses `node:crypto`) and `ioredis`, both of which break Vite's client bundle. Same rule already applied in `apiRequest.ts` / `syncRequest.ts`.

Publishability audit status after this sweep:

- **A. Config reach**: **closed**. Only remaining `../../../config` imports are `SessionLayout` type-only.
- **B. Runtime-maps reach**: **closed**.
- **C. Notify/UI reach**: **closed** for runtime values; `SessionLayout` type-only imports remain.
- **D. Dev-only devkit reach**: unchanged (acceptable — devkit is dev-only).

Known gaps / not done this session:

- **`SessionLayout` type still imported from `../../../config`** in 6+ files. Making `@luckystack/api` / `@luckystack/sync` fully publishable as npm packages requires either generic-ifying (`handleApiRequest<TSession>(...)`) or treating `BaseSessionLayout` from `@luckystack/login` as the canonical shape. Deferred — this is a bigger refactor.
- **Fast-check property-based fuzz** still not wired. `sampleSchemaInput` returns one deterministic value per schema; true property testing needs a randomizing generator.
- **Zod emitter scope** is minimal. Intersections, complex generics, mapped types fall back to `z.any()`. Good enough for current endpoints; revisit when the first API hits the fallback in practice.
- **`@luckystack/monitoring`** and **`@luckystack/web-vitals`** — explicitly parked per user's instruction; keep in §15 backlog for when product direction is clear.

---

## 38) Next Session Plan

1. ~~**`SessionLayout` generic-ification**~~ — **DONE** (§38.1 below). Decoupled by aliasing `BaseSessionLayout` from `@luckystack/login` in all 7 framework files. No generic introduced; structural compatibility from `_SessionLayoutCheck` carries the project shape across.
2. **fast-check integration** — add `fast-check` as a devDep; write a Zod → Arbitrary adapter for the types the emitter produces. Extend `runFuzzTests` with a property-based pass: generate N valid inputs per endpoint, assert no 5xx and response envelope.
3. **Zod emitter coverage** — handle intersections (merge object shapes), basic `Pick`/`Omit` by resolving the referenced interface.
4. **NPM publish dry-run** — with A/B/C closed and `SessionLayout` resolved, try `npm pack` in each framework package. Report remaining blockers (bundled paths, peer deps, etc.).
5. **Web vitals / Monitoring packages** (§15 backlog) — deferred per current product direction.
6. **`server/sockets/socket.ts`** — stays in server/ as project glue (already decided).

---

## 38.1) SessionLayout type-only decoupling — COMPLETED

Goal: remove the last `packages/** → ../../../config` import. Strategy: Option B from §38 — treat `BaseSessionLayout` (from `@luckystack/login`) as the framework-visible session type. The project's richer `SessionLayout` extends it (verified by `_SessionLayoutCheck` in `config.ts`), so structural compatibility carries the concrete shape into framework callsites without a generic parameter.

### Pattern applied

```typescript
// Before
import type { SessionLayout } from '../../../config';

// After (cross-package callsites)
import type { BaseSessionLayout as SessionLayout } from '@luckystack/login';

// After (intra-login package, avoids barrel self-import)
import type { BaseSessionLayout as SessionLayout } from './sessionLayout';

// After (client-facing syncRequest, mirrors the Vite-bundle rule already used
// for `getProjectConfig` / `notify` in apiRequest/syncRequest — import from the
// specific source file rather than the barrel)
import type { BaseSessionLayout as SessionLayout } from '../../login/src/sessionLayout';
```

### Files swept (7)

| File | Type-level usage | Other change |
| --- | --- | --- |
| `packages/api/src/handleApiRequest.ts` | `user: SessionLayout \| null` in `RuntimeApiEntry.main` | — |
| `packages/api/src/handleHttpApiRequest.ts` | `user: SessionLayout \| null` in `RuntimeApiRoute.main` | — |
| `packages/sync/src/handleSyncRequest.ts` | `user: SessionLayout \| null` in `RuntimeSyncServerEntry.main` | — |
| `packages/sync/src/handleHttpSyncRequest.ts` | same | — |
| `packages/sync/src/syncRequest.ts` | `RefObject<SessionLayout \| null>` for `sessionRef` | client-bundle-safe import path |
| `packages/login/src/session.ts` | `SessionLayout` payload in `saveSession`/`getSession`/`getAllSessions` | — |
| `packages/login/src/login.ts` | `const newUser: SessionLayout` constructions, `SessionLayout["language"]` casts | language casts replaced with `Prisma.UserCreateInput['language']` (login already pulls `PROVIDERS` from `@prisma/client`, so no new coupling) |

### Why no generic was needed

Option A would have made `handleApiRequest` / `handleHttpApiRequest` / `handleSyncRequest` generic over `TSession extends BaseSessionLayout`. Option B turned out cleaner because:

- All 5 api/sync handler usages of `SessionLayout` are pure type annotations on the runtime-loaded `main` callable, which already takes a generic `Record<string, unknown>` for `data`. Project handlers do their own narrowing on the user object inside their own typed signatures, so framework code never needs to reach into project-specific session fields.
- `session.ts` only serializes/parses sessions through Redis. Storage is opaque; `BaseSessionLayout`'s loose shape is sufficient.
- `login.ts` constructs sessions by spreading `Omit<User, 'password'>` (already typed by Prisma) into a `BaseSessionLayout`-typed local. The spread carries every project-specific field structurally; assignment to `BaseSessionLayout` succeeds because Prisma User has all of BaseSessionLayout's required fields. Generic-ification here would just propagate `Prisma.User` outward without buying anything.

### Why `login.ts` decoupling is partial

The login package already imports `prisma`, `PROVIDERS`, and now `Prisma` types from `@prisma/client` (transitively via `@luckystack/core`'s `db.ts`). It will never be publishable as a stand-alone npm package without first generic-ifying over the User shape — which is a much larger surgery than the SessionLayout swap. The SessionLayout decoupling was done here for consistency and to remove the `../../../config` dependency, not because it makes login publishable on its own.

### Audit result

- `packages/** → ../../../config` value imports: **0** (was 7).
- `packages/** → ../../../config` type imports: **0** (was 7).
- Remaining `packages/** → project` references: only re-exports (`@luckystack/login` re-exports `SessionLocation`, `AuthProps`); no value or runtime dependency.

### Verification

- `_SessionLayoutCheck` in `config.ts` still compiles (project `SessionLayout` extends `BaseSessionLayout`).
- `tsc --noEmit` clean.
- No callsite changes in framework files; the `BaseSessionLayout as SessionLayout` alias keeps every existing `SessionLayout` reference unchanged.

---

## 39) Publishability Audit (npm pack readiness)

With §38.1 complete, the `packages/** → ../../../config` import surface is gone. This section audits what *else* must change before each package can be published to npm.

### 39.0 Audit method

Static read of every `packages/*/package.json` and a grep over `packages/**` for: (a) imports from outside `packages/` (project paths like `../../../config`, `../../../server/...`), (b) cross-package imports (`@luckystack/*`), (c) external npm imports (used to derive each package's true dependency set).

### 39.1 Per-package publishability tier

Three tiers based on intent and remaining coupling:

| Package | Tier | Rationale |
| --- | --- | --- |
| `@luckystack/core` | **A — Publishable target** | Foundation layer. Holds DI registries (config, runtime-maps, notifier), socket helpers, Redis. One blocker: `synchronizedEnvHashes.ts` imports `../../../deploy.config`. |
| `@luckystack/api` | **A — Publishable target** | Now zero project value imports. Pure framework — handlers + HTTP variants. |
| `@luckystack/sync` | **A — Publishable target** | Same status as api. |
| `@luckystack/error-tracking` | **A — Publishable target** | Single file, owns its own `registerSentryConfig` registry. Clean. |
| `@luckystack/test-runner` | **A — Publishable target** | Dev-only utilities (Zod schema sampler). No project coupling. |
| `@luckystack/presence` | **A — Publishable target** | After §39.2's `peerNotifier.ts` fix, zero project imports. |
| `@luckystack/login` | **A — Publishable target** | DI'd through `registerUserAdapter` / `defaultPrismaUserAdapter`; no longer directly imports `prisma.user.*` from app code. As of 0.2.0 §8 the package's `./register` side-effect subpath auto-wires `defaultPrismaUserAdapter()` at boot (guarded by `isUserAdapterRegistered()` so it never clobbers a custom one). Consumers override it by calling `registerUserAdapter(...)` — e.g. from an optional `luckystack/login/userAdapter.ts` overlay, which runs *after* `./register` and wins as last-writer. The overlay is no longer scaffolded by default. |
| `@luckystack/devkit` | **A — Publishable target** | Promoted on 2026-05-13. Reads project paths via `getProjectConfig().paths` getters and locale reload via `getLocaleReloader()` registry. The remaining `hotReload.ts → responseNormalizer.ts` import has been DI'd through `registerLocaleReloader`. Ships as a `devDependency` for consumers (build-time tool, not runtime). |
| `@luckystack/router` | **A — Publishable target** | Promoted on 2026-05-11. Reads deploy/services configs via `getDeployConfig()` / `getServicesConfig()` DI surfaces — the `luckystack-router` bin loads the consumer's compiled config modules via `--deploy` / `--services` flags before calling `startRouter()`. |

### 39.2 Code-level coupling matrix

After §38.1, remaining `packages/** → project` imports:

| Package | File | Import | Disposition |
| --- | --- | --- | --- |
| `core` | `synchronizedEnvHashes.ts` | `../../../deploy.config` | **Closed (§39.7)** — `getDeployConfig()` from new `deployConfigRegistry`. |
| `presence` | `activity/peerNotifier.ts` | `../../../../server/sockets/socket` | **Closed (§39.5)** — `getIoInstance()` from core. |
| `devkit` | `hotReload.ts` | `../../../server/utils/responseNormalizer` | **Closed (2026-05-13)** — DI'd via `registerLocaleReloader()` in core; devkit calls `getLocaleReloader()?.()`. |
| `router` | `resolveTarget.ts`, `bootHandshake.ts`, `startRouter.ts` | `getDeployConfig()`, `getServicesConfig()` from `@luckystack/core` | **Closed (2026-05-11)** — router uses DI surfaces; the `luckystack-router` bin loads consumer config modules. |

After §39.7, every tier-A package has **zero** project-level value or type imports. The remaining `packages/** → project` imports are all in tier-B (devkit, router) and accepted by design.

### 39.3 Universal `package.json` blockers (apply to every tier-A package)

| Field / Concern | Current State | Required for npm |
| --- | --- | --- |
| `private: true` | Set in all 9 packages | Remove (or set `false`). |
| `main` | `./src/index.ts` | Point at compiled output, e.g. `./dist/index.js`. |
| `types` | Missing | Add `./dist/index.d.ts`. |
| `module` | Missing | Add `./dist/index.js` (ESM). |
| `exports` | `{ ".": "./src/index.ts" }` | `{ ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`. |
| `files` | Missing | Add `["dist", "README.md"]` (or use `.npmignore`). |
| `dependencies` | Missing | Each package declares its true npm deps (e.g., `ioredis` for core, `bcryptjs`/`validator` for login). |
| `peerDependencies` | Missing | Declare `react`/`socket.io`/`@prisma/client` etc. as peers where appropriate. |
| `version` | All `0.0.1` | Pick a versioning policy (lockstep simplest for a monorepo). |
| Build step | None — packages run from `src/*.ts` directly via tsx in dev | Add per-package `tsup` / `tsc` build emitting to `dist/`. |
| README | Missing | Add a one-paragraph README to each before publishing (npm requires it). |

### 39.4 Recommended fix order before `npm pack` dry-run

1. ~~**Tier-A code blocker** — DI for `deploy.config`.~~ **Done (§39.7).**
2. **Build pipeline** — pick `tsup` (zero-config dual ESM/CJS + `.d.ts`) and add a `build` script per tier-A package. Confirm output by running `npm pack --dry-run` per package.
3. **Dependency declarations** — generate per-package `dependencies`/`peerDependencies` from the import audit in 39.2. Ensure consumers don't get duplicate copies of `react`/`socket.io`/`@prisma/client` (peer them).
4. **Cross-package consumption** — verify `@luckystack/api` published as `0.0.1` resolves `@luckystack/core` `0.0.1` — i.e., dependencies between framework packages are also declared.
5. **Trial publish** — `npm pack` (writes a `.tgz` locally without publishing) for each tier-A package; inspect tarball contents.
6. **Real publish** — only after the rest, to a registry (npm public, GitHub Packages, or private).

### 39.5 What this session changed

- `peerNotifier.ts` decoupled from `server/sockets/socket` (`ioInstance` → `getIoInstance()`). Presence is now tier-A clean at code level.
- Audit recorded; remaining tier-A code blocker is the single `deploy.config` import in `core/synchronizedEnvHashes.ts`.

### 39.6 Out of scope for this audit

- `@luckystack/login` Prisma decoupling — non-trivial, would require DI for User model or generic-ification.
- Build tooling decision (`tsup` vs `tsc -b` vs `rollup`) — needs a small spike on each before committing.
- Versioning policy — lockstep vs independent. Lockstep is simpler; independent allows independent semver but needs Changesets or similar.

---

## 39.7) deploy.config DI — COMPLETED

Closes §39.4 step 1. Last tier-A code blocker eliminated.

### Pattern (same as `projectConfig` / `runtimeMapsRegistry` / `notifier`)

- New `packages/core/src/deployConfigRegistry.ts` exports `registerDeployConfig`, `getDeployConfig`, `isDeployConfigRegistered`, plus `DeployConfigShape` / `DeployResourceShape` types. Safe default is empty `resources: {}`.
- `packages/core/src/index.ts` re-exports the registry surface.
- `packages/core/src/synchronizedEnvHashes.ts` swaps `import deployConfig from '../../../deploy.config'` for `import { getDeployConfig } from './deployConfigRegistry'`. `collectSynchronizedEnvKeys()` now reads `getDeployConfig().resources` at call time — registration order doesn't matter.
- Project `deploy.config.ts` imports `registerDeployConfig` from the **direct file path** `./packages/core/src/deployConfigRegistry` (not the barrel — same Vite-bundle rule we use elsewhere) and calls `registerDeployConfig({ resources: deployConfig.resources })` at module load.
- `server/server.ts` adds an explicit `import '../deploy.config'` next to the existing `import '../config'`, so the registration is wired before any code reads `computeSynchronizedEnvHashes()` (used by `/_health`).

### Why only `resources` is registered

`@luckystack/core` only consumes `resources[*].synchronizedEnvKeys`. Environments, bindings, and routing fields stay private to the project — they're only consumed by `@luckystack/router`, which is tier-B and intentionally project-coupled. If router is ever promoted to tier-A, extend `DeployConfigShape` with `environments` (and the project pre-registers the full config); for now, narrow shape = narrow contract.

### Verification

- All `packages/** → ../../../deploy.config` value imports: **0** in tier-A. (1 remains in router; tier-B, accepted.)
- Boot order preserved: `server.ts` side-effect-imports `../deploy.config` immediately after `../config`, before any framework code that calls `computeSynchronizedEnvHashes()`.
- `synchronizedEnvHashes.ts` still re-exports `resolveEnvKey` from `./bootUuid`; that re-export path is unchanged.

### Tier-A code-coupling status: clean

| Package | `packages/** → project` imports |
| --- | --- |
| `@luckystack/core` | 0 |
| `@luckystack/api` | 0 |
| `@luckystack/sync` | 0 |
| `@luckystack/sentry` | 0 |
| `@luckystack/test-runner` | 0 |
| `@luckystack/presence` | 0 |

Next step: §39.4 step 2 — pick a build tool and add `build` scripts per tier-A package.

---

## 39.8) Build pipeline (tsup) — COMPLETED

Closes §39.4 step 2. Every package (tier-A and tier-B) now has a tsup-based build that emits ESM `.js` + `.d.ts` to `dist/`.

### Choices

- **Tool**: `tsup` (esbuild + rollup-plugin-dts wrapper). Zero-config, handles dts generation, supports multi-entry.
- **Format**: ESM only. Project is already `"type": "module"`; modern Node + Vite consumers are ESM-first. CJS dual-build adds dts/exports gymnastics for marginal benefit and can be added later if needed.
- **Externals**: `@luckystack/*` (sister packages stay external — consumers install them) + `skipNodeModulesBundle: true` (third-party deps come from the consumer's `node_modules`, not bundled). Once we declare per-package `dependencies`/`peerDependencies` in §39.4 step 3, tsup will respect those automatically.
- **Target**: ES2022 (matches `tsconfig.shared.json`).

### File layout per package

```
packages/<name>/
  package.json        # main/types/exports/files/build script
  tsconfig.json       # extends ../../tsconfig.packages.base.json
  tsup.config.ts      # entry, format, dts, externals
  src/                # source (unchanged)
  dist/               # build output (gitignored)
```

### Shared base tsconfig

`tsconfig.packages.base.json` at the repo root carries:

- `module: ESNext`, `moduleResolution: bundler`
- `declaration: true`, `declarationMap: true`, `sourceMap: true`, `noEmit: false`
- `lib: ['ES2023', 'DOM', 'DOM.Iterable']`, `jsx: 'react-jsx'` (so files importing React types compile)

Notably **no `paths`** — see §39.8.1 for why.

Each package's `tsconfig.json` is a 7-line file: extends the base, adds `outDir: dist` + `rootDir: src` + `include: ['src']`.

### npm workspaces

Root `package.json` declares `"workspaces": ["packages/*"]`. After `npm install`, every package is symlinked into `node_modules/@luckystack/*`. Sister-package imports inside the build pipeline resolve through `node_modules` to the target's `package.json` `exports` map (which points at `dist/`).

Dev mode is unaffected: `tsconfig.server.json` and `tsconfig.client.json` still carry their `@luckystack/* → packages/*/src/index.ts` paths, which Vite (`vite-tsconfig-paths`) and `tsx` use to resolve to source. Workspaces and tsconfig paths coexist; for dev, paths win.

### Multi-entry packages

`@luckystack/core` and `@luckystack/sync` ship two entries:

| Entry | File | Why |
| --- | --- | --- |
| `.` (default) | `src/index.ts` | Server-safe surface (Redis, sockets, registries / handlers) |
| `./client` | `src/client.ts` | Browser-safe transport (`apiRequest`, `syncRequest`) — quarantined because it pulls React-coupled project code |

The `exports` map advertises both subpaths with their own `types`/`import` pairs.

### Build orchestration

- Per-package: `cd packages/<name> && npm run build` (runs `tsup`).
- All packages: `npm run build:packages` from root — runs `scripts/buildPackages.mjs`, which builds in topological order (core → sentry/login → api/sync → presence/test-runner → devkit/router).
- Pack dry-run: `npm run pack:dry` from root — builds, then runs `npm pack --dry-run` per package so you can inspect what would be published.

### Why every package is still `private: true`

Building does not imply publishing. Packages stay private until §39.4 steps 3-6 land (per-package dep declarations, README per package, registry choice, real publish). Removing `private: true` is the last switch flipped, intentionally.

### Tier-B packages get builds too (full JS + dts)

devkit and router are project-glue and not intended for npm publishing, but they ship the same tsup setup so the build pipeline is uniform across the monorepo. They emit ESM + `.d.ts` like tier-A. The only difference: their per-package `tsconfig.json` omits `rootDir` so tsc accepts cross-`src` imports from project files (devkit: `server/utils/responseNormalizer`; router: `deploy.config`, `services.config`). Tarball layout is unaffected — rollup-plugin-dts bundles intermediate types into a single `dist/index.d.ts` regardless of where source files lived during compilation.

If the project ever wants to deploy router from compiled output (instead of running `tsx` on src), the JS + dts build is already there.

### Verification

To verify after this commit:

```bash
npm install                     # picks up tsup devDep
npm run build:packages          # builds all 9 packages
ls packages/core/dist           # expect: index.js, index.d.ts, client.js, client.d.ts, .map files
npm run pack:dry                # dry-run npm pack per package; tarball file lists print to stdout
```

The expected tarball contents per package: `package.json` + `dist/**` only (no `src/`, no `tsconfig.json`, no `tsup.config.ts` — `files: ["dist"]` whitelist enforces this).

### Known follow-ups (not blockers, but worth doing soon)

- ~~**Per-package `dependencies` / `peerDependencies`**~~ — done in §39.9.
- **README per package** — npm publish requires it.
- **Sourcemap paths** — tsup emits sourcemaps that point at `src/` paths relative to the package dir; should work out of the box but worth verifying once a real consumer pulls a built tarball.
- **Bundle size sanity check** — first build revealed devkit at 195 KB (typescript compiler API + AST walkers, expected) and core at 47 KB server / 13.7 KB client; everything else under 30 KB.

---

## 39.8.1) Build-time circular type dep — RESOLVED

The first `npm run build:packages` exposed a circular type dep between core and login: `core/validateRequest.ts` imported `BaseSessionLayout` and `AuthProps` from `@luckystack/login`, while login's value-level code imported from `@luckystack/core` (prisma, redis, etc.). With path-based resolution to source, tsc's dts step pulled `packages/login/src/index.ts` into core's program and rejected it under `rootDir: src`.

### Fix: foundational types belong in core

- New `packages/core/src/sessionTypes.ts` — canonical home for `BaseSessionLayout`, `SessionLocation`, `AuthProps`. Definitions moved verbatim.
- `core/validateRequest.ts` imports from `./sessionTypes` (no more `@luckystack/login` dep in core).
- `core/index.ts` exports the three types from `./sessionTypes`.
- `login/sessionLayout.ts` collapsed to a single re-export line: `export type { BaseSessionLayout, SessionLocation, AuthProps } from '@luckystack/core'`. Login's barrel still re-exports them, so existing project imports (`import type { BaseSessionLayout } from '@luckystack/login'`) keep working.

### Fix: drop `@luckystack/*` paths from the build base

- `tsconfig.packages.base.json` no longer carries path mappings.
- Sister packages now resolve through `node_modules` (workspaces symlinks), where each package's `package.json` `exports` map points at `dist/`.
- This means **build order matters at type-check time**: a package can't be type-checked until its dependencies have been built. `scripts/buildPackages.mjs` builds in topological order (core → sentry/login → api/sync/presence/test-runner → devkit/router).

### Build dependency graph (after type move)

```
core ─┬─> sentry
      ├─> login ─┬─> api
      │          └─> sync
      ├─> presence
      ├─> test-runner
      ├─> devkit
      └─> router
```

No cycles. Every package's incoming edges resolve before it builds.

### Re-bootstrap steps for anyone re-cloning

```bash
npm install                  # creates node_modules/@luckystack/* symlinks via workspaces
npm run build:packages       # builds in topological order
```

---

## 39.10) `@luckystack/server` — one-call bootstrap helper

New tier-A package consolidating HTTP + Socket.io + framework-routes wiring. Consumer's `server.ts` shrinks from 700+ lines to ~25.

### Surface

```ts
import { createLuckyStackServer } from '@luckystack/server';

const server = await createLuckyStackServer({
  port: 80,
  ip: '0.0.0.0',
  serveFile: (req, res) => /* project static-file handler */,
  serveFavicon: (res) => /* project favicon handler */,
  customRoutes: async (req, res, ctx) => {
    // return true if you handled the request, false otherwise
    return false;
  },
  enableDevTools: process.env.NODE_ENV !== 'production',
});

await server.listen();
```

### What's wired automatically

- HTTP framework routes: `/api/*`, `/sync/*`, `/_health`, `/_test/reset`, `/uploads/*`, `/auth/api/*`, `/auth/callback/*`
- CORS + standard security headers (Referrer-Policy, X-Frame-Options, X-XSS-Protection, X-Content-Type-Options)
- Cookie-mode session sliding expiration
- SSE streaming for `/api/*` and `/sync/*` when client opts in via `Accept: text/event-stream` or `?stream=1`
- Socket.io with the Redis adapter, connection token extraction, room join/leave handlers, optional presence broadcasting, optional location syncing
- Boot-UUID write before `listen()` so the router handshake works

### Project responsibilities (passed in as options)

- `serveFile`: how to serve your built Vite output / static assets
- `serveFavicon`: how to serve `/favicon.ico`
- `customRoutes`: any project-specific HTTP endpoints

### Pre-conditions

Before calling `createLuckyStackServer(...)`, the project must side-effect-import:
1. `./config` — registers project config
2. `./deploy.config` — registers deploy topology
3. `./prod/runtimeMaps` — registers runtime API/sync maps
4. `./utils/responseNormalizer` — registers locale-aware error normalizer

### Project config additions

`ProjectConfig` gained three fields used by the server package:
- `socketActivityBroadcaster?: boolean` — toggle presence broadcasting on socket connect/disconnect
- `locationProviderEnabled?: boolean` — toggle client → server `updateLocation` syncing
- `loginRedirectUrl?: string` — where to redirect after a successful OAuth callback

The project's `config.ts` already has these as top-level keys; we now propagate them through `registerProjectConfig`.

### Why this isn't `@luckystack/core`

Keeping the bootstrap helper in its own package means consumers who don't want it (advanced users wiring their own HTTP server) don't pull in `@luckystack/api` + `@luckystack/sync` + `@luckystack/login` + `@luckystack/presence` transitively just by importing `core`.

---

## 39.9) Per-package dependency declarations — COMPLETED

Closes §39.4 step 3. Each package's `package.json` now declares its real `dependencies` and `peerDependencies` based on a static import audit.

### Classification rules used

- **`peerDependencies`** for libs that:
  - must not be duplicated across the consumer's tree (`react`, `socket.io`, `socket.io-client` — singleton clients/servers; `zod` — instanceof checks across schema modules; `ioredis` — singleton connection; `@prisma/client` — schema must match the consumer's; `typescript` — devkit's runtime type resolver should use the consumer's tsc; `@sentry/node` — single tracer instance).
- **`dependencies`** for everything else (`bcryptjs`, `validator`, `dotenv`, `chokidar`, `@socket.io/redis-adapter`).
- **Cross-package** (`@luckystack/*`) goes in `dependencies` with `^0.0.1`. Workspaces resolve via symlink today; a registry resolves the constraint when published.

### Final matrix

| Package | `dependencies` | `peerDependencies` |
| --- | --- | --- |
| `@luckystack/core` | `dotenv`, `@socket.io/redis-adapter` | `@prisma/client`, `ioredis`, `socket.io`, `socket.io-client`, `zod` |
| `@luckystack/error-tracking` | `@luckystack/core` | `@sentry/node` |
| `@luckystack/login` | `@luckystack/core`, `bcryptjs`, `dotenv`, `validator` | `@prisma/client`, `socket.io` |
| `@luckystack/api` | `@luckystack/core`, `@luckystack/login`, `@luckystack/error-tracking` | `socket.io` |
| `@luckystack/sync` | `@luckystack/core`, `@luckystack/login`, `@luckystack/error-tracking` | `react`, `socket.io`, `socket.io-client` |
| `@luckystack/presence` | `@luckystack/core`, `@luckystack/login` | `socket.io` |
| `@luckystack/test-runner` | — | `zod` |
| `@luckystack/devkit` | `@luckystack/core`, `chokidar` | `@prisma/client`, `typescript`, `zod` |
| `@luckystack/router` | `ioredis` | — |

### What this changes for builds

- **No build-time difference today** — workspaces was already resolving sister packages and root `node_modules` was already hoisting third-party deps. tsup's `skipNodeModulesBundle: true` continues to leave them as imports.
- **Real consumers** doing `npm install @luckystack/api` will now correctly pull `@luckystack/core`, `@luckystack/login`, `@luckystack/error-tracking` automatically, and npm will warn (not fail) if they're missing the peer deps.
- **`tsup` will start respecting the declared peer/regular split** — once we drop `skipNodeModulesBundle`, peers become mandatory externals automatically.

### What's still missing for actual publish

1. README per package (npm requires it; consumers expect it).
2. Pick a registry (npm public, GitHub Packages, private).
3. Flip `private: false` on packages we want to publish (tier-A first; tier-B stays private).
4. Decide on a versioning policy. Lockstep at `0.0.1` is fine for a first release; later we can adopt Changesets if tier-A versions drift.
5. Add `repository`, `license`, `description`, `keywords` fields to every published package.json.
6. Run `npm pack` (not dry-run) and inspect the actual tarball. Optionally test-install one in a fresh directory to confirm consumer DX.
