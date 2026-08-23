---
title: Never key a memo or effect on useTranslator()'s function identity — it is new every render
severity: high
area: frontend
date: 2026-08-23
---

# What happened

A fix-round agent replaced a hardcoded welcome message in `WorkspacesProvider` with an i18n one:
`useMemo(() => [{ text: translate({...}) }], [translate])`. The chat-hydrate `useEffect` depended on that
memo. `translate` from `useTranslator()` is a fresh function every render, so the memo re-created its
array each render, the effect re-ran, `setChat` set state, the provider re-rendered — "Maximum update
depth exceeded" on EVERY page. Lint, tsc, build and all unit/integration tests were green; only Playwright
(11 red specs with unrelated-looking "element not found" errors) and a console listener exposed it.

# Root cause

Identity-keyed memoisation on a hook result that is not referentially stable, feeding a state-setting effect.

# How to avoid

- Key memos/effects on the translated STRING (`const text = translate({...}); useMemo(..., [text])`), never
  on `translate` itself.
- When many Playwright specs fail at once with "element not found" on basic pages, read the browser console
  first (a `page.on('console')` listener in a throwaway spec) — one render loop looks like a dozen UI bugs.
