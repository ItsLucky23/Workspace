---
name: a11y-audit
description: Run axe-core against every route plus a Tailwind-token contrast check.
category: audit
---

# Skill: /a11y-audit

Spin up the dev server, run `@axe-core/cli` against every page route from `docs/AI_PROJECT_INDEX.md`, and report WCAG violations grouped by severity. Also cross-references Tailwind color tokens in `src/index.css` and flags any token combination that fails WCAG AA contrast.

## When to use

- New page added and the user wants a quick a11y sanity check.
- Tailwind tokens were edited in `src/index.css` — verify contrast didn't regress.
- Before a release.
- Periodically (monthly) — a11y debt accumulates silently.

## Prerequisites

- Install (skill prompts if missing):

  ```bash
  npm i -D @axe-core/cli
  ```

- Dev server must be runnable via `npm run server`.

## Workflow

### 1. Discover routes

Read `docs/AI_PROJECT_INDEX.md` and pull every entry under `src/<page>/page.tsx`. Skip:

- Routes that require auth — unless the user provides a test session cookie via `--session-cookie '<value>'`. Without it, those routes will land on a login redirect and the axe report will be for the login page, not the protected page. Note this clearly.
- Routes with `template: 'plain'` that are redirects.

### 2. Start dev server

Tell the user: "Please start the dev server in another terminal (`npm run server`) and confirm it is bound to http://localhost:5173." The skill does NOT auto-start the server (rule 8 — server start is a developer action).

Once confirmed, proceed.

### 3. Run axe per route

```bash
npx @axe-core/cli http://localhost:5173/<route> \
  --tags wcag2a,wcag2aa,wcag21aa \
  --stdout \
  --exit
```

Capture JSON output per route. Stop on the first auth-redirected route if no session cookie was provided.

### 4. Tailwind contrast cross-check

Read `src/index.css` and pull the `@theme` block. For each pair that is used together in `className` patterns across the codebase (Grep for `bg-<token>.*text-<token>` patterns), compute WCAG AA contrast ratio:

- Normal text: 4.5:1 minimum.
- Large text (>=18pt or >=14pt bold): 3:1 minimum.

Flag any pair below threshold.

Common combinations to check explicitly:

- `bg-primary` + `text-common-primary`
- `bg-secondary` + `text-common-secondary`
- `bg-container1` + `text-common`
- `bg-warning` + `text-title`

### 5. Report

```
[a11y-audit] <YYYY-MM-DD>

Route violations:

  /dashboard
    Critical (1):
      - color-contrast: <button class="bg-primary text-muted">  → contrast 3.2:1, needs 4.5:1.
        Fix: use text-common-primary (5.8:1) instead of text-muted.
    Serious (2):
      - button-name: <button> has no accessible label at src/dashboard/page.tsx:42.
      - link-name: <a> with icon-only content at src/dashboard/page.tsx:88.
    Moderate (0)
    Minor (1)
      - landmark-one-main: page has no <main> element.

  /settings
    Critical (0)
    Serious (0)
    Moderate (1)
    Minor (0)

Tailwind token contrast check:
  - bg-primary + text-muted               3.2:1  FAIL  (used in dashboard, settings)
  - bg-warning + text-title              4.6:1  PASS
  - bg-container2 + text-disabled        2.9:1  FAIL  (intentional? disabled state — but should still hit 3:1)

Summary:
  6 routes audited, 1 skipped (auth without --session-cookie).
  Critical: 1, Serious: 2, Moderate: 1, Minor: 1.
  Tailwind: 2 token pairs fail AA contrast.
```

## Verification

- Every violation has file:line (or the route URL if file mapping is unavailable).
- Every Tailwind finding lists ALL routes that use the failing combo.
- Re-running after fixes drops the finding from the next report.

## Notes / Limitations

- `@axe-core/cli` is REQUIRED — skill aborts with a clear message if it is not installed.
- Routes behind auth need `--session-cookie` flag; otherwise they are skipped.
- The Tailwind contrast pass is heuristic — it Greps the codebase for `bg-X.*text-Y` patterns. Dynamic class names (`className={dynamic}`) are not detected.
- Does NOT cover keyboard-navigation flows or screen-reader semantics beyond what axe-core catches. Manual testing is still recommended.
