---
title: Users upload their own knowledge docs (context-doc InfoSources) — the dead Sources upload is real
status: accepted
date: 2026-07-07
tags: [sources, infosource, knowledge, freedom-program]
---

## Context

FREEDOM_PROGRAM item **K2**. The Sources page "Upload spec" button was a `noop` — a user could not bring their
own knowledge/house-rules docs for the AI to use; InfoSources only came from a linked git repo (`scan-docs`).

## Decision

- A new `create-info-source` control-op registers an uploaded doc as a `source: 'uploaded'` context-doc
  InfoSource (upsert by name, `enabled: false` by default — the user toggles it on). It returns the full
  context-doc list as the delta (same shape + client callback as `scan-docs`), via a new `addInfoDoc` `_sync`
  route + provider method.
- The client reads the file's text (`File.text()`) and sends it — **no binary upload needed for text docs**
  (md/txt); the K1 `/media/upload` route is for binary media, this is plain text over the control channel.

## Rejected alternatives

- **Reuse the K1 binary upload route for docs.** Unnecessary — a text doc is small and reads client-side; the
  control-op carries it directly (and keeps the write on the single-writer chain).
- **PDF support now.** Needs a parser dependency; scoped to md/txt for K2 (the common house-rules/brief case).
  PDF can be added with a `pdf-parse`-style dep later.
- **Auto-enable uploaded docs.** They default OFF like scanned docs — the user opts each into the AI's context
  (consistent + safe).

## Consequences

- Users bring their own knowledge (house style, product facts, examples) as first-class context-docs. K3 wires
  the creative features to actually retrieve/ground on them (today they feed the dev stage-agent via
  `sourceIds`, like scanned docs).
