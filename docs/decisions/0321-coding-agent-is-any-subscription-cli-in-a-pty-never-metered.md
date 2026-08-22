---
title: The coding agent is any subscription CLI in a PTY — never metered
status: accepted
date: 2026-08-22
tags: [ai-providers, pipeline, billing, invariant-6]
---

# Context

Build-invariant 6 said the code-writing pipeline agent is always the interactive `claude` CLI in a node-pty (subscription billing; never `-p`/headless, never the Agent SDK). The owner wants other AI tools supported — other subscriptions (OpenAI/GPT) and many APIs/models. The one-shot feature layer is already provider-pluggable (ADR 0007, 9-backend catalog); the question was what the CODING agent may be.

# Decision

Owner decisions, 2026-08-22 (AI_PROVIDER_EXPANSION_PLAN.md):

1. **Invariant 6 generalizes**: the coding agent is always an **interactive vendor CLI in a PTY on a subscription seat** — vendor-neutral, but still never headless and never a metered API. First additional adapter: **OpenAI Codex CLI**, Gemini CLI later. Each new CLI is gated by its own P0.5-style billing spike (RED escalates to the owner, never silently falls back to headless).
2. **No metered coding** (plan Fase 4 rejected): the pipeline agent never runs on an API-key backend, not even as a capped opt-in.
3. **No Azure OpenAI** in the catalog for now (add only on concrete need).
4. **Plan Fase 1+2** (routing fallback chain, per-feature model override, dynamic model listing) run directly after fix-round Agent 1 merges, as a fourth cheap-agent handoff package.

# Rejected alternatives

- **Coding stays Claude-only** — rejected: the owner explicitly wants other subscriptions to drive the pipeline.
- **Metered API coding with budget caps** — rejected: invariant 6's purpose is billing protection; a cap still invites surprise spend.
- **Azure OpenAI now** — rejected as speculative (per-deployment URL scheme = extra transport work without a user).

# Consequences

- CLAUDE.md invariant 6 must be rewritten to the vendor-neutral form when Fase 3 starts (user-gated edit; this ADR records the approval).
- `stageRunner.ts`/`modelSelect.ts`/`claudeCli.ts` grow a `CodingCliAdapter` seam; per-stage coding-agent choice reuses the Fase-1 resolution chain.
- Container images and the SetupWizard gain per-CLI install + host sign-in steps.
