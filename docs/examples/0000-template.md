---
name: example-slug
title: One-line title of the pattern
pattern: auth-api-route
tags: [api, auth]
---

# Pattern title

> Template seed for a canonical example. Copy to `docs/examples/<slug>.md` and fill in.
> `npm run ai:examples` regenerates `docs/AI_EXAMPLES_INDEX.md` (the hook does it too).
> `pattern` is the lookup key for the MCP `get_example` tool — keep it short + stable.

## When to use

One or two sentences: which task this is the canonical shape for, and when NOT to use it.

## Canonical example

```ts
// The reviewed-correct implementation. Real, compilable LuckyStack code that
// follows every convention (typed ApiParams, functions.tryCatch, i18n, etc.).
```

## Why this shape

The annotation: WHY each notable choice is correct here (the auth gate, the rate
limit, the response envelope), and the subtle mistakes this shape avoids. This is
what makes it a template instead of just a sample.
