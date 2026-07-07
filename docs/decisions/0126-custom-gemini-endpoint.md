---
title: Custom Gemini base URL (bring-your-own endpoint) — X4, AI-provider half
status: accepted
date: 2026-07-07
tags: [ai, providers, gemini, extensibility, freedom-program]
---

## Context

FREEDOM_PROGRAM item **X4**. The Gemini endpoint was hardcoded to Google's
`generativelanguage.googleapis.com/v1beta`. No way to point at a self-hosted / proxied / regional
Gemini-compatible endpoint. (The coding agent stays `claude` in a PTY — the PTY-billing invariant — so this is
non-coding-provider only.)

## Decision

- A per-workspace `Workspace.geminiBaseUrl` + a `WS_GEMINI_BASE_URL` env, resolved in `resolveGeminiConfig`
  (workspace override > env > Google default) alongside the P2 model/temperature read (one query). A pure
  `geminiEndpoint(baseUrl, model)` builds the `…/models/<model>:generateContent` URL, trimming trailing
  slashes. Edited in the AI-tab (a base-URL field) through the same `save-ai-instruction` op as the other
  Gemini settings.

## Rejected alternatives

- **A closed provider union with a second "custom-gemini" id.** The endpoint is a config knob on the existing
  provider, not a new provider — a base-URL field is the minimal, honest surface.
- **A generic base-URL for every provider incl. the coding agent.** Claude runs in a subscription-billed PTY
  (PTY invariant) — it has no HTTP endpoint to override. Scoped to Gemini (the API-billed non-coding provider).
- **Do the publish-destination-registry half now.** X4 also asks for a custom publish destination; that's a
  separate registry + adapter — a documented follow-up. The provider-endpoint half is the bounded, tested slice.

## Consequences

- A workspace can route Gemini through its own endpoint (a proxy, a mirror, an OpenAI-compatible gateway),
  composing with the P1 provider-per-feature + P2 model/temperature dials. `geminiEndpoint` is pure +
  unit-tested. The custom publish-destination registry is the remaining half of X4.
