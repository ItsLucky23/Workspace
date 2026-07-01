# 03 — Build phase: link the repo & seed the doc set

> The post-setup "build a workspace" step that turns a linked git repo into the initial `InfoDoc` set the Assistant uses to author the pipeline. Extends [01 §2] (two-system topology), [01 §5] (real-time multi-client), [02 §2] (`query_context`), [03 §2] (refresh-docs path), [03 §4] (pipeline-authoring). Reads from the INDEX (D9 GENERATE/LINK, the no-new-verbs contract).

This is the hand-off target of `01_WORKSPACE_SETUP.md`: setup picks the preset tier (`02_PIPELINE_PRESETS.md`) and links a repo; **this** doc says what happens once the URL is in — clone, render the tree, choose per file whether the orchestrator **GENERATEs** a doc or **LINKs** the live repo file, snapshot RAG at the commit, and feed the resulting context-docs to the Assistant so it can **author** the pipeline (03 §4).

---

## Scope

**In**
- Linking the git project: `Project.gitUrl` (alongside the existing `Project.gitlabPath`), auth handshake, shallow clone into a scratch worktree, error surfacing.
- Rendering the repo tree (read-only) and letting the user mark each path as **GENERATE** or **LINK** → `Project.linkedFiles[]{path, role}`. The Assistant **proposes** the split; the user confirms (sensible fallback defaults if it doesn't).
- The **RAG snapshot @ commitHash**: freezing the index at the cloned `commitHash` (the same commit-hash binding used per-ticket, DH5) so the seeded docs and later tickets share one baseline.
- Producing the initial `InfoDoc` set: GENERATE entries become `InfoDoc{source:'generated'}`, LINK entries become `InfoDoc{source:'git'}` with `note:"frozen @ <hash>"`. GENERATE'd docs are **committed into the repo** at `Project.generatedDocsPath` (default `docs/luckystack/`), so the build phase needs git **write/commit** access (not read-only).
- Injecting that `InfoDoc` set as **context-docs** the Assistant loads, then authoring the pipeline from them (03 §4 — `read_pipeline` + `propose_suggestion`/`config-review` patch → user accepts → Conductor applies).

**Out**
- The credential-decrypt / scoped-token plumbing for the clone (orchestrator phase, [01 §8]); here it is the same encrypted-token-on-the-row pattern GitLab already uses (`gitlabTokenEnc`, DATAMODEL §1).
- Authoring the integration tools themselves — that is `04_INTEGRATION_TOOLS.md`.
- The actual VSCode-like file viewer (`08_CODEBASE_VIEWER.md`, UI-Builder, **D3** — external, provided later). The tree here is a lightweight checkbox picker, not the editor.

**Deferred**
- Multi-repo projects (one `Project` = one `gitUrl` in v1).
- Auto re-running GENERATE on every push by default — staleness is surfaced as a `maintenance` suggestion ([03 §2] entry-point d). Re-snapshot-on-push is available as an **opt-in** `stage.on_complete → ai:refresh-docs` `WorkspaceTrigger` (the recommended automation); no silent auto-regen elsewhere.

---

## User flow

1. **From setup → build.** Right after the workspace is created with its preset, the build screen opens on the just-linked `Project`. If no repo is linked yet, a **"Link git project"** field takes the URL → writes `Project.gitUrl`.
2. **Auth + clone.** The orchestrator clones with the per-workspace token (same encrypted-token path as GitLab, [01 §8]). A progress strip shows `Authenticating → Cloning → Indexing`. On success it captures the `commitHash` (HEAD of the default branch) and freezes it as the snapshot baseline (DH5).
3. **Tree + per-file role.** The cloned tree renders as a collapsible checkbox list. Each selected path gets a two-way toggle: **GENERATE** (the Assistant authors a doc/file from project context — e.g. `AI_PROJECT_SUMMARY.md`, conventions) vs **LINK** (a stage-agent reads the existing repo file live as a context-doc — e.g. an existing `README.md`, `db-schema.prisma`, a hand-written spec). Sensible defaults are pre-checked (existing `CLAUDE.md`/`README`/spec files default to LINK; "summary/conventions/glossary" slots default to GENERATE).
4. **Confirm → seed.** "Build sources" writes `Project.linkedFiles[]`, then the Conductor (the only writer, [01 §5]) materializes the `InfoDoc` rows: GENERATE rows are produced via the allow-listed doc command ([03 §2]) and **committed into the repo** under `Project.generatedDocsPath` (default `docs/luckystack/`) — the build-phase git clone is **write-capable**, not read-only; LINK rows are stamped `frozen @ <hash>`. RAG indexes the snapshot at that commit.
5. **Assistant authors the pipeline.** The seeded `InfoDoc` set is attached as context-docs to the user's Assistant. The user asks "set up the pipeline for this repo" → the Assistant calls `read_pipeline` + `query_context` over the docs, then `propose_suggestion({type:'config-review', patch})` (03 §4). The user **accepts**; the Conductor applies the patch to `PipelineStageCfg[]`. AI proposes, user accepts, Conductor executes — never a direct write (B-23).
6. **Result.** The `Sources` screen now shows the new docs (generated = primary tint, git = muted); the `Pipeline` editor's **Context & Skills** tab lists them as selectable `sourceIds`.

### Error paths
The progress strip is the single place errors land — each is a deterministic Conductor result, surfaced as a banner + a `container-failure`/`maintenance` notification, never a silent hang:

| Failure | Symptom | Surface → recovery |
|---|---|---|
| **Auth** | token rejected / SSH key not authorized | `Authenticating ✗` banner: "git auth failed — check the workspace token" → links to `WorkspaceSettings` GitLab/token tab; clone never starts. |
| **Clone** | repo not found, network/egress blocked, default branch missing | `Cloning ✗` with the git stderr one-liner; **Retry** re-runs the same fixed clone action. The egress allow-list applies ([01 §8]) — a blocked host reads as a clone failure, not a silent stall. |
| **Large repo** | clone/index exceeds the size/time guard | `Indexing` pauses at a soft cap with "repo is large — indexing the snapshot in the background"; the picker still opens (tree is available pre-index), GENERATE waits on the RAG snapshot and shows `frozen @ <hash> · indexing` until it completes. The tree is **`.gitignore`-aware** — it skips junk (`node_modules`/build/`dist`/`.git`) by default and **lazy-loads** child nodes rather than rendering the whole tree up front. |
| **No commit** | empty repo / detached HEAD | "no commit to snapshot — push an initial commit first"; `linkedFiles` can still be drafted but `Build sources` is disabled until a `commitHash` exists. |

**Desktop:** two-pane — tree on the left, a live per-file GENERATE/LINK summary on the right; the progress strip pins to the header.
**Mobile (~99% parity, B-37):** the tree becomes a single scrolling list; each row carries an inline GENERATE/LINK segmented control. Cloning/indexing runs server-side, so a backgrounded phone just re-syncs progress on reconnect ([01 §5] catch-up). Heavy authoring ("set up the pipeline") is driven through the Assistant chat, exactly the phone-from-the-beach path.

```
┌ Build: youcomm/app ─────────────────────────────┐
│ ● Authenticating  ● Cloning  ◐ Indexing @ a1b2c3 │
├──────────────────────┬──────────────────────────┤
│ ▾ src/               │  12 files selected        │
│   ▾ _functions/      │  GENERATE  3 (summary,…)  │
│     translator.ts ☐  │  LINK      9 (README,…)   │
│   CLAUDE.md  [LINK]✓  │                           │
│ db/schema.prisma[LNK]│  [ Build sources ]        │
│ README.md  [GENERATE]│                           │
└──────────────────────┴──────────────────────────┘
```

---

## Data

Additive to `Project` (prototype `types.ts`; the real Prisma `Project`, DATAMODEL §2, gains the same):

| Field | Type | Validation |
|---|---|---|
| `Project.gitUrl` | `string` | non-empty; `https://`/`ssh://`/`git@` form; sits alongside the existing `gitlabPath`. The token reuses the encrypted-on-the-row pattern (`gitlabTokenEnc`), not stored here. |
| `Project.linkedFiles[]` | `{ path: string; role: 'generate' \| 'link' }[]` | unique `path` per entry; `path` is repo-relative POSIX; `role` ∈ `generate`/`link`. Empty array = nothing seeded yet. |
| `Project.generatedDocsPath` | `string` | repo-relative POSIX dir where GENERATE'd docs are committed; defaults to `docs/luckystack/`. |

No new `InfoDoc` shape: a LINK entry maps to the existing `InfoDoc{source:'git', note:'frozen @ <hash>'}`, a GENERATE entry to `InfoDoc{source:'generated'}` — both already in `types.ts`. The `commitHash` is the existing per-ticket/per-snapshot hash (DH5); not re-introduced.

**INDEX delta:** `Project.gitUrl`, `Project.linkedFiles[]{path,role}`, `Project.generatedDocsPath`

---

## Verbs / Events / Hooks

**No new verbs.** The build phase uses only:
- **Assistant verbs** ([02 §2]): `read_pipeline` (read the stage config + catalogs to author against), `query_context` (pull the seeded docs / repo facts on demand while authoring), `propose_suggestion` (emit the `config-review` patch — 03 §4), `refresh_docs` (kick the GENERATE/re-index path).
- **`run-command` allow-list** ([03 §2]): GENERATE + the RAG snapshot are the registered `ai:refresh-docs` command (`OrchestratorCommandRegistry`), never raw shell. The clone itself is a fixed orchestrator action behind that same allow-list — the browser requests it, never chooses the binary/args ([01 §8]).
- **`WorkspaceTrigger`** ([03 §1]): the recommended opt-in re-snapshot automation is `{ on:'stage.on_complete', action:'run-command', command:'ai:refresh-docs' }` (a cron variant is also valid); staleness otherwise surfaces as a `maintenance` `WorkspaceSuggestion` ([03 §2] entry-point d). No silent auto-regen by default.
- **Hooks:** none new. The clone/index runs in the orchestrator (deterministic Conductor), not inside a Claude session, so it needs no lifecycle hook.

The seeded docs are read-only context for the Assistant; the Assistant never writes a `PipelineStageCfg` — it proposes a patch and the Conductor applies it on accept (B-23, [02 §7]).

---

## UI

**Reused**
- `Sources.tsx` — the seeded `InfoDoc` set renders in the existing **Context docs** tab (`DocCard`, `SOURCE_TINT` already distinguishes `generated`/`git`/`uploaded`); the `note` shows `frozen @ <hash>`. The existing `HealthBanner` ("RAG index is behind main by N commits") is exactly the staleness surface for GENERATE docs.
- `WorkspaceSettings.tsx` **GitLab** tab — the model for the URL + verify pattern; the new git-link field mirrors its `Base URL` + `Verify` layout and `WsButton`/`fieldCls` styling.
- `Pipeline.tsx` **Context & Skills** tab (`ContextTab`) — the place the new `sourceIds` become per-stage selectable; **Validate with AI** is the existing entry to the Assistant authoring path (03 §4).
- Primitives: `Tabs`, `Toggle`, `WsButton`, `Segmented` (for the per-row GENERATE/LINK control), `Icon`, `EmptyState`, `Sheet` (file preview, already in `Sources.tsx`).

**New (small)**
- A **Build screen** (one screen, prototype-local state like the others) hosting the progress strip + repo-tree picker + per-file GENERATE/LINK segmented control. The tree is a plain checkbox list (no editor) — the full file experience is `08_CODEBASE_VIEWER.md` (UI-Builder, external, **D3**).

**Mobile parity:** the two-pane build screen collapses to a single list; the GENERATE/LINK `Segmented` sits inline per row. Progress + authoring survive backgrounding via reconnect catch-up ([01 §5]).

---

## Extends

- "[01 §2] Two-system topology" — the clone/index/seed runs in the single-instance orchestrator; the web-app only renders the picker and the resulting `InfoDoc` rows.
- "[01 §5] Real-time multi-client + contention" — progress + the new docs fan out to the `workspace-<wsId>` room; a phone re-syncs on reconnect (subscribe-first → snapshot → merge-on-seq).
- "[01 §8] Security & dev-gating" — secrets at spawn / encrypted-token-on-the-row; the browser requests the clone but never chooses binary/args/cwd. The build-phase clone is **write-capable** (GENERATE'd docs are committed back under `Project.generatedDocsPath`), so its token must carry write/commit scope — unlike a read-only context clone.
- "[02 §2] `query_context`" — the Assistant pulls the seeded docs / repo facts on demand while authoring, rather than loading whole sources.
- "[03 §2] Refresh generated docs — one path, four entry points" — GENERATE + RAG re-index is the registered `ai:refresh-docs` command; staleness → `maintenance` suggestion.
- "[03 §4] Workspace-AI as a pipeline-authoring assistant" — the seeded context-docs are what the Assistant reads to emit the `config-review` patch that authors the pipeline.

---

## Resolved

1. **03.q1 — GENERATE/LINK split:** the Assistant **proposes** the split; the user confirms. Sensible fallback defaults apply if the Assistant doesn't propose (existing `CLAUDE.md`/`README`/spec → LINK; summary/conventions/glossary → GENERATE).
2. **03.q2 — Re-snapshot on push:** an **opt-in** `stage.on_complete → ai:refresh-docs` `WorkspaceTrigger` (documented as the recommended automation). No silent auto-regen by default; staleness otherwise stays a `maintenance` suggestion.
3. **03.q3 — GENERATE target location:** GENERATE'd docs are **committed into the repo** at `Project.generatedDocsPath` (default `docs/luckystack/`). The build phase therefore needs git **write/commit** access, not read-only.
4. **03.q4 — Large-repo guard:** ignore junk — `.gitignore`-aware, skip `node_modules`/build/`dist`/`.git` — and **lazy-load** tree children rather than paginating the whole picker.
