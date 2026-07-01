# 15 — Sources management

> The Sources screen: managing the workspace's **context docs** (generated / git / uploaded) and its **skills / MCP** (frozen vs live), plus reindex + upload. Extends [03_BUILD_PHASE](./03_BUILD_PHASE.md) (which seeds the initial `InfoDoc` set) and [04_INTEGRATION_TOOLS](./04_INTEGRATION_TOOLS.md) (the CLI-client-first / MCP-exception rule). Reindex drives the bullmq RAG delta-indexer in [07 §D]. Builds on the existing `Sources.tsx` screen.

This doc turns the existing dummy Sources screen into the real management surface for everything the stage-agents *read*: the loaded-whole **context docs** and the queried-on-demand **skills/MCP** (RAG, graphify, symbol-index, …). It documents the source-tint taxonomy, the detail overlays, the reindex banner + live progress (wired to the [07 §D] indexer job), the upload-spec sheet, and the read-only preview. The freezing semantics (frozen-per-commit) come straight from [07 §D] — this screen surfaces them, never restates them.

---

## Scope

**In**
- The **Context docs** tab: `InfoDoc` cards tinted by `source` — **generated** (orchestrator-produced), **git** (linked live, frozen @ hash), **uploaded** (user spec) — with the "branches not yet processed in this file" warning and a Preview / Regenerate / Details row.
- The **Skills / MCP** tab: `SkillEntry` rows showing **frozen-vs-live** kind, a **ready / stale / error** status, model, and **used-by-stages**, with a per-skill Reindex (frozen only) + on/off Toggle.
- **Detail overlays** (centered `menuHandler` modal) for a doc or a skill — the small-data view.
- The **reindex banner** ("RAG index is behind main by N commits") + **live progress** while a reindex runs → a **bullmq job** on the [07 §D] delta-indexer queue.
- The **upload-spec sheet**: drag-drop + name an uploaded doc; it lands with the **`uploaded`** tint.
- The **read-only preview** (right `Sheet`): the doc's `content` rendered as monospaced text.

**Out**
- *Authoring* the initial set / the GENERATE-vs-LINK split — that's [03_BUILD_PHASE](./03_BUILD_PHASE.md) (build phase seeds them; this screen manages them after).
- *Configuring* integration tools / env vars and binding them per-stage — that's [04_INTEGRATION_TOOLS](./04_INTEGRATION_TOOLS.md) + `WorkspaceSettings` + `Pipeline`. A skill row here is a read/toggle surface, not the tool editor.
- The indexer internals (chunking, embeddings, `$vectorSearch`, dedupe) — owned by [07 §D]; this screen only kicks it and shows progress.

**Deferred**
- **Editing** a generated doc's content inline (regen replaces it; manual edit is out for v1).
- Per-doc version history / diff-between-snapshots (the carry-over `commitHash` freezing is the v1 story).
- Bulk reindex-all-skills as one action (per-skill + the workspace banner cover v1).

---

## User flow

1. **Open Sources.** Two tabs (`Tabs`): **Context docs** (count) and **Skills / MCP** (count). A **`HealthBanner`** pins below the header when the live RAG snapshot is behind `main` ("RAG index is behind main by 3 commits. Open tickets stay frozen on their own commit; reindex to refresh the live snapshot.") with a **Reindex** button.
2. **Browse context docs.** Each `DocCard` shows the file name (mono), a **source tint** badge, `updated` + `note` (e.g. `frozen @ abc123` for git/generated, `spec` for uploaded), and — for generated/git docs — a **`pendingBranches`** warning ("DEV-1245, DEV-1249 not yet processed in this file"). Actions: **Preview** (opens the read-only sheet), **Regenerate** (generated/git only — kicks `ai:refresh-docs`), **Details**.
3. **Doc detail (overlay).** Details opens a small centered modal (`DocDetail` via `menuHandler.open`) with Summary, Source, Last updated + note, "Not yet processed" branches, and **Loaded by stages** chips (`usedByStages`). Little data → centered modal, not a big sidebar.
4. **Read-only preview (sheet).** Clicking a doc (or Preview) slides in the right `Sheet` with the doc's `content` in a `whitespace-pre-wrap` mono block. Read-only — a real editor is `08_CODEBASE_VIEWER` territory; this is text.
5. **Browse skills / MCP.** Each `SkillRow` shows an icon (tinted by on/off), the name, a **kind** badge (**frozen** = per-commit / **live**), the `status` string + model, **Details**, a **Reindex** (frozen skills only), and an on/off **`Toggle`**. Frozen skills (RAG, symbol-index, route-index) are pinned to a commit; live skills (graphify, git-history, test-runner, …) query in real time.
6. **Skill detail (overlay).** `SkillDetail` modal: What it does, Type (`Frozen per commit · <model>` / `Live`), Status, Last indexed, **Enabled by stages** chips.
7. **Reindex (banner or per-skill).** Either entry enqueues a **delta job** on the [07 §D] `ragDeltaQueue` (concurrency:1, leased). The banner / the touched skill rows flip to a **live progress** state ("indexing… N/M files" → `ready`); open tickets stay frozen on their own `commitHash` throughout ([07 §D], B-25). On failure the skill status reads **error** with the stderr one-liner.
8. **Upload a spec.** "Upload spec" opens the upload sheet: **drag-drop a file + name it**; it's stored as an `InfoDoc{source:'uploaded', note:'spec'}` and shows the **uploaded** tint. Uploaded docs have no Regenerate (they're user content, not orchestrator-produced).

**Desktop:** docs grid (`md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4`); skills two-column. The banner spans full width; preview is a right sheet; details are centered modals.

**Mobile:** single-column docs + skills; the banner wraps; the preview `Sheet` and `menuHandler` modals already render full-width/bottom on small screens (no parity work). The Details/Reindex secondary actions on a `SkillRow` are `hidden sm:inline` today — on mobile they live in the row's detail overlay.

```
┌ Sources                                  [ + Upload spec ] ┐
│ ⚠ RAG index is behind main by 3 commits.       [ Reindex ] │  ← HealthBanner → 07 §D job
├ [ Context docs · 5 ] [ Skills / MCP · 8 ] ─────────────────┤
│ ┌ project-summary  [generated] ┐ ┌ conventions   [git] ┐  │
│ │ updated 2h · frozen @ abc123 │ │ updated 1d · …      │  │
│ │ ⚠ DEV-1245, DEV-1249 not yet │ │                     │  │
│ │ 👁 Preview · Regenerate · Det.│ │ 👁 Preview · …       │  │
│ └──────────────────────────────┘ └─────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## Data

No new persisted model. The screen renders the existing **`InfoDoc`** (`{ id, name, source:'generated'|'git'|'uploaded', updated, note, summary, pendingBranches?, usedByStages?, content }`) and **`SkillEntry`** (`{ id, name, kind:'frozen'|'live', status, model?, on, description?, usedByStages?, lastIndexed? }`) from `_data/types.ts`. These mirror `InfoSource` (mode `context-doc` | `skill`) in DATAMODEL.

- **Source tint** (`generated` / `git` / `uploaded`) is the existing `SOURCE_TINT` map in `Sources.tsx`; an upload sets `source:'uploaded'`.
- **Skill kind** (`frozen` / `live`) is the existing `SkillEntry.kind`; **ready/stale/error** is the existing free-text `status` (e.g. `"12.4k chunks @ abc123 · healthy"`, `"indexing… 8/142"`, `"error: embed timeout"`) — a presentation of state, not a new enum field. The transient **live progress** during a reindex is derived UI state fed by the [07 §D] job's `ws-ai:*` progress events, not persisted.
- **`usedByStages`** chips are the existing field; they cross-reference the stage names that select this doc/skill (`PipelineStageCfg.sourceIds` / `skillKeys`).
- An uploaded doc's blob is **not** modeled in `types.ts` (server-only, like the build-phase note in [03]); the UI only ever sees the resulting `InfoDoc`.

**INDEX delta:** (none — reuses `InfoDoc`, `SkillEntry`; reindex progress is derived UI-only)

---

## Verbs / Events / Hooks

**No new verbs.**

- **`refresh_docs`** ([02 §2]) — Regenerate (a generated/git doc) and the banner/per-skill Reindex all run the allow-listed **`ai:refresh-docs`** command via this Assistant verb ([03 §2]). It is the registered `OrchestratorCommandRegistry` entry, never raw shell; the browser requests it, never the binary/args ([01 §8]).
- **`WorkspaceTrigger`** ([03 §1]) — auto re-snapshot on push is the opt-in `{ on:'stage.on_complete', action:'run-command', command:'ai:refresh-docs' }` rule (the recommended automation, [03] D20); otherwise staleness surfaces as the `HealthBanner` + a `maintenance` `WorkspaceSuggestion` ([02 §6]). No silent auto-regen by default.
- **The reindex job** is the [07 §D] **bullmq** delta-indexer: `ai:refresh-docs` enqueues onto `ragDeltaQueue` (concurrency:1, under the orchestrator Redis lease, G1). The screen subscribes to the job's progress over the workspace room ([01 §5]) — subscribe-first → snapshot → merge-on-seq (B-22) — so a backgrounded phone re-syncs progress on reconnect. The indexer does a **per-changed-file delta + importer propagation** (B-O3), not a full re-index, and is **append-only / frozen-per-commit** (B-25) so open tickets never shift.
- **Skill toggle** is a **config write** the Conductor executes (it flips the skill on the relevant `PipelineStageCfg`/workspace), gated by "edit pipeline/stages" RBAC — a control-API request, not a verb (B-23).
- **Hooks:** none new. Indexing runs in the orchestrator (deterministic), not inside a Claude session, so it needs no lifecycle hook.

---

## UI

**Reused (real names):**
- `Sources.tsx` — the whole screen: `TABS`, `SOURCE_TINT`, `HealthBanner`, `DocCard`, `SkillRow`, `DocDetail` / `SkillDetail` / `DetailHead` / `DetailRow` (centered overlays via `openDetail` → `menuHandler.open`), `StageChips`, and the right-side preview `Sheet`.
- Primitives + motion: `Tabs`, `Toggle`, `WsButton`, `EmptyState`, `Icon`, `Sheet`; `menuHandler.open` / `menuHandler.close`.
- Cross-screen: the `usedByStages` chips reference the stage names rendered in `Pipeline.tsx`'s Context & Skills tab (the inverse selection — `sourceIds` / `skillKeys`).

**New (small):**
- An **upload-spec sheet** — a drag-drop dropzone + a name field (reuse `Sheet` + `WsButton`), producing an `InfoDoc{source:'uploaded'}`. (Today "Upload spec" is a `WsButton` with no target; this wires it.)
- A **live-progress** affize on `HealthBanner` + on a reindexing `SkillRow` (a progress label / spinner state over the existing `status` string) — a state branch, not a new component.

**Mobile parity:** docs + skills collapse to single columns; the banner wraps; preview `Sheet` and detail modals are already full-width/centered on small screens. The secondary `SkillRow` actions (Details / Reindex) move into the detail overlay on mobile (they're `hidden sm:inline` on the row).

---

## Extends

- see [03_BUILD_PHASE](./03_BUILD_PHASE.md) — the build phase **seeds** the initial `InfoDoc` set (GENERATE → `generated`, LINK → `git` frozen @ hash) and is the GENERATE/LINK authoring surface; this screen **manages** them afterward. The `HealthBanner` is the same staleness surface [03] points at.
- see [04_INTEGRATION_TOOLS](./04_INTEGRATION_TOOLS.md) — **CLI-client-first**; a skill row's MCP transport is the documented exception used only where a CLI client can't (semantic **RAG**). The skill on/off here is the read/toggle face of the per-stage tool/skill binding [04] configures.
- "[07 §D] RAG delta-indexer + vector store" — Reindex enqueues the bullmq delta job (concurrency:1, leased); **append-only, frozen-per-commit** (B-25); per-changed-file delta + importer propagation (B-O3); self-hosted embeddings (B-18); `$vectorSearch` on Atlas Local (B-24). This screen surfaces, never restates, those mechanics.
- "[01 §5] Real-time multi-client" — reindex progress + doc updates fan out to the `workspace-<wsId>` room; a phone re-syncs on reconnect (B-22).
- "[02 §6] Suggestions / Notifications" — staleness → a `maintenance` `WorkspaceSuggestion`; reindex completion / failure → a `Notification`.
- **B-14 / B-15 / B-16** — the context-docs (generated/git/uploaded), frozen-per-commit context, and the loaded-whole vs queried-on-demand split that this screen presents.
- **B-18** — self-hosted code-embedding model (no code egress, no per-call cost) behind the RAG skill.
- **B-24 / B-25** — `$vectorSearch` on Atlas Local; append-only, frozen-per-commit RAG store.

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D74–D75)

1. **15.q1 — Upload formats → D74:** **md/txt/plain text only in v1.** Richer formats (pdf/docx with extraction) are deferred.
2. **15.q2 — Regenerate confirmation → D75:** **Fire immediately, no confirm.** It overwrites the committed `docs/luckystack/` file ([03] D21) but is reversible via git.
