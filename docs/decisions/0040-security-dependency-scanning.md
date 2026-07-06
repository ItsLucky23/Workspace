---
id: 0040
title: Security & dependency scanning — first-class CI job types
status: accepted
date: 2026-07-06
tags: [ci, security, dependency-audit, secret-scan, expansion-c2]
supersedes: []
depends_on: [0039]
---

# Security & dependency scanning

## Context

C1 (ADR 0039) built the CI runner + the merge/promote gates. C2 adds the user's ask: security + dependency
scanning built DIRECTLY into the pipeline (not only via automation/cron or manual tickets). It inherits
C1's runner/DAG entirely — the job TYPES are the delta.

## Decision

1. **First-class scanner job types on the C1 runner** — a CI job gains a `type` (`script` default, plus
   `dep-audit` / `sca` / `secret-scan`). A scanner job needs NO `script` (its command comes from its type:
   `npm audit --json` for dep-audit; a credential-pattern `grep` for secret-scan). Results are PARSED into
   typed findings + a max severity (`server/ci/security.ts` pure parsers), stored on the `PipelineJob`
   (`severity`, `findings`) and rolled up to `PipelineRun.maxSeverity` — not freeform log-grepping.

2. **Fail policy: high/critical blocks a PROD promote; report-only on dev/merge.** A scanner job stays
   green (it doesn't fail the run — so it never hard-blocks merge), but its SEVERITY is a separate prod
   gate: `securityBlocksProdPromote(projectId)` blocks `env-promote → prod` (`promote.securityFindings`)
   when the latest run carries a high/critical finding. This matches "build it into the pipeline" without
   making a moderate advisory wedge every merge.

## Rejected alternatives

- **Fail the run on any finding (block merge).** Rejected — a low/moderate advisory shouldn't block all
  merges; the value is gating the irreversible-ish prod promote. Report-only on dev keeps the signal
  without the friction (the findings still surface as `TicketEvent(type:'ci')`).
- **A separate scan model / cron scanner.** Rejected — the user explicitly wanted it IN the pipeline, and
  C1's runner + DAG already provide the container/tenancy/egress substrate; a scanner is just a job type.
- **Third-party scanner integration (Snyk/etc.).** Deferred — `npm audit` + a secret-pattern grep are
  zero-dep and cover the V1 need; a pluggable external scanner is a later `runnerKind`/provider seam.

## Consequences

- Schema grows (`PipelineJob.jobType`/`severity`/`findings`; `PipelineRun.maxSeverity`).
- The prod-promote gate now has THREE checks: approval (B2) + green CI (C1) + no-high-severity (C2).
- Findings surface via the existing CI `TicketEvent`s; a dedicated security-findings UI panel is a
  follow-up (same as the C1 CI-chip UI).
- C3 (AI MR-review) is the next Wave-C item — a separate propose-only review surface, not a CI job.
