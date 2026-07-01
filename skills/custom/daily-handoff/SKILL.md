# Skill: daily-handoff

Produce a structured handoff document at the end of a working session, so another AI assistant (or the same human the next day) can resume without context loss.

## When to Use This Skill vs the Slash Command

- For a one-shot end-of-day handoff, use the slash command `/save_handoff` (definition lives in `.claude/commands/save_handoff.md`). The slash command is the primary trigger.
- Invoke this skill instead when:
  - Multiple parallel sessions need to produce handoffs in a consistent format (the skill enforces the same structure across all of them).
  - The handoff must be written from an AI sub-agent that does not have access to slash commands.
  - You want to deviate from the default save destination but keep the structural format.

## Workflow

### 1. Gather context

- Read `branch-logs/<current-branch>.md` for the running log of work on this branch.
- Read `SESSION_STATE.md` if present (whole-repo session checkpoint).
- Scan the git status + recent commits since the last handoff.
- Note any open plan files referenced in `~/.claude/plans/`.

### 2. Structure the output in 6 sections

Use these section headings in order, even if a section is empty (write `_None._` rather than dropping the header).

```markdown
# Handoff — <branch> — <YYYY-MM-DD HH:mm>

## 1. Done
- Bulleted list of work completed this session. Each bullet: one outcome, link to file/PR if useful.

## 2. In Progress
- Work that is started but not finished. State exactly where it stops.
- For each item: file path, what was attempted, what is left.

## 3. Blockers
- Anything preventing forward motion: missing decision, broken dep, failed test, external waiting.
- For each blocker: cause, who/what is blocking, suggested unblock path.

## 4. Next
- The first 3 to 5 actions the next session should take, in order.
- Prefer concrete file paths over abstract goals.

## 5. Open Questions
- Decisions waiting on the human.
- Phrase as questions, not statements.

## 6. Files Touched
- Path-by-path list of files added / modified / deleted this session.
- Group by area if it helps scanning.
```

### 3. Length target

300+ lines is acceptable and often necessary. The goal is that a fresh AI session in a different terminal can pick up the work without re-reading the entire branch log. Err on the side of more context, not less.

### 4. Example section snippet

```markdown
## 2. In Progress

- `packages/server/src/createServer.ts` — extracting argv parsing into `parseArgv.ts`.
  - Done: new file written, imports rewired in `createServer.ts`.
  - Left: update the 3 call sites in `packages/server/src/index.ts` that still pass the legacy shape, then delete the inline parser.

- `docs/ARCHITECTURE_PACKAGING.md` — section on peer-dep guard policy is half-written.
  - Done: code example for env-key-without-peer hard crash.
  - Left: short prose intro + cross-link from `packages/*/CLAUDE.md`.
```

### 5. Save location

- Default: `branch-logs/<branch>.handoff-<timestamp>.md` so multiple handoffs on the same branch are preserved.
- If the parent caller explicitly overrides the path, honor that.

### 6. Final check before saving

- Every "In Progress" item has a clear "Done / Left" split.
- Every "Blocker" has a suggested unblock path.
- "Next" items are concrete enough to act on without asking questions.
- "Files Touched" matches `git status` (no surprises).

Then write the file and report the path back to the caller.
