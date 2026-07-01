# Branch Log Protocol

The authoritative protocol for `branch-logs/` — how, when, and why we keep per-branch progress logs.

## 1. Purpose

Branch logs are the connective tissue between AI sessions and human reviewers on a single branch. They answer questions the diff cannot:

- What did the previous session intend?
- What alternatives were considered and rejected?
- Why does this commit exist at all?
- What is still in-flight that the next session must pick up?

They are **not** a substitute for commit messages, PR descriptions, or architecture docs. They sit one layer above the diff and one layer below the architecture docs.

## 2. Storage

- Location: `branch-logs/` at the repository root.
- One file per branch.
- **Not gitignored** — reviewers and other-session AI need read access via the repo.
- Filename = sanitized branch name (see Section 5).
- Format: Markdown, append-only, newest entries at the bottom.

## 3. When to log

### Log it

- A new feature, file, package, or module was added.
- An architecture decision was made (dependencies, layering, contracts, public API).
- A refactor changed call sites, types, or public exports.
- A non-trivial bug was diagnosed and fixed (capture the root cause).
- A new pattern was codified in docs.
- A multi-step sweep was kicked off (so the next session can resume mid-way).
- Anything the next session would have wanted to know an hour into reverse-engineering.

### Skip it

- Lint-only fixes (auto-fixable rule run).
- Typo or comment-only edits.
- Adding or correcting translation strings without behavior change.
- Pure reformatting or whitespace.
- File reads, searches, or exploration that did not result in a code change.
- Reverts of changes made earlier in the same session (just amend the original entry instead).

### When in doubt

Log it. A 5-line entry is cheap. A missed handoff costs the next session 30 minutes of archaeology.

### Examples

| Situation                                                          | Log? |
| ------------------------------------------------------------------ | ---- |
| Renamed `src/foo/bar.ts` -> `src/foo/baz.ts` and updated 12 imports | Yes  |
| Fixed prettier complaint in 4 files                                | No   |
| Added a new sync handler under `src/dashboard/_sync/`              | Yes  |
| Translated three Dutch labels to English                           | No   |
| Decided to drop Express dependency in favor of raw Node            | Yes (decision matters) |
| Updated a JSDoc typo                                               | No   |
| Spent 40 minutes reading code to learn the auth flow, no edits     | No (but consider a docs PR) |
| Rolled back a refactor from the same session                       | No — amend the original entry to note the revert |

## 4. Entry format

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

### Field-by-field

- **Heading line**: `## YYYY-MM-DD HH:MM — title`. Date is mandatory; time is optional when not informative. Title is a short, human-readable summary (under 70 chars).
- **User prompt (summary)**: Paraphrase, do not paste verbatim. 1-3 sentences. The goal is "why did this work happen?".
- **What I did**: Bullet list of concrete actions. Keep it scannable — verbs first ("Added", "Refactored", "Diagnosed"). 3-10 bullets is typical.
- **Files touched**: Comma-separated relative paths (or globs for large sweeps). This is the bridge to the diff.
- **Notes / decisions**: Only when there is something non-obvious to capture (a rejected alternative, a known follow-up, a trade-off). Omit the field entirely if you have nothing to say.

### Style rules

- No emojis.
- Date format: `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour).
- Markdown headers consistent: always `##` for entries.
- New entries go at the **bottom** of the file. Never reorder or rewrite history.
- Amending an entry is allowed only to correct factual errors or add a `Notes` line about a same-session revert.

## 5. Filename sanitization

Branch names contain characters that are illegal in Windows filenames. Sanitize as follows:

1. Replace `/` with `--` (double dash, visually distinct from a single dash).
2. Replace each of `:`, `*`, `?`, `"`, `<`, `>`, `|` with `_`.
3. Truncate to a maximum of 100 characters.
4. Append `.md`.

### Worked examples

| Branch                                | Sanitized filename                       |
| ------------------------------------- | ---------------------------------------- |
| `chore/package-split-prep`            | `chore--package-split-prep.md`           |
| `feat/login/oauth-google`             | `feat--login--oauth-google.md`           |
| `fix/socket:reconnect-storm`          | `fix--socket_reconnect-storm.md`         |
| `release/2026-05-20`                  | `release--2026-05-20.md`                 |
| `wip/<experimental>/no-promises`      | `wip--_experimental_--no-promises.md`    |

### Edge cases

- **Branch name longer than 100 chars after sanitization**: Truncate. There is no hash suffix — at 100 chars the collision risk is accepted as negligible. If two branches collide in practice, rename one.
- **Branch name that starts or ends with whitespace**: Trim before sanitizing.
- **Detached HEAD or unnamed branch**: Do not log. Branch logs are keyed by branch name.

## 6. Slash command integration

Two slash commands work with branch logs.

### `/log_progress` — manual fallback

Use when the AI did not auto-log and a human wants to force an entry, or when the human wants to dictate the entry text directly. The command:

1. Detects the current branch.
2. Computes the sanitized filename.
3. Creates `branch-logs/<filename>.md` with a header if it does not exist.
4. Appends a new entry using the format above, with fields prompted from the user or inferred from recent tool calls.

`/log_progress` is **fallback**, not the primary path. Routine logging is autonomous (see Section 3).

### `/review_branch` — consumer

Used by a reviewer (human or AI) to summarize a branch before merge. The command:

1. Reads `branch-logs/<sanitized-branch>.md` if it exists.
2. Reads the diff (`git diff <base>...HEAD`).
3. Cross-references: does the log explain the diff? Are there decisions in the log that should be promoted to docs or commit messages? Are there entries with no corresponding diff (drift)?
4. Produces a review checklist.

If the branch log is missing, `/review_branch` falls back to diff-only review and notes the absence.

## 6.5. INDEX maintenance (mandatory)

Every time you create or append to a `branch-logs/<branch>.md` file you MUST also update the corresponding row in `branch-logs/INDEX.md`. This rule applies whether the log update was autonomous, triggered by `/log_progress`, or done by hand. The index is what makes sprint-end audits ("review tickets DEV-120..DEV-140") tractable without listing the directory.

### What to update

1. **Find the row** matching the current branch in `branch-logs/INDEX.md`. If no row exists, add one in alphabetical order by branch name.
2. **`Last updated`** — set to the timestamp of the new entry's `## ` heading (same `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` format).
3. **`Entries`** — increment by 1 for each new entry added (or set to the new total if you are unsure).
4. **`Status`** — flip to `merged YYYY-MM-DD` if the branch has just landed in master; flip to `abandoned` if the branch is being discarded. Leave as `active` otherwise.
5. **`Ticket(s)`** — when adding a new row, extract by matching `[A-Z]{2,}-\d+` against the branch name (`DEV-120`, `PROJ-42`, etc.). Use `(none)` if the branch name carries no ticket prefix.

### Examples

| Operation | INDEX.md action |
|---|---|
| First entry on a new branch | Add a new row with `Entries: 1`, `Status: active`, `Last updated` = entry header timestamp |
| Appending entry N+1 to an existing branch | Update existing row: `Entries: N+1`, `Last updated` = new entry's timestamp |
| Observing the branch was merged to master | Flip `Status` to `merged YYYY-MM-DD` on the existing row |
| Discovering a row is out of sync with the file | Fix it in the same edit pass |

### Drift repair (deferred)

A `npm run ai:index-branchlogs` script that regenerates INDEX.md from disk by scanning `branch-logs/*.md` headings is reserved as a drift-repair tool. It is NOT the primary maintenance path — manual updates by the writing agent stay the source of truth.

## 7. Sample log

This is what a healthy branch log looks like after a week of work:

```markdown
# Branch: feat/dashboard-widgets

> Append-only progress log. New entries to the bottom.

## 2026-05-12 — Initial widget framework scaffold

**User prompt (summary)**: Begin a dashboard-widgets feature. We want a registry where
each widget declares its own data source, render function, and per-user preferences.
Start with the registry and one example widget; defer persistence.

**What I did**:
- Added `src/dashboard/_widgets/registry.ts` with `registerWidget` and `getWidgets`.
- Added `ClockWidget` as the first example widget (renders local time, no data source).
- Wired the registry into `src/dashboard/page.tsx` behind a feature flag.
- Updated `docs/ARCHITECTURE_ROUTING.md` to mention `_widgets/` as a private folder.

**Files touched**: src/dashboard/_widgets/registry.ts, src/dashboard/_widgets/ClockWidget.tsx,
src/dashboard/page.tsx, docs/ARCHITECTURE_ROUTING.md.

**Notes / decisions**:
- Registry is module-scope, not React context — widgets register on import, not on mount.
- Decided against a per-widget Zod schema in v1; revisit when persistence lands.

## 2026-05-14 — Persistence via user preferences

**User prompt (summary)**: Persist which widgets each user has enabled. Reuse the existing
settings/_api/updatePreferences endpoint rather than introducing a new one.

**What I did**:
- Extended `SessionLayout.preferences` with a `widgets: string[]` field.
- Updated `updatePreferences_v1` to accept and validate the new field.
- Added `useEnabledWidgets()` hook on the client.

**Files touched**: src/_types/SessionLayout.ts, src/settings/_api/updatePreferences_v1.ts,
src/dashboard/_widgets/useEnabledWidgets.ts, prisma/schema.prisma.

**Notes / decisions**:
- Stored as `string[]` of widget IDs, not a map of widget-id -> config. Per-widget config
  is intentionally deferred — when it lands, migrate `string[]` -> `Record<string, unknown>`.

## 2026-05-18 — Diagnosed Clock widget hydration mismatch

**User prompt (summary)**: ClockWidget logs a hydration warning in dev. Find the cause and fix.

**What I did**:
- Reproduced the warning in `src/dashboard/page.tsx` with React 19 strict mode.
- Root cause: `new Date()` was called during SSR-equivalent render, producing a different
  string than the client's first render.
- Fix: render `null` on first paint, then `setIsMounted(true)` in `useEffect` and render
  the time. Standard React 19 hydration-safe pattern.

**Files touched**: src/dashboard/_widgets/ClockWidget.tsx.

**Notes / decisions**:
- Considered using `suppressHydrationWarning` — rejected because it masks real bugs
  in other widgets later.
```

## 8. Failure modes to avoid

- **Treating the log as a diary**: It is not. If a session did no meaningful work, write nothing.
- **Pasting raw user prompts**: Summarize. Verbatim prompts are noisy and often contain irrelevant context.
- **Logging the same work twice**: One entry per piece of work. If a follow-up session continues the same task, link to the prior entry by date rather than restating it.
- **Editing old entries**: Append-only. The only allowed edits are factual corrections and notes about same-session reverts.
- **Skipping the `Files touched` field**: Reviewers use it to align the log against the diff. Even a glob (`src/dashboard/_widgets/**`) is better than nothing.
