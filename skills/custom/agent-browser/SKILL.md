---
name: agent-browser
description: Scaffold E2E browser tests per page route using vercel-labs agent-browser.
category: automation
---

# Skill: /agent-browser

Generate per-route E2E tests under `e2e/<route>.test.ts` using [`@vercel-labs/agent-browser`](https://github.com/vercel-labs/agent-browser). One test per page route discovered via `docs/AI_PROJECT_INDEX.md`. Tests run headless in CI.

## When to use

- Project has no E2E coverage yet.
- A new page was added and the user wants smoke coverage for it.
- Before a release where regressions on key flows would be costly.

## Prerequisites

- Install (skill prompts if missing):

  ```bash
  npm i -D @vercel-labs/agent-browser
  ```

- Add to `package.json` scripts:

  ```json
  "test:e2e": "agent-browser run e2e/**/*.test.ts"
  ```

- GitHub Actions Ubuntu runners ship Chrome, so no extra browser install is needed in CI.

## Workflow

### 1. Discover routes

Read `docs/AI_PROJECT_INDEX.md`. Pull every page entry (lines describing `src/<page>/page.tsx`). Skip:

- Private folders (prefixed `_`).
- Pages with `template: 'plain'` that are redirect-only.

The user can pass `--only <route>` to scope to one.

### 2. Pick the test shape per route

Standard pattern: **navigate → assert title → check key element → submit form (if present) → assert outcome.**

For each route, Read `src/<route>/page.tsx` and detect:

- Whether the page has a `<form>` element.
- The visible `<h1>` or page title.
- Required auth (`middleware` export) — if present, scaffold a pre-login step using `agent-browser`'s session helper.

### 3. Generate `e2e/<route>.test.ts`

Template (auth-required pages):

```typescript
import { test, expect } from '@vercel-labs/agent-browser';

test('<route>: loads + happy-path interaction', async ({ page, session }) => {
  await session.loginAs('e2e-test-user@example.com');
  await page.goto('/<route>');

  await expect(page.locator('h1')).toHaveText(/<expected title pattern>/i);
  await expect(page.locator('[data-testid="<key-element>"]')).toBeVisible();

  // If a form exists:
  await page.fill('input[name="<field>"]', '<sample value>');
  await page.click('button[type="submit"]');
  await expect(page.locator('[role="alert"]')).toContainText(/saved|success/i);
});
```

For public pages, omit the `session.loginAs` line.

### 4. Add a CI workflow stub (only if `.github/workflows/e2e.yml` is missing)

Propose `.github/workflows/e2e.yml`:

```yaml
name: e2e
on: [pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - run: npm run test:e2e
```

### 5. Report

```
[agent-browser]
Routes discovered: 14
Tests generated: 12 (skipped 2 redirect-only routes)
Files written:
  e2e/dashboard.test.ts
  e2e/settings.test.ts
  ...

Next steps (manual):
  - Replace <expected title pattern> placeholders.
  - Confirm data-testid attributes exist or add them.
  - Run: npm run test:e2e
```

## Output format

A summary as above plus the list of files written. The tests themselves contain TODO markers where the generator could not infer the right selector.

## Verification

- `npm run test:e2e` discovers all generated files.
- At least the navigate + title assertion passes for each route (others may need data-testid backfill).
- CI workflow file is valid YAML (lint via `yamllint` if available).

## Notes / Limitations

- `@vercel-labs/agent-browser` is an EXTERNAL dependency — the skill will not scaffold tests until it is installed.
- The generator cannot infer business-logic assertions; it provides a skeleton.
- Auth helper assumes `session.loginAs` is configured against the project's session strategy — manual wiring may be required on first run.
- Generated tests overwrite existing `e2e/<route>.test.ts` files — back up first if you have customizations.
