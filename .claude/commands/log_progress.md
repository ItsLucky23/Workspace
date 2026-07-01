---
name: log_progress
description: Manually append a branch-log entry for the current branch summarizing the most recent prompt's work.
---

You are writing one entry into the branch log. This is the manual fallback for the automatic branch-log protocol described in `.claude/CLAUDE.md` — use it when the user explicitly wants an entry recorded now.

## Procedure

1. Determine the current branch:
   ```
   git rev-parse --abbrev-ref HEAD
   ```
2. Sanitize the branch name for use as a filename: replace `/` and any character outside `[A-Za-z0-9._-]` with `_`. Example: `chore/package-split-prep` -> `chore_package-split-prep`.
3. Target path: `branch-logs/<sanitized>.md`.
4. Ensure `branch-logs/` exists (`mkdir -p branch-logs`).
5. If the file is new, start it with a header:
   ```
   # Branch log: <original-branch-name>
   ```
6. Read the file if it exists so you can append correctly. Do not rewrite previous entries.
7. Append one new entry at the bottom.

## Entry format

```
## <YYYY-MM-DD HH:MM> — <short title>

**Prompt:** <one-sentence paraphrase of the user's last prompt>

**Did:**
- <bullet> (file:line where useful)
- <bullet>

**Result:** <one or two sentences — what changed, whether it built, whether tests ran>

**Touched files:**
- <path>
- <path>

**Notes:** <optional — anything surprising, deferred, or worth flagging next time>
```

If the recent work touched zero files (e.g. pure investigation), keep `Touched files: - (none)` and put findings in `Notes`.

Use the actual current time from your environment context. If unsure, omit the time and use `<YYYY-MM-DD>` only.

## Style rules

- No emojis.
- One entry per invocation. Do not retroactively log earlier prompts unless the user explicitly asks.
- Be concrete. "Refactored server" is useless; "Extracted `parseArgv()` out of `packages/server/src/index.ts` into `parseArgv.ts`, wired imports" is the bar.
- Do not duplicate content that is already in a handoff — link to it instead (`see handoffs/<date>/HANDOFF.md`).

## After writing

Report: branch-log path + the title of the entry that was appended.
