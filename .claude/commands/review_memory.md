---
name: review_memory
description: Audit the session's persistent memory store — list every memory by type with mtime, accept user flags for keep/update/delete, apply edits.
---

You are running a memory hygiene audit for the current Claude Code session. Memories at `<memoryDir>/` (the auto-memory store described in your system prompt — the path varies per machine and per project) accumulate over time and some claims drift. This command surfaces them all so the user can prune.

## Procedure

1. **Locate the memory directory** described in the auto-memory section of your system prompt. Read its `MEMORY.md` index file.

2. **For each memory entry linked from MEMORY.md**:
   - Read the file. Parse the YAML frontmatter: capture `name`, `description`, `metadata.type` (`user` / `feedback` / `project` / `reference`).
   - Capture the file's last-modified date via the Bash tool: `Get-ItemProperty -Path '<file>' -Name LastWriteTime` on Windows, `stat -c %y '<file>'` on POSIX. Use whichever your platform supports. If neither works, mark age as `unknown` and proceed — don't block on it.
   - Capture the file's full body (after frontmatter) for later display.

3. **Build the listing**. Group by type in this order: `feedback`, `project`, `user`, `reference`. Within each group, sort by oldest mtime first. Render as a sectioned markdown table:

   ```
   ## Feedback (N entries)

   | # | Title | Last updated | One-liner |
   |---|---|---|---|
   | 1 | Strict typing policy | 2026-03-12 | Zero tolerance for `as unknown` / `as any` casts… |
   | 2 | Eslint two-file scaffold split | 2026-05-21 | official + luckystack configs… |
   …
   ```

   Number entries continuously across groups (1, 2, 3, …) so the user can reference any entry by number.

4. **Present the listing to the user** along with a short prompt:

   > Review the memories above and tell me which to keep, update, or delete.
   > Examples: `delete 3, 7; update 5; keep the rest` — or `walk me through each one` for an interactive review.

5. **Wait for the user's response.** Parse the directives:
   - `delete <numbers>` → mark those entries for deletion.
   - `update <numbers>` → for each, ask the user what to change (read the current body aloud first, then capture the replacement or amendment).
   - `keep <numbers>` (or `keep the rest`) → no action.
   - `walk me through each one` → present each entry's full body in turn, ask `keep / update / delete` per entry. Continue until all are addressed.

6. **Apply the changes**:
   - **Delete**: remove the file from disk AND remove the corresponding line from `MEMORY.md`. Use the Edit tool on `MEMORY.md`, not Write — only the specific line should change.
   - **Update**: rewrite the file body (preserving the frontmatter unchanged unless the user explicitly asks to change the title / description / type). The mtime bump is automatic from the write.
   - **Keep**: no action.

7. **Verify integrity** after edits:
   - Count files in `<memoryDir>/` matching `*.md` (excluding `MEMORY.md` itself).
   - Count lines in `MEMORY.md` that look like `- [Title](file.md) — description`.
   - These should match. If they don't, report the discrepancy and pause for user direction.

8. **Report a summary line**:

   ```
   Memory audit complete: N kept, M updated, K deleted. Remaining: <total> entries.
   ```

## Style

- Be terse during the listing — one row per entry, no preamble.
- During interactive walk-through, render each memory's body verbatim before asking — don't paraphrase.
- Default to the user's explicit answer; don't propose alternatives unless they ask.
- This command does NOT touch repo files. Do not write a branch-log entry for memory edits — they're personal to the session.
- If the user types `cancel` or `nevermind` at any point, abort cleanly without applying partial changes.
