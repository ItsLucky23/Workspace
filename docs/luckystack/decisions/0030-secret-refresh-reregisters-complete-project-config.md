---
name: secret-refresh-reregisters-complete-project-config
title: Secret refresh rebuilds the complete project registration instead of patching the active registry
status: accepted
date: 2026-07-16
deciders: [ItsLucky23]
tags: [core, config, secret-manager, cors, auth]
supersedes: []
relates: [0026]
---

## Context

`registerProjectConfig` is deliberately last-write-wins: each call deep-merges its
input over pristine defaults, not over the previous active config. The consumer and
scaffold configs subscribed to ADR 0026's secrets-resolved channel but re-registered
only `http.cors.allowedOrigins`. That refreshed CORS while silently resetting every
other consumer override, including Redis rate limiting, auth features, session
policy, logging, public URL, and OAuth callback configuration.

Several URL slots were also derived from the same env values at module load. Updating
only CORS could therefore leave `app.publicUrl` and `oauthCallbackBase` pointing at an
unresolved secret pointer while the allowlist contained the resolved origin.

## Decision

Consumer config defines a factory for its complete `registerProjectConfig` input.
Both initial boot and every secrets-resolved notification call that factory and make
one replacement registration. The factory recomputes the full public URL, backend
origin, OAuth callback base, environment-dependent policy, and CORS list from the
same current env snapshot.

## Rejected alternatives

- **Change `registerProjectConfig` to merge over the active config** — contradicts
  its documented replacement semantics, makes test resets such as
  `registerProjectConfig({})` retain stale policy, and changes every consumer.
- **Keep the CORS-only registration and spread `getProjectConfig()` into it** —
  couples consumer boot code to the fully-defaulted stored shape and can preserve
  stale env-derived fields rather than recomputing them coherently.
- **Use getters for every env-derived slot** — `deepMerge` evaluates getters during
  registration, so the resulting stored values are still frozen.
- **Refresh only when `changedKeys` contains URL fields** — the channel permits
  `changedKeys` to be omitted and a full rebuild is cheap boot/rotation work; a
  conditional path adds another way to miss a derived dependency.

## Consequences

- Secret resolution or rotation preserves all consumer policy while refreshing URL
  and CORS values atomically.
- Repeated project registrations remain replacement registrations; core registry
  semantics and existing tests do not change.
- Projects adding new env-derived registry fields must add them to the complete
  registration factory, not register a partial from a secrets listener.
