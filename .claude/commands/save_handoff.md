---
name: save_handoff
description: Write a session handoff file (solo or parallel-agent mode) capturing done/in-progress/blockers/next-steps/open-questions/files-touched.
---

You are writing a handoff document for the current Claude Code session. Work autonomously, do not ask the user clarifying questions, make reasonable inferences from the transcript.

## Argument parsing

`$ARGUMENTS` may be empty or contain two integers `N M`.

- Empty -> **solo mode**. Target path: `handoffs/<YYYY-MM-DD>/HANDOFF.md`
- Two integers `N M` (e.g. `2 4` meaning agent 2 of 4) -> **parallel mode**. Target path: `handoffs/<YYYY-MM-DD>/agent_<N>_of_<M>.md`
- Any other shape -> fall back to solo mode and note the unparsed args at the top of the file.

`<YYYY-MM-DD>` is today's date (use the date already provided in your context; do not shell out for it unless the context lacks it).

If a file already exists at the target path, append a new dated section to it rather than overwriting. Lead with `## Update <HH:MM>` so the existing content is preserved.

## Procedure

1. Determine the target path from the args.
2. Use the Bash tool to ensure the parent directory exists (`mkdir -p handoffs/<date>`).
3. If the file exists, read it first so you append rather than overwrite.
4. Scan the session transcript and recent tool calls. Pull out: edited files, ran commands, observed errors, decisions made, questions deferred.
5. If the repo has a current `branch-logs/<sanitized-branch>.md`, glance at the last entries to ground the timeline.
6. Write the handoff. Length is whatever the session warrants — 300+ lines is fine if the session was dense; do not pad short sessions.

## Required sections (in this order)

```
# Handoff <date> <solo | agent N of M>

## Session overview
One short paragraph: branch, broad goal of the session, end state.

## Timeline
Bulleted, roughly chronological. Each bullet: short phrase + the file(s) or command(s) it touched.

## Done
What is finished and verified. One bullet per concrete change.

## In Progress
What is started but not finished. Include current file + line region if relevant.

## Blockers
Anything that stopped progress. Include the exact error message or command output when known.

## Next Steps
Concrete, ordered. The next agent should be able to start from bullet 1 without re-reading the whole file.

## Open Questions
Decisions deferred to the user. Frame each as a question + the options considered.

## Files Touched
Absolute or repo-relative paths, grouped by status (modified / added / deleted). One per line.

## User testing checklist
What the user needs to click / run / observe to confirm the work.
```

## Style rules

- No emojis, no decorative banners.
- Plain markdown headings, plain bullets.
- Code blocks for any command, error, or file snippet.
- Be specific: prefer "added `parseArgv` to `packages/server/src/parseArgv.ts`, wired into `index.ts:42`" over "improved arg parsing".
- If a section is genuinely empty, write `- (none)` rather than omitting the heading.

## After writing

Report back to the user: target path + line count + a one-sentence summary of what was captured. Do not paste the full handoff back into chat.
