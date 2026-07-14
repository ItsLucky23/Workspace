---
severity: high
area: core / server / secret-manager
date: 2026-07-14
tags: [redis, secret-manager, boot, config, verification]
---

# A correct fix that never fires is no fix — verify the TRIGGER runs, not just the logic

## What happened

0.6.4 shipped `rebuildDefaultRedisClient()` (eager rebuild + register) as THE fix for the
Redis secret-manager-pointer boot, gated in the server boot on
`getProjectConfig().secretManager?.url`. Unit tests proved the rebuild logic was correct.
A consumer then proved 0.6.4 still failed with `WRONGPASS` — in BOTH prod and dev — and
that a MANUAL `rebuildDefaultRedisClient()` right after `initSecretManager` worked. So the
function was right; it just never ran.

## Root cause

The trigger never fired for a normal project:

1. **The gate was always falsy.** The scaffold's `config.ts` puts `secretManager` in the
   local config object + default export (read by `server.ts` → `initSecretManager`), but
   the `registerProjectConfig({...})` call does NOT include `secretManager`. So
   `getProjectConfig().secretManager` is `undefined`, and the server-boot rebuild was
   dead code.
2. **`onApplied` was not wired.** Bare `initSecretManager(...)` (the documented pattern)
   sets no `onApplied`, so the decoupled hook's other entry point never fired either.

Two "belt-and-suspenders" triggers, neither of which actually runs for the common case.
Green unit tests hid it because they called the rebuild / fired the hook DIRECTLY — they
never asserted that a real boot path invokes the trigger.

## How to avoid

- When a fix depends on a config value or a callback, **verify the value is actually
  populated / the callback is actually wired on the real path** — don't assume
  `getProjectConfig().X` is set just because the consumer "configured X" (they may only
  pass it to a package directly, never into `registerProjectConfig`).
- Prefer a trigger owned by the component that KNOWS the event happened. Here: the resolver
  (`@luckystack/secret-manager`) knows secrets were resolved, so IT fires the channel
  (global-symbol array → core rebuilds), instead of the server boot guessing from config.
- Add at least one test that exercises the trigger through the real entry point (here: a
  secret-manager resolve fires the global listeners), not only the leaf logic.

Ties off [[0006-reset-cached-client-insufficient-register-instead]]: 0.6.3 fixed the wrong
thing (reset), 0.6.4 had the right thing but un-fired, 0.6.5 fires it from the resolver.
