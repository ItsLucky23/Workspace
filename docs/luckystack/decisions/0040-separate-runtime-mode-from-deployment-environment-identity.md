---
title: Separate application runtime mode from deployment environment identity
status: accepted
date: 2026-07-27
deciders: [admin]
tags: [core, deployment, security, docker, multi-instance]
supersedes: []
relates: [0016, 0037, 0038]
---

## Context

`resolveEnvKey()` historically served two jobs: Redis/router environment identity and the development-versus-production switch. Distributed deployment needs descriptive identities such as `staging`, `dockerSplit` and `localAdmin`. With `NODE_ENV=production` and `LUCKYSTACK_ENV=dockerSplit`, the old checks classified the process as development: generated production maps were skipped, devkit was loaded into source-free images, secure-cookie and bootstrap policy weakened, loopback rate-limit bypasses could activate, and busy ports could auto-increment.

The topology name is not an application security mode.

## Decision

Use two explicit axes:

- `resolveRuntimeMode()` (plus `isProductionRuntime()` / `isTestRuntime()`) reads validated `NODE_ENV` and controls all application behavior: route-map selection, dev tooling, cookies, validation, rate limiting, email/login policy and port auto-increment.
- `resolveEnvKey()` keeps `LUCKYSTACK_ENV -> NODE_ENV -> development` and is used only for deploy bindings, boot UUID keys, health attestation and observability environment labels.
- Fresh browser config receives Vite's build/serve runtime mode because browser bundles do not have Node's `process`; custom Vite profile names such as `staging` are not treated as the runtime axis.

## Rejected alternatives

- **Require every production topology to be named `production`** — rejected because routers must distinguish staging, split Docker and local-fallback environments.
- **Infer production from an allowlist of topology names** — rejected because consumer-defined environment names are open-ended and an omitted name would fail insecurely.
- **Leave `LUCKYSTACK_ENV` unset on backends** — rejected because strict boot health and fallback routing need the backend to attest the same topology identity.

## Consequences

- Any named topology remains production-safe when `NODE_ENV=production`.
- Custom deployment names no longer alter auth credentials, cookies, validation, route maps or dev tooling.
- Framework code must never compare `resolveEnvKey()` to `production`; new dev/prod checks use the runtime-mode helpers.
- This fix is required before routed multi-host Docker deployment can be released safely.
