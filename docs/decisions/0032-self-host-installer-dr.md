---
id: 0032
title: Self-host installer + DR — compose stack, bootstrap, runbook
status: accepted
date: 2026-07-03
tags: [workspaces, self-host, deployment, docker-compose, disaster-recovery]
supersedes: []
---

# 0032 — Self-host installer + DR

## Context

Goal-item #7 (deliberately last — a real from-scratch install disrupts the dev setup). Workspaces
had `docs/HOSTING.md` (the proxy/preview model) but no one-command install: no compose stack, no
bootstrap, no disaster-recovery procedure. A self-hoster had to wire Mongo (as a replica set),
Redis, the app (with the Docker socket for ticket containers), and a reverse proxy by hand.

## Decision

A self-contained `deploy/` stack + a DR runbook:

- **`deploy/docker-compose.yml`** — the whole product in one stack: `mongo` (single-node **replica
  set** — Prisma requires one for transactions — self-initializing via a healthcheck), `redis`
  (password + appendonly), `app` (built from `deploy/Dockerfile`, mounts the host **docker.sock** +
  an `app-data` volume, joined to `workspaces-net` so it can launch per-ticket containers), and
  `caddy` (reverse proxy, admin API for runtime preview routes). Validated: `docker compose config`
  renders cleanly (4 services + networks).
- **`deploy/Dockerfile`** — node:22 + the Docker CLI (the app shells out via `WS_DOCKER_BIN`), `npm
  ci`, `vite build`, `prisma generate`, and boots the server on port 80.
- **`deploy/bootstrap.sh`** — idempotent from-scratch installer: checks Docker/compose/openssl,
  generates the missing secrets into `deploy/.env` (never clobbers an existing one — so re-runs are
  safe), builds the ticket base image, `docker compose up -d`, and waits on `/readyz`. Syntax-checked
  (`bash -n`).
- **`deploy/Caddyfile` + `deploy/.env.example`** — a working default (catch-all → app) with the
  production host + wildcard-preview TLS block documented for the operator to enable.
- **`docs/DR_RUNBOOK.md`** — backup (mongodump + app-data tar + Redis + the secrets **off-host**),
  restore, and full host-loss DR, with RPO/RTO. The load-bearing rule: `WORKSPACES_ENC_KEY` is
  irreplaceable — back it up separately from the data or the encrypted secrets are unrecoverable.

## Rejected alternatives

- **Kubernetes manifests / Helm.** Overkill for a self-hosted single-box product; compose is the
  right first rung and matches the audience. K8s can come later on the same images.
- **Bundle Mongo without a replica set.** Prisma's Mongo connector needs a replica set for
  transactions; a standalone mongod breaks writes. The single-node `rs0` is the minimal correct form.
- **Run the app as a pre-bundled `dist/server.js`.** The framework's prod-bundle command isn't wired
  in this repo yet; the image runs the server via `tsx` (`server:once`), which is a correct, simple
  production run. Swapping to a bundle later is a Dockerfile CMD change, nothing else.

## Consequences

- A self-hoster runs `cd deploy && ./bootstrap.sh` and gets the full stack; DR is documented +
  testable.
- **ACTUALLY RUN (2026-07-04) on local Docker 29.6.1** — the app image builds (npm install +
  node-pty compile + vite build + prisma generate) and the full stack comes up **healthy**: app +
  mongo (single-node replica set, self-initializing) + redis, with `/healthz`+`/readyz`+`/livez` =
  200 against its OWN fresh stores. The app is not host-published (only Caddy is), so it ran
  ALONGSIDE the dev backend without colliding. Torn down after (`compose down -v`); dev intact.
- Doing the real run surfaced + fixed 5 install issues the headless `config`/`-n` checks can't: a
  missing `.dockerignore` (huge context), `npm ci`→`npm install` fallback (a Windows-generated
  lockfile omits linux-only optional native deps like `@emnapi/*`), `build-essential`+`python3` (so
  `node-pty` compiles), `NODE_OPTIONS` heap 4096 (the Vite build OOMs, exit 134), and
  `workspaces-net` `external: true` + a bootstrap `docker network create` (the engine owns that
  network). Verified headless too: `docker compose config` VALID, `bash -n bootstrap.sh` OK.
- Caddy was NOT brought up in the test (it binds :80, colliding with the dev proxy); its config is
  validated and documented. On a real host it comes up with the rest.
