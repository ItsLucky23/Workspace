# LuckyStack Package Overview

<!-- @covers packages -->

> Quick reference voor AI agents en developers: welk `@luckystack/*` package los je waarmee op?
> Voor diepe details per package: zie `packages/<name>/CLAUDE.md`. Exacte versies, exports en dependency-ranges staan in `packages/<name>/package.json`; de tabellen hieronder zijn een use-case- en installatiematrix, geen tweede manifest.

## Core Packages

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/core` | Foundation: socket-first transport contracts, DI registries (config, database, Redis, notifier, email, error-tracker, logger, runtime maps), hooks bus, cross-cutting primitives (`tryCatch`, rate limiter, CORS, validateRequest, offline queue, CSRF), and the LuckyStack ESLint contract via the `/eslint` subpath. | `ioredis`, `socket.io`, `socket.io-client`, `zod` | `@prisma/client` (only for the Prisma database path), React packages, `sonner`, `eslint` (only `/eslint`) |
| `@luckystack/server` | One-call server bootstrap that wires raw Node HTTP, Socket.io (+ Redis adapter), framework routes (`/api/*`, `/sync/*`, `/_health`, `/livez`, `/readyz`, `/_test/reset`, `/auth/*`), CSRF, CORS, security headers, and dev hot reload. | `socket.io` | `@prisma/client`, `@luckystack/login`, `@luckystack/presence`, `@luckystack/sync`, `@luckystack/email`, `@luckystack/error-tracking`, `@luckystack/cron`, `@luckystack/docs-ui`, `@luckystack/devkit` (dev-only) |
| `@luckystack/api` | Transport-agnostic API request layer for file-based `_api/` routes — handles auth, rate limit, Zod validation, hook dispatch, and response normalization for both Socket.io and HTTP transports. | `socket.io` | `@prisma/client` only when the consumer uses Prisma through core |
| `@luckystack/sync` | Real-time room-based fanout over Socket.io (+ HTTP/SSE fallback) for file-based `_sync/` routes with streaming primitives and an offline-replay queue. | `socket.io`, `socket.io-client` | `@prisma/client`, React (only `/client` subpath) |

## Auth & Sessions

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/login` | Credentials + OAuth (Google, GitHub, Discord, Facebook, Microsoft, custom) auth, Redis-backed sessions, single-session enforcement, password-reset and 2FA primitives, pluggable `UserAdapter` / `SessionAdapter`. | `socket.io` | `@prisma/client` (default adapter only), `@luckystack/email` (framework password reset only) |

## Communication

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/email` | Pluggable transactional email with Console / Resend / SMTP adapters, named template registry, `preEmailSend` / `postEmailSend` hooks, multi-sender slots. | none | `resend` (for `ResendSender`), `nodemailer` (for `SmtpSender`) |
| `@luckystack/presence` | Presence + activity awareness: AFK detection, disconnect grace windows, room-peer `userAfk` / `userBack` notifications, reconnect hooks, pluggable activity events. | `socket.io` | `@luckystack/login`, React, `react-router-dom` (client subpath only) |

## Observability

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/error-tracking` | Pluggable server error-tracking with built-in Sentry / Datadog / PostHog adapters and multi-tracker fan-out (per-adapter throws are swallowed). | none | `@sentry/node@^10.66.0`, `dd-trace@^5.0.0`, `hot-shots@^10.0.0`, `posthog-node@^4.0.0` |

## Infrastructure & Deployment

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/router` | Optional standalone HTTP + WebSocket load-balancer for multi-instance / preset-bundle deploys with boot-UUID handshake, Redis-backed health state, and dev-to-staging fallback proxy. The router's topology config files (`services.config.ts` + `deploy.config.ts`, plus the build-time `server/config/presetLoader.ts`) are **NOT** in a default install — they ship via `npx luckystack add router` (which also wires their two `server.ts` side-effect imports) and are removed again by `npx luckystack remove router`. | `ioredis@^5.10.0` | none |
| `@luckystack/cron` | Leader-elected, Redis-backed cron scheduler: declarative recurring jobs (`registerCronJob`, cron expressions via croner or `{ everyMs }` intervals) with one active leader under a healthy lease, per-run dedup leases, overlap guards, jitter, per-tenant fan-out, run stats, and `preCronRun`/`postCronRun` hooks. Auto-wired at boot; register jobs in `luckystack/cron/*.ts`. The lease is best-effort, so jobs must be idempotent. NOT a queue — for retries/priorities use bullmq. | none (Redis via core) | none |

## Dev Tools

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/devkit` | Dev-time file-based route discovery, hot reload, TypeScript-program-backed type-map + Zod schema emission (including the multi-directory function-injection map — spec: `docs/ARCHITECTURE_FUNCTION_INJECTION.md`), supervisor process restart, and `luckystack-validate-deploy` CLI. | `typescript@>=5.7.3 <7.0.0`, `zod` | `@prisma/client` only when Prisma route types are present |
| `@luckystack/test-runner` | Generated-type-driven sweep that walks every API endpoint and runs five progressive layers: contract smoke, auth enforcement, rate-limit, crash-resistance fuzz, and per-route custom tests. | `zod`, `socket.io-client` | `@luckystack/login`, `@luckystack/secret-manager` |
| `@luckystack/docs-ui` | Dev-only Swagger-style browser at `/_docs` that renders `apiDocs.generated.json` with method, auth, rate limit, input/output shape, and optional inline try-it-out. | none | `@luckystack/server` |
| `@luckystack/mcp` | Read-only MCP server exposing the project's committed AI context (decisions, dependency graph, routes, runbooks, capabilities) to Claude Code as queryable tools (`blast_radius`, `who_imports`, `god_nodes`, `list_decisions`, `get_decision`, `find_route`, `get_runbook`, `get_capability`). Runs via `npx` (no app dependency); add a `luckystack` entry to `.mcp.json`. | none (uses `@modelcontextprotocol/sdk` + `zod`, bundled via `npx`) | none |

## Utilities

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/secret-manager` | Rotation-aware secret resolver client. Commit `.env` pointers (e.g. `OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5`) instead of real secrets; at boot it resolves them against an external append-only secret-manager server and writes the real values into `process.env`. Supports `local` / `remote` / `hybrid` modes + opt-in dev hot reload. The companion server lives in a separate, project-independent git repo (`luckystack-secret-manager`). | none (uses global `fetch`, requires Node >= 20) | any `fetch` polyfill (e.g. `undici`) for non-Node-20 hosts |

## Scaffolding

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `create-luckystack-app` | Interactive scaffold CLI for new LuckyStack projects (`npx create-luckystack-app <name>`); supports the selected ORM and npm/Bun package manager, copies the template and runs the relevant install/generation steps. | none (Node >= 20) | none |

## "I want to..." cheatsheet

Quick lookup: feature -> which package(s) to suggest.

| I want to... | Suggest installing |
|---|---|
| Add OAuth login | `@luckystack/login` (+ `@luckystack/email` voor framework-mode password reset) |
| Add real-time updates / multiplayer | `@luckystack/sync` |
| Track user presence (online / AFK) | `@luckystack/presence` |
| Send transactional emails | `@luckystack/email` |
| Add error tracking | `@luckystack/error-tracking` |
| Run recurring background jobs (leader-elected, best-effort once-per-cluster scheduling) | `@luckystack/cron` |
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

> **Reserved slot:** `packages/` also contains an `env-resolver` directory — an intentionally-reserved, **not-yet-implemented** placeholder (no `package.json`, no `src/`, excluded from `buildPackages.mjs` / `publishPackages.mjs`). It is NOT published, so it's deliberately absent from the tables above. The published count is 16 `@luckystack/*` packages (+ `create-luckystack-app`).

---

> Voor consumers — exacte packageversies en peer-dependencies staan in de geïnstalleerde package manifests. Voor framework-owned docs gebruikt een bestaand project `npx luckystack update`; `npm run ai:index` regenereert alleen de lokale AI-index.
