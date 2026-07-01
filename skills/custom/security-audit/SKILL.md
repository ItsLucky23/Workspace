---
name: security-audit
description: OWASP-flavored sweep across deps, secrets, auth coverage, and security headers.
category: audit
---

# Skill: /security-audit

Single-shot security sweep. Runs `npm audit`, scans for hardcoded secrets, checks route auth coverage, and inspects the server bootstrap for missing security headers. Output is a prioritized findings list (CRITICAL / HIGH / MEDIUM / LOW) with file:line and remediation.

## When to use

- Before a public release.
- After a dependency bump (`/upgrade-deps` finished a wave).
- Periodically (at least quarterly) — the threat surface drifts.
- After an incident, to widen the search beyond the specific root cause.

## Workflow

### 1. `npm audit`

Run `npm audit --json` and parse. Map advisories to severity:

- `critical` / `high` → CRITICAL.
- `moderate` → MEDIUM.
- `low` / `info` → LOW.

For each, capture the package, advisory URL, and the fixed version.

### 2. Secret scan

Prefer `gitleaks` if installed:

```bash
gitleaks detect --no-git --source . --report-format json --report-path gitleaks.json
```

If `gitleaks` is not installed, fall back to a Grep sweep over `src/`, `packages/`, `scripts/`:

- `(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']`
- `-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----`
- AWS-style: `AKIA[0-9A-Z]{16}`

Always SKIP `.env.local`, `*.lock`, and `dist/`.

Each match → HIGH (or CRITICAL if it matches a known cloud-provider prefix).

### 3. Route auth coverage

Cross-reference with `/audit-page-middleware-coverage` (or read its source if not installed). For every page under `src/<page>/page.tsx`:

- Pages with no `middleware` export AND a sensitive name keyword (`admin`, `settings`, `billing`, `account`) → HIGH.
- Pages with `middleware` export but the handler returns truthy unconditionally → MEDIUM.

For every API under `src/<page>/_api/*_v*.ts`:

- `auth.login: false` on a write route → HIGH.
- `auth.login: false` + no rate limit on a write route → CRITICAL.

### 4. Security headers

Read the server bootstrap (search by Grep for `createServer` / `httpServer.listen` / `setHeader`):

- Missing `Content-Security-Policy` → HIGH.
- Missing `X-Frame-Options` (or no `frame-ancestors` in CSP) → MEDIUM.
- Missing `Strict-Transport-Security` (HSTS) on prod-mode binding → HIGH.
- Missing `X-Content-Type-Options: nosniff` → LOW.
- Missing `Referrer-Policy` → LOW.

Note: if the user runs behind a reverse proxy that injects headers, the absence in code is acceptable. Note this in the report so the user can confirm.

### 5. Report

```
[security-audit] <YYYY-MM-DD>

CRITICAL (2):
  - api/auth/sendReset/v1            rateLimit: false + auth: none
    Fix: set rateLimit: 5, keep auth: { login: false }.
  - npm audit: lodash@4.17.20 — prototype pollution (CVE-2021-23337)
    Fix: npm i lodash@latest (4.17.21+).

HIGH (4):
  - src/admin/page.tsx               no middleware export on /admin
    Fix: add `export const middleware: MiddlewareHandler = ...` requiring role: 'admin'.
  - secret scan: src/scripts/seed.ts:14 — looks like an AWS key.
    Fix: move to .env.local, reference via process.env.
  ...

MEDIUM (3):
  ...

LOW (1):
  ...

OK:
  - HSTS header set in packages/server/src/createServer.ts:88
  - CSP set in same file:91
  - npm audit: no high/critical advisories.
```

## Verification

- Every finding has file:line OR (for `npm audit`) package@version.
- Every finding has a remediation step.
- Re-running after applying fixes drops the finding from the next report.

## Notes / Limitations

- `gitleaks` is optional. Without it, the regex sweep has higher false-positive rate.
- Does NOT detect runtime-only issues (e.g. SQL injection via dynamic Prisma queries). Use code review + `/parallel_review` for that.
- CSP detection is text-based — if CSP is set via a middleware library, the skill may miss it. Note in the report and request human verification.
- Does NOT run penetration tests. For that, use an external tool (OWASP ZAP, Burp).
