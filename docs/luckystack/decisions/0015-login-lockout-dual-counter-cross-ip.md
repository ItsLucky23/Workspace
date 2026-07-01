---
name: login-lockout-dual-counter-cross-ip
title: Per-account login lockout uses a dual counter (per-IP + cross-IP) to actually stop distributed credential stuffing
status: accepted
date: 2026-06-23
deciders: [ItsLucky23]
tags: [security, login, dos, brute-force]
supersedes: []
relates: [0012]
---

## Context

The per-account brute-force lockout (DD-LOGIN-F5) keyed its failed-attempt counter on an **IP+account composite** (`auth:<email>:<ip>`) on the primary HTTP credentials route (the resolved IP is always threaded in). That composite was deliberately chosen so one attacker IP cannot lock a victim out for legitimate users on other IPs (a victim-lock DoS guard). But it structurally **defeats the module's own documented headline defense** — "stop distributed credential stuffing against a SINGLE account from many IPs": with a per-(account,IP) bucket, an attacker using N IPs gets N × `maxAttempts` guesses against one account before anything locks. The pure per-account bucket (`auth:<email>`) only existed on the register/socket paths that omit the IP. So consumers enabling `rateLimiting.auth` believed they had cross-IP per-account brute-force protection but effectively only had a per-IP throttle.

## Decision

Maintain **TWO** counters and lock when **EITHER** trips:

- **Bare-account** `auth:<email>` against a new **cross-IP** cap `rateLimiting.auth.maxAttemptsPerAccount` (default `50`) — the distributed-credential-stuffing defense (counts failures from all IPs combined).
- **IP+account composite** `auth:<email>:<ip>` against the existing per-IP cap `rateLimiting.auth.maxAttempts` (default `5`) — bounds a single IP and shields other IPs from a victim-lock DoS.

`isAccountLocked` / `recordAuthFailure` / `clearAuthFailures` consult/maintain/clear both keys. The cross-IP cap is higher than the per-IP cap because it aggregates every IP. The register-path check (`isAccountLocked(email)` with no IP) now also observes the cross-IP lock, so the "bypass via the register code path" guard is real again.

## Rejected alternatives

- **Composite-only (status quo)** — rejected: the documented distributed-stuffing defense is absent on the primary HTTP login surface.
- **Bare-account-only** — rejected: re-introduces the victim-lock DoS (one attacker IP locks the account for everyone) that DD-LOGIN-F5 deliberately fixed.
- **A single hardcoded cross-IP multiple of `maxAttempts`** — rejected: the DoS-vs-stuffing balance is deployment-specific, so the cross-IP cap is its own configurable knob.

## Consequences

A distributed attacker is now bounded to `maxAttemptsPerAccount` total guesses per account regardless of IP count, while a single IP is still bounded to `maxAttempts` and cannot lock a victim for other IPs below the account cap. Two Redis buckets are written per genuine wrong-password attempt instead of one. Consumers who want the old behavior can set `maxAttemptsPerAccount` very high. Default lockout stays opt-in (`rateLimiting.auth.enabled: false`).
