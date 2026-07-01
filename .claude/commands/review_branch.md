---
name: review_branch
description: Full audit of the current branch — compares git history against branch-log and SESSION_STATE, flags discrepancies, suggests a commit message and review focus areas.
---

You are auditing the current branch end-to-end. Your goal: give the user a clear picture of what is on the branch, what is missing from the docs, what is risky, and what still needs testing.

## Procedure

Run these checks in parallel where possible. Use the Bash tool.

1. **Branch + base**
   ```
   git rev-parse --abbrev-ref HEAD
   git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo "master"
   ```
   Use `master` as base unless the repo's default ref says otherwise.

2. **Commits on the branch**
   ```
   git log <base>..HEAD --pretty=format:"%h %ad %s" --date=short
   ```

3. **File-level diff overview**
   ```
   git diff <base>...HEAD --stat
   ```

4. **Per-file diff for anything non-trivial** — for each file in the stat that is not a lockfile, generated file (`*.generated.*`), or `package-lock.json`, sample the diff:
   ```
   git diff <base>...HEAD -- <path>
   ```
   Read enough to understand the change, not every line of every file.

5. **Branch log**
   - Sanitize the branch name as in `log_progress`.
   - Read `branch-logs/<sanitized>.md` if it exists. If missing, note it.

6. **Session state**
   - Read `SESSION_STATE.md` at the repo root if it exists.

7. **Working tree state**
   ```
   git status --short
   ```
   Note any uncommitted changes — they are not part of the branch yet but the user may have forgotten to commit them.

## Analysis

Compare:

- What the commits + diff say was done
- What `branch-logs/<sanitized>.md` claims was done
- What `SESSION_STATE.md` claims was done

Flag every mismatch. Common shapes:

- Diff shows a change to file X but no log entry mentions it -> "undocumented change".
- Log entry claims feature Y is done but no diff supports it -> "missing implementation or already reverted".
- Commit message says "fix Z" but diff also changes unrelated file W -> "scope creep".

## Output format

```
# Branch audit: <branch-name>
Base: <base>  Ahead by <N> commits, <M> files changed, +<adds>/-<dels>

## Discrepancy table
| Source A | Source B | Mismatch |
|---|---|---|
| git: edited `src/foo.ts` | log: no mention | Undocumented change |
| log: "finished migration" | git: no migration files | Claim unsupported |

(if no discrepancies, write "No discrepancies found.")

## What was done (from git)
- One bullet per logical change, grouped by feature area, with the files involved.

## What is potentially broken
- Anything in the diff that looks risky: deleted code with no replacement, type changes that ripple, schema changes without migration, etc.
- Be specific and reference the file:line.

## What still appears unfinished
- TODOs added in the diff, half-written functions, tests not added, docs not updated.

## What the user should test
- Concrete manual steps grouped by feature area.

## Suggested commit / PR message
```
<one-line title under 70 chars>

<paragraph body explaining the why, not the what>
```

## Flagged for deeper review
- File(s) that warrant a closer security/perf/types pass — name them so the user can run `/parallel_review` against them.
```

## Style rules

- No emojis.
- Use exact file paths and line numbers. The user should be able to jump straight from your output to the code.
- Do not edit files. Do not commit. This is read-only analysis.
- If `git` fails (e.g. no base branch), report the failure cleanly and continue with whatever you could gather.

## After writing

Print the report directly to the chat. Do not save it to a file unless the user asks. End with the suggested next command (typically `/parallel_review` or `/log_progress`).
