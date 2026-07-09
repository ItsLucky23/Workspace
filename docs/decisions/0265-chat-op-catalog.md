---
status: accepted
date: 2026-07-09
tags: [assistant, control-api, rbac, security]
---

# 0265 — Catalog-driven assistant surface (X1): every control-op classified, propose→accept intact

## Context

The Workspace-AI could propose exactly 5 of the 138 control-ops (a hardcoded enum in
`server/ai/workspaceChat.ts`) — the scan reports (SCAN_UNIVERSAL_TOOL / COMPLETENESS_SCAN) measured
assistant-reachability at ~3.6% against the CLAUDE.md dual-mandate "every action via UI AND via the
workspace-AI". The user decided (2026-07-09, UNIVERSAL_TOOL_PROGRAM §0): nearly ALL ops must become
proposable, with destructive ones behind an extra explicit confirm.

## Decision

1. **A single exhaustive op-catalog** (`server/ai/opCatalog.ts`, `Record<ControlOp, OpSpec>` — a
   missing op is a tsc error) classifies every op as `enabled` (proposable now + client-dispatchable),
   `later` (safe; flips to enabled when its dispatcher lands) or `excluded` (never via chat).
2. **Excluded forever:** secret-bearing ops (`save-env`, `save-integration`, `save-media-provider`,
   `gitlab-settings`, `forge-connect`, `db-connect`, `account-disconnect`) — secret values must never
   flow through the LLM/chat transcript — plus plumbing/legacy/dead ops (`create-workspace`,
   `accept-invite`, `accept-suggestion`, `mark-read`, `copilot-propose`, `answer-input`,
   `preview-up/down`, and the 5 ops the legacy rich chat path already covers).
3. **Generic validation before proposal:** params are spec-typed; workspace references
   (ticketKey/stageId/pieceId/envId/serviceName/preset) validate against the REAL context
   (`loadCtx` now also loads pieces/environments/services); undeclared fields are stripped.
   RBAC + payload validation still run at the write path on accept (B-23 unchanged — the AI only
   proposes, the Conductor stays the only writer, no new verbs anywhere).
4. **Destructive ops carry `destructive: true`** → the client wraps accept in `menuHandler.confirm`
   (one combined confirm for plans). `env-promote`'s confirm doubles as the promote `approved` flag;
   prod stays further gated server-side (green CI + security).
5. **Server/client lockstep by test, not import:** the server bundle can't import `src/` runtime
   values (same constraint as OP_CAPABILITY), so the enabled tranche exists twice —
   `server/ai/opCatalog.ts` and `src/workspaces/_data/chatOps.ts` + `chatDispatch.ts`
   (`Record<ChatEnabledOp, …>` = compile-forced total) — and
   `tests/unit/opCatalogParity.test.mts` fails on any drift.
6. **First tranche = 28 ops** (agent-controls, deploy/env, CI/reasoning/memory, DB-safe half,
   projects/greenfield, service stacks preset-only, stage reshape, content lifecycle + run-pipeline +
   regenerate). Paid per-asset gen ops stay `later` until the cost-confirm work (UNIVERSAL_TOOL B4)
   lands, so chat can't trigger spend without a price shown.

## Rejected alternatives

- **One generic "dispatch any op" client route** — would bypass the per-route payload validation and
  create a de-facto new verb; rejected on B-23/frozen-verb grounds.
- **Whitelist-in-prompt only (no catalog)** — leaves validation drifting from the prompt; the catalog
  makes prompt, validation and dispatch provably the same set.
- **Enabling all 138 at once** — dispatchers without existing routes/UI shapes would silently no-op;
  the `later` mode makes growth explicit and parity-tested instead.

## Consequences

- "Zet Kafka aan", "publiceer naar demo", "run CI", "draai de content-pipeline voor piece X" are now
  one chat-accept away; later COMPLETION fases flip more ops on with a 3-line change (catalog mode +
  chatOps entry + dispatcher).
- The parity test (53 asserts) is the drift-guard; adding a ControlOp without classifying it breaks
  tsc, misclassifying it breaks the test.
