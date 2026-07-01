---
name: ideas
description: Surface feature gaps and improvement candidates across the repo, bucketed by effort.
category: analysis
---

# Skill: /ideas

Walk the repo's AI snapshots + recent git history, then produce a markdown report of feature gaps, refactor opportunities, and quick wins — grouped by category and effort bucket. **No code is changed.** The output is a proposal list the user can pick from.

## When to use

- Start of a sprint / planning session where the user asks "what should I work on?"
- After a large feature lands and the user wants a sweep for cleanup / follow-up debt.
- After installing a new `@luckystack/*` package, to surface integration opportunities.
- Periodically (e.g. monthly) — small improvements accumulate and lose visibility.

## Inputs to read

1. `docs/AI_CAPABILITIES.md` — current framework + project capability snapshot.
2. `docs/AI_PROJECT_INDEX.md` — consumer project inventory (routes, pages, helpers, components, cross-refs).
3. `docs/PACKAGE_OVERVIEW.md` — installed and available `@luckystack/*` packages.
4. `git log --oneline -50` — last 50 commits for recent direction.
5. `git log --since="14 days ago" --stat` — what changed in the last 2 weeks.
6. `branch-logs/INDEX.md` — recent branch focus areas.

## Workflow

### 1. Build a mental model

Read the inputs above in parallel. Note:

- Routes with no tests (cross-ref `AI_PROJECT_INDEX.md` against `*.tests.ts` files).
- Helpers that look duplicated (similar names in `src/_functions/` vs `functions/`).
- Pages without `middleware` exports that handle sensitive data.
- API routes with `rateLimit: false` or missing `rateLimit`.
- Sync routes without their paired tests.
- TODO / FIXME / HACK comments via Grep.
- `@luckystack/*` packages available but not installed where a fit exists (e.g. project uses Stripe but no `@luckystack/billing` peer).

### 2. Bucket by effort

| Bucket | Definition |
|---|---|
| **30min** | Single-file change, no migration, no new types. Example: add `rateLimit: 30` to one route. |
| **half-day** | A few files, possibly a new helper or test. No schema change. Example: extract a duplicated util into `src/_functions/`. |
| **multi-day** | New feature, schema change, or cross-package work. Example: add audit-log pipeline. |

### 3. Bucket by category

- **Performance** — bundle size, render perf, N+1 queries, missing indexes.
- **UX** — missing loading states, error toasts, keyboard nav, mobile breakpoints.
- **DX** — missing tests, dead code, missing types, undocumented helpers.
- **Security** — unbounded rate limits, missing auth, secrets in code, missing CSRF.
- **Tests** — coverage gaps, flaky tests, missing scenarios.

### 4. Output a single markdown report

Print it directly back to the user. Do not save to disk unless asked.

## Output format

```markdown
# Ideas — <YYYY-MM-DD>

## Performance
### 30min
- `src/dashboard/_api/listProjects_v1.ts:42` — add Prisma `select` to avoid pulling full rows.
### half-day
- Code-split `src/admin/page.tsx` — currently 240KB, only used by 3% of users.

## UX
### 30min
- `src/login/page.tsx:58` — no loading spinner on submit; user double-clicks.

## DX
### half-day
- 14 routes still call `apiRequest` without route-literal typing. Run `/audit-api-rate-limits` peer for the list.

## Security
### 30min
- `src/auth/_api/sendReset_v1.ts` — `rateLimit: false`. CRITICAL. Suggest `rateLimit: 5`.

## Tests
### 30min
- `src/billing/_api/createInvoice_v1.ts` — no `.tests.ts` neighbor. Run `npm run scaffold:test billing/createInvoice/v1`.
```

Top of the report should include counts: `Total: 18 ideas — 30min: 11, half-day: 5, multi-day: 2`.

## Verification

- Every item references a file path or command.
- Every bucket label matches the rubric.
- No item is fixed by the skill itself.
- Cross-referenced data (e.g. "no tests") is verifiable by re-running a Glob.

## Notes / Limitations

- Does NOT run `npm audit`, `lighthouse`, or any external scanner — those are separate skills (`/security-audit`, `/lighthouse`).
- Quality of output depends on `AI_CAPABILITIES.md` + `AI_PROJECT_INDEX.md` being fresh. Run `npm run ai:capabilities && npm run ai:project-index` first if stale.
- Effort estimates are best-effort; user should sanity-check before committing to a multi-day item.
