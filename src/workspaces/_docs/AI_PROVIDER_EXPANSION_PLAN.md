# AI Provider Expansion Plan

> Goal: any AI feature can run on any backend the user connects — other subscriptions (OpenAI/GPT, …), many APIs, many models — instead of the `claude-cli` / `gemini-api` pair the code keeps naming. Written 2026-08-22, after the 8-agent audit; builds on the fix-round (`fix-round-2026-08-22/`). Owner decisions are marked **OPEN VRAAG**.

## 1. What already exists (do not rebuild)

The provider abstraction (ADR 0007, project rule *ai-provider-abstraction*) is further along than the codebase's surface suggests:

- **Catalog** — `server/ai/providers/catalog.ts`: **9 backends** over **3 transports**: `claude-cli` (subscription PTY), `anthropic` (messages API), and `openai-compatible` serving Gemini, **OpenAI**, OpenRouter, Groq, DeepSeek, Mistral, and Local/self-hosted (Ollama/vLLM/LM Studio). Each entry: model list + "other" escape hatch, default model, base URL + `WS_*_BASE_URL` env override, subscription-vs-api-key kind.
- **Registry/dispatch** — `server/ai/registry.ts`: `runAiCompletion(feature, req)` never names a provider; availability probe, shared queue + circuit breaker, bounded retry, spend recording, workspace steer/skills/product-index injection at one choke point.
- **Connections** — `AiConnection` rows (connect / test / disconnect UI on the AI page, commit f6c12be) hold per-workspace key + picked model per backend.
- **Features** — 21 `AiFeature`s (`server/ai/types.ts`) with a defaults map (`assignments.ts`) and a per-workspace per-feature override picker (`__ai_provider_<feature>` EnvVars → AiBehaviorTab).

So: adding another **metered OpenAI-compatible host is a data change** (one catalog entry). The gaps are in routing, defaults, the coding agent, and multimodal.

## 2. The four hardcode remnants (why it *feels* like two providers)

| # | Place | Problem |
|---|---|---|
| 1 | `server/ai/workspaceAssignments.ts:13` | Dispatch-side allowlist `Set(['claude-cli','gemini-api'])` silently DROPS overrides pointing at the other 7 backends → **audit F-017** (routing looks saved, engine ignores it). |
| 2 | `server/ai/opCatalog.ts:222-225` | Assistant-op enum for `save-ai-provider` offers only `default/claude-cli/gemini-api`. |
| 3 | `server/ai/assignments.ts` | All 21 feature defaults name only `claude-cli`/`gemini-api`; no fallback when the default backend is not connected/available (a GPT-only user gets `ai.providerUnavailable` instead of their working backend). |
| 4 | `server/orchestrator/stageRunner.ts:254` + `modelSelect.ts` | The CODING agent literally spawns `claude` in the container PTY; model selection is Claude-only. Guarded by build-invariant 6 (PTY-billing). |

Remnants 1+2 are **already assigned to fix-round Agent 1, Batch 8 (F-017)** — the fix derives the allowlist from the catalog and validates on save. This plan starts where that fix ends.

## 3. Phases

### Fase 1 — Routing volwassen maken (small, high impact)

*Precondition: fix-round Agent 1 merged (touches the same files: `workspaceAssignments.ts`, `opCatalog.ts`, `workspace/page.tsx` AiBehaviorTab).*

1. **Workspace default backend + fallback chain.** New workspace setting `defaultAiProviderId`. Resolution order per feature: explicit per-feature override → workspace default → hardcoded feature default → *any available connected backend* (deterministic order), instead of failing. Surface which backend actually ran in the AI-activity record (already carried as `providerId` — show it in the Activity tab row).
2. **Per-feature model override.** The override store keeps only a providerId; the connection holds one picked model. Extend `__ai_provider_<feature>` to `providerId[:model]` (backwards-compatible parse) so e.g. `script → openai-api:gpt-4.1-mini` and `mr-review → openai-api:o4-mini` can differ.
3. **Honest availability in the picker.** AiBehaviorTab's per-feature dropdown lists all connections but should badge availability (reuse `aiProviderHealth` probe) and warn when routing at a disconnected backend.
4. **Type honesty.** Keep `AiProviderId = string` (open catalog), but export a `knownAiProviderIds()` helper from the catalog as the single validation source (no new hand-kept Sets anywhere).

**Verification:** unit tests for the resolution chain (override > ws-default > feature-default > any-available); e2e: connect only OpenAI, run script/interviewer/document-generate → all succeed on `openai-api`; Activity rows show the backend + model that ran.

### Fase 2 — Catalogus + modellen verbreden (data + one endpoint)

1. **More OpenAI-compatible hosts** (each = one catalog entry): xAI (Grok), Together, Fireworks, Cerebras. **OPEN VRAAG A:** Azure OpenAI needed? (Its URL scheme is per-deployment, needs a small transport tweak — only worth it if you'll use it.)
2. **Dynamic model listing.** `GET {baseUrl}/models` per connection (standard on the OpenAI shape), cached, with a refresh button in the connection form — so new models (GPT-5.x, "Luna", …) appear without a code change. Catalog lists stay the offline fallback; the "other" free-text hatch stays.
3. **Refresh the static model lists** while at it (they predate several releases).

**Verification:** connect OpenRouter → model dropdown shows the live catalog; type an unlisted model id → completion still runs.

### Fase 3 — Tweede coding-CLI: andere subscriptions voor de PIPELINE-agent (the big one)

> **✅ AFGEROND 2026-08-23 — anders dan hieronder gepland (ADR 0322).** De owner koos niet de Codex CLI maar de
> **pi coding agent** als tweede harness: seats = Claude + Codex (ChatGPT) only; Codex ⇒ pi geforceerd, Claude ⇒
> keuze Claude Code (default) of pi (extra-usage-waarschuwing). Gebouwd: `server/orchestrator/codingAgents/*`
> (adapter-seam), `docker/pi/workspaces.ts` (capture-extensie), `save-coding-agent` op + UI-sectie, `codex-cli`
> one-shot backend. Zie `CODING_AGENT_PROGRAM.md` voor het volledige ontwerp + fasen. De tekst hieronder is het
> historische plan.

Today the code-writing pipeline agent is hardwired to the interactive `claude` CLI in a node-pty (invariant 6 — subscription billing, never headless). Supporting e.g. **OpenAI Codex CLI** (ChatGPT subscription) or **Gemini CLI** as the coding agent means a per-CLI implementation, exactly as the catalog comment warns: session resume, structured-output capture, permissions/settings injection, container install + host sign-in.

1. **`CodingCliAdapter` seam.** Extract from `stageRunner.ts`/`claudeCli.ts` what is Claude-specific: binary + turn args (`--model`, resume flag), session-id capture, the stop/structured-capture hook mechanism (`claudeStopCapture.mjs`, `type:http` hooks), settings file the CLI reads at session start (per-stage permissions!), login/seat check. One adapter per CLI; `stageRunner` and `modelSelect` consume the adapter.
2. **Billing spike per CLI first (the P0.5 lesson).** Before building an adapter: a small gated spike proving the CLI in interactive PTY mode bills the subscription seat (not a metered API pool) and supports resume + hooks well enough for the stage loop. RED ⇒ escalate to owner, never silently fall back to headless/API.
3. **Adapter 1: OpenAI Codex CLI** (ChatGPT subscription). **Adapter 2 (later): Gemini CLI.** **OPEN VRAAG B:** volgorde/keuze — Codex CLI eerst?
4. **Per-stage coding-agent choice.** Pipeline stage config gets a coding-agent picker (default = workspace default), reusing the Fase-1 resolution chain. Container images must install the chosen CLIs; sign-in is a host/setup step (SetupWizard item).

> **Invariant-6 wijziging (user-gated):** this generalizes "the CODE-writing agent is always interactive `claude`" to "always an interactive **vendor CLI** in a PTY on a subscription seat — never headless, never a metered API". Needs the owner's explicit OK + an ADR + a CLAUDE.md edit before Fase 3 starts.

**Verification:** spike report per CLI (billing evidence); one full ticket run refine→implement on the new CLI with handover + structured channel intact; per-stage mixed run (stage A claude, stage B codex).

### Fase 4 — API-billed coding als expliciete opt-in (**OPEN VRAAG C**)

Allowing `pipeline-agent` on a metered API backend (e.g. GPT via API when no subscription exists) contradicts invariant 6's *reason* (billing protection), not its letter-for-non-coding. If wanted: hard per-workspace budget cap + explicit "metered coding" consent toggle + spend surfaced per run. Owner decides if this exists at all.

### Fase 5 — Multimodaal + media/embeddings-pariteit

1. Vision (`image-critique`) and audio (`speech-to-text`) currently assume Gemini. The OpenAI-compatible transport does text only; extend it with image/audio input parts so vision/STT can route to OpenAI (gpt-4o / whisper) and others.
2. Media generation (fal/elevenlabs/suno) and RAG embeddings live in their own registries with the same pattern — align their connection UX with the AI page (one "connected backends" mental model), including the F-001 store unification the fix-round already does for Gemini.

## 4. Sequencing tegen de fix-ronde

- **Nu:** nothing from this plan runs — Agent 1 owns the conflicting files (batches 3 + 8).
- **Na merge Agent 1:** Fase 1 + 2 can run (small; could even be one cheap-agent package with the same handoff format).
- **Fase 3** is its own program: spike → adapter → per-stage picker; start only after OPEN VRAAG B + the invariant-6 decision.

## BESLIST (owner, 2026-08-22 — ADR 0321)

- **A.** Azure OpenAI: **nee**, overslaan (pas bij concrete behoefte).
- **B.** Fase 3: **ja — OpenAI Codex CLI eerst**, Gemini CLI later. Invariant 6 generaliseert naar "interactieve vendor-CLI in PTY op subscription-seat"; CLAUDE.md-edit bij de start van Fase 3.
- **C.** Fase 4: **nee** — geen metered-API-coding, ook niet als opt-in. Fase 4 vervalt.
- **D.** Fase 1+2: **direct na merge van fix-ronde Agent 1**, als vierde handoff-pakket voor een goedkope agent.
