---
name: perf-budget
description: Bundle-size regression guard with baseline capture and per-build diff check.
category: quality
---

# Skill: /perf-budget

Bundle-size regression guard. First run captures baseline `dist/*.js` sizes to `perf-budget.json` at repo root. Subsequent runs diff the current build against the baseline and fail if any chunk exceeds the configured threshold (default 5%, configurable in the JSON).

## When to use

- CI step on every PR to prevent silent bundle bloat.
- After a refactor where the user wants to confirm size didn't regress.
- Before a release.

## Commands

Add to `package.json` scripts:

```json
"perf:baseline": "node scripts/perfBudget.mjs baseline",
"perf:check": "node scripts/perfBudget.mjs check"
```

`perf:baseline` writes / overwrites `perf-budget.json`.
`perf:check` reads it, runs a fresh `npm run build`, diffs, exits 1 on regression.

## `perf-budget.json` shape

```json
{
  "threshold": 0.05,
  "perChunkThreshold": {
    "vendor": 0.10
  },
  "ignore": [
    "stats.json"
  ],
  "baseline": {
    "assets/index-abc123.js": 184320,
    "assets/vendor-def456.js": 412000
  },
  "capturedAt": "2026-05-15T10:24:00Z",
  "capturedFromCommit": "2bf770c"
}
```

- `threshold` — global default. 0.05 = 5%.
- `perChunkThreshold` — override by chunk filename prefix (vendor chunks tend to vary more).
- `ignore` — never check these.

## Workflow

### Baseline mode

1. Run `npm run build`.
2. Walk `dist/**/*.js`. For each, record byte size keyed by filename.
3. Normalize chunk filenames: strip Vite's content hash (`-abc123`) to a stable key (`assets/index-*.js`).
4. Write `perf-budget.json` with current sizes, threshold (default 0.05), commit SHA, and timestamp.
5. Tell the user: "Baseline captured. Commit `perf-budget.json` so CI can diff against it."

### Check mode

1. Read `perf-budget.json`. Abort if missing — tell the user to run `npm run perf:baseline` first.
2. Run `npm run build`.
3. Walk `dist/**/*.js`, normalize filenames, build current-size map.
4. For each chunk in the baseline:
   - If missing in current → WARN ("chunk removed — was a code-split lost?").
   - If `(current - baseline) / baseline > threshold` → FAIL.
5. For each new chunk in current not in baseline:
   - INFO ("new chunk added: <name> at <size>").
6. Exit 1 on any FAIL. Exit 0 otherwise.

### Output format

```
[perf-budget] check vs baseline (2026-05-15)
Threshold: 5% (vendor: 10%)

PASS  assets/index-*.js       184.3KB → 186.1KB  (+1.0%)
PASS  assets/vendor-*.js      412.0KB → 432.0KB  (+4.9%)
FAIL  assets/admin-*.js       240.0KB → 290.0KB  (+20.8%)   <-- exceeds 5% threshold
INFO  new chunk: assets/reports-*.js  64.0KB

Result: FAIL (1 regression).
Either:
  - Investigate src/admin/* for accidental imports.
  - Run /lighthouse to find code-split candidates.
  - Re-baseline if the regression is intentional: npm run perf:baseline.

Exit code: 1
```

### CI integration

GitHub Actions snippet (the skill emits this if `.github/workflows/perf-budget.yml` is missing):

```yaml
name: perf-budget
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run perf:check
```

## Implementation

The skill creates `scripts/perfBudget.mjs` with both `baseline` and `check` subcommands. The script:

- Uses `node:fs` + `node:path` only (zero deps).
- Reads gzipped sizes too (write `size` AND `gzipSize` in the JSON).
- Strips Vite hash via regex: `/-[a-f0-9]{8,}\.js$/` → `-*.js`.

## Verification

- `npm run perf:baseline` then `npm run perf:check` immediately after = exit 0.
- Adding a 60KB module to a chunk and re-checking = exit 1.
- `perf-budget.json` round-trips through `JSON.parse(JSON.stringify(...))` cleanly.

## Notes / Limitations

- Compares only `*.js` chunks. CSS / asset budgets are out of scope (open a follow-up skill if needed).
- Vite's hash is the only filename volatility this handles. If your bundler uses a different scheme, edit the strip regex.
- A re-baseline silently accepts new size — make sure to commit the JSON change with a clear message so reviewers see the budget moved.
- Does NOT measure runtime perf (TTI, LCP). That's `/lighthouse`.
