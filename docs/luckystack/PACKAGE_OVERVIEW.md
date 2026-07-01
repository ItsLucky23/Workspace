# LuckyStack Package Overview

> Quick reference voor AI agents en developers: welk `@luckystack/*` package los je waarmee op?
> Voor diepe details per package: zie `packages/<name>/CLAUDE.md`.

## Core Packages

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/core` | Foundation: socket-first transport contracts, DI registries (config, prisma, redis, notifier, email, error-tracker, logger, runtime maps), hooks bus, cross-cutting primitives (`tryCatch`, rate limiter, CORS, validateRequest, offline queue, CSRF), AND the LuckyStack eslint contract via the `@luckystack/core/eslint` subpath. | `@prisma/client@^6.19.0`, `ioredis@^5.10.0`, `socket.io@^4.8.0`, `socket.io-client@^4.8.0`, `zod@^4.0.0` | `react@^19.2.0`, `react-dom@^19.2.0`, `react-router-dom@^7.0.0`, `sonner@^2.0.0`, `eslint@^9.0.0` (only `/eslint` subpath) |
| `@luckystack/server` | One-call server bootstrap that wires raw Node HTTP, Socket.io (+ Redis adapter), framework routes (`/api/*`, `/sync/*`, `/_health`, `/livez`, `/readyz`, `/_test/reset`, `/auth/*`), CSRF, CORS, security headers, and dev hot reload. | `@prisma/client@^6.19.0` (via core), `socket.io@^4.8.0` | `@luckystack/error-tracking`, `@luckystack/email`, `@luckystack/docs-ui`, `@luckystack/devkit` (dev-only) |
| `@luckystack/api` | Transport-agnostic API request layer for file-based `_api/` routes — handles auth, rate limit, Zod validation, hook dispatch, and response normalization for both socket and HTTP transports. | `@prisma/client@^6.19.0` (via core), `socket.io@^4.8.0` | none |
| `@luckystack/sync` | Real-time room-based fanout over Socket.io (+ HTTP/SSE fallback) for file-based `_sync/` routes with streaming primitives and an offline-replay queue. | `@prisma/client@^6.19.0` (via core), `socket.io@^4.8.0`, `socket.io-client@^4.8.0` | `react@^19.2.0` (only `/client` subpath) |

## Auth & Sessions

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/login` | Credentials + OAuth (Google, GitHub, Discord, Facebook, Microsoft, custom) auth, Redis-backed sessions, single-session enforcement, password-reset primitives, pluggable `UserAdapter` / `SessionAdapter`. | `@prisma/client@^6.19.0`, `socket.io@^4.8.0` | `@luckystack/email` (only when `auth.forgotPassword === 'framework'`) |

## Communication

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/email` | Pluggable transactional email with Console / Resend / SMTP adapters, named template registry, `preEmailSend` / `postEmailSend` hooks, multi-sender slots. | none | `resend` (for `ResendSender`), `nodemailer` (for `SmtpSender`) |
| `@luckystack/presence` | Presence + activity awareness: AFK detection, disconnect grace windows, room-peer `userAfk` / `userBack` notifications, reconnect hooks, pluggable activity events. | `socket.io@^4.8.0` | `react@^19.2.0`, `react-router-dom` (only `/client` subpath for `SocketStatusIndicator` + `LocationProvider`) |

## Observability

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/error-tracking` | Pluggable server error-tracking with built-in Sentry / Datadog / PostHog adapters and multi-tracker fan-out (per-adapter throws are swallowed). | none | `@sentry/node@^10.48.0`, `dd-trace@^5.0.0`, `hot-shots@^10.0.0`, `posthog-node@^4.0.0` |

## Infrastructure & Deployment

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/router` | Optional standalone HTTP + WebSocket load-balancer for multi-instance / preset-bundle deploys with boot-UUID handshake, Redis-backed health state, and dev-to-staging fallback proxy. The router's topology config files (`services.config.ts` + `deploy.config.ts`, plus the build-time `server/config/presetLoader.ts`) are **NOT** in a default install — they ship via `npx luckystack add router` (which also wires their two `server.ts` side-effect imports) and are removed again by `npx luckystack remove router`. | `ioredis@^5.10.0` | none |

## Dev Tools

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/devkit` | Dev-time file-based route discovery, hot reload, TypeScript-program-backed type-map + Zod schema emission (including the multi-directory function-injection map — spec: `docs/ARCHITECTURE_FUNCTION_INJECTION.md`), supervisor process restart, and `luckystack-validate-deploy` CLI. | `typescript@>=5.7.3 <7.0.0`, `zod@^4.0.0`, `@prisma/client@^6.19.0` | `tsx` (supervisor child process) |
| `@luckystack/test-runner` | Generated-type-driven sweep that walks every API endpoint and runs five progressive layers: contract smoke, auth enforcement, rate-limit, crash-resistance fuzz, and per-route custom tests. | `zod@^4.0.0`, `socket.io-client@^4.8.0` | none |
| `@luckystack/docs-ui` | Dev-only Swagger-style browser at `/_docs` that renders `apiDocs.generated.json` with method, auth, rate limit, input/output shape, and optional inline try-it-out. | none (composes with `@luckystack/server` `customRoutes`) | none |
| `@luckystack/mcp` | Read-only MCP server exposing the project's committed AI context (decisions, dependency graph, routes, runbooks, capabilities) to Claude Code as queryable tools (`blast_radius`, `who_imports`, `god_nodes`, `list_decisions`, `get_decision`, `find_route`, `get_runbook`, `get_capability`). Runs via `npx` (no app dependency); add a `luckystack` entry to `.mcp.json`. | none (uses `@modelcontextprotocol/sdk` + `zod`, bundled via `npx`) | none |

## Utilities

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/secret-manager` | Rotation-aware secret resolver client. Commit `.env` pointers (e.g. `OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5`) instead of real secrets; at boot it resolves them against an external append-only secret-manager server and writes the real values into `process.env`. Supports `local` / `remote` / `hybrid` modes + opt-in dev hot reload. The companion server lives in a separate, project-independent git repo (`luckystack-secret-manager`). | none (uses global `fetch`, requires Node >= 20) | any `fetch` polyfill (e.g. `undici`) for non-Node-20 hosts |

## Scaffolding

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `create-luckystack-app` | Interactive scaffold CLI for new LuckyStack projects (`npx create-luckystack-app <name>`); copies template, runs `npm install` + `npx prisma generate`. | none (Node >= 20, npm on PATH) | none |

## "I want to..." cheatsheet

Quick lookup: feature -> which package(s) to suggest.

| I want to... | Suggest installing |
|---|---|
| Add OAuth login | `@luckystack/login` (+ `@luckystack/email` voor framework-mode password reset) |
| Add real-time updates / multiplayer | `@luckystack/sync` |
| Track user presence (online / AFK) | `@luckystack/presence` |
| Send transactional emails | `@luckystack/email` |
| Add error tracking | `@luckystack/error-tracking` |
| Run multi-instance load-balanced | `@luckystack/router` |
| Add API endpoints | `@luckystack/api` (auto-wired via `@luckystack/server`; create `src/{page}/_api/{name}_v{N}.ts`) |
| Bootstrap a new project | `npx create-luckystack-app` |
| Run integration tests | `@luckystack/test-runner` |
| Browse generated docs in dev | `@luckystack/docs-ui` |
| Resolve secrets from a central server (committed pointers) | `@luckystack/secret-manager` |
| Hot-reload + type-map gen in dev | `@luckystack/devkit` |
| Let Claude Code query the repo's AI context (blast-radius, decisions, routes) | `@luckystack/mcp` (add a `.mcp.json` entry; runs via `npx`) |

## Decision Matrix

| Scenario | Required packages | Optional add-ons |
|---|---|---|
| Minimal API server | `core` + `server` + `api` | `error-tracking` |
| Full social app | `core` + `server` + `api` + `sync` + `login` + `presence` | `email`, `error-tracking` |
| Public REST API | `core` + `server` + `api` | `error-tracking`, `docs-ui` |
| Multi-tenant SaaS | `core` + `server` + `api` + `sync` + `login` + `email` | `error-tracking`, `presence`, `router` |

---

> **Reserved slot:** `packages/` also contains an `env-resolver` directory — an intentionally-reserved, **not-yet-implemented** placeholder (no `package.json`, no `src/`, excluded from `buildPackages.mjs` / `publishPackages.mjs`). It is NOT published, so it's deliberately absent from the tables above. The published count is 15 `@luckystack/*` packages (+ `create-luckystack-app`).

---

> Voor consumers — als deze documentatie stale wordt na een framework-update: run `npm run ai:index` om `AI_QUICK_INDEX.md` te regenereren, of consider `npx @luckystack/sync-docs` (toekomstig CLI tool).
