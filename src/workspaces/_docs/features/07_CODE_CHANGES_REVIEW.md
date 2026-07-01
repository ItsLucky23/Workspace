# 07 — Code-changes review (changed-files mode)

> Reviewing a stage's code output before promote — the **same UI-Builder editor as [08_CODEBASE_VIEWER.md], in "changed-files mode"**: left = repo tree with changed files highlighted + a prev/next stepper; main = the diff/editor at the frozen snapshot. Extends [02 §2] (`query_context`) and [02 §4] (carry-over). Baseline behavior is D10.

---

## ⚠️ Same external dependency as 08

This surface is **not a separate editor** — it is the **UI-Builder CodebaseEditor** ([08_CODEBASE_VIEWER.md]) driven through the **same mount/props contract** (`openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`), just configured to spotlight changed files and run a stepper. UI-Builder is **external, NOT in the repo yet** (D3); the user adds it as an in-repo folder later (hard dependency, provided later). **Until it lands, the existing read-only `FileDiffViewer` / `DiffView` are the OPTIONAL INTERIM** for this surface — they already render the GitLab-MR-style changed-files list + inline diff from `Ticket.files: TicketFile[]`. This doc owns the *review workflow*; 08 owns the editor contract.

---

## Scope

**In**
- The **review-before-promote** surface for a stage's code output: see every changed file, step through them, read/inspect the diff, then accept (promote) or send back.
- **Changed-files mode** of the shared editor: LEFT BAR = the repo tree with changed files **highlighted** + a **prev/next stepper** that walks only the changed files; MAIN = the diff (or editor) for the focused file.
- **Diff baseline (D10): support BOTH, default whole-ticket.** Default = **whole-ticket** diff (against the ticket's parent / branch-base). A **toggle** flips to **per-stage delta** (just this stage's changes). Either way the snapshot is **frozen at the stage `commitHash`** carried in the carry-over envelope ([02 §4]).
- Reusing the existing **`FileDiffViewer` + `DiffView`** as the read-only interim until UI-Builder mounts.

**Out**
- Whole-tree browsing / multi-tab free editing — that's [08_CODEBASE_VIEWER.md] (`read-only`/`edit` over the full tree). 07 is the *changed-files-focused* configuration of the same component.
- The promote *mechanics* (carry A→B injection, spawning the next stage) — that's the Conductor + [02 §4]/[02 §1]; 07 only surfaces the **approve == promote** gate ([02 §5]).
- Line-level review comments / threaded code review — out for v1 (the review verdict is the QuestionSet `approve` gate, not inline threads).

**Deferred**
- Per-hunk staging / partial accept (accept some files, send others back) — v1 accepts the stage output as a whole at the gate.
- In-review `edit` (fix-and-accept inside the diff) — rides on 08's deferred `edit` mode; until then review is read-only and fixes loop back to the agent via the QuestionSet answer.

---

## User flow

**Desktop**

1. A stage finishes → `emit_carryover` → Conductor marks the stage **`done`** ([02 §1]); `TicketDetail` shows the green **"Done in <stage>"** banner with **Promote to <next>** (the real `Banner` in `TicketDetail.tsx`).
2. The user opens **Files & refs** to review. The surface renders in **changed-files mode**:
   ```
   ┌──────────────────────┬───────────────────────────────────────────────────┐
   │ CHANGED (3)   ‹ 2/3 › │ src/_components/Avatar.tsx              +12  −4     │ ← focused file
   │ ▾ src                 ├───────────────────────────────────────────────────┤
   │   ▾ _components        │ 12   const status = useAvatarStatus(user.id);     │
   │  ● Avatar.tsx  +12 −4 │ 13 − return <img src={user.avatar} />;            │ ← del (wrong wash)
   │  ● AvatarProvider +3  │ 13 + return user.avatar                            │ ← add (correct)
   │   ▾ index.css          │ 14 +   ? <img src={user.avatar} onError={…} />     │
   │  ● index.css   +6 −0  │ …                                                 │
   │                       │                                                   │
   └──────────────────────┴───────────────────────────────────────────────────┘
   Baseline: ( ● Whole-ticket  ○ This stage )   snapshot @ abc123 (frozen)   ‹ Prev | Next ›
   ```
   - LEFT = the repo tree; **only changed files are highlighted** (dot + `+adds −dels`, reusing `TicketFile.add`/`del`). The host calls `setChangedFiles(ticket.files)` so UI-Builder paints the highlight.
   - The **stepper** (`‹ 2/3 ›` / `Prev | Next`) walks the changed-file set; each step calls `openFile(path)` (and `revealRange(path, firstHunk)` to land on the first change).
3. The **baseline toggle** (`Whole-ticket` ↔ `This stage`) calls `setBaselineCommit(hash)` — whole-ticket diffs against the parent/branch-base; per-stage delta diffs against the previous stage's `commitHash`. The footer always names the frozen `commitHash`.
4. The user reviews each file, then acts on the gate: **Promote** (the `done`-banner button) OR answer the stage's `approve` **QuestionSet** ([02 §5]) — **Approve == Promote**, **Reject RE-OPENS the stage**: the free-text reject note becomes the `--resume` prompt for the **same agent** and the stage flips `done → busy` (it does **not** hold at `done`). Consistent with [09_QUESTIONS_IN_TICKETS.md] q2.

**Mobile**
- The CHANGED-files list is the primary view (full-width); tapping a file opens the diff full-screen with a **back chip** (mirrors the terminal full-screen pattern, DESIGN_BRIEF §E/§F).
- The **stepper** is a sticky bottom bar (`‹ Prev   2/3   Next ›`) — thumb-reachable, so "review from the beach" works ([02 §5] phone-from-the-beach).
- **Approve == Promote** renders as the mobile QuestionSet **Approve / Reject** card (one tap), not a desktop button ([02 §5]); the baseline toggle is a segmented control in a bottom-sheet.

---

## Data

Additive — but almost everything reuses existing names. The changed-files set is the existing **`Ticket.files: TicketFile[]`** (`path/add/del/diff`); the frozen snapshot is the existing **`CarryOver.envelope.commitHash`** ([02 §4]); the approve gate is the existing **`QuestionSet`/`Question(kind:'approve')`** ([02 §5]). 07 introduces only the **baseline selector** UI-state and reuses 08's editor contract types.

| Field / type | Type | On / new | Validation |
|---|---|---|---|
| `DiffBaseline` | `'whole-ticket' \| 'stage-delta'` | new (ui-only) | one of the two; defaults `'whole-ticket'` (D10) |
| (reused) `CodebaseEditorProps.changedFiles` | `TicketFile[]` | from [08] | the highlighted/stepped set = `Ticket.files` |
| (reused) `setBaselineCommit(hash)` | method | from [08] | hash = parent/branch-base (whole-ticket) or prev-stage `commitHash` (stage-delta); both frozen |

No new persisted model — the baseline is a per-view toggle; the commits it resolves to are already on the ticket's branch history + the `CarryOver` rows.

**INDEX delta:** DiffBaseline

---

## Verbs / Events / Hooks

**No new verbs.**

- **`query_context`** ([02 §2]) — the read path: fetch the changed-file list + each file's diff/content at the chosen baseline `commitHash` (same path 08 uses; B-O2 on-demand). The whole-ticket-vs-stage-delta toggle is just *which two commits* the host asks `query_context` to diff.
- **`emit_carryover`** ([02 §2]) — already emitted by the worker at stage end; its envelope's `commitHash` (+ `changedFiles`) is exactly what this surface freezes/highlights. 07 consumes it; it does not add a verb.
- **`request_input`** + `draft_questionset` ([02 §2], [02 §5]) — the **approve gate** is an `approve` QuestionSet; Approve/Reject is the user answering it. The Assistant may pretty-print it (`draft_questionset`); the **Conductor** executes the promote on Approve (B-23, [02 §7]). No write verb.
- **Hooks (reused):** `PostToolUse(Edit/Write)` → `file-change` `TicketEvent` ([02 §3]) is the source of the changed-files highlight; `Stop` → the done-check that surfaces the promote offer ([02 §3]).
- **Triggers:** optional `stage.on_approval → start-stage` ([03 §1]) auto-promotes after Approve; otherwise promote is a manual user action ([02 §1]). No engine change.

---

## UI

**New (host-side, small):** a **baseline toggle** (segmented control, DESIGN_BRIEF §4b) + the **prev/next stepper** wired to the shared editor handle (`openFile`/`revealRange`). These are thin host controls around the `CodebaseEditorHost` from [08]; the editor itself is UI-Builder.

**Reused (real names):**
- `FileDiffViewer` + `DiffView` — the **optional read-only interim** for this exact surface (left file-list + inline `correct`/`wrong`-wash diff already match the design). Both carry an inline comment that "a real editor (VS Code) comes later" — that real editor is UI-Builder ([08]).
- `TicketDetail.tsx` — the `done`-`Banner` + **Promote to <next>** button (already wired through `menuHandler.confirm` showing the carry-over) is the desktop promote gate; the **Files & refs** tab hosts the changed-files view.
- `NeedsInputBanner` / the QuestionSet card path ([02 §5], → 09) — the **Approve/Reject** gate and the "send back" loop.
- Theme tokens (DESIGN_BRIEF §3.1): `correct`/`wrong` for add/del (matching `DiffView`), `primary` for the stepper/active file, `warning` for the needs-input/reject path.

**Mobile parity:** changed-files list + full-screen diff + sticky stepper + one-tap Approve/Reject card — all first-class on mobile (the phone-from-the-beach review, [02 §5] / DESIGN_BRIEF §2). The baseline toggle moves into a bottom-sheet.

---

## Extends

- **[02 §1] Ticket lifecycle** — review happens at `(stage, done)`; **promote is a user action** (or a `stage.on_approval` trigger); **Reject re-opens the stage** (`done → busy`) and `--resume`s the same agent with the reject note as the prompt ([09_QUESTIONS_IN_TICKETS.md] q2).
- **[02 §2] `query_context` + `emit_carryover`** — the read path (diff at a baseline) and the source of the frozen `commitHash` + `changedFiles`.
- **[02 §4] Carry-over envelope** — `commitHash` is the frozen snapshot; `changedFiles` seeds the highlight; the whole-ticket vs per-stage-delta baselines are both resolved against committed snapshots.
- **[02 §5] Question / approval flow** — **Approve == Promote** on a `done` stage; the mobile card vs desktop button; free-text/voice fallback feeds the same answer ([06]/[09]).
- **[02 §7] RBAC / proposes-only (B-23)** — accept/promote is Conductor-executed after the user's Approve, RBAC-gated ("work on tickets"); no session writes.
- **[08_CODEBASE_VIEWER.md]** — the shared UI-Builder editor + its mount/props contract; 07 is that editor in changed-files mode. The interim `FileDiffViewer` is shared too.

---

## Resolved

1. **07.q1 — Per-stage-delta baseline resolution:** the per-stage delta is the **commit-range diff `prevStage.commitHash..thisStage.commitHash`** (not the `CarryOver.envelope.changedFiles` set). Whole-ticket remains the default; the toggle resolves to this range.
2. **07.q2 — Partial accept:** v1 accepts the **WHOLE stage output** at the gate — no per-file / per-hunk staging. A richer gate than the single `approve` Question is out of scope for v1.
3. **07.q3 — Reject payload:** the reject payload is a **free-text note**. A Reject **RE-OPENS the stage** — the note becomes the `--resume` prompt for the **same agent** and the stage flips `done → busy` (it does **not** hold at `done`). Consistent with [09_QUESTIONS_IN_TICKETS.md] q2.
4. **07.q4 — Stepper scope:** the stepper walks the **currently-visible diff's file set** — it follows the baseline toggle (whole-ticket vs stage-delta).
5. **07.q5 — Interim parity:** the interim `FileDiffViewer` stays **minimal + read-only** (whole list, no baseline toggle / stepper). The toggle and stepper land only with UI-Builder.
