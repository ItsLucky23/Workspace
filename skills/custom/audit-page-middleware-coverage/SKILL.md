# Skill: audit-page-middleware-coverage

Scan every `src/**/page.tsx` and flag pages that probably need a per-page `middleware` export but don't have one — or have one that's missing an expected check (e.g. `/admin` pages with no role gate).

LuckyStack supports per-page route guards via `export const middleware` on each `page.tsx` (see `docs/ARCHITECTURE_EXTENSION_POINTS.md`). This skill catches the common framework antipattern of putting an admin page somewhere routable but forgetting to gate it.

## When to use

- Before shipping a release that touches `src/admin/**`, `src/settings/**`, or any new "private" surface.
- Periodically during code review — drift accumulates as the team adds pages.
- After a refactor that moved or renamed page folders (URLs change, central middlewareHandler.ts often left stale).

## Workflow

### 1. Configure expected checks per folder prefix

If `.claude/audits/page-middleware-rules.json` exists, read it. Default rules when the file is absent:

```json
{
  "admin": { "requires": ["session", "session.admin"] },
  "settings": { "requires": ["session"] },
  "billing": { "requires": ["session"] },
  "account": { "requires": ["session"] },
  "profile": { "requires": ["session"] }
}
```

The key is the **first non-underscore URL segment** of the route. The `requires` array lists tokens that should appear inside the middleware function body. Tokens are checked as substrings — `session.admin` matches any `session.admin` or `session?.admin` reference.

Consumers can ship their own `.claude/audits/page-middleware-rules.json` to extend or override; an empty `{}` disables the skill (rare).

### 2. Discover every page.tsx

Use Glob with pattern `src/**/page.tsx`. For each result:

- Compute the route via the framework's invisible-parent rule (`_<folder>` segments are stripped). Use the file path relative to `src/`, drop underscore-prefixed segments, drop `page.tsx`. Empty -> `/`.
- Skip pages whose route doesn't match any configured prefix — the skill only flags rule-relevant pages.

### 3. Inspect each matched page

Read the file content. Apply two checks:

1. **Missing middleware**: does the file contain `export const middleware` (or `export {middleware}` from another module)? If not → flag.
2. **Insufficient check**: for each token in the matching rule's `requires`, grep the file for the literal substring. Missing any token → flag.

### 4. Report

Print one line per finding, grouped by folder prefix:

```
[audit-page-middleware-coverage]
  /admin/users   src/admin/users/page.tsx   MISSING middleware export
  /admin/billing src/admin/billing/page.tsx HAS middleware but missing token: session.admin
  /settings      src/settings/page.tsx      OK
```

End with a summary: `N findings across M pages`.

### 5. Offer fixes

For "MISSING middleware" findings, suggest adding the canonical guard for that prefix. Use `Read` to print the page, then propose a patch that adds:

```ts
import type { PageMiddleware } from '@luckystack/core/client';
import type { SessionLayout } from 'config';

export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  // <add role check from .claude/audits/page-middleware-rules.json>
  return { success: true };
};
```

Apply via Edit only when the user confirms.

## Example finding + correction

```
src/admin/page.tsx → MISSING middleware export (rule: admin → requires session.admin)
```

Suggested fix:

```ts
export const middleware: PageMiddleware<SessionLayout> = ({ session: baseSession }) => {
  const session = baseSession as SessionLayout | null;
  if (!session) return { success: false, redirect: '/login' };
  if (!session.admin) {
    notify.error({ key: 'middleware.notAdmin' });
    return undefined; // navigate(-1)
  }
  return { success: true };
};
```

## Not in scope

- This skill doesn't enforce middleware quality (e.g. "does the check actually work"). It only verifies that an expected token is present. Real semantic verification is a code review task.
- API and sync route auth is checked by a different skill (`audit-api-rate-limits` handles APIs).
