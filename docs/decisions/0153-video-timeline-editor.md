---
title: V5/V6 — the video timeline editor UI
status: accepted
date: 2026-07-08
tags: [content, video, editor, ui, idea-to-outcome]
---

## Context

V1–V4 built the whole backend of an editable multi-scene video (scene model, stitch render, decomposition,
range-refine) but the only way to drive it was raw control-ops. V5 is the editor a user actually operates; V6
(split/delete/transition) folds into it because those are just edits to the scene list the editor saves.

## Decision

- **`VideoTimelineEditor`** (modal from the content piece page): renders the piece's `VideoScene`s as
  proportional blocks and drives the existing ops — edit a scene's **duration (trim)** + **transition**
  (Dropdown), **split** (halve a scene → a new second half), **delete**, **reorder** (left/right) → all saved as
  the full ordered list via `content-save-scenes` (upsert by id, so ids/lineage survive). A **range selector**
  (start/end seconds + instruction) fires `content-refine-range`; a **"Generate scenes"** button fires
  `content-decompose-video`. Every write goes through `runContentOp` → the Conductor (B-23).
- **`runContentOp` payload widened to `Record<string, unknown>`** so the editor can pass the scene array +
  numeric start/end (not just strings); the route validates each op's real shape server-side.
- **Reorder/split/trim are buttons + inputs, not raw drag.** They are reliable, keyboard-accessible, and
  produce exactly the same scene-list save; drag is a logged follow-up (it needs live browser tuning).

## Rejected alternatives

- **Granular per-edit ops (move/trim/transition each a round-trip).** The editor already holds the whole list;
  one `content-save-scenes` on apply is simpler + matches V1's upsert. Split just inserts a new list entry.
- **A native `<select>` for transitions.** The framework's `Dropdown` is the house component (keyboard/theme);
  used it per the Component Reference.
- **Raw drag-and-drop reorder now.** Can't be browser-verified in this pass; buttons deliver the same result
  and are testable-by-reading. Drag is a follow-up when the dev server is up.

## Consequences

- A user can now open a piece and actually edit its video timeline — trim, reorder, split, change transitions,
  refine a selected range, and (re)generate scenes — all landing through the tested V1/V3/V4 ops. This completes
  the marquee "idea → editable multi-scene video" surface end to end (UI + backend). The component is
  typecheck/lint/ai-lint/build clean; a live browser pass (drag polish, visual QA, mobile) is the remaining
  step, pending the dev server. i18n ×4 for every label. Next browser-heavy items: B (image editor extras),
  L3 (mobile approvals).
