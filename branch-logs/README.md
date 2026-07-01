# Branch Logs

Append-only, per-branch progress logs that AI sessions (and human reviewers) can read to recover context across handoffs.

## Purpose

- Give cross-session AI an authoritative record of what was done on this branch, by whom (which session), and why.
- Give code reviewers a narrative companion to the diff: "what was the intent?" before "what does the code do?".
- Survive context resets, compactions, and laptop restarts.

This folder is **NOT gitignored**. The logs are part of the repository so reviewers and other-session AI can read them.

## Filename convention

One file per branch. Filename derives from the branch name via the following sanitization:

1. `/` is replaced with `--` (Markdown-safe, visually distinct from a single dash).
2. Illegal Windows filename characters are replaced with `_`: `:`, `*`, `?`, `"`, `<`, `>`, `|`.
3. Truncate to a maximum of 100 characters. No hash suffix; treat collisions as a non-issue at that length.
4. Append `.md`.

Examples:

| Branch                         | File                                  |
| ------------------------------ | ------------------------------------- |
| `chore/package-split-prep`     | `chore--package-split-prep.md`        |
| `feat/login/oauth-google`      | `feat--login--oauth-google.md`        |
| `fix/socket:reconnect-storm`   | `fix--socket_reconnect-storm.md`      |
| `release/2026-05-20`           | `release--2026-05-20.md`              |

## Update protocol

See `docs/BRANCH_LOG_PROTOCOL.md` for the full protocol (when to log, format spec, edge cases, sample log).

## Entry format

Each entry uses this template. New entries go at the **bottom** of the file.

```markdown
## YYYY-MM-DD HH:MM — <short title>
**User prompt (summary)**: <1-3 sentences capturing what the user asked for>
**What I did**:
- bullet 1
- bullet 2
- bullet 3
**Files touched**: file1.ts, file2.md, ...
**Notes / decisions**: <optional, only when a non-obvious choice was made>
```

The `HH:MM` portion is optional when the time of day adds no information; `YYYY-MM-DD` alone is acceptable.

## When AI logs

AI sessions log autonomously when work is meaningful. Heuristic:

| Log it                                              | Skip it                                       |
| --------------------------------------------------- | --------------------------------------------- |
| New feature, new file, new package                  | Lint-fix only                                 |
| Architecture decision (deps, layering, contracts)   | Typo / comment-only fix                       |
| Refactor that changes call sites or types           | Adding/updating translation strings only      |
| Bugfix with non-trivial root-cause                  | File reads / searches with no code change     |
| Docs change that codifies a new pattern             | Reformatting / whitespace                     |
| Anything the next session would benefit from knowing| Reverting a change made earlier in the same session |

When in doubt: log it. Cheap to write, expensive to miss.
