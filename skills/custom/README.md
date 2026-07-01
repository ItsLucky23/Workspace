# Custom Skills

Framework- and project-specific skills authored in this repository.

## Convention

- One folder per skill: `skills/custom/<skill-name>/`
- Each folder MUST contain a `SKILL.md` file with the workflow definition.
- Optional: additional files (templates, code snippets, examples) live in the same skill folder and are referenced from `SKILL.md`.
- Folder names use `lower-kebab-case`.

## Available Skills

| Skill | Purpose |
| --- | --- |
| [`a11y-audit/`](./a11y-audit/SKILL.md) | Run axe-core against every route plus Tailwind-token contrast validation. |
| [`add-new-api/`](./add-new-api/SKILL.md) | Add a new API endpoint under `src/{page}/_api/` with template + typing. |
| [`add-new-component/`](./add-new-component/SKILL.md) | Scaffold a new `src/_components` UI component matching the framework's tokens/patterns + mirror to the template. |
| [`add-new-package/`](./add-new-package/SKILL.md) | Scaffold a new `@luckystack/*` package in the monorepo with full setup. |
| [`add-new-page/`](./add-new-page/SKILL.md) | Scaffold a new page (`src/{path}/page.tsx`) with template + optional middleware. |
| [`agent-browser/`](./agent-browser/SKILL.md) | Generate per-route E2E tests using `@vercel-labs/agent-browser`. |
| [`agent-browser-verify/`](./agent-browser-verify/SKILL.md) | Interactively verify a running flow (esp. the login matrix) with agent-browser — propose + get user approval first. |
| [`audit-api-rate-limits/`](./audit-api-rate-limits/SKILL.md) | Scan API endpoints and flag missing/suspect rate-limit configs. |
| [`audit-error-code-coverage/`](./audit-error-code-coverage/SKILL.md) | Cross-check error codes against locale JSON files; flag missing translations. |
| [`audit-invalid-page-locations/`](./audit-invalid-page-locations/SKILL.md) | Scan pages and flag files that aren't routeable under the invisible-parent convention. |
| [`audit-page-middleware-coverage/`](./audit-page-middleware-coverage/SKILL.md) | Flag pages that should have a middleware export but don't (e.g. `/admin` without auth). |
| [`audit-sync-pairing/`](./audit-sync-pairing/SKILL.md) | Flag orphaned sync files (client without server or vice versa). |
| [`daily-handoff/`](./daily-handoff/SKILL.md) | Produce a structured handoff document when closing a session (slash-command alternative: `/save_handoff`). |
| [`ideas/`](./ideas/SKILL.md) | Surface feature gaps and improvement candidates across the repo, bucketed by effort. |
| [`lighthouse/`](./lighthouse/SKILL.md) | Run Lighthouse, parse the unused-JS audit, and propose code-split candidates. |
| [`perf-budget/`](./perf-budget/SKILL.md) | Capture a bundle-size baseline and guard against regressions on subsequent builds. |
| [`security-audit/`](./security-audit/SKILL.md) | OWASP-flavoured sweep: npm audit, secrets, auth coverage, security headers. |
| [`upgrade-deps/`](./upgrade-deps/SKILL.md) | Semver-aware dependency updater: bump patch/minor safely, surface majors individually. |

## Authoring Guide

When adding a new skill:

1. Pick a clear, verb-first name: `add-new-<thing>`, `migrate-<x>-to-<y>`, `audit-<area>`.
2. Create the folder and write `SKILL.md` with numbered steps, code-fenced templates, and links to the relevant files in `docs/`.
3. Add a row to the index above.
4. Keep the skill focused on one workflow. If you find yourself adding "alternative paths", split into multiple skills.
