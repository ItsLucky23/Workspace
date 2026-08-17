---
name: test-runner-resolves-secrets-in-its-own-process
title: The test runner resolves secret pointers in its own process through a lazy consumer-config loader
status: accepted
date: 2026-07-21
deciders: [mathijs]
tags: [test-runner, secret-manager, prisma, env, testing]
supersedes: []
relates: [0017, 0026, 0030]
---

## Context

A consumer using `DATABASE_URL=DATABASE_URL_V1` found that its Layer-5 integration
tests failed before assertions: the live server had resolved the pointer, but the
separate test process had not. Direct `ctx.prisma`/Redis/SDK access runs inside
`@luckystack/test-runner`; one process cannot mutate another process's
`process.env`.

The Prisma CLI already solves the same class through an env+secret boot prefix
(ADR 0017), while server boot owns its own resolver. The runner had neither.

## Decision

`@luckystack/test-runner` owns `resolveTestEnvironment()`. It always loads the
normal env-file layers and optionally receives a **lazy** `loadProjectConfig`
callback. The callback runs only after env loading, so `config.ts` sees the real
`LUCKYSTACK_SECRET_MANAGER_URL`. If its default export contains a non-empty
`secretManager.url`, the runner dynamically loads the optional
`@luckystack/secret-manager` peer and calls
`initSecretManager({ ...config.secretManager, source: 'remote' })` before any test
layer or custom test-module import.

`runAllTests` invokes this bootstrap automatically through its matching
`loadProjectConfig` input. The scaffolded `scripts/testAll.ts` supplies
`() => import('../config').then(...)`; custom Vitest integration suites can call
the exported helper from setup.

Configured-but-unloadable secret-manager is fail-fast. The runner will not
continue with raw pointer values and wait for Prisma/Redis to emit a misleading
connection-string/auth failure.

## Rejected alternatives

- **Assume server boot already resolved the test env.** Impossible across process
  boundaries; this is the original defect.
- **Infer configuration only from `LUCKYSTACK_SECRET_MANAGER_URL` and hardcode
  token/allowlist defaults in the runner.** This bypasses the consumer's audited
  token source, `envNames` allowlist, transport and timeout policy.
- **Put secret-manager config back into core's `ProjectConfig`.** Reverses ADR
  0026's cleanup and couples framework config to an optional boot tool. The
  consumer default export already owns the correct config.
- **Keep the bootstrap only in scaffold `scripts/testAll.ts`.** Fixes one entry
  script but leaves direct `runAllTests` users and custom Vitest setup without a
  reusable package API; it also duplicates the optional-import/error policy.

## Consequences

- Layer-5 Prisma/Redis access sees the same resolved values as the live server.
- Base projects pay only an env-load + lazy config read; secret-manager remains an
  optional peer and is never imported when its URL is empty/absent.
- Existing consumers need the updated scaffold `scripts/testAll.ts` (normally via
  `npx luckystack update --app` and merge/sidecar flow) or can pass
  `loadProjectConfig` manually.
- A malformed configured token or missing optional package now fails before any
  test layer, with the test-runner named as the source.
