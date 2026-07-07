---
title: Per-platform publish variants (caption / hashtags / privacy) in the upload payload
status: accepted
date: 2026-07-07
tags: [content, publish, freedom-program]
---

## Context

FREEDOM_PROGRAM item **O2**. Publishing posted the piece TITLE to every platform with a hardcoded `private`
visibility — no per-platform caption, hashtags, or privacy. Each network wants its own copy + settings.

## Decision

- A normalized `PublishVariant { caption?, hashtags?, privacy? }` with `privacy: 'public'|'unlisted'|'private'`.
  `buildUploadRequest` takes an optional `variant` and maps it to each platform's own vocabulary — YouTube
  `privacyStatus` (public/unlisted/private), TikTok `privacy_level` (PUBLIC_TO_EVERYONE / SELF_ONLY; no
  "unlisted" → SELF_ONLY). A pure `composeCaption(title, variant)` builds the caption (override or title) +
  `#`-prefixed hashtags.
- Variants are stored per-piece on `ContentProject.publishVariants` (a `{ [platform]: variant }` JSON). A pure
  `extractPublishVariant(json, platform)` validates + pulls the entry; `performUpload` threads it into the
  upload. Defaults preserve the prior behaviour (title-only, private).

## Rejected alternatives

- **A separate `PublishVariant` model/table.** Variants are a small, piece-scoped JSON map — a column on the
  piece is simpler than a table + joins for what is effectively a settings blob.
- **A single caption for all platforms.** The whole point is per-platform copy/privacy; a shared caption is the
  status quo it replaces.

## Consequences

- Each platform posts its own caption/hashtags/privacy, asserted per-platform in the pure `buildUploadRequest`
  tests (`publishVariants` 14/14). The compose-post UI (editing the variant per connected platform) + a
  `save-publish-variant` control-op are a follow-up on top of the tested payload + store primitives.
