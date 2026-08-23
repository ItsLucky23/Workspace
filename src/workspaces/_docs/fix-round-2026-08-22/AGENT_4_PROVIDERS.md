# Agent 4 — AI provider expansion, Fase 1+2 (routing, fallback, models)

You implement Fase 1 + 2 of `src/workspaces/_docs/AI_PROVIDER_EXPANSION_PLAN.md` (decided in ADR 0321). Work on branch `fix/audit-providers` (own worktree). Agents 2 and 3 are fixing audit findings in parallel on other files. Follow the phases strictly.

## Project context (30 seconds)

Workspaces is a self-hosted AI dev-orchestration + content platform on the LuckyStack framework. The AI layer: `server/ai/providers/catalog.ts` (9 backends, 3 transports), `server/ai/registry.ts` (`runAiCompletion(feature, req)` — the ONLY module features import), `server/ai/assignments.ts` (21 feature defaults), `server/ai/workspaceAssignments.ts` (per-feature override store `__ai_provider_<feature>`), `AiConnection` rows for per-workspace credentials, `src/workspaces/workspace/aiProviders.tsx` (the AI-page connections UI). Fix-round Agent 1 already widened the dispatch allowlist to the full catalog and added save-side validation (F-017) — READ THAT CODE FIRST; your work builds on it, do not redo it.

Read `CLAUDE.md` in the repo root first. All framework rules apply: `tryCatch` (never raw try/catch), i18n via `useTranslator`, Tailwind theme tokens only, no `as any`, `_api`/`_sync` function-injection, every user-initiated write is a control-API op through the Conductor (single-writer). After any new `_api`/`_sync` route: `npm run generateArtifacts` (regenerates the gitignored type maps), then `npm run scaffold:test <route>` + at least one happy-path test.

## Ground rules

1. **Surgical changes only** — every changed line traces to an item below.
2. **File ownership is hard.** Phase A: never edit `src/workspaces/workspace/page.tsx`, `Shell.tsx`, `MobileChrome.tsx`, `SearchPalette.tsx`, or anything under `content/marketing`, `content/studio`, `content/settings` (owned by Agent 3's Phase B). If an item genuinely needs one of those, skip and record it.
3. **Verify after every item:** `npm run lint && npm run build` clean; `npm run test:unit` before committing. Do not start the dev server yourself.
4. **New/changed ops:** every new op in the propose catalog gets a row in `tests/effectMatrix.mts` (covered or excluded:*), per the testing contract.
5. **Translations:** new i18n keys only at the END of the module's section, all four locale files, never reorder.
6. **Track progress in THIS file** (checkboxes + Result lines). Commit per item. Append a branch-log entry (`branch-logs/fix-audit-providers.md` + INDEX row).
7. If an item turns out already (partly) built — Agent 1's F-017 work overlaps the edges — verify, then mark "already-fixed" with what you found.

## Phase A — start now

- [x] **P4-1 · Workspace default backend + fallback chain.** New workspace-level setting `defaultAiProviderId` (EnvVar `__ai_provider__default` in the existing override store is fine — document the choice). Resolution order in `runAiCompletion`: explicit call-site override → per-feature workspace override → workspace default → feature default (`assignments.ts`) → first AVAILABLE connected backend (deterministic catalog order). A feature must no longer fail `ai.providerUnavailable` when ANY connected backend is available. Save-side: extend the existing `save-ai-provider` op (or a sibling) to accept the `_default` pseudo-feature, with validation. Unit-test the chain exhaustively (pure function preferred).
  - **Result:** DONE. Store choice: the workspace default lives in the EXISTING override store as pseudo-feature `_default` (EnvVar `__ai_provider__default`, `AI_DEFAULT_FEATURE` in `server/ai/workspaceAssignments.ts`) — one store, one op (`save-ai-provider` accepts `feature:'_default'`), one validation path; no schema migration. Resolution = pure `aiRouteCandidates()` in `server/ai/assignments.ts` (call-site → per-feature → ws default → feature default → every other catalog backend in catalog order, dedup by providerId); `runAiCompletion` walks the list and runs the FIRST available backend (`resolveAvailableRoute`) — `ai.providerUnavailable` only when nothing can serve. Snapshot `aiOverrides` now includes the `_default` row; `reassignmentFor` matches on the provider part. `_sync` route + client `saveAiProvider` + chatDispatch + op-catalog enum (`_default` added) all accept it. Tests: `tests/unit/aiRouteChain.test.mts` (65 asserts, chain exhaustive per feature) + a `_default`/model case in `saveAiProvider_server_v1.tests.ts` (DB-backed, not run here — runtimes not started). Committed together with P4-2 (same files, same seam).
- [x] **P4-2 · Per-feature model override.** The override store keeps only a providerId; extend the stored value to `providerId[:model]` (backwards-compatible: no colon = provider only, connection's picked model applies). Parse in `workspaceAssignments.ts`, thread the model through `runAiCompletion` → provider `complete()` (openai-compatible + anthropic transports accept a model today via connection; add a per-call override parameter). Validate model non-empty on save.
  - **Result:** DONE. Stored value is `providerId[:model]` — `parseAiOverride`/`formatAiOverride` (split at the FIRST colon, so `local-openai:llama3.1:8b` works; no colon = provider only). New `AiRoute {providerId, model?}` type; `AiProvider.complete(req, opts?: {model?})` — openai-compatible + anthropic transports prefer `opts.model` over the connection's model, claude-cli ignores it. Save side: optional `model` param on `save-ai-provider` (conductor, `_sync` clientInput, client `saveAiProvider(feature, providerId, model?)`, chatDispatch, op-catalog `model` string param); a SENT-but-blank model → `ai.modelRequired`. Ack/snapshot return `{feature, providerId, model?}` split (never the raw string). Not in scope: a model picker in the per-feature dropdown (that is `workspace/page.tsx` AiBehaviorTab → P4-7, Phase B).
- [ ] **P4-3 · One validation source.** Export `knownAiProviderIds()` from `server/ai/providers/catalog.ts` and make every place that validates a providerId (dispatch, `save-ai-provider`, op-catalog enum, connection ops) consume it. Delete any remaining hand-kept ID lists/Sets. (Agent 1 may have done most of this — verify and finish.)
  - **Result:** _(fill in)_
- [ ] **P4-4 · Dynamic model listing.** New `_api` route (e.g. `workspaces/aiModels_v1`): given a connectionId, call `GET {baseUrl}/models` on the OpenAI-compatible transport (and Anthropic's models endpoint for `anthropic`), tenant-scoped, key from the connection, 10-min in-memory cache, typed result `{ models: {id,label}[] }`. In `aiProviders.tsx`: the connection form's model dropdown loads the live list (fallback to the static catalog list on error) + a refresh button. Keep the free-text "other" escape hatch.
  - **Result:** _(fill in)_
- [ ] **P4-5 · More OpenAI-compatible hosts (data-only).** Add catalog entries: xAI (Grok, `https://api.x.ai/v1`), Together (`https://api.together.xyz/v1`), Fireworks (`https://api.fireworks.ai/inference/v1`), Cerebras (`https://api.cerebras.ai/v1`), each with 2-4 current models, keyUrl, and a `WS_*_BASE_URL` env override. NO Azure (decided). Verify each renders in the connections UI and validates.
  - **Result:** _(fill in)_
- [ ] **P4-6 · Refresh the static model lists** of the existing entries (OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral) to currently-shipping models; keep lists short (3-5) — the dynamic listing (P4-4) is the real source now.
  - **Result:** _(fill in)_

## Phase B — ONLY after Agent 3's Phase B is merged into main and you rebased

- [ ] **P4-7 · Honest availability in the per-feature picker.** In `workspace/page.tsx` AiBehaviorTab: badge each backend in the per-feature dropdown with availability (reuse the `aiProviderHealth` probe / connection state), warn when a feature is routed at a disconnected backend, and show which backend+model actually ran last (from the AI-activity data). Also surface the new workspace default (P4-1) as the first choice ("Default — <backend>").
  - **Result:** _(fill in)_

## Out-of-scope observations

_(note anything you saw but did not fix)_
