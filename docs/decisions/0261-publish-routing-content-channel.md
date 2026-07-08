---
title: A3+A4 — publish routing by account + content bound to a channel
status: accepted
date: 2026-07-08
tags: [content, publish, accounts, channels, ai-libraries-accounts]
---

## Context

A1+A2 gave N accounts per platform + channel management. A3 makes a publish target a CHOSEN account (not just
"the platform"), and A4 lets a content piece be created bound to a channel ("make a video for channel Z") so
generation grounds on that channel's brand.

## Decision

- **A3 — thread `accountId` through the publish path.** `performUpload` + `publishAsset` gained an optional
  `accountId` → `getConnection(platform, accountId)`, so the upload uses the chosen account's token (default
  account when omitted). `content-request-publish` carries `accountId` in the suggestion patch; the accept
  passes it to `publishAsset`.
- **A4 — `content-from-brief` accepts `channelId`.** The created `ContentProject` is bound to the channel
  (content-create already did), so `brandContext` + brand-RAG ground every generation on that channel's voice.
  The Workspace-AI can propose "make a video for channel Z" by re-expressing it as a content-create/
  content-from-brief with the channelId (no new verb).

## Rejected alternatives

- **A separate publish-to-account op.** `content-request-publish` already models the intent; an optional
  `accountId` on it + the patch is the minimal change and keeps the B-23 propose→accept→Conductor flow.
- **Resolve the account from the channel implicitly.** Explicit accountId keeps the choice in the user's hands
  (a channel may map to multiple accounts, or a one-off cross-post); the channel binding is a separate concern
  (brand grounding), not publish routing.

## Consequences

- A publish now lands on the exact account the user picked, and a piece can be created pre-bound to a channel
  so its generation is on-brand. Proven E2E (6/6, fixture transport): the upload used the "second" then the
  "main" account token as routed, and content-from-brief bound the piece to the channel. This closes Fase A
  (social-account management) and the whole AI_LIBRARIES_ACCOUNTS program's build phases. Real OAuth connect +
  a live post remain fixtures (no apps, per the run decision); the account picker UI is browser-verified.
