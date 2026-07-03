---
id: 0029
title: Forge-provider abstraction (GitLab + GitHub) + webhook ingest
status: accepted
date: 2026-07-03
tags: [workspaces, forge, gitlab, github, webhook]
supersedes: []
---

# 0029 — Forge-provider abstraction + webhook ingest

## Context

Goal-item #10. The push-on-approval + MR path was GitLab-hardcoded (`openMergeRequest` calling
`/api/v4` with `PRIVATE-TOKEN`), and issue ingest was poll-only. The goal wants GitHub-forge support,
a built-in git-server, and GitLab-webhook continuous ingest.

## Decision

- **Forge-provider abstraction** (`server/git/forgeProvider.ts`): the REST call SHAPING is pure +
  per-provider (`buildOpenMrRequest` / `buildFindMrRequest` / `readMrUrl` / `isDuplicateStatus` for
  `gitlab` | `github`), so it is unit-testable without a network; `openForgeMergeRequest` is the one
  thin fetch wrapper. GitLab uses `/api/v4` + `PRIVATE-TOKEN` + `web_url` + 409-duplicate; GitHub
  uses `/repos/{owner}/{repo}/pulls` + `Bearer` + `html_url` + 422-duplicate. `forge.ts` resolves the
  provider from `Workspace.forgeType` and calls it — the engine code is now forge-agnostic.
- **Webhook ingest** (`server/git/webhookIngest.ts` + `webhookRoute.ts`): a pure `parseWebhookEvent`
  normalizes GitLab (`object_kind:'issue'`) AND GitHub (`X-GitHub-Event: issues`) issue events to one
  shape; `ingestIssueEvent` upserts the `DEV-<iid>` ticket (idempotent). Exposed at
  `POST /webhooks/forge/<workspaceId>` as a pre-params custom route with `registerOriginExemptPath`
  (a server-to-server POST has no Origin → the framework's step-1 origin gate would 403 it).
- **Security**: exemption is NOT auth — the handler requires a shared secret (`WS_WEBHOOK_SECRET`) in
  `X-Webhook-Secret` / `X-Gitlab-Token`. UNSET ⇒ the endpoint is DISABLED (503, fail-closed). Wrong
  secret ⇒ 401. On a dedicated `/webhooks/` prefix (never overlaps `/api`·`/auth`·`/sync`).
- **Config**: `Workspace.forgeType` (default `gitlab`) + a provider dropdown in the GitLab settings
  tab (i18n en/nl/de/fr), through the existing `gitlab-settings` control-op.

## Rejected alternatives

- **Keep GitLab hardcoded + copy-paste for GitHub.** Two divergent code paths; the abstraction keeps
  the engine forge-agnostic and the differences declarative + tested.
- **Poll GitHub too (no webhooks).** Higher latency + API cost; the webhook seam is realtime and the
  framework already provides the origin-exempt raw-body pre-params phase for exactly this.
- **HMAC signature verification (vs a shared-secret header).** Both providers support a plaintext
  token header (`X-Gitlab-Token`); a shared secret is simpler + sufficient for V1. HMAC can be added
  behind the same seam later.

## Consequences

- A workspace can target GitLab OR GitHub for MRs/PRs with the same engine code; issues ingest
  continuously via webhook (realtime) on top of the existing poller.
- **Built-in git-server = DEFERRED** (honest scope): serving repos over authenticated git-HTTP is a
  separate infra service (a git-http-backend container + auth), not a code change to the app. Tracked
  as a follow-up within #10; the forge abstraction is the seam it will plug into.
- Verified: `forge.test.mts` (26/26) — provider request-shaping (GitLab vs GitHub open/find/url/
  duplicate) + webhook parse (both providers, push ignored) + real ingest (create→update, no dup).
  Full suite 31/31. Live: `POST /webhooks/forge/<ws>` — wrong secret → 401, correct secret → 200 +
  `ingested DEV-8888` (real upsert). Browser: the forge-provider dropdown renders in settings.
