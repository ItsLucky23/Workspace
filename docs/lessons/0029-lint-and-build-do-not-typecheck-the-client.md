---
title: Lint and build do not typecheck the client — run tsc on tsconfig.json before calling a merge green
severity: high
area: tooling
date: 2026-08-23
---

# What happened

After merging four parallel fix-round branches (2026-08-23), `npm run lint`, `npm run build`, `ai:lint` and `npm run test:unit` were all green — yet `npx tsc --noEmit -p tsconfig.json` reported 7 errors, one of which was a **missing import** (`SavedNote` in `content/settings/AdminTab.tsx`): a guaranteed runtime `ReferenceError` the moment that card rendered. Two branches had each edited the same file in a way that was individually consistent but jointly broken, and nothing in the gate caught it.

# Root cause

- `npm run build` = Vite bundle + `tsc` for the **server** configs only. Vite transpiles client TS without type-checking.
- `npm run lint` runs type-aware ESLint rules, which report *unsafe* patterns but not plain TS compile errors (an undefined identifier is not an ESLint rule).
- Unit tests don't import the React pages.

So client-side type errors — including missing imports, lost narrowing inside closures, `noUncheckedIndexedAccess` slips — are invisible to the whole autonomous gate.

# How to avoid

- After any merge of parallel branches, and before declaring a round green: `npx tsc --noEmit -p tsconfig.json` (client) in addition to lint/build/unit. Treat 0 errors as part of "green".
- Applied 2026-08-24: `npm run build` now runs `npm run typecheck` (= `tsc --noEmit` on `tsconfig.json`, which covers client AND server in one program, ~29 s) before `vite build`, and `.githooks/pre-push` runs `npx tsc --noEmit -p tsconfig.json` between lint and the invariant linter. Note `tsconfig.server.json` is a runtime loader config for `tsx` only — it is never type-checked by any gate and is red on `config.ts`'s `import.meta.env`, so do not wire it in.
- Agents reporting "tsc clean for touched files" while noting "one pre-existing error elsewhere" is a signal to run the FULL client typecheck on main, not a reassurance.
