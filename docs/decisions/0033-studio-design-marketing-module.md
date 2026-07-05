---
id: 0033
title: Studio — AI design + marketing module (brief → artifacts via provider layer + AgentRoles)
status: accepted
date: 2026-07-05
tags: [workspaces, studio, ai, marketing, design, provider-abstraction, agent-roles]
supersedes: []
---

# 0033 — Studio (design + marketing module)

## Context

The user wants a "designer + marketing tool": AI roles that take a product/marketing BRIEF and produce
design + marketing artifacts (landing page, copy/campaigns, brand kit, go-to-market strategy). Chosen
shape (user-confirmed): a Workspaces MODULE built on the **AgentRole registry** (#2, ADR 0027) + the
**pluggable AI-provider layer** (ADR 0007, so the backend is a config choice, Claude CLI / Gemini /
…). First deliverable: one vertical flow end-to-end (landing page: brief → generate → live preview →
save), then the other three kinds.

## Decision

- **Data model**: `StudioBrief` (product, audience, tone, goals, notes) + `StudioArtifact` (kind,
  role, `content` JSON, providerId, status). A brief has many artifacts.
- **Generation** (`server/studio/generate.ts`): PURE per-kind prompt builders + parsers (unit-tested,
  no DB), and one impure `generateArtifact` that runs `runAiCompletion(feature, req)` and stores a
  `StudioArtifact`. Kinds → roles/features: landing+brand = `designer`/`studio-designer`,
  copy+strategy = `marketer`/`studio-marketer` (two new `AiFeature`s + assignments, defaulting to
  claude-cli, overridable to gemini per the abstraction). Landing = a self-contained responsive HTML
  page (rendered in a **sandboxed iframe** — no scripts run); brand/copy = structured JSON; strategy =
  markdown.
- **AgentRole bridge** (`server/studio/roles.ts`): registers `studio-designer` + `studio-marketer`
  into the #2 registry (`mutates: true` → automation gates them behind approval), so a
  WorkspaceTrigger can auto-generate an artifact.
- **Routes** (`_api`, membership-gated, `relaxed`): `studioSaveBrief`, `studioGenerate` (runs the AI,
  rate-limited 10/min), `studioDelete`. Studio content is a separate domain (not board/git/status), so
  it writes via `_api` like the chat/preferences routes — the Conductor single-writer invariant (B-23)
  governs orchestration state, not this content.
- **UI**: a new `studio` view + nav item + `src/workspaces/studio/page.tsx` — brief list, brief form,
  a generate row (4 kinds), and per-kind live previews (iframe landing, palette swatches, copy
  columns, rendered strategy markdown). i18n en/nl/de/fr.

## Rejected alternatives

- **Hardcode Claude for generation.** Violates the ai-provider-abstraction rule; every AI feature
  resolves a provider via the registry so swapping backends is config, not code.
- **Route generation through the Conductor.** B-23 is about orchestration state (tickets/git/status);
  a studio artifact is user-requested content, so an `_api` write (like chat/preferences) is correct +
  simpler. Async job + broadcast is a later optimization if generation latency needs it.
- **Render the landing HTML directly (not sandboxed).** XSS/again-script risk; a `sandbox=""` iframe
  gives a faithful preview with zero script execution.

## Consequences

- A user writes a brief and generates real, previewable marketing artifacts; the backend is pluggable
  and the roles are automatable.
- Verified: `studio.test.mts` (17/17) — prompt builders embed the brief + ask for the right shape,
  parsers extract HTML/JSON/markdown + fall back safely, role/feature wiring is correct. server/
  front-tsc + eslint + ai:lint 0.
- **LIVE-VERIFIED end-to-end (2026-07-05)** once the self-hosted secret-manager host came back:
  `prisma db push` (in sync), backend booted, and in the browser a brief ("Nimbus — an AI note-taking
  app") generated a **landing page** (claude-cli → 14 KB HTML rendered in the sandboxed iframe:
  hero "The meeting ends. The notes are already done.", CTA, tagline) AND a **brand kit** (claude-cli
  → 6-colour palette with hex swatches, Sora/Inter typography, brand voice, 5 taglines, 5 logo ideas).
  Both artifact families (HTML iframe + JSON preview) render correctly with real AI output.
