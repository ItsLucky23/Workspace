---
name: lighthouse
description: Run Lighthouse against the LuckyStack app and surface concrete code-split candidates.
category: audit
---

# Skill: /lighthouse

Run the Lighthouse CLI against either the dev server or the built `dist/`, parse the `unused-javascript` and `bootup-time` audits, cross-reference the `rollup-plugin-visualizer` JSON, and output a ranked list of `React.lazy()` candidates with file:line and expected bundle-size reduction.

## When to use

- Page TTI feels slow after a recent feature landed.
- Bundle size grew significantly (check `dist/*.js` against last week).
- Before a release where Core Web Vitals matter.
- Periodically (monthly) — bundle bloat is silent and cumulative.

## Prerequisites

- `lighthouse` CLI: `npm i -D lighthouse` (the skill warns if not installed).
- `rollup-plugin-visualizer`: add to `vite.config.ts` with `emitFile: true, filename: 'stats.json', template: 'raw-data'` for the JSON cross-ref. Without it, the skill still works on Lighthouse output alone, just without source mapping.

## Workflow

### 1. Pick target mode

Ask the user (or auto-pick based on flag):

- `--dev` — start `npm run server`, wait for it to bind to `localhost:5173`, then audit.
- `--prod` (default) — `npm run build`, serve `dist/` via `npx serve -s dist -l 4173`, then audit.

`--prod` gives realistic numbers. `--dev` is useful for quick iteration but never trust the score.

### 2. Run Lighthouse

```bash
npx lighthouse http://localhost:<port>/ \
  --output=json \
  --output-path=./lighthouse.json \
  --chrome-flags="--headless --no-sandbox" \
  --only-categories=performance \
  --quiet
```

For multi-route coverage, loop over routes from `docs/AI_PROJECT_INDEX.md` and produce one JSON per route.

### 3. Parse the JSON

Read `lighthouse.json` and pull these audits:

- `audits['unused-javascript'].details.items` — each item has `url`, `wastedBytes`, `wastedPercent`.
- `audits['bootup-time'].details.items` — each item has `url`, `scripting`, `scriptParseCompile`.
- `audits['render-blocking-resources'].details.items` — for early-network optimisations.

### 4. Cross-ref with visualizer JSON

If `dist/stats.json` exists, walk the chunk tree to map each Lighthouse `url` (e.g. `/assets/admin-abc123.js`) back to its source modules. Pick the top 3 source files per chunk by `renderedLength`.

### 5. Rank candidates

A chunk is a code-split candidate when:

- `wastedBytes > 30000` (30KB+ unused on first load), AND
- The chunk's top source module is a page-level component (lives under `src/<page>/`) or a heavy helper.

For each candidate, propose:

```typescript
// before
import AdminDashboard from './AdminDashboard';

// after
const AdminDashboard = React.lazy(() => import('./AdminDashboard'));
```

Wrap in `<Suspense fallback={...}>` at the call site.

### 6. Report

```
[lighthouse — prod build]
Score: 78  (LCP 2.4s, TBT 320ms, CLS 0.02)

Code-split candidates (sorted by expected savings):

  1. src/admin/page.tsx                       wasted: 184KB / 240KB (76%)
     → wrap in React.lazy, expected first-load savings ~180KB.
  2. src/_components/RichTextEditor.tsx        wasted:  92KB / 110KB (84%)
     → only used in src/posts/edit/page.tsx — lazy on parent.
  3. src/_functions/pdfRenderer.ts             wasted:  60KB / 64KB  (94%)
     → dynamic-import inside the export function, drop top-level import.

Bootup-time hotspots:
  - vendor-chunk.js — 280ms scripting. Consider Vite manualChunks split for date-fns.

Render-blocking:
  - <none>
```

## Verification

- `lighthouse.json` exists and parses.
- Every candidate's file path is reachable via Read.
- Suggested diff compiles (you don't need to apply it, but it should be syntactically valid).

## Notes / Limitations

- Lighthouse scoring varies run-to-run by ~5 points. Run twice if the score is borderline.
- The skill does NOT apply the `React.lazy` swap — output is a proposal.
- If `stats.json` is missing, source-mapping is best-effort by chunk filename only.
- Dev-mode scores are not comparable to prod scores; the user is reminded in the report header.
