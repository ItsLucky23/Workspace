---
title: D3 — demo-host (main on a DNS) + auto-redeploy watcher
status: accepted
date: 2026-07-08
tags: [deploy, demo, environments, watcher, idea-to-outcome]
---

## Context

The deploy engine already runs a project's target branch (main) at a stable route (`<kind>-<slug>.<domain>`)
via Caddy + Docker. What was missing for "main draait op DNS X" as a demo surface: a dedicated demo kind and
the thing that makes a demo useful — it stays current as main advances, or is deliberately frozen at a commit
for a stable link.

## Decision

- **A `demo` env kind** (added to `ENV_KINDS`) that reuses the whole existing deploy path (clone target
  branch → serve → readiness → flip the stable route). No parallel deploy engine.
- **Three fields on `Environment`** (MongoDB — no migration): `deployedCommit` (what the current deploy runs),
  `autoRedeploy` (follow main), `pinnedCommit` (freeze at a fixed commit; disables auto-redeploy and is
  `git checkout`'d in the container so the demo serves that exact commit).
- **A leader-gated `demoWatch` sweep** (`startDemoWatcher`, same shape as the cron/publish schedulers): every
  tick it resolves each demo env's target-branch head (`branchHead`) and redeploys when it moved. The decision
  is the pure `shouldRedeployDemo` (auto on + not pinned + known head + head ≠ deployed); head-resolution and
  deploy are injectable so the sweep is tested with injected git-state, no git/container needed.
- **`ensureEnvironment` defaults a demo to autoRedeploy=true** unless a `pinnedCommit` is given (a pin always
  wins); `env-deploy` passes `pinnedCommit`/`autoRedeploy` through. No new op.

## Rejected alternatives

- **A separate demo deploy engine / route scheme.** A demo is just a persistent env on a stable route — the
  existing engine already does clone-branch + serve + route-flip. Only the follow-main behaviour is new.
- **A git post-receive hook to push-trigger redeploys.** A poll (leader-gated, 60s) needs no hook wiring into
  every repo/forge and works identically for the built-in bare repos and external remotes; it reuses the same
  leader/lease machinery as the other sweeps. A push-hook is a latency optimisation, not required.
- **Storing the pin/auto-redeploy in env or a config file.** They are per-environment data; three nullable
  columns on the row (free on Mongo) keep them queryable by the sweep and survive restarts.

## Consequences

- A user can deploy `main` as a demo at a stable DNS and it auto-updates as main moves, or pin it to a commit
  for a frozen link. The watcher is leader-safe (multi-instance) and best-effort. Proven with injected
  git-state (10/10): a moved-main demo redeploys, an unchanged one doesn't, a pinned one is never touched.
  The demo-env-creation UI (a button + pin picker) is the natural follow-up; the op + watcher are done. NB:
  real prod-to-another-server is D4 (build-export + deploy-hook); this is the demo/preview surface.
