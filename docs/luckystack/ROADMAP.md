# LuckyStack Roadmap

> Future work that is intentionally out of scope for the current branch. Grouped by category so an AI agent or contributor can scan it quickly and pick up an item without re-litigating context.
>
> This is a living document. When an item lands, remove it (don't strike it through) — git history keeps the record. Items that shipped (npm scope registration, `private:false` flip, Redis-key formatter R3, secret-manager server, per-package `CHANGELOG.md`, full unit-test coverage) were removed here once done.

---

## 1. External packages and repositories

These live outside the framework monorepo. The framework ships thin adapters or concept docs; the heavy lifting happens in dedicated repos.

### `@luckystack/monitoring`

- **What**: Pluggable monitoring/observability layer covering metrics, traces, and dashboards.
- **Where**: Separate git repo (not yet created).
- **Relationship to framework**: The framework ships only a thin adapter surface (similar to how `@luckystack/error-tracking` works); the heavy logic lives in the dedicated repo.
- **Status**: Not started. Web-vitals folds into this as a subpath, not a standalone package. Rationale captured in memory `[[project_monitoring_separation]]`.

### `@luckystack/sync-docs` CLI

- **What**: `npx @luckystack/sync-docs` refreshes a consumer's `docs/luckystack/` snapshot when the framework receives doc updates. Diff-merge aware so consumer-custom edits are preserved.
- **Status**: Not built. For MVP the scaffold-time copy is sufficient. Consumers can manually re-run `npx create-luckystack-app` against a temp dir and copy the deltas if they care about staying in sync.

---

## 2. Niche edge-cases that require framework changes

### Custom JWT signing as alternative session backend

- **Status**: Sessions are Redis-backed via `sessionAdapter` (registry exists, default reads/writes Redis). There is no JWT mechanism.
- **Proposed**: Add a `JwtSessionAdapter` variant alongside the existing Redis adapter, plus a config slot (`auth.sessionMode: 'redis' | 'jwt'`). New code in `@luckystack/login` for sign/verify, env keys for the signing secret, optional JWKS rotation.
- **Scope**: New module in `@luckystack/login` (~300 lines), updates to login flow, docs, and tests. Apt for a dedicated sprint.

---

## 3. Verification still owed (smoke / live testing)

Not blockers, but worth verifying before relying on them.

- **Microsoft OAuth never end-to-end tested** — requires an Azure AD tenant. Other providers (Google, GitHub, Discord, Facebook) are verified.
- **`npm run server` smoke not re-run recently** — full dev-server boot after the latest sweeps has not been manually verified. Recommended before push.
- **Consumer `postinstall` artifact regen** — does `npm run generateArtifacts` regenerate `apiTypes.generated.ts` correctly on a fresh `npx create-luckystack-app` install?

---

## 4. Tech debt for future sweeps

### Documentation

- **Split `docs/ARCHITECTURE_PACKAGING.md`** — currently the largest doc in the repo. Hard to scan and creates merge-conflict hotspots.
- **`packages/server/docs/security-defaults.md` + `http-routes.md`** still mention hardcoded `'x-csrf-token'` — should reference `registerCsrfConfig()` now.

### Tooling

- **JSDoc-based `CLAUDE.md` Function INDEX regenerator** — currently hand-curated. Worth building (~100-line Node script reusing `packages/devkit/src/typeMap/extractors.ts`) when drift between source signatures and the INDEX table becomes a recurring chore. Until then, the periodic-review approach is fine.
- **Optional runtime warning in `registerCsrfConfig()`** when `cookieOptions.httpOnly === true` is set (since that would break client-side reads once cookie-issued CSRF mode lands).

### Generated files

- **`apiTypes.generated.ts` `session.*` paths** — in the framework repo, TypeScript resolves the workspace dependency to its source folder (`../../packages/login/src/session`). In a consumer repo this resolves to `node_modules/@luckystack/login` and works correctly, so it is only cosmetically odd in the framework. A `tsconfig` paths tweak could normalise this.

---

## 5. How to pick up an item from this roadmap

1. **Read the relevant section above** plus any linked memory or doc.
2. **Search `branch-logs/<branch>.md`** in the archive directory for prior context.
3. **Check `docs/AGENT_TEAM_PLAYBOOK.md`** — captures the rationale for why some patterns were intentionally left as-is.
4. **Start a new branch** named for the work (`feat/jwt-session-adapter`, `feat/sync-docs-cli`, etc.).
5. **Remove the item from this `docs/ROADMAP.md`** when it lands. Treat it as a living document, not historical record.
