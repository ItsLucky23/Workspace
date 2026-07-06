---
title: tsc is a delivery gate; Prisma-Json writes go through jsonInput, never a cast
status: accepted
date: 2026-07-07
tags: [tooling, typing, testing, prisma]
---

## Context

`npm run build` is `vite build`, which transpiles per-file and does **not** type-check the
project. The real full-program check is `npm run typecheck` (`tsc --noEmit`), and it was **red**:
20 errors that had accumulated invisibly because CI/commits only ran vite + eslint. Most were typed
data (a domain interface array, a `Record<string, unknown>`) being written into a Prisma `Json`
column, which demands `Prisma.InputJsonValue` — a type an `interface`-shaped value can never satisfy
(no index signature) even though the data is valid JSON at runtime. The rest were small nullability /
union / prop-shape drifts (a nav item without its `group`, a `Dropdown` built with `label` instead of
`item`, a fetch header union with optional-undefined members, a stage lookup that could be `undefined`).

## Decision

1. **`npm run typecheck` (tsc) is a mandatory pre-delivery gate**, run per item alongside
   `lint` + `build` + `ai:lint`. Vite's per-file transpile is not a substitute for whole-program
   type safety.
2. **Typed data destined for a Prisma `Json` column goes through `server/util/json.ts` `jsonInput()`**
   — a deep-clone (`structuredClone`) that widens the value to `Prisma.InputJsonValue` **without a
   cast**. This honours the standing "no `as any` / `as unknown as T`" rule (Rule 21): the clone is a
   genuine structural coercion, and being a copy it is also safe to store. Every other error was fixed
   at its typing source (reorder so a `const` is narrowed before use, `?? null`, annotate the header as
   `Record<string,string>`, make `NavDef.group` optional, build `DropdownItem`s with `id`+`item`).

## Rejected alternatives

- **Cast the values** (`findings as Prisma.InputJsonValue`). Forbidden by Rule 21, and TS forces the
  double `as unknown as` form here anyway (interface arrays don't overlap `InputJsonValue`), which is
  exactly the erasing cast the contract bans.
- **Add index signatures to the domain interfaces** (`SecurityFinding`, `ReviewFinding`) to satisfy
  Prisma structurally. Pollutes the domain types and defeats exhaustive property checking everywhere
  they're read.
- **Leave typecheck out of the gates / only run vite.** The 20 errors prove that silently lets real
  type drift accumulate; a socket-payload shape (`ContentPieceSummary`) can go stale against the
  server without anything failing until runtime.
- **`JSON.parse(JSON.stringify(x))`.** Works, but eslint's `unicorn/prefer-structured-clone` flags it;
  `structuredClone` is the same intent, faster, and lint-clean.

## Consequences

- `tsc` is green (0 errors) and stays a per-item gate. New Prisma-Json writes call `jsonInput()`.
- The pre-commit hook is unchanged (it regenerates AI artifacts + runs `ai:lint`; it does not run
  compile gates). Wiring `tsc` into the hook is left as an OPEN question for the user — it adds ~30s to
  every commit, which is the AI's per-item responsibility, not necessarily the user's commit cost.
