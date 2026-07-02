---
id: 0007
title: Pluggable AI-provider layer — features resolve a backend at dispatch, never hardcode one
status: accepted
date: 2026-07-02
tags: [ai, architecture, orchestrator, extensibility]
supersedes: []
---

## Context

Workspaces integrates AI in many places: the Workspace-AI chat, docs generation,
`.workspaces/Dockerfile` generation, the per-stage in-container coding agent, conflict
resolution. The obvious path is to call the Claude CLI directly at each site (the P0.5
spike proved the subscription-billed interactive PTY works). The user requires instead
that **each AI feature be independently assignable to a different backend** — Claude
Code (CLI/PTY), a Gemini API key, or any future provider — chosen per feature.

## Decision

Introduce a generic AI-provider layer under `server/ai/`:
- **`types.ts`** — the shared contract: `AiProviderId`, `AiFeature`, `AiProvider`
  (`available()` + `complete()`), and the request/result shapes.
- **`providers/*`** — one standalone handler per backend: `claude-cli` (drives the
  interactive PTY in a scrubbed env → Max subscription, reading the final message off the
  Stop hook via `--settings`, never `-p/--print`) and `gemini-api` (headless Generative
  Language API call, gated on `GEMINI_API_KEY`).
- **`assignments.ts`** — the single feature→provider map, with a `resolveAssignment`
  seam that a per-workspace/user override (a future picker UI backed by a DB setting)
  plugs into without touching feature code.
- **`registry.ts`** — `runAiCompletion(feature, req, overrides?)`: resolves the assigned
  provider, gates on `available()`, and dispatches. This is the ONLY entry point features
  import; no feature names a provider.

Adding a backend = one handler + one union member. Adding a feature = one key + a default.

## Rejected alternatives

- **Call the Claude CLI directly at each site.** Simplest, but hardcodes Claude
  everywhere and makes "use Gemini for docs-gen" a cross-cutting rewrite. Directly
  violates the user's per-feature-choice requirement.
- **A single `runAI()` that branches on provider internally.** Centralises dispatch but
  entangles every backend's transport in one function; adding a provider edits shared
  code and risks regressions across features. The handler-per-backend registry keeps each
  transport isolated behind a common interface.
- **Per-workspace provider config in the DB now.** Deferred, not rejected: the
  `resolveAssignment(overrides)` seam is already in place; the DB/UI layer lands when the
  picker ships. V1 ships a global default map so no schema change is needed yet.

## Consequences

- Every AI feature (chat, docs-gen, dockerfile-gen, pipeline-agent, conflict-resolve)
  builds on `runAiCompletion` and is backend-agnostic from day one.
- The Claude path stays subscription-billed (interactive PTY); other providers (Gemini)
  are a different billing driver and may run headless — the layer makes that a per-feature
  choice, not a global mode.
- The one-shot `complete()` shape covers chat/docs/dockerfile. The long-running
  in-container pipeline agent is a streaming/session shape that will EXTEND this contract
  when the container runtime lands — deliberately not built speculatively here.
- Governed files carry `//? project rule: ai-provider-abstraction`; see the standing
  project memory of the same name.
