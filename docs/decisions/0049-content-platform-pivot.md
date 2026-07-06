---
id: 0049
title: Content-platform pivot — Workspaces as an all-in-1 AI content platform on the shared engine
status: accepted
date: 2026-07-06
tags: [strategy, content, media, pivot, provider-abstraction, style-system]
supersedes: []
depends_on: [0007, 0027, 0033, 0034]
---

# Content-platform pivot

## Context

Workspaces began as an AI **dev-orchestration** environment (tickets → pipeline → coding agent, human-in-the-middle). With the Studio marketing module (ADR 0033) it became clear the product is really an **all-in-1 tool for using AI in many ways**. The user wants to add AI **content creation** as a first-class use: short + long-form video, reference-driven photorealistic imagery, avatars, music, 3D, auto-posting to platforms, and animated software demos — driven by the same "user approves, the engine executes" model. This is a deliberate scope expansion the user wants; the question was whether it fits the architecture. It does — as an **addition, not a rewrite**.

## Decision

**Add a content lane on the existing engine.** A `projectType` (`dev` | `content` | …) selects the workflow lane; the same Conductor, realtime, RBAC, RAG, cron/automation, control-ops and B-23 single-writer serve both. Content is NOT a separate product — one app, distinct workflow surfaces. Concretely:

1. **The pipeline engine is generic.** A content-pipeline (idea → script → generate → assemble → review → publish) is just different stage-configs + roles on the same stage-runner.
2. **The provider abstraction (ADR 0007) is the "one tool for everything"** — our tool is the router, not a single external vendor. Default gateway **Fal.ai** (image/video/3d) + **ElevenLabs** (voice) + **Remotion** (code-driven assembly) + **Gemini** (reference/video analysis); per-workspace provider override + per-workspace key.
3. **A cross-cutting style/preset system.** Every AI feature has a `StyleRegistry` of named styles (each = a curated system-prompt + optional model/params). A generation composes `feature + input + style + free-form extra instructions`. Global default styles + per-workspace custom (brand) styles. Reference-conditioned photorealistic image-gen is the #1-priority feature, expressed through this system (`style: realistisch` + a reference input + extra instructions).
4. **€-budget as a first-class, metered cost.** Media APIs are real-money per-generation (unlike the Max-subscription coding agent, invariant #9). Real €-tracking + per-workspace caps + a pre-generation guard.
5. **Publishing behind the B-23 approval gate** — auto-post to YouTube + TikTok built behind an explicit approve-tap; Instagram + LinkedIn designed-for (extendable abstraction) but not built now. The primary near-term usable output is a **complete downloadable asset** the user posts manually.
6. **Built as one long autonomous `/goal` run** — the constraint is minimizing human-input touchpoints during the run, so all scope decisions are front-loaded (this ADR + `CONTENT_PLATFORM_PROGRAM.md`). No API keys are provided yet, so every provider adapter ships a **stub/dummy mode** returning valid-shaped fake output; the whole pipeline (assembly, budget, review, publish-gate, posting) is integration-tested end-to-end with dummy data. Live AI-output tests happen later when keys are added.

## Rejected alternatives

- **A separate content product / separate app now.** Rejected — shares nothing early and loses the engine synergy; a `projectType` lane on one app reuses Conductor/RBAC/RAG/cron. (Distinct workflow *surfaces* within the one app are kept — a merged everything-page is the risk to avoid.)
- **Build (train/host) the generative models ourselves.** Rejected — video/3d/image gen is the moat of specialised vendors and improves monthly; always integrate via API/gateway. Our moat is the orchestration + review + publish + memory on top.
- **Pick a single external all-in-one vendor (e.g. one video tool).** Rejected — no vendor is best at every modality; a gateway (Fal/Replicate) + the provider abstraction gives best-of-breed with easy swapping and ~2–3 keys.
- **Cost in €… everywhere / reuse token-tracking.** Rejected for media — token-tracking (invariant #9) was for the subscription coding agent; metered media needs real €-caps or a cron-loop runs up the bill. (Token display stays for the coding agent.)
- **Live AI-output integration tests in this build.** Rejected for now — no keys yet; stub/dummy-mode adapters test the whole downstream pipeline deterministically. Live tests deferred to a keyed follow-up.

## Consequences

- New content data-model (`projectType`, Channel/ContentProject/Asset/Script/Beat/MediaJob/RenderJob/StylePreset…), media `AiFeature`s + stub-capable adapters, a `StyleRegistry`, a €-budget model + guard, a publish-gate + platform abstraction, a Remotion assembly/render path, a navbar refactor + lazy-loading, an AI-drives-UI copilot, and per-channel brand-RAG + content-analytics.
- Full mechanics + the phased, per-item build spec live in `src/workspaces/_docs/CONTENT_PLATFORM_PROGRAM.md` (the `/goal` source of truth), each item schema→engine→client→dummy-test→ADR→commit.
- All framework rules still apply (routing, function-injection, strict typing/no-casts, `tryCatch`, i18n ×4, Tailwind tokens, surgical changes, lint+build+ai:lint, branch-log, decision-memory). The nine Workspaces invariants (B-23 single-writer, control-API writes, `runInTenant`, leader-elected engine, PTY-billing for the *coding* agent, …) remain; media generation is NON-coding and MAY use other providers (ADR 0007 already allows this).
- Follow-ups deferred: custom-model/LoRA training-from-references (heavier than reference-conditioned gen); live AI-output tests once keys land; Instagram/LinkedIn posting adapters; the parked €-vs-token reconciliation.
