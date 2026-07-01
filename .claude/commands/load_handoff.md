---
name: load_handoff
description: Load a handoff file and emit a short TL;DR (Done / Open / Next Steps) so the agent can resume work with full context.
---

You are picking up a session from a handoff document. Goal: load context fast, give a clean recap, then wait for the user.

## Argument parsing

`$ARGUMENTS` should contain a file path. Accept any of:

- Absolute path: `C:\youcomm\LuckyStack-v2\handoffs\2026-05-20\HANDOFF.md`
- Repo-relative: `handoffs/2026-05-20/HANDOFF.md`
- Date-only shortcut: `2026-05-20` -> resolve to `handoffs/2026-05-20/HANDOFF_COMBINED.md` if it exists, else `handoffs/2026-05-20/HANDOFF.md`
- Empty: list all `handoffs/*/` directories sorted desc and ask the user which one (this is the only case where you may ask a question).

If the resolved file does not exist, list the contents of the closest existing parent dir and stop.

## Procedure

1. Resolve the path per above.
2. Read the file in full.
3. Do not run git, do not edit files, do not act on next steps. This command is context-loading only.
4. Emit the recap below.

## Output format

```
Loaded: <resolved-path> (<line-count> lines)

## TL;DR
Two to four sentences. What was the session about, where did it end.

## Done
- (top 5–10 most relevant bullets, verbatim from the file or lightly compressed)

## Open / In Progress
- (everything from In Progress + anything in Done that was marked partial)

## Blockers
- (verbatim — do not summarize errors, keep them grep-able)

## Next Steps
- (full ordered list, verbatim)

## Open Questions for the user
- (verbatim, these are the questions the previous agent deferred)

## Files Touched
- (compact list — group by directory if more than ~15 files)

Ready to continue. Reply with which next step you want to start on, or answer the open questions first.
```

## Style rules

- No emojis.
- Keep recap scannable. The user is re-entering a session, they need the shape of the work, not a re-read.
- Preserve exact filenames, function names, error strings. Do not paraphrase.
- Do not propose new work. Do not start editing. End with the "Ready to continue" line and stop.
