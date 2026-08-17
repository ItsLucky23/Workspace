---
name: production-dependencies-can-overwrite-generated-runtime-artifacts
title: Production dependencies can overwrite generated runtime artifacts
severity: high
area: docker
date: 2026-07-27
tags: [docker, prisma, multi-stage, healthcheck, scaffold]
---

# 0013 — Production dependencies can overwrite generated runtime artifacts

## What happened

A clean scaffold image successfully ran Prisma generation and the full app build in its build stage, but the runtime `/readyz` repeatedly failed with “@prisma/client did not initialize yet.” The final app image copied `node_modules` from a separate `npm ci --omit=dev` stage, so it discarded the generated `.prisma/client` and generated `@prisma/client` output from the build stage.

A second misleading signal followed: the router process logged that it was listening, but its HTTP `/readyz` healthcheck stayed red because router health itself depended on route ownership and the installed published package predated the new custom-route manifest support.

## Root cause

A successful build stage does not prove the final runtime filesystem contains build-generated dependency artifacts. Separate production-dependency stages replace those artifacts unless they are explicitly projected into the final image. A router proxy healthcheck also tests topology/routing semantics, not only whether the router process is alive.

## How to avoid

- After ORM/client generation, copy required generated runtime dependency directories from the build stage into the final production `node_modules`.
- Keep the production-dependency stage minimal, but add an explicit `runtime-artifacts` projection stage rather than copying all dev dependencies.
- Run a real final-image `/readyz` check; a successful `docker build` is insufficient.
- Use a TCP liveness check for the standalone router process and test routed backend readiness separately through integration/edge smoke tests.
- Validate against a clean scaffold and Linux image, not only the framework monorepo's already-generated local tree.

## Related

- `docs/decisions/0038-ship-generic-rendered-docker-assets-as-a-project-surface.md`
- `packages/create-luckystack-app/template/Dockerfile`
