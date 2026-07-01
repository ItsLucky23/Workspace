# 01 — Workspace setup

> The onboarding / build wizard: from "name a workspace" to a live, indexed pipeline. Extends `[01 §2]` (two-system topology), `[01 §4]` (SessionManager / first worker spawn), `[02 §1]` (ticket lifecycle), `[05 P1]` (Foundations + the build phase), and hands off to `[03_BUILD_PHASE]` for the realize-the-preset step. It pulls in `[02_PIPELINE_PRESETS]` for the preset pick.

---

## Scope

**In**
- A multi-step wizard, launched from the topbar **Create workspace** entry (replacing the name-only `CreateWorkspaceForm` in `_shell/Shell.tsx`): **name + slug → GitLab connect → select project → preset pick OR copy-from-workspace → build phase → first index**. The slug is unique **per owner** (not global); each workspace owns exactly **one project**.
- GitLab connect with a live **Verify connection** check (✓/✗); the token is stored **per workspace** (B-07), encrypted on the `Workspace` entity. GitLab is the **source of truth** for board/issues (B-29).
- Preset selection (`Workspace.presetKey`, see `[02_PIPELINE_PRESETS]`) **or** **copy-from-workspace** — a deep-duplicate (**D9**) of skills/sources/tools/env from an existing workspace the user owns/admins.
- The **build phase** (delegated to `[03_BUILD_PHASE]`): the chosen preset is instantiated into editable `PipelineStageCfg[]` and the initial `InfoDoc` set is ingested (GENERATE vs LINK).
- **First index** progress with an ETA; the board is **usable while indexing** (skills come online as they finish).
- Failure + **resume** states for every async step (verify, project fetch, index), so a dropped connection (mobile, B-37) re-enters the wizard where it left off.

**Out**
- The mechanics of *how* a preset becomes a pipeline + how docs are generated/linked — that's `[03_BUILD_PHASE]`.
- The preset tier definitions themselves — `[02_PIPELINE_PRESETS]`.
- GitLab webhook reconciliation cron + bidirectional board sync — orchestrator phase (B-29; cited, not built here).
- Auth / SSH-key linking — that's the `A1/A2` login flow (DESIGN_BRIEF PART1 A), a prerequisite, not part of this wizard.

**Deferred**
- "Save current pipeline as a reusable template" (B-O4 — only the built-in presets in v1; cross-workspace template marketplace is later, see `[02_PIPELINE_PRESETS]`).
- Multi-instance / DR provisioning concerns → `[05 P4]` (D6).

---

## User flow

A 5-step wizard rendered in the `menuHandler` slide-in (desktop) / bottom-sheet (mobile). A step header shows progress (`Step 2 of 5`); each step has Back / Continue, and Continue is gated on that step's validity.

1. **Name & slug.** Text input for `Workspace.name`; `Workspace.slug` auto-derives (lowercased, `-`-joined) with an inline edit + a **per-owner** uniqueness check (two different users can each own a `my-app`). Continue enabled once `name` is non-empty and `slug` is unique within the owner's workspaces.
2. **Connect GitLab.** Inputs: `gitlabBaseUrl` (default `https://gitlab.com`) + a personal-access **token**. **Verify connection** button → calls GitLab as the workspace, shows a spinner then ✓ (green, "Connected as <namespace>") or ✗ (red, the API error). The token is held only to be persisted encrypted on the `Workspace` (B-07); never shown back in full. Continue gated on a ✓.
3. **Select project.** Once verified, fetch the namespace's repos and render a searchable, single-select list (reuse `Dropdown`). The chosen repo becomes the workspace's **one** `Project` with `gitUrl` (+ the existing `gitlabPath`) — **one project per workspace**, no project switcher. (The prototype seed's second project is legacy; the wizard stays single-project.) GitLab stays SoT (B-29) — labels/issues are cached, not authored here.
4. **Choose how to build.** Two cards:
   - **Start from a preset** → a `simple` / `advanced` / `professional` segmented pick (`[02_PIPELINE_PRESETS]`), with a one-line capability blurb per tier. Sets `Workspace.presetKey`.
   - **Copy from a workspace** → a dropdown of the user's other workspaces; on pick, the wizard shows a deep-duplicate summary ("12 skills, 5 sources, 2 integration tools, 4 env vars will be cloned — fully isolated") per **D9**. This path bypasses the preset pick (the source pipeline IS the starting config). The GitLab connection is **never** carried over — the cloned workspace always does a **fresh GitLab connect** (its own per-workspace token, B-07); the source's token is never reused.
5. **Build & first index.** Continue triggers the **build phase** (`[03_BUILD_PHASE]`): the preset (or the copied config) is realized into `PipelineStageCfg[]`, then per-source ingestion starts. This step renders the index progress (see below) and a **Open workspace** button that unlocks as soon as the GENERATE'd **project-summary** `InfoDoc` is `done` — RAG / code-graph / symbol-index keep indexing in the background. After unlock, **per-source progress chips** (one per source, `indexing` / `done`) stay visible on the board so the user knows not everything is loaded yet.

**First-index progress (step 5).** A progress bar with an ETA ("Indexing 4,210 / 12,400 files · ~3 min left") above per-source rows — one row per `InfoDoc` being produced (project-summary / db-schema GENERATE) and per skill being built (RAG / code-graph / symbol-index), each with its own status pill (`queued` → `indexing` → `done` / `error`). **Open workspace** unlocks the moment the **project-summary** GENERATE row hits `done`; everything else may still be `indexing`. A note: "You can use the board while indexing — skills light up as they finish." Empty → indexing → done states per row. After unlock, the same per-source `indexing`/`done` state surfaces as compact **progress chips** on the board (see below) so the still-loading sources stay visible.

**Failure & resume.** Each async step persists its progress so the wizard is re-enterable:
- Verify fails (✗) → stay on step 2, surface the error, let the user fix the token/URL and retry.
- Project fetch fails → retry button on step 3.
- An index source errors → its row shows `error` + a **Retry** action; the workspace is still usable (other skills online). A half-built workspace lands in a `building` state on the board with a banner "Finishing setup — retry the failed sources" deep-linking back into step 5.

**Mobile parity (~99%, B-37).** Identical steps as a stacked bottom-sheet; the project picker is a full-height searchable sheet (single-select); the index progress is a vertical list. The **Open workspace** affordance appears the moment the project-summary GENERATE is `done` so a phone user isn't blocked on the background indexing.

---

## Data

Additive fields on existing prototype types in `_data/types.ts` (the cohesion pass folds these into `04`; do **not** edit `04_DATA_MODEL.md`):

| Field / model | Type | Validation |
|---|---|---|
| `Workspace.presetKey` | `'simple' \| 'advanced' \| 'professional'` | required when not copying from another workspace; set in step 4 |
| `Project.gitUrl` | `string` | required; a valid http(s)/ssh git URL; alongside existing `Project.gitlabPath` |
| `Project.linkedFiles` | `{ path: string; role: 'generate' \| 'link' }[]` | `path` repo-relative + non-empty; `role` enum. GENERATE = orchestrator-owned (`AI_*` docs, skills); LINK = read live from the repo. Deep-duplicated on copy (D9). |

Notes:
- The encrypted GitLab token is a **server-only** field on `Workspace` (B-07) — omitted from the prototype types per the `04 §1` "prototype omits server-only fields" rule; the wizard only handles it transiently in step 2.
- `Project.linkedFiles` is owned here but *consumed* by `[03_BUILD_PHASE]` (it drives the GENERATE-vs-LINK ingestion). It is declared in this doc because setup is where projects are created.
- Copy-from-workspace (D9) is a pure clone operation over existing per-workspace data (`SkillEntry`/`InfoDoc`/`IntegrationTool`/`EnvVar`/`PipelineStageCfg`) + the two fields above — no new shape beyond them.

**INDEX delta:** `Workspace.presetKey`, `Project.gitUrl`, `Project.linkedFiles`

---

## Verbs / Events / Hooks

**No new verbs.** Setup is deterministic provisioning done by the **Conductor** (`[01 §3.3]` — the only writer), not an LLM action, so it touches no Stage-Agent/Assistant verb.

- The first **worker** spawn after build uses the standard SessionManager path (`[01 §4]` `spawnWorker`), no setup-specific verb.
- First-index runs as the existing allow-listed `run-command` (`OrchestratorCommandRegistry`, `[03 §1.5]` / `[03 §2]` `ai:refresh-docs`-style indexer) — config, not a verb.
- No `WorkspaceTrigger` is authored by the wizard itself; presets may seed lifecycle triggers, but that is `[02_PIPELINE_PRESETS]` / `[03_BUILD_PHASE]` territory.

---

## UI

**Reused**
- `menuHandler` slide-in / bottom-sheet shell (the existing overlay model).
- `Dropdown` (single-select project pick, copy-source workspace pick, base-URL preset).
- `WsButton`, `IconButton`, `Segmented` (preset tier pick), `Toggle`, `InfoDot` from `_components/primitives`.
- The topbar **Create workspace** entry + workspace switcher in `_shell/Shell.tsx` (`TopBar`) — the launcher; `CreateWorkspaceForm` is replaced by this wizard.

**New (small)**
- `SetupWizard` (the multi-step container; owns step state + Back/Continue gating).
- A lightweight **Steps** header + a **ProgressBar** row component for the index step (no such primitive exists yet in `_components/primitives.tsx`) — kept generic for reuse by the Sources reindex view.
- A `VerifyBadge` (✓/✗/spinner) for the GitLab connect step.
- **Background-index chips** — after **Open workspace** unlocks, a compact per-source chip row (`indexing` / `done`) shown on the board so the user can see RAG / code-graph / symbol-index are still completing. Reuses the per-source status state from the step-5 progress rows.

**Mobile parity.** Every step renders as a bottom-sheet; the progress + per-source rows stack vertically; **Open workspace** is reachable mid-index.

---

## Extends

- `[01 §2]` two-system topology — the wizard provisions data the **orchestrator** later picks up; the web-app step is stateless CRUD.
- `[01 §3.3]` Conductor is the only writer — setup writes (`Workspace`/`Project`/cloned config) are Conductor/deterministic, not LLM.
- `[01 §4]` SessionManager `spawnWorker` — the first ticket activation after build uses this path unchanged.
- `[02 §1]` ticket lifecycle — `aiEnabled=false` first stage parks new tickets at `idle`; the board is immediately usable while indexing completes.
- `[05 P1]` Foundations — setup is the front door to the P1 skeleton; the build phase is the realize step.
- `[03_BUILD_PHASE]` — step 5 hands off to it (realize preset + GENERATE/LINK ingestion).
- `[02_PIPELINE_PRESETS]` — step 4 consumes it (`Workspace.presetKey`).
- B-07 (token per workspace), B-29 (GitLab = SoT), B-O4 (one editable default pipeline, clone later), B-37 (mobile parity), D9 (deep-duplicate copy).

---

## Resolved

1. **Slug uniqueness scope** — **per-owner**, not global. Two different users can each own a `my-app`; the step-1 check only validates uniqueness within the owner's own workspaces.
2. **Multiple projects per workspace** — **one project per workspace**, no project switcher. The wizard stays single-project; the prototype seed's second project (`youcomm-api`) is legacy.
3. **Copy-from-workspace + GitLab** — **fresh GitLab connect** always. The cloned workspace gets its own per-workspace token (B-07); the source's connection/token is never reused.
4. **Partial-index usability threshold** — **Open workspace** unlocks when the GENERATE'd **project-summary** `InfoDoc` is `done`; RAG / code-graph / symbol-index keep indexing in the background. After unlock, a visible "still indexing in the background" indicator — per-source progress chips (`indexing` / `done`) — stays on the board so the user knows not everything is loaded yet.
