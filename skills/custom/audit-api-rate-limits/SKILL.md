# Skill: audit-api-rate-limits

Scan every `src/**/_api/*_v*.ts` and flag rate-limit configurations that look suspect: missing entirely, set to `false` (unlimited) on a write endpoint, or set to an unusually-high number on an auth/billing surface.

## When to use

- Before publishing a public API surface.
- After a security review surfaces unbounded endpoints.
- Periodically — new APIs added without thinking about rate limits accumulate fast.

## Heuristics

### Tier 1: hard flags

- `export const rateLimit = false` on a write-shaped route (POST/PUT/DELETE inferred from name OR `httpMethod` export) → **HIGH**: anyone can hammer it.
- `export const rateLimit = false` on an auth/password/billing route (route name contains `login`, `register`, `reset`, `password`, `billing`, `invoice`, `charge`, `subscribe`) → **CRITICAL**: this is the password-stuffing / card-testing surface.
- Missing `rateLimit` export entirely → **MEDIUM**: route silently uses `projectConfig.rateLimiting.defaultApiLimit`. Probably fine but worth confirming.

### Tier 2: soft flags

- `rateLimit > 600` on a public (auth.login: false) route → **LOW**: 10 req/sec per requester is a lot.
- `rateLimit > 60` on an auth/reset/billing surface → **MEDIUM**: probably too generous.

## Workflow

### 1. Discover APIs

Glob: `src/**/_api/*_v*.ts` (skip `.tests.ts` via the routing test-file rule).

### 2. Parse exports per file

For each file, use Grep to extract:

- `export const rateLimit = ...` value (number, false, or absent)
- `export const httpMethod = ...` value (default = inferred from name prefix: `get*` → GET, `delete*` → DELETE, else POST)
- `export const auth = {...}` — specifically `login: true` vs `login: false`

### 3. Classify each finding

Build a record `{ routeKey, rateLimit, method, requiresLogin, severity, reason }`. Apply the tier rules. Bucket by severity.

### 4. Report

```
[audit-api-rate-limits]
  CRITICAL (1):
    api/auth/login/v1                    rateLimit: false   (auth surface; password-stuffing risk)

  HIGH (2):
    api/orders/create/v1                 rateLimit: false   (POST write endpoint, no auth required)
    api/feedback/submit/v1               rateLimit: false   (POST write endpoint)

  MEDIUM (5):
    api/admin/listUsers/v1               rateLimit: missing  (using default; admin surfaces deserve explicit ceiling)
    api/billing/createInvoice/v1         rateLimit: 120      (>60 on a billing route)
    ...

  LOW (3):
    api/search/query/v1                  rateLimit: 1000     (high; OK if cached, otherwise consider 300)
    ...
```

End with the total + a remediation snippet.

### 5. Suggest fixes

For each finding, propose a specific number based on category:

| Category | Suggested ceiling |
|---|---|
| Login / register / password reset | 5 per minute per IP |
| Billing / invoice / charge | 10 per minute per user |
| Admin actions | 30 per minute per user |
| Write actions (generic) | 30 per minute per user |
| Read-heavy queries | 120 per minute per user |
| Public read | 600 per minute per IP |

Generate per-route diffs only when the user confirms.

## Example finding + correction

```
api/auth/sendReset/v1 → rateLimit: false (CRITICAL)
```

Suggested fix:

```diff
- export const rateLimit: number | false = false;
+ export const rateLimit: number | false = 5;
```

With reasoning: at 5/min, an attacker who steals one IP can only attempt 7,200 emails per day, vs unlimited today. Combined with the framework's per-IP default cap and anti-enumeration response, this drops the password-reset abuse surface dramatically.

## Not in scope

- Doesn't read framework defaults from `projectConfig.rateLimiting` — if a project bumped the default to `1000`, the "missing rateLimit" finding here doesn't know that. Manual review.
- Doesn't check `projectConfig.rateLimiting.defaultIpLimit` — that's a global cap, separate concern.
- Sync routes have their own rate-limit pattern; a separate skill would handle them.
