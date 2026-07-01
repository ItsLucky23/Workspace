# 08 — Codebase viewer (the full VSCode-like editor)

> The ticket's working-tree browser/editor — the **full VSCode-like editor target** (D7), powered by the **external UI-Builder** (D3). Extends [01 §2] (two-system topology) and [03 §3] (the `ArtifactViewer` registry seam). Shares its editor host with [07_CODE_CHANGES_REVIEW.md].

---

## ⚠️ Hard dependency — UI-Builder is EXTERNAL and NOT in this repo yet

The editor described here is **not built in this folder**. It is powered by the user's **separate, external project "UI-Builder"** — a VSCode-like editor component the user maintains outside LuckyStack. **The user will ADD IT AS AN IN-REPO FOLDER when this feature is built** (e.g. `src/workspaces/_uibuilder/` or an `@luckystack/ui-builder` workspace package). Until that folder lands, this doc is a **contract**, not an implementation: it defines exactly how Workspaces (the host) drives the editor, so the drop-in is mechanical when the folder arrives.

- **It is a hard dependency, provided later.** Do not stub a parallel mini-editor in `_components/` hoping to "grow it" into this — that contradicts D7. The only interim is the existing read-only `FileDiffViewer`/`DiffView` (see [07_CODE_CHANGES_REVIEW.md]), used for changed-files preview *until* UI-Builder is mounted.
- This doc owns the **mount/props contract** (`openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`) so 07 and 08 drive the same component identically.

---

## Scope

**In**
- Browsing the **whole working tree** of a ticket's stage snapshot: a file tree (left), multi-tab open files (center), syntax highlighting, search-in-file/search-in-tree.
- **Two modes**: `read-only` (default — inspect a frozen snapshot) and `edit` (write back into the worktree; gated, see Verbs/Events/Hooks + RBAC).
- A single **mount/props contract** the host uses to drive the editor (open a file, reveal a range, mark changed files, set the diff baseline commit).
- Mounting UI-Builder as a **local React component/module** once its folder exists; `iframe + postMessage` documented as the fallback bridge when build systems clash.
- Rendering as the `ArtifactViewer` for code artifacts ([03 §3.3]) inside `TicketDetail`'s Files surface, replacing the interim `FileDiffViewer`.

**Out**
- The diff/review *workflow* (prev/next changed-file stepper, accept-before-promote) — that's [07_CODE_CHANGES_REVIEW.md] (the **same** editor in "changed-files mode").
- Building the editor internals (tree virtualization, tokenizer, LSP, multi-cursor) — that's UI-Builder's job, external.
- Live collaborative cursors / multi-user co-editing in one buffer — out for v1 (presence is workspace-level, [01 §5]).

**Deferred**
- `edit` mode write-back beyond the interim: ships only once UI-Builder lands AND the worker container exposes the worktree path (real-repo orchestrator, [01 §2]). Prototype is read-only over the snapshot.
- Inline LSP/intellisense, run-from-editor, and terminal-in-editor — UI-Builder may provide them; Workspaces does not require them for v1.

---

## User flow

**Desktop**

1. From a ticket tab (DESIGN_BRIEF §E), the user opens **Files & refs**. Today that renders `FileDiffViewer`; once UI-Builder is mounted it renders the **full editor** instead (same tab).
2. The editor shows the standard three-pane shape:
   ```
   ┌───────────────┬──────────────────────────────────────────────────────┐
   │ EXPLORER      │ Avatar.tsx ×   AvatarProvider.tsx ×   index.css ×      │ ← open tabs
   │ ▾ src         ├──────────────────────────────────────────────────────┤
   │   ▾ _components│  12  export function Avatar({ user }: AvatarProps) {  │
   │     Avatar.tsx│  13    const status = useAvatarStatus(user.id);        │
   │     Avatar…   │  14    return (                                        │ ← syntax-highlit
   │   ▾ _functions│  …                                                     │
   │ ▾ server      │                                                        │
   └───────────────┴──────────────────────────────────────────────────────┘
   read-only · snapshot @ abc123 (frozen)            [ Read-only ▾ ]  ⌕ Search
   ```
3. Clicking a file in the EXPLORER calls `openFile(path)`; clicking a search hit or an event-log "edited X" entry calls `revealRange(path, range)` to jump straight to the line.
4. A **mode chip** (`Read-only ▾`) shows the current mode and the frozen `commitHash`. In a code stage with edit rights it can flip to `Edit` (RBAC + container availability permitting); otherwise it's a static label.
5. The footer always names the **baseline commit** (the `commitHash` from the carry-over envelope, [02 §4]) so the user knows which snapshot they're looking at.

**Mobile**
- The EXPLORER collapses behind a **"Files" drawer** (slide-in, mirroring the `menuHandler` 200ms drawer, DESIGN_BRIEF §4a); the editor pane is full-bleed.
- Open tabs become a **horizontal scroll strip** (same pattern as the app-shell session-bar, DESIGN_BRIEF §B); tap a chip to switch, long-press to close.
- Read-only is the expected mobile default ("look from the beach", DESIGN_BRIEF §2); edit is desktop-first. Pinch-zoom / soft-wrap respected; the on-screen keyboard never covers the active line (UI-Builder concern, noted in the contract).

**Mount/props contract (how the host drives the editor)** — the host (Workspaces) holds a ref to the mounted UI-Builder and calls these **imperative methods** (it never reaches into UI-Builder's internal state):

```ts
//? src/workspaces/_data/types.ts — additive. The contract Workspaces calls on
//? the mounted UI-Builder. Hand-shaped so it is stable across mount strategies
//? (local module OR iframe postMessage bridge).
export type EditorMode = 'read-only' | 'edit';

export interface CodeRange { startLine: number; startCol?: number; endLine?: number; endCol?: number }

export interface CodebaseEditorHandle {
  openFile(path: string): void;                 // open (or focus) a tab for path
  revealRange(path: string, range: CodeRange): void; // open path + scroll/select range
  setChangedFiles(files: TicketFile[]): void;   // mark tree entries as changed (reuses TicketFile)
  setBaselineCommit(hash: string): void;        // the snapshot/diff baseline (carry-over commitHash)
}

export interface CodebaseEditorProps {
  ticketId: string;
  workspaceId: string;
  mode: EditorMode;                 // 'read-only' default; 'edit' gated (RBAC + container)
  baselineCommit: string;           // frozen snapshot (carry-over envelope, [02 §4])
  changedFiles: TicketFile[];       // for the changed-files highlight (drives [07])
  onReady?: (handle: CodebaseEditorHandle) => void;  // host captures the imperative handle
  onDirtyChange?: (dirtyPaths: string[]) => void;    // edit mode: which buffers are unsaved
}
```

- **Mount strategy A (preferred): local React component/module.** Once the UI-Builder folder exists in-repo, Workspaces imports it and lazy-mounts it through the **`ArtifactViewer` registry** ([03 §3.3]): `registerArtifactViewer('code', lazy(() => import('<uibuilder>/CodebaseEditor')))`. `TicketDetail` already renders an artifact by its `artifactKind`, **falling back to `FileDiffViewer`** ([03 §7] step 3 / §3.3) — so the swap is one registration line, no `TicketDetail` change.
- **Mount strategy B (fallback): `iframe` + `postMessage`.** If UI-Builder's build toolchain clashes with Workspaces' Vite/React setup, mount it in an `iframe` and bridge the **same** contract over `postMessage` (host → `{cmd:'openFile'|'revealRange'|'setChangedFiles'|'setBaselineCommit', args}`; child → `{evt:'ready'|'dirtyChange', payload}`). The prop/method names are identical so callers don't care which bridge is live.

---

## Data

Additive UI-only types for the editor host contract (the editor's own internal models live in UI-Builder, not here). These mirror existing names: `TicketFile` (path/add/del/diff) is reused unchanged for the changed-files highlight; `commitHash` is the existing carry-over envelope field ([02 §4]).

| Field / type | Type | On / new | Validation |
|---|---|---|---|
| `EditorMode` | `'read-only' \| 'edit'` | new (ui-only) | one of the two; defaults `'read-only'` |
| `CodeRange` | `{ startLine; startCol?; endLine?; endCol? }` | new (ui-only) | `startLine ≥ 1`; `endLine ≥ startLine` if set |
| `CodebaseEditorHandle` | imperative handle (4 methods) | new (ui-only) | captured via `onReady`; never persisted |
| `CodebaseEditorProps` | mount props | new (ui-only) | `baselineCommit` non-empty; `mode:'edit'` only if RBAC + container allow |

No new **persisted** model. The snapshot itself is the existing worktree frozen at `CarryOver.envelope.commitHash` ([02 §4]); `TicketFile[]` is already on `Ticket.files`.

**INDEX delta:** EditorMode, CodeRange, CodebaseEditorHandle, CodebaseEditorProps

---

## Verbs / Events / Hooks

**No new verbs.**

- **Read path** uses **`query_context`** ([02 §2]) — the editor host asks the orchestrator for tree listings + file contents at `baselineCommit` (the worker/Conductor answers from the frozen snapshot; B-O2 "fetch full output if needed"). No file API verb is added; tree/content reads ride `query_context`.
- **Edit-mode write-back is NOT an LLM verb and NOT a new verb.** A user save in `edit` mode is a **user action the Conductor executes** — same proposes-only boundary as everything else (B-23, [02 §7]): the browser *requests*, the Conductor writes to the worktree. No session gains a write verb; UI-Builder edits never bypass the Conductor.
- **Hooks (reused, not new):** the `PostToolUse(Edit/Write)` hook ([02 §3]) is what produces the `TicketFile`/`file-change` `TicketEvent` stream; the host calls `setChangedFiles(...)` from that stream and `revealRange(...)` when the user clicks a `file-change` event. The editor does not register hooks of its own.
- **Triggers:** none required. Opening/closing the editor is pure client UI over `query_context`.

---

## UI

**New (external, provided later):** the **UI-Builder CodebaseEditor** — the file tree, multi-tab editor, syntax highlighting, search. Mounted via the `ArtifactViewer` registry ([03 §3.3]) for `artifactKind:'code'`. Not authored in this repo.

**New (host-side, small, in this repo):** a thin **`CodebaseEditorHost`** wrapper that lazy-loads UI-Builder (strategy A) or the `iframe` bridge (strategy B), captures the `CodebaseEditorHandle` via `onReady`, and feeds it `baselineCommit` + `changedFiles`. This wrapper is the only new component Workspaces ships; it's a host shim, not the editor.

**Reused (real names):**
- `TicketDetail.tsx` **Files & refs** tab (DESIGN_BRIEF §E) — already widened to `max-w-5xl` for `tab==='files'`; renders the editor where `FilesTab`/`FileDiffViewer` is today.
- `FileDiffViewer` + `DiffView` — the **optional read-only interim** until UI-Builder lands (see [07_CODE_CHANGES_REVIEW.md]).
- Theme tokens only (DESIGN_BRIEF §3.1): editor chrome uses `container1`/`container2`/`divider`/`title`/`common`; changed-file accents reuse `correct`/`wrong` (matching `DiffView`). UI-Builder must theme to these tokens (or accept a theme map) so light/dark parity holds.
- The **drawer/session-strip** patterns from the app-shell ([01 §5] / DESIGN_BRIEF §B) for the mobile EXPLORER + tabs.

**Mobile parity:** full read-only browsing is first-class on mobile (drawer tree + scroll-strip tabs); `edit` is desktop-first but the contract is identical on both, so when UI-Builder ships a mobile editor it works with no host change.

---

## Extends

- **[01 §2] Two-system topology** — file contents come from the orchestrator (single-instance, host-bound worktrees), not the horizontally-scaled web-app; the editor host is a thin client over `query_context`.
- **[01 §5] Real-time multi-client** — many users may open the same ticket's editor; presence is workspace-level, buffers are not shared (no co-editing in v1).
- **[02 §2] `query_context`** — the only verb the read path uses (tree + file contents at the snapshot).
- **[02 §4] Carry-over envelope** — `commitHash` is the frozen snapshot the editor reads / diffs against; `setBaselineCommit(hash)` takes it.
- **[02 §7] RBAC / proposes-only (B-23)** — `edit`-mode saves are Conductor-executed user actions, not session writes; no write verb is introduced.
- **[03 §3.3] `ArtifactViewer` registry** — the mount seam: `registerArtifactViewer('code', …)`; `TicketDetail` renders by `artifactKind`, falling back to `FileDiffViewer`.
- **[03 §7] "Claude Design" walkthrough** — the same registry pattern (step 3, "register the viewer (client)") is how UI-Builder drops in: a registration line, no core change.
- see [03_BUILD_PHASE.md](./03_BUILD_PHASE.md) — the snapshot/commit the editor reads (`baselineCommit`) is the RAG-snapshot-@-`commitHash` frozen by the build phase (the dependency-graph `08 → 03` edge).
- see [07_CODE_CHANGES_REVIEW.md](./07_CODE_CHANGES_REVIEW.md) — the same editor in "changed-files mode"; shared mount/props contract + interim `FileDiffViewer` (the `07 ↔ 08` edge).

---

## Resolved

1. **08.q1 — Where the UI-Builder folder lives:** **co-located at `src/workspaces/_uibuilder/`** (mount strategy A — local React import). It is stripped along with `src/workspaces` later. (A top-level `@luckystack/ui-builder` package is not the chosen home.)
2. **08.q2 — `artifactKind` key:** the registry key is **`'code'`**, shared by 07 and 08.
3. **08.q3 — Edit-mode availability gate:** `edit` unlocks **ONLY** on a **live worker container** **AND** the **"work on tickets" RBAC** capability; otherwise the editor is read-only. **No editing of frozen snapshots via a scratch worktree in v1.**
4. **08.q4 — Theme handoff:** UI-Builder **consumes the `@theme` tokens directly**; a theme map passed through `CodebaseEditorProps` is the **fallback**.
5. **08.q5 — Large-repo tree:** tree virtualization + lazy children is **UI-Builder's responsibility**; the host streams tree/contents via `query_context` with **no host pagination**.
