---
name: parallel_review
description: Spawn four parallel sub-agent reviewers (security, performance, conventions, type-safety) over the current branch diff and consolidate their findings.
---

You are running a multi-perspective review of the current branch's diff. You will spawn four parallel sub-agents via the TaskCreate tool, each with a distinct role, then merge their findings into one report.

## Argument parsing

`$ARGUMENTS` is optional. If present, it lists extra reviewer roles to add (comma- or space-separated). Recognized extras: `ux`, `accessibility`, `i18n`, `tests`, `docs`. Unknown roles are ignored with a warning at the top of the report.

## Preparation

Before spawning agents, gather the shared context once so each agent does not redo it:

1. Current branch + base (same logic as `/review_branch`).
2. `git diff <base>...HEAD` — full diff. If huge (>2000 lines), also produce a per-file index so each agent can pick what to read.
3. `git diff <base>...HEAD --stat` for the overview.
4. List of changed files.

Pass this context into each sub-agent's prompt so they all review the same artifact.

## Roles

Spawn these four in parallel by issuing four TaskCreate calls in one tool-call batch. Each agent gets a focused prompt with the diff context and the role-specific checklist below.

### 1. Security Reviewer
Look for:
- SQL injection (raw query strings with interpolated user input)
- XSS (unescaped HTML, `dangerouslySetInnerHTML`, direct DOM injection)
- Auth bypass (missing `auth.login` on new `_api/*.ts`, missing role checks, IDOR — accessing records by id without ownership check)
- Secret leak (hardcoded keys, tokens committed, `.env*` changes that expose secrets)
- OWASP Top 10 categories relevant to the diff
- Unsafe deserialization, prototype pollution, open redirects
- Rate-limit removal or weakening
Output: findings with file:line + severity (critical/major/minor) + recommended fix.

### 2. Performance Reviewer
Look for:
- N+1 queries (loop containing `prisma.*.findUnique`/`findFirst`)
- Blocking I/O in async paths (sync `fs.readFileSync`, sync hashing on hot paths)
- Missing DB indexes for new query patterns
- Large payloads sent over socket without pagination or projection
- Unbatched socket emits in a loop
- Memory leaks: event listeners added without removal, growing maps without eviction
- Unnecessary re-renders: missing `useMemo`/`useCallback` where deps are stable and cost is real (do not chase false positives)
Output: findings with file:line + severity + recommended fix.

### 3. Conventions Reviewer
Source of truth: `.claude/CLAUDE.md`. Look for:
- SOLID violations (god-functions, leaky abstractions, concrete deps where interfaces exist)
- Helper reuse missed: raw `try/catch` instead of `tryCatch`, custom dropdown instead of `Dropdown`, etc. — cross-reference the existing-components table in CLAUDE.md
- i18n violations: hardcoded user-facing strings instead of `useTranslator`
- Tailwind violations: arbitrary color values, raw hex codes, margin instead of `flex`/`gap`
- Naming convention drift: file-based-routing filenames, `_v<N>` suffixes
- Emoji usage in code/UI/comments
- JSX rules: non-self-closing tags without children, `''`/`""` in `className`, `header`/`footer` instead of `div`
Output: findings with file:line + severity + recommended fix.

### 4. Type-Safety Reviewer
Source of truth: rules 15–16 in `.claude/CLAUDE.md`. Look for:
- `as unknown`, `as any`, `as <T>` casts that bypass generated types
- Local `unsafe*` wrappers around `apiRequest`/`syncRequest`/`upsertSyncEventCallback`
- Missing return types on exported functions
- Generic type erasure (`<T>` not constrained, then `as any`-d inside)
- `@ts-ignore` / `@ts-expect-error` without justification
- `unknown` payloads in sync callbacks where the generated discriminated union should narrow
- `any` in API params/results
Output: findings with file:line + severity + recommended fix.

### Optional roles (only if requested via $ARGUMENTS)

- **ux**: tab order, focus traps, loading states, empty states, error states
- **accessibility**: aria attributes, contrast (against the design tokens), keyboard nav, screen-reader labels
- **i18n**: missing keys across `nl`/`en`/`de`/`fr`, key naming consistency
- **tests**: missing assertions, brittle selectors, async without await
- **docs**: `docs/ARCHITECTURE_*.md` out of sync with code changes, `PROJECT_CONTEXT.md` stale

## Consolidation

After all sub-agents return, build the final report.

```
# Parallel review: <branch>
Base: <base>  Changed files: <N>  Reviewers: security, performance, conventions, type-safety[, ...extras]

## Executive summary
3–6 bullets. Lead with critical findings. End with the single most important next action.

## Critical findings (across all reviewers)
- [security] file:line — one-line description
- [perf] file:line — one-line description

## Security
(findings from sub-agent 1, severity-sorted)

## Performance
(findings from sub-agent 2, severity-sorted)

## Conventions
(findings from sub-agent 3, severity-sorted)

## Type safety
(findings from sub-agent 4, severity-sorted)

(optional sections per extra role)

## Cross-cutting patterns
Anything two or more reviewers flagged in the same area — these are usually the highest-leverage fixes.

## Suggested order of fixes
Numbered list, critical first.
```

## Style rules

- No emojis.
- Each finding is one line. Multi-paragraph findings go in a code block immediately under the one-liner, not inline.
- Severity tags in brackets: `[critical]`, `[major]`, `[minor]`.
- Always include file:line. If the issue spans a region, use `file:start-end`.
- If a sub-agent returns nothing, write "No findings." under its section — do not omit the section.
- Do not edit code. Do not auto-fix. Reporting only.

## After writing

Print the consolidated report directly. End with a one-line suggestion: typically `/log_progress` to record the review, or a pointer to the highest-priority fix.
