# Branch log — `fix/audit-providers`

> Agent 4 van de fix-ronde 2026-08-22: AI-provider-expansie Fase 1+2 (`AI_PROVIDER_EXPANSION_PLAN.md`,
> ADR 0321). Voortgangsadministratie (per item checkbox + Result-regel):
> `src/workspaces/_docs/fix-round-2026-08-22/AGENT_4_PROVIDERS.md`.

## 2026-08-23 — Phase A compleet (P4-1 t/m P4-6), 5 commits

**User prompt:** lees `AGENT_4_PROVIDERS.md`, voer alleen Phase A uit (P4-1…P4-6), vink af + Result-regels,
commit per item, Phase B NIET starten.

**Wat ik deed (5 commits, elk lint/build/ai:lint/unit-groen):**

| Commit | Item | Kern |
|---|---|---|
| `8db463d` | P4-1 + P4-2 | Pure `aiRouteCandidates()` (call-site → per-feature → ws-default `_default` → feature-default → catalogus-volgorde); `runAiCompletion` draait de EERSTE beschikbare backend. Override-waarde `providerId[:model]` (split op eerste `:`), `AiRoute`-type, `complete(req, {model?})` door openai-compatible + anthropic. `save-ai-provider` accepteert `_default` + optioneel `model` (blanco → `ai.modelRequired`). |
| `e73ed9c` | P4-3 | `catalog.knownAiProviderIds()` + `isKnownAiProviderId` = enige validatiebron (dispatch, save-op, op-enum, `addConnection`); lokale Set weg. |
| `075bebf` | P4-4 | `server/ai/modelListing.ts` (GET `/models`, OpenAI + Anthropic-shape, 10-min cache) + route `workspaces/aiModels_v1` (tenant-scoped, `workspaceSettings`) + live dropdown/refresh in `aiProviders.tsx` (via bestaande keyed connection; statisch = fallback). 5 i18n-keys ×4 locales. |
| `ea3a33d` | P4-5 | Catalogus: `xai-api`, `together-api`, `fireworks-api`, `cerebras-api` (geen Azure). |
| (deze) | P4-6 | Statische modellijsten OpenAI/Gemini/OpenRouter/Groq/DeepSeek/Mistral ververst (3-5 per host). |

**Tests:** nieuw `tests/unit/aiRouteChain.test.mts` (65), `tests/unit/aiModelListing.test.mts` (14); uitgebreid
`aiProviderAllowlist` (47), `aiProviders` (124); per-route `aiModels_v1.tests.ts` (3, DB) + extra case in
`saveAiProvider_server_v1.tests.ts` (DB) — DB-tests niet gedraaid (runtimes niet gestart). Unit-suite 130/130.

**Files touched (code):** `server/ai/{assignments,registry,types,workspaceAssignments,connections,opCatalog,modelListing}.ts`,
`server/ai/providers/{catalog,openaiCompatible,anthropicApi}.ts`, `server/orchestrator/conductor.ts`,
`server/read/{mappers,workspaceSnapshot}.ts`, `src/workspaces/_api/aiModels_v1(.tests).ts`,
`src/workspaces/_sync/saveAiProvider_server_v1(.tests).ts`, `src/workspaces/_shell/{WorkspacesProvider,WorkspacesContext}.tsx`,
`src/workspaces/_functions/chatDispatch.ts`, `src/workspaces/workspace/aiProviders.tsx`, `src/_locales/*.json`.

**Notes / open:** Phase B (P4-7, `workspace/page.tsx`) wacht op Agent 3's Phase B-merge + rebase. Out-of-scope-
observaties (multimodaal-fallback naar tekst-only backend, Anthropic-lijst, pre-existing tsc-fouten) staan in
`AGENT_4_PROVIDERS.md`. Geen nieuwe ops → geen effect-matrix-wijziging.

## 2026-08-23 — Phase B: P4-7 honest availability in the per-feature picker (1 commit)

**User prompt:** branch is bijgewerkt met main; voer Phase B (alleen P4-7) uit, afvinken + Result, commit.

**Wat ik deed:** `workspace/page.tsx` AiBehaviorTab-routing herschreven: beschikbaarheids-dot per backend
(probe `aiProviderHealth_v1`, fallback = connection-state), "Default — <backend>" als eerste keuze (lost op naar
ws-default → ingebouwde feature-default, via nieuw snapshot-veld `aiFeatureDefaults`), waarschuwing bij routing
naar een onbeschikbare backend, "Laatst gedraaid op <backend> · <model> · <tijd>" uit `aiRuns` (`AiRun.model`
toegevoegd: `server/ai/activity.ts` + registry + snapshot + client-type), nieuwe rij "Workspace default backend"
(`saveAiProvider('_default', …)`), pinned-model-regel. 11 i18n-keys ×4 locales.

**Files touched:** `src/workspaces/workspace/page.tsx`, `server/ai/{activity,registry}.ts`,
`server/read/workspaceSnapshot.ts`, `src/workspaces/_shell/{WorkspacesProvider,WorkspacesContext}.tsx`,
`src/workspaces/_data/types.ts`, `src/_locales/*.json`, `AGENT_4_PROVIDERS.md`.

**Verificatie:** lint/build/ai:lint schoon, tsc schoon voor de aangeraakte files, unit 130/130. Niet in de
browser gezien (geen dev-server). Agent 4 hiermee volledig klaar (Phase A + B).
