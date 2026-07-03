---
name: market-hardening-gitlab-ingestion-capacity-edge-auth
title: Market-hardening — GitLab issue ingestion, a concurrent-turn CapacityManager, edge-auth on subdomains, and Sentry error tracking
status: accepted
date: 2026-07-03
deciders: [ItsLucky23]
tags: [gitlab, capacity, security, ops, market]
supersedes: []
relates: [0011, 0013]
---

## Context

Toward market readiness, four gaps remained on the engine/proxy side: the board was NOT fed from
the source (tickets came from quick-add, not GitLab issues — `gitlab-resync` was a no-op); nothing
capped concurrent autonomous turns (runaway container spawning under load); the editor/preview
subdomains were protected only by the openvscode connection token (no session gate); and error
tracking was installed but inactive. This ADR records the batch closing them.

## Decision

**A. GitLab issue ingestion — `server/git/gitlabSync.ts` + the `gitlab-resync` op.** Pull the
linked project's open issues via the GitLab REST API (reusing the forge token model: decrypt
only here, `PRIVATE-TOKEN` header) and upsert them as tickets keyed `DEV-<iid>`. NEW issues enter
at `unrefined` (the AI moves them on); EXISTING tickets get title/labels/description refreshed
WITHOUT touching their pipeline position. The op broadcasts the touched tickets so the board
updates live. This is the ingestion half of the loop (a webhook-driven continuous sync + a
push-back of AI state to GitLab remain Fase-2 follow-ups).

**B. CapacityManager — a host-wide concurrent-turn cap.** `provisionContainers` defers a turn
(banner + broadcast, stays in-stage) when `busy worker AgentSessions >= WS_MAX_CONCURRENT_TURNS`
(default 4). A completing turn frees a slot; re-entering the stage runs it. Deliberately a SOFT
cap — a simultaneous burst can race past it, but steady-state is honoured — because a hard cap
needs atomic admission / a durable queue (Fase-2, alongside multi-instance).

**C. Edge-auth on editor/preview subdomains (Track B5) — committed separately.** The proxy's
`forward_auth`/`auth_request` calls `/editor-auth-check` (`readSession` → 204/401); the
`ProxyRoute.forwardAuth` field carries the auth backend. Today it gates on ANY valid session;
per-workspace membership needs a host→workspace lookup the proxy can carry (follow-up), and the
session cookie must be subdomain-scoped in production.

**D. Sentry error tracking.** Registered at boot when `SENTRY_DSN` is set (else inactive), via the
framework's `createSentryAdapter` + `registerErrorTracker`.

## Rejected alternatives

- **Keep tickets quick-add-only.** Rejected: a dev-orchestration product must ingest the team's
  real backlog (GitLab issues); a hand-maintained board isn't the product.
- **A hard concurrency cap with a queue now.** Rejected as premature — it couples to the Fase-2
  durable signal-log/multi-instance work; a soft cap prevents the runaway case today.
- **Membership-scoped edge-auth in one step.** Deferred — logged-in gating is the large security
  win; per-workspace isolation is a bounded follow-up (needs the host→workspace map).

## Consequences

- A GitLab-linked workspace's board is fed from its issues (`gitlab-resync`). `DEV-<iid>` keying
  can collide with quick-add's sequential `DEV-<n>` in a workspace that uses both — a GitLab-synced
  workspace should be sourced from GitLab.
- Under load the engine defers rather than exhausts the host; the deferred banner tells the user why.
- Editor/preview subdomains require a login; production must scope the session cookie to the
  wildcard parent domain.
- Still open for market: continuous GitLab webhook sync + AI-state push-back, per-workspace edge-auth
  membership, egress control on containers (07b §6), multi-instance (Fase-2), and billing enforcement.
