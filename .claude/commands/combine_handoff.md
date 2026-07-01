---
name: combine_handoff
description: Merge all per-agent handoffs for a given date into one combined HANDOFF_COMBINED.md, deduplicating and attributing per agent.
---

You are merging multiple parallel-agent handoffs into a single combined handoff. Work autonomously.

## Argument parsing

`$ARGUMENTS` should contain one date in `YYYY-MM-DD` form. If empty, default to today's date from your context. If malformed, stop and report the issue to the user.

## Procedure

1. Glob `handoffs/<date>/agent_*_of_*.md` to find the per-agent files.
2. If zero files match: report "no agent handoffs found at handoffs/<date>/" and stop.
3. If one file matches: copy it to `handoffs/<date>/HANDOFF_COMBINED.md` verbatim, note in the report that only one agent ran.
4. Otherwise, read every matching file in full. Extract each of the six standard sections (Done, In Progress, Blockers, Next Steps, Open Questions, Files Touched) plus Session overview / Timeline / User testing checklist if present.
5. Build the combined doc using the merge rules below.
6. Write to `handoffs/<date>/HANDOFF_COMBINED.md`. Overwrite if it already exists.

## Merge rules per section

- **Session overview**: one paragraph per agent, each prefixed with `Agent N:` so the reader sees who did what.
- **Timeline**: interleave by agent. Each bullet stays attributed (`[agent N]` prefix). Sort chronologically only if timestamps exist; otherwise group by agent.
- **Done**: union, deduplicate by semantic equivalence (same file + same change = one bullet). When agents collide on the same change, keep one bullet and append `(reported by agents N, M)`.
- **In Progress**: union, always keep agent attribution (`[agent N]`) because the next reader needs to know who to ask.
- **Blockers**: group by blocker root cause. If two agents hit "Prisma client not generated" and "schema.prisma missing field x" — those are different blockers, keep separate. Same error in two places — merge with attribution.
- **Next Steps**: deduplicate, then order by priority. Priority signal = how many agents called it out + whether it unblocks another step. Critical path first, polish last. Annotate each step with the agents that proposed it.
- **Open Questions**: union, attribute each question to its agent(s). If two agents asked semantically the same question, merge them and note both.
- **Files Touched**: union, deduplicate by absolute path. For each path, list which agent(s) touched it in parentheses after the path.
- **User testing checklist**: union, deduplicate, group by feature area when obvious.

## Output format

```
# Combined Handoff <date>

Sources:
- handoffs/<date>/agent_1_of_M.md
- handoffs/<date>/agent_2_of_M.md
- ...

## Session overview
...

## Timeline
...

(six standard sections, in the same order as save_handoff)

## Per-agent quick links
- Agent 1: handoffs/<date>/agent_1_of_M.md
- Agent 2: handoffs/<date>/agent_2_of_M.md
- ...
```

## Style rules

- No emojis.
- When attributing, use the compact `[agent N]` or `(agents N, M)` form, not "according to agent N".
- Preserve exact error messages, file paths, and line numbers from the source files. Do not paraphrase technical detail.
- If two agents contradict each other on a fact, do not silently pick one. Flag it under a `## Conflicts` section at the bottom with both claims and their sources.

## After writing

Report: target path, total line count, number of source files merged, count of conflicts flagged (if any).
