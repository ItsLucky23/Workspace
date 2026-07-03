---
name: pluggable-proxy-and-git-workflow-config
title: Git/workflow customization is split into structured per-workspace config vs skill/context-doc guidance, and the preview reverse-proxy is a pluggable Caddy/nginx provider
status: accepted
date: 2026-07-03
deciders: [ItsLucky23]
tags: [git, hosting, proxy, workflow, config]
supersedes: []
relates: [0007, 0008, 0010]
---

## Context

Two related customization needs surfaced for Workspaces V1:

1. **Git/workflow** — teams name branches differently (`DEV-1240` vs `feature/DEV-1240-…`),
   have different push/MR policies, and want to steer *how* the AI commits ("split a ticket
   into testable steps, commit each passing step"). The runtime hardcoded `branch == ticket
   key` in three places (worktree, container, host).
2. **Preview hosting** — each ticket's container is exposed at a per-ticket subdomain of
   `workspace.<domain>` (wildcard DNS + cert). The user runs **nginx** today but Caddy is the
   easier fit for per-ticket route churn. An editor-specific Caddy driver already existed
   (`caddyRoutes.ts`), but nothing general or pluggable.

The forces: the reverse proxy is an integration point (not core logic); branch/host derivation
must be deterministic (code parses it); but "how to commit" is prose the AI interprets, not
something code enforces. We needed a principled line so customization doesn't become a grab-bag.

## Decision

**A. The line = "does CODE act on it, or does the AI just READ it?"**
- **Code acts → structured config.** A per-workspace `GitConfig` (`Workspace.gitConfig` JSON):
  `branchStrategy` (ticket-prefix | typed | custom template), `pushPolicy`, `targetBranch`,
  `protectedBranches`, `commitSigning`. `server/git/branchStrategy.ts` is the pure resolver:
  `resolveBranchName` (called once at branch creation, persisted on `Ticket.branch`) +
  `deriveHostSlug` (the same branch → a valid RFC-1123 preview subdomain). One source of truth,
  two consumers (git worktree/container naming + the proxy host).
- **AI reads → skill/context-doc guidance.** "How to commit / conventions" lives in the
  EXISTING InfoSource layer (context-docs + `sourceIds`/`enabled`), NOT in config. A curated
  **starter library** (`server/bootstrap/starterLibrary.ts`) seeds disabled `source='starter'`
  context-docs a user toggles on — "a nudge, not a blank page". The load-bearing wire that was
  deferred — injecting a stage's context-docs into `CLAUDE.md` — is now built
  (`stageRunner` loads enabled starter + per-stage `sourceIds` docs → `renderStage` inlines them).

**B. The reverse proxy is a pluggable provider** (`server/proxy/`, mirroring the
[[0007-pluggable-ai-provider-layer]] shape): one `ProxyProvider` interface
(upsert/remove/reconcile a host→target route), two backends chosen by `WS_PROXY`. `caddy` uses
the Admin API (dynamic, no reload); `nginx` regenerates a managed include file + **debounced
graceful reload** (zero-downtime — the wildcard DNS is static, `nginx -s reload` drops no
connections, and a failed `nginx -t` never reloads). Host-level infra (`WS_PROXY`,
`WS_BASE_DOMAIN`) is env/config, not per-workspace DB state. See docs/HOSTING.md.

## Rejected alternatives

- **Hardcode Caddy** (extend the existing `caddyRoutes.ts` only). Rejected: the user runs nginx
  and wants to keep it; the proxy is an integration point that shouldn't be baked in.
- **Hardcode `branch == ticket key`** (status quo). Rejected: teams have real, differing
  branch conventions, and the preview subdomain must derive from the branch.
- **Put commit-behaviour in structured config** (e.g. a `commitStrategy` enum). Rejected: "how
  to work" is open-ended prose the AI interprets — encoding it as config is a false structure;
  the skill/context-doc layer already exists for exactly this.
- **A new mechanism for the starter library.** Rejected: InfoSource context-docs + the
  `skill-toggle` op + the Sources page already do browse/store/toggle — reuse, don't reinvent.

## Consequences

- Changing a workspace's branch strategy never renames an in-flight ticket's branch (resolved
  once, persisted). New tickets pick up the new strategy.
- The `sourceIds → CLAUDE.md` injection now makes ALL context-docs (not just starter snippets)
  actually reach the agent — a capability that was a dead toggle before.
- nginx and Caddy are behaviourally interchangeable behind `ProxyProvider`; the preview flow is
  substrate (not yet wired to a live dev-server-per-ticket flow — that's a later slice).
- Host infra config (proxy, base domain, wildcard cert) is a deployment concern documented in
  docs/HOSTING.md, separate from per-workspace settings.
