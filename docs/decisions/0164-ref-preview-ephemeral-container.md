---
title: T1 — preview an arbitrary git ref via an ephemeral, ref-scoped container (un-defer preview-at-ref)
status: accepted
date: 2026-07-08
tags: [preview, container, git, time-travel, adoption]
---

## Context

Every run/preview/deploy path was hardwired to the branch TIP: `launchTicketContainer` clones
`git clone --branch <branch> --single-branch`, `openPreview` took only `{workspaceId, ticketKey}`, and
previewing a specific/older commit was explicitly "Deferred" (`features/23_PREVIEW_DEPLOYMENT.md`). The user
wants "start a server from main but without commit X" / "run yesterday's version" (T2 builds the synthetic-ref
producer on top of this) — which requires previewing an arbitrary ref.

## Decision

- **A ref-preview runs in its OWN ephemeral, ref-scoped container** — NOT the ticket's tip worker container.
  `launchTicketContainer` gains an optional `ref`: when present, the container/volume name get a `-ref-<slug>`
  suffix (`refSlug`, ≤12 docker-safe chars) and the clone becomes a FULL-history `git clone /mirror /work` +
  `git checkout <ref>` (`cloneExecArgs`, pure + tested) instead of the single-branch tip clone. So two refs of one
  branch coexist and a ref-preview never clobbers the agent's tip working container.
- **Ref-scoped route** (`refPreviewRoute`): distinct `id` (`<ticketKey>-ref-<slug>`) + subdomain
  (`<branch>-<slug>.<domain>`) per ref → side-by-side previews, idempotent per ref.
- **Injection-safe ref**: `isSafeRef` gates on `[0-9a-zA-Z._/-]` with no `..` before the ref reaches the clone
  shell; `openRefPreview` (+ the `open-ref-preview_v1` `_api` op, `workTickets`-gated) rejects a bad ref.

## Rejected alternatives

- **Reuse the ticket's worker container + `git checkout <ref>` in place.** Rejected: it would detach/overwrite the
  agent's tip checkout (losing uncommitted work) and can't run two refs at once. The ephemeral container is clean.
- **A ref DIMENSION on the existing preview route key only (shared container).** Rejected: same clobbering
  problem; the container, not just the route, must be ref-scoped.
- **Shallow clone of just the ref.** Rejected: a ref may be an ancestor not reachable by `--branch`; full history
  is the robust default for a throwaway preview.

## Consequences

- The live launch is Docker-dependent; the naming + clone/checkout + route PLAN is pure + unit-tested
  (`refPreview.test.mts`), matching the plan's "route-key + checkout-args" verify. A keyed live run is a later
  user-triggered check.
- Ref-preview containers accumulate until torn down — a follow-up can reap idle ref-previews (mirror W3 /
  editor-reaper) keyed on the `-ref-` name.
- T2 (synthetic revert-ref "main minus X" / "as-of timestamp T") produces a ref that feeds straight into this;
  T3 lets the Assistant propose it phone-first.
