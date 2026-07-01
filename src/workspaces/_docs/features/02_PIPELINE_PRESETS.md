# 02 — Pipeline presets

> The 3/5/7 capability-differentiated preset tiers + the layered default-system-prompt resolution + copy-from-workspace. Extends `[03 §3] AgentRole` (the role supplies base defaults + the `systemPromptTemplate`), `[03 §6]` (stable code vs per-workspace data), and `[04 §3]` (`roleKey` on `PipelineStageCfg`). Consumed by `[01_WORKSPACE_SETUP]` (step 4 sets `Workspace.presetKey`).

---

## Scope

**In**
- Three capability-differentiated **preset tiers** (**D1**): `simple` (3 stages), `advanced` (5), `professional` (7). Each is a **code fixture** (`WorkspacePreset`) — not a DB row (`[03 §6]`: capabilities are code, per-workspace state is data).
- A preset **instantiates editable `PipelineStageCfg[]`** on workspace-create. Tiers differ both in their **stage list** AND in **per-stage model / effort / skills** (and prompt — see below).
- The **layered default system prompt** (**D2**) and its **resolution order**: `AgentRole.systemPromptTemplate` (base) → preset per-stage override → user per-stage edit, surfacing as `PipelineStageCfg.systemPrompt`.
- **Copy-from-workspace** (**D9**) = deep-duplicate of skills/sources/tools/env for full isolation (the alternative to picking a preset in `[01_WORKSPACE_SETUP]` step 4).

**Out**
- The wizard UI that picks a preset — `[01_WORKSPACE_SETUP]`.
- How a chosen preset is *realized* into a running pipeline + doc ingestion — `[03_BUILD_PHASE]`.
- The full per-stage config editor (the existing `Pipeline.tsx` tabs) — unchanged; presets just seed it.

**Deferred**
- **Save-as-template** — saving a user's edited pipeline as a reusable preset is **deferred** (B-O4: v1 ships only the built-in presets + clone-an-existing-workspace; user templates / a marketplace come later, B-38).

---

## User flow

Preset choice happens inside the setup wizard (`[01_WORKSPACE_SETUP]` step 4), then the per-stage config is editable forever after in the Pipeline editor.

1. **Pick a tier.** A `Segmented` control: **Simple · Advanced · Professional**, each with a one-line capability blurb and a stage-count chip. A small expandable shows the stage list + the headline per-stage model (e.g. "Coding: Opus / high · dual review").
2. **Instantiate.** On Continue, the chosen `WorkspacePreset` fixture is expanded into `PipelineStageCfg[]` (one per stage), each stage's `systemPrompt` resolved (see resolution order), and `Workspace.presetKey` recorded. `[03_BUILD_PHASE]` realizes them.
3. **Edit anytime.** In `Pipeline.tsx`, every instantiated stage is fully editable (model/effort/skills/commands/network/hooks/carry-over) exactly as today — the preset only set the starting values. A per-stage **System prompt** field (new, in the General tab next to Custom instructions) shows the resolved base + lets the user override it; an InfoDot explains the layering.

**Resolution order (D2 — document this explicitly).** For each stage, `PipelineStageCfg.systemPrompt` is resolved as a 3-layer fallback at instantiation, then frozen as editable config:
```
1. AgentRole.systemPromptTemplate   (base — per roleKey, code, [03 §3.2])
        ▼ overridden by
2. preset per-stage override         (the WorkspacePreset fixture — code, per tier+stage)
        ▼ overridden by
3. user per-stage edit               (PipelineStageCfg.systemPrompt — data, per workspace)
```
Layers 1–2 are **code fixtures**; only layer 3 is per-workspace data. The instantiation flattens 1→2 into the initial `systemPrompt`; a user edit (layer 3) replaces it. This is distinct from the existing `customInstructions` (loaded into the stage's `CLAUDE.md` — domain rules) and `promptTemplate` (the carry-over template with `{{chips}}`): `systemPrompt` is the **session system prompt** (the appended persona/contract), the other two are the per-turn task framing.

**Tier definitions (D1).** Stage list + the differentiating per-stage config:

| Tier | `presetKey` | Stages | Per-stage model / effort | Skills & extras |
|---|---|---|---|---|
| **Simple** | `simple` | 3: **Refine → Code → Review** | Sonnet / medium throughout | RAG only on Refine/Code; no code-graph; single review |
| **Advanced** | `advanced` | 5: **Refine → Plan → Code → Test → Review** | Plan Opus/high; Code Sonnet/high; others Sonnet/medium | + symbol-index; RAG on Refine/Plan/Code; single review |
| **Professional** | `professional` | 7: **Refinement → Planning → Coding → Reviewer 1 → Reviewer 2 → Test → Final** | Planning + both Reviewers Opus/high; Coding Sonnet/high; Refinement/Test Sonnet/medium; Final Haiku/low | + code-graph (graphify) + RAG + symbol-index on the heavy stages; **dual review** (Reviewer 1 + Reviewer 2 are two distinct `code`-role stages with different review prompts) |

The 7-stage `professional` tier matches the existing `STAGE_CONFIGS` shape (which already encodes Opus/high on Plan + Review, Sonnet/high on Implementatie, Haiku on Final), kept as the one `professional` preset in `_data/presets.ts` — it is the B-O4 "one 7-stage default" generalized into the top tier. `simple`/`advanced` are the down-tiered subsets. Containers attach only to code roles (`AgentRole.needsWorkspace`, `[01 §3.1]`); Refine/Plan stay lightweight host-side reasoning sessions.

**Copy-from-workspace (D9).** When the wizard's step 4 chooses **Copy from a workspace** instead of a tier, no preset fixture is expanded: the source workspace's `PipelineStageCfg[]`, `SkillEntry[]`, `InfoDoc[]`, `IntegrationTool[]`, and `EnvVar[]` are **deep-duplicated** into the new workspace (full isolation — edits to the clone never touch the source). `Workspace.presetKey` is copied from the source for provenance.

**Mobile parity.** Tier pick = a stacked card list with the same blurbs; the per-stage `systemPrompt` editor reuses the existing Pipeline-editor mobile layout (textarea + chips), no new mobile-only surface.

---

## Data

Additive (cohesion pass folds into `04`; do **not** edit `04_DATA_MODEL.md`):

| Field / model | Type | Validation |
|---|---|---|
| `Workspace.presetKey` | `'simple' \| 'advanced' \| 'professional'` | set at create (`[01_WORKSPACE_SETUP]`); copied from source on D9 clone. *(Also declared by 01 — same field; this doc defines its enum + semantics.)* |
| `WorkspacePreset` | **code fixture** (registry, not a DB row) | `{ key: presetKey; label; description; stages: PresetStageFixture[] }` where each `PresetStageFixture` = `{ id; name; roleKey; order; modelCfg; skillKeys; sourceIds; systemPromptOverride? }`. Fixtures live in a dedicated `_data/presets.ts` (the existing `STAGE_CONFIGS` is kept as the one `professional` preset there); instantiates `PipelineStageCfg[]` on create. |
| `PipelineStageCfg.systemPrompt` | `string` | the resolved per-stage system prompt (D2 layer 3). Distinct from existing `customInstructions` + `promptTemplate` (which already exist on `PipelineStageCfg`). May be empty (falls back to the resolved base at render time). |

Notes:
- `WorkspacePreset` is **code, not data** (`[03 §6]` stable-waist rule) — adding a tier is a code edit, never a migration.
- This doc relies on `roleKey` already being on `PipelineStageCfg` (`[04 §3]`, defaults `'code'`); presets set it per stage (all `code` in v1 tiers). The `AgentRole.systemPromptTemplate` it layers on is already defined in `[03 §3.2]` — not reintroduced here.

**INDEX delta:** `Workspace.presetKey`, `WorkspacePreset`, `PipelineStageCfg.systemPrompt`

---

## Verbs / Events / Hooks

**No new verbs.** Presets are pure config fixtures expanded at create-time by the deterministic Conductor (`[01 §3.3]`).

- Instantiating a preset = writing `PipelineStageCfg[]` rows — a Conductor write, no LLM, no verb.
- A user later asking their Assistant to *suggest* a preset/stage change uses the **existing** `read_pipeline` verb → `config-review` `WorkspaceSuggestion` (`[03 §4]`), accepted by an RBAC-gated user, executed by the Conductor — unchanged.
- Copy-from-workspace (D9) is a deterministic deep-clone, not a verb.
- No `WorkspaceTrigger` introduced; if a tier wants auto-advance (e.g. `professional` Reviewer 1 → Reviewer 2), that is an existing `stage.on_approval → start-stage` trigger seeded as data (`[03 §1.2]`), not a new mechanism. Dual review carries over **serially**: Reviewer 1 emits a full carry-over envelope that is injected into Reviewer 2's session (no `query_context` hop) — see Resolved q2.

---

## UI

**Reused**
- `Segmented` (tier pick) + `WsButton` / `InfoDot` from `_components/primitives`.
- `Dropdown` (copy-source workspace pick) — shared with `[01_WORKSPACE_SETUP]`.
- The entire existing `Pipeline.tsx` editor — presets only seed its state; the new per-stage **System prompt** field slots into the existing `GeneralTab` (next to `Custom instructions`, using the same `areaCls` textarea + `FieldLabel`).

**New (small)**
- `PresetPicker` (the tier `Segmented` + per-tier blurb/stage-preview card) — used inside the setup wizard.
- One added field block in `GeneralTab` for `systemPrompt` (resolved-base hint + override textarea + a layering InfoDot). No new screen.

**Mobile parity.** `PresetPicker` collapses to stacked cards; the `systemPrompt` field inherits the Pipeline editor's existing mobile layout.

---

## Extends

- `[03 §3] AgentRole` — "The role supplies defaults + contracts; per-stage config still overrides them." Presets sit between the role base and the user edit (D2 layer 2).
- `[03 §3.2]` `AgentRole.systemPromptTemplate` — the base layer of the D2 resolution.
- `[03 §6]` stable code vs per-workspace data — `WorkspacePreset` is code (a registry/fixture), `PipelineStageCfg[]` is the instantiated per-workspace data; "Adding capabilities = a registry registration."
- `[04 §3]` `roleKey: string` (default `'code'`) on `PipelineStageCfg` — presets set it per stage.
- `[04 §1]` "Project & pipeline" — presets produce the same `PipelineStageCfg` (+ children) the prototype already models.
- `[01 §3.1]` Stage-Agent `needsWorkspace` — only code stages get containers; tiers keep Refine/Plan lightweight.
- B-O4 (one editable default, clone later; save-as-template deferred), D1 (3/5/7 tiers), D2 (layered prompts), D9 (deep-duplicate copy).

---

## Resolved

1. **Where does `WorkspacePreset` live in code** — a dedicated **`_data/presets.ts`**. `WorkspacePreset` fixtures live there; the existing `STAGE_CONFIGS` is kept as the one `professional` preset within that file.
2. **Dual-review carry-over (professional)** — **serial full carry-over envelopes**. Reviewer 1 emits a full envelope that is **injected into Reviewer 2** (Reviewer1 → Reviewer2); no `query_context` hop.
3. **`systemPrompt` vs `customInstructions` boundary** — **keep both distinct**. `systemPrompt` = the appended session system prompt (`--append-system-prompt`); `customInstructions` = the stage `CLAUDE.md` (domain rules). Do not collapse them into one field.
4. **Tier editability** — **fully editable post-instantiation**: users can freely add/remove stages. `Workspace.presetKey` is **provenance-only** (the seed, not a lock).
