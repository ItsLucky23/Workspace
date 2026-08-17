---
name: generate-prisma-before-type-maps-in-artifact-free-worktrees
title: Generate Prisma before type maps in artifact-free worktrees
severity: medium
area: build
date: 2026-07-27
tags: [prisma, type-generation, worktree, postinstall, build]
---

# 0015 — Generate Prisma before type maps in artifact-free worktrees

## What happened

A clean worktree had no ignored generated API artifacts. `npm ci` therefore ran the root postinstall artifact generator immediately, but type-map generation failed on `system/session` with a misleading unsupported `symbol` wire-type error. Building all packages did not resolve it. Running `npm run prisma:generate` before `npm run generateArtifacts` made the same source tree generate successfully.

## Root cause

The session response projects the Prisma-backed user type into `ClientSessionLayout`. Before Prisma Client generation, TypeScript sees placeholder declarations from `@prisma/client`; the route type expander encounters their internal symbol instead of the generated model shape and reports it as a transport-dependent output. The root postinstall currently tests only whether `apiTypes.generated.ts` exists, not whether Prisma Client is ready before regenerating it.

## How to avoid

- In artifact-free worktree and release validation, generate Prisma Client before generating route type maps.
- Treat an unsupported `symbol` error on a Prisma-backed DTO as a possible missing-client artifact, not immediately as a route contract violation.
- A future build-pipeline fix should order Prisma generation before route generation or produce a specific missing-Prisma diagnostic; do not weaken wire-type validation to hide the placeholder.
