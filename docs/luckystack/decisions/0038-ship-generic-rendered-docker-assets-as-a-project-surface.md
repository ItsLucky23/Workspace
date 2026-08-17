---
name: ship-generic-rendered-docker-assets-as-a-project-surface
title: Ship generic rendered Docker assets as a project surface
status: accepted
date: 2026-07-27
deciders: [mathijs]
tags: [docker, compose, scaffold, cli, deployment, presets]
supersedes: []
relates: [0037]
---

## Context

A production-like Flexbuddy stack proved a useful multi-stage image, nginx/router/app chain, private Redis/database services, health-gated startup and container hardening. Copying that stack directly into LuckyStack would also copy consumer-specific seeds, credentials, integration variables, service groups and storage assumptions. LuckyStack scaffolds also support npm or Bun, four database providers, optional router installation and arbitrary preset names.

Existing framework docs only showed a manual single-stage-ish Docker example and hardcoded the `default` preset. Existing consumer projects had no supported command for receiving updated generic assets.

## Decision

Treat Docker as rendered project files, not a runtime package. Fresh scaffolds receive a provider/router-aware `Dockerfile`, `compose.yaml`, `.dockerignore`, nginx config, preset entrypoint, remote-infrastructure env template, generic Mongo replica initializer and runbook. Existing projects use `npx luckystack add docker`; files are copy-if-absent and `luckystack docker check` validates the rendered surface without printing secrets.

The app image selects `LUCKYSTACK_PRESET` at runtime and includes generated ORM/runtime and router config artifacts. Router-enabled scaffolds switch invocation to routed HTTP/SSE but retain one Socket.io connection for realtime delivery. App/router run non-root with `tini`; nginx is unprivileged; Compose uses health gates, localhost binding, read-only roots, explicit writable mounts, dropped capabilities and `no-new-privileges`.

Database services are rendered for MongoDB, PostgreSQL, MySQL or SQLite. Mongo initialization performs replica-set election only. Consumer seeds, users, business integrations, real endpoints, service grouping and storage credentials remain consumer-owned.

## Rejected alternatives

- **Copy Flexbuddy's files verbatim.** Fast initially, but leaks business topology, credentials and unsafe bootstrap behavior into every consumer.
- **Publish a Docker runtime package.** Dockerfiles, Compose and nginx are deployment-owned project artifacts; hiding them in `node_modules` makes customization and review harder.
- **Ship one Mongo-only/default-preset example.** Contradicts scaffold choices and makes split deployments rebuild or hand-edit framework assumptions.
- **Overwrite existing Docker files on `add docker`.** Risks destroying consumer deployment policy. Existing files remain owned by the consumer.

## Consequences

- Template and CLI raw Docker assets require byte-parity tests.
- Provider/router rendering logic must remain equivalent across scaffolder and CLI.
- Multi-host consumers must still supply shared object storage, edge affinity/draining, real secrets, backups, resource limits and environment bindings.
- Remote `.env.docker` operation is explicit and grants normal read/write access; migrations and seeds are never automatic.
- Image/Compose CI and multi-router affinity remain follow-up hardening rather than claims of this baseline.
