---
title: Tests run a stub provider world by default; live-AI is opt-in via enableLiveProviders()
status: accepted
date: 2026-07-07
tags: [testing, ai, media, providers]
---

## Context

The dev env now carries real media/AI provider keys (`.env.local`, resolved from the secret-manager),
which the user added so the app can be exercised live. But the existing unit/integration suite was
written for the **stub** world — deterministic, free, CI-safe (exact beat counts, `stub://…` urls, a
`ai.providerUnavailable` path). With keys present, every provider's `available()` flipped to TRUE and
those tests took the LIVE path (real HTTP → variable output / 401 on a pointer that isn't a real key).

Simply unsetting the keys in the test harness didn't hold: importing any server module pulls in
`@luckystack/core`, whose boot runs **dotenvx with `override:true`**, re-injecting the raw `.env.local`
provider **pointers** over whatever the harness had cleared.

## Decision

The default test world is **stub**; a live-AI test **opts in**.

- `tests/_helpers.mts` triggers the framework's dotenvx boot itself (`await import('@luckystack/core')`)
  and unsets the provider keys **after** it — dotenvx runs once (module then cached), so the clear
  sticks for every later server import.
- `db()` additionally re-clears after `initSecretManager` (which resolves the pointers to the real keys
  and injects them), **stashing** the resolved values first.
- `enableLiveProviders()` restores the stashed real keys for a live test and forces `WS_MEDIA_CHEAP=1`
  so a live run costs cents, not euros. It returns which providers actually have a key so a test can
  skip a leg it can't run.
- Test files import server modules **dynamically** (`await import(...)`) so they evaluate *after* the
  harness setup; a static import is a sibling of `_helpers` and races the unset (this is why the
  `aiRegistry` "unavailable provider" assertion was leaking a real key — it was converted to dynamic).

## Rejected alternatives

- **Relax the assertions to tolerate live variation** (e.g. `beats >= 1`). Throws away determinism and
  makes the default suite cost money + flake on every run.
- **Set the keys to `''` instead of unsetting.** dotenvx's `override:true` overwrites even a
  defined-empty var, so it doesn't hold.
- **Delete the keys from `.env.local` for tests.** They're the user's real resolved secrets and the
  live-AI suite needs them; the harness must neutralise per-run, not mutate the env file.
- **Make the default suite the live one.** Live AI is non-deterministic, metered, and needs network +
  valid keys — wrong contract for the fast inner-loop suite. Live coverage is a *separate*, opt-in tier.

## Consequences

- 92/93 test files pass headless (the one skip, `httpControl`, needs the running dev server — a
  developer action). The suite is deterministic again with real keys present in the env.
- Live-AI tests (the overnight goal's next task) call `enableLiveProviders()` after `db()` and assert
  real output, skipping any provider whose key is absent.
