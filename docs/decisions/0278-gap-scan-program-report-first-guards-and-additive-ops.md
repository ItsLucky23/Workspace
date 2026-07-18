---
id: 0278
title: GAP_SCAN program — report-first security guards, additive ops, and honest platform no-ops
status: accepted
date: 2026-07-18
tags: [security, tenancy, control-api, content, deploy]
supersedes: []
---

## Context

The `GAP_SCAN_2026-07-17` audit produced ~37 open items spanning the autopilot chain, the phone-first
approve/answer loop, eight orphaned couplings, reliability/observability, two security postures, content
depth and six new modules. Delivering them raised three questions that recur across the whole program, and
answering them once (here) is what keeps the individual changes consistent.

## Decision

**1. Security posture changes ship report-first, not enforce-first.**

Two items change what is ALLOWED at runtime: tenant scoping on background writers (E2) and worker-container
egress (E3). Both now run in a mode that *records* what strict enforcement would have rejected —
`tenantGuardReport()` counts unscoped and cross-tenant calls, `egressReport()` counts unconfined worker
launches — and an env flag (`WS_TENANT_ENFORCE=1`, `WS_EGRESS=1`) flips each to enforcement.

The default for egress changed from *silently open* to *reported open*: the previous default hid the posture
entirely, which is the actual defect. Nothing is blocked that was not blocked before.

**2. Closing a feature gap adds OPS, never verbs.**

The frozen 7+6 structured-channel surface is untouched. Every new capability in this program is a
`ControlOp` behind the existing propose→accept→Conductor path: `save-platform-credentials`, `env-rollback`,
`document-archive`/`-unarchive`, `content-gen-thumbnail`, `content-reply-comment`, `studio-publish-site`/
`-unpublish-site`, `asset-star`, `clone-workspace`. Each is registered in the exhaustive `Record<ControlOp,…>`
maps (RBAC, catalog, dispatch), so the compiler refuses a half-wired op.

Which ops the Assistant may PROPOSE is now also filtered by the workspace's enabled modules (C4), in both
the prompt and validation — a content-only workspace can no longer be offered deploy ops it cannot run.

**3. A platform that cannot do something returns an honest no-op.**

TikTok has no public cover-image endpoint and no public comment-reply endpoint. Rather than silently
succeeding, `buildThumbnailUploadRequest` and `buildReplyRequest` return `null` for that platform and the
caller reports `platform-unsupported`. The same principle governs `previousLiveCommit` (a rollback with no
earlier good deploy is refused, not "rolled back" to the broken commit) and the first site-watch check
(a baseline, explicitly not a change).

## Rejected alternatives

- **Enforce tenancy/egress immediately.** Correct on paper, but the publish scheduler and trigger loops
  legitimately scan across tenants before acting on one workspace, and worker builds legitimately reach
  private registries. A hard flip would have broken working installs to fix a posture nobody had measured.
  Report-first produces the evidence that justifies the flip per install.
- **A generic `run-any-op` verb** to avoid growing the op list. It would collapse the RBAC + catalog
  exhaustiveness that currently makes a missing capability a compile error, and hand the model a surface
  the Conductor cannot reason about.
- **Auto-migrating `.env` platform credentials into the encrypted per-workspace store (A7).** Rejected by
  the owner: silently copying secrets into a new store is the kind of "helpful" migration that is impossible
  to audit afterwards. `.env` stays a fallback; the owner re-enters credentials by hand.
- **Pretending unsupported platform actions succeeded** (returning ok with a stub). It makes the product
  feel complete and the data lie — exactly the failure the A2/A4 publish-visibility work was closing.

## Consequences

- Two new report surfaces exist and are expected to be READ before enforcement is enabled; leaving them
  permanently in report mode is a deliberate operator choice, not a completed task.
- The op catalog grows with capability, and the module filter means the Assistant's prompt now differs per
  workspace — tests assert the filtering in both the prompt and the validator.
- `AuditArchive` (D4) is platform-level on purpose: it is the one table a workspace deletion may not touch.
  Tenant `AuditLog` and `DeployHistory` are now explicitly cascaded, closing an orphan-row leak found while
  testing the archive.
- Governed files carry `//? GAP_SCAN <item>` markers so the reasoning stays attached to the code.
