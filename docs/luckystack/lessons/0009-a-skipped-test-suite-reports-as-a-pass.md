---
name: a-skipped-test-suite-reports-as-a-pass
title: The integration suite that "proves the Redis cross-instance link" had never run a single test
severity: high
area: testing
date: 2026-07-15
tags: [testing, redis, false-green, env]
---

# 0009 — A skipped suite reports as a pass

## What happened

`npm run test:integration` is documented in `ARCHITECTURE_MULTI_INSTANCE.md` as the
thing that **proves the Redis cross-instance link**. On this machine it had never
executed a single assertion. Every run printed:

```
Test Files  1 passed (1)
     Tests  5 skipped (5)
```

`1 passed` is what you read. `5 skipped` is what happened.

The suite deliberately skips when Redis is unreachable, so a Redis-less CI does not go
red — a reasonable design. The trap was in *why* Redis was unreachable: `.env.local`
supplies `REDIS_USER`/`REDIS_PASSWORD` for the developer's real Redis, the local docker
Redis on `:6380` has no auth, and the AUTH handshake failed. The graceful skip swallowed
it, silently, forever.

This surfaced only because a new router integration test skipped too, and its 6-skipped
"pass" looked wrong for something that was supposed to be exercising a live proxy.

## Root cause

**A conditional skip is invisible in the summary line that people actually read.** The
suite had no way to express "I am supposed to prove something right now, so an
environment that prevents that is a failure" — the same run means "no Redis in CI, fine"
and "prove the cross-instance link" and cannot tell them apart.

Secondary cause: the skip predicate was `can I connect`, which conflates *Redis is
absent* (legitimately skippable) with *Redis is present but my credentials are wrong*
(a broken setup, worth shouting about).

## How to avoid

- **Give every conditional skip an opt-in that turns it into a failure.**
  `LUCKYSTACK_REQUIRE_REDIS=1` now does this; run it that way whenever the point of the
  run is proof. The error names host, port, and whether auth was attempted, which is
  exactly what the skip was hiding.
- **Read the skip count, not the pass count.** `1 passed | 5 skipped` is not a pass; the
  file passed, the tests did not run. Prefer a green count you can point at.
- **A test whose whole purpose is proving something should not be able to pass by
  proving nothing.** `scripts/wsProxySmoke.ts` therefore exits 1 when Redis is missing —
  it has no legitimate skip case.
- **Beware env overlays in tests.** `.env.local` holds credentials for real
  infrastructure; a local docker service usually has none. Bypass with
  `LUCKYSTACK_ENV_FILES=.env` (ambient-only, per the env contract) rather than editing a
  secrets file — and never read `.env.local` to find out why (CLAUDE.md rule 16).

## Related

- `docs/findings/2026-07-15-bun-feasibility/README.md` — B20
- [[status-line-is-not-a-handshake]] — the sibling false-green found in the same session:
  one asserted too little, this one asserted nothing at all
