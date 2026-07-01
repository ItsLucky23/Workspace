# Product

> Plain-language description of what this app is and what it is for — the INTENT layer. Maintained by the
> AI (and you): kept current when features land, and backfilled from history + a short interview on an
> existing repo (see `docs/DECISION_MEMORY_PROTOCOL.md` §8 + CLAUDE.md). Folded into the generated
> `docs/AI_PRODUCT_OVERVIEW.md` together with each page's `//? intent:` line. No emojis; plain language.

## What this is

This repository is the **LuckyStack framework monorepo** plus a **sample/playground app** used to exercise
and demo the framework. The sample app is not a product for end users — it is a living reference that shows
every framework capability working (auth/login, real-time sync, presence, the API + sync routing, the UI
component kit, streaming, the playground feature sweep).

## Who it is for

- **Framework authors / contributors** — to develop and verify `@luckystack/*` against a real app.
- **Consumers evaluating LuckyStack** — to see the conventions in action before scaffolding their own app.

## Key areas

- **playground** — a hands-on sweep of every framework feature (notifications, dialogs, dropdowns,
  lifecycle hooks, rate limiting, health probes, streaming, offline queue).
- **login / register / reset-password / settings** — the auth surface (credentials + OAuth, sessions).
- **workspaces** — a separate, not-yet-active prototype (drag-and-drop, moves to its own repo before
  publish).

## Glossary

- **Route** — a file-based API (`_api/`) or sync (`_sync/`) endpoint.
- **Page** — a `page.tsx` that maps to a URL.
- **Helper / component** — reusable logic in `src/_functions/` / UI in `src/_components/`.
- **ADR** — a committed decision record in `docs/decisions/` (the "why").
