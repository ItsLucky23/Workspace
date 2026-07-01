# Workspaces — AI Development Contract (root `CLAUDE.md`)

> **This is a TEMPLATE.** Copy it to the **new Workspaces repo root** as `CLAUDE.md`. Do **not** edit it in place in `src/workspaces/_docs/` — the live copy lives at repo root.
> Generated **2026-06-04** from the LuckyStack root `CLAUDE.md` (framework rules carried over) + `src/workspaces/_docs/V1_SCOPE.md` (the V1 ground truth). Keep it tight: this is a root contract, not a spec. The specs live under `src/workspaces/_docs/`.

---

## Project snapshot (one paragraph)

**Workspaces** is a self-hosted, AI-driven dev-orchestration app built **on top of `@luckystack/*`** (React 19 + raw Node.js + Socket.io, file-based `_api`/`_sync` routing, function-injection, Prisma, Redis). A user writes simple tickets; a configurable **pipeline of stages** (refine → plan → implement → test → review) drives each ticket; the human is a **man-in-the-middle** who only **approves and answers questions** — ideally from a phone. **V1 is one deliberately small end-to-end slice: Claude CLI (interactive node-pty PTY, Max subscription) + GitLab only, on a single self-hosted host** (orchestrator + web-app + Mongo + Redis + per-ticket containers all on one box). The whole `src/workspaces/` folder is drag-dropped into this fresh repo, the `@luckystack` install commands run, and an AI is pointed at the build-handoff doc, reads the doc set, and asks where to start.

---

## Read order (do this FIRST, every session)

Before touching any Workspaces code, read **in this order**:

1. **`src/workspaces/_docs/BUILD_HANDOFF.md`** — the master entry doc; where to start, current state, lane status.
2. **`src/workspaces/_docs/V1_SCOPE.md`** — the **definitive ground truth for what V1 *is***. The broader doc set (01–08, 04b, the all-in-one layer, the 24 `features/` docs) describes a **bigger system than V1 ships**. Where any other doc over-describes beyond V1, **V1_SCOPE wins** (its §5). It selects the *what*; the build-docs supply the *how*.
3. **`src/workspaces/_docs/BUILD_ORDER.md`** — the sequenced build plan + lane gating (Phase 0 / the P0.5 CLI billing spike gates the rest; then the 4 non-overlapping lanes).

Then, as needed for the piece you're building, the owning build-doc: `07b` (containers), `CONTROL_API` (writes), `04b` (persistence), `GOLDEN_PLAN_STAGE` (stage-config renderer), `P0_CLI_SPIKE` (the gate), `CLIENT_AND_PUSH` (push), `MIGRATION` (prototype→real port). Code resolution: `REFERENCE_CODES.md`.

---

## Carried-over LuckyStack working rules (still apply)

These are the framework conventions Workspaces inherits from LuckyStack. They govern *every* IN piece of V1.

- **File-based `_api` / `_sync` routing.** `src/{page}/_api/{name}_v{N}.ts` → `api/{page}/{name}/v{N}`; `src/{page}/_sync/{name}_server_v{N}.ts` (+ optional `_client_v{N}.ts`) → `sync/{page}/{name}/v{N}`. `_`-prefixed folders are private/never routed. Follow the API/sync handler shapes (`main({ data, user, functions })`, `AuthProps`, `ApiResponse`).
- **Function-injection system.** In API/sync handlers prefer injected `functions.*` (`functions.tryCatch.tryCatch`, `functions.sleep.sleep`, `functions.db`, `functions.redis`, `functions.session`, …) over direct package imports. Spec: `docs/ARCHITECTURE_FUNCTION_INJECTION.md` (shipped via `@luckystack`). Treat the generated `apiTypes.generated.ts` as the source of truth.
- **Strict typing / no casts.** NEVER write `{} as unknown as TYPE`, `as any`, or `as unknown as TYPE`. No unsafe wrappers around `apiRequest` / `syncRequest` / `upsertSyncEventCallback`. If typing fails, FIRST regenerate artifacts (`npm run generateArtifacts`); if the generator output is wrong, fix the generator — never cast around it. No lint rules disabled.
- **Error handling via `tryCatch`.** In handlers use injected `functions.tryCatch.tryCatch(...)`; elsewhere `import { tryCatch } from '@luckystack/core'`. Check the `[error, result]` tuple's first value. Never raw `try/catch`.
- **i18n mandatory** for all user-facing text via the `useTranslator` pattern (`src/_functions/translator`).
- **Tailwind tokens only.** Colors come **only** from the `src/index.css` `@theme` block (surfaces, text, accent, semantic, utility tokens). Never arbitrary hex. Always backticks in `className`.
- **Reuse before authoring.** Check existing `src/_functions` helpers, `src/_components` primitives, and the generated `docs/AI_CAPABILITIES.md` / `docs/AI_PROJECT_INDEX.md` snapshots BEFORE writing a new helper, component, or route. If a capability lives in a not-yet-installed `@luckystack/*` package, propose the install instead of reimplementing.
- **Surgical changes.** Every changed line traces to the request. No drive-by "improvements", refactors, or formatting churn in adjacent code. Match existing style. Report out-of-scope issues — don't auto-fix them. Clean up only the imports/variables your change orphaned.
- **Lint + build after every code change.** Run `npm run lint && npm run build` autonomously — zero warnings, zero errors before declaring done. Re-read your own diff on larger work.
- **Autonomous vs ask command split.**
  - **Autonomous (no permission):** `npm run lint`, `npm run build`, the `ai:*` index/capabilities/project-index scripts, `npm run scaffold:test`, all git **read** commands (`status`/`diff`/`log`/`branch`), `git add` + `git commit`, and all Grep / Glob / Read.
  - **Always ask:** `npm install`, `prisma migrate`, **server start**, `rm`, force-pushes, branch-deletes. Server start is always a developer action.
- **No ad-hoc string-replacement / regex-mutation scripts** outside the Edit/Write tools. **No loose `.md`/`.txt` in repo root** — docs live under `docs/` or `src/workspaces/_docs/`.
- **Branch-log protocol.** Append to `branch-logs/<sanitized-branch>.md` after any prompt with real code/architecture changes, and update the matching `branch-logs/INDEX.md` row. Skip for lint/typo/translation-only edits; when in doubt, log.

---

## Workspaces-specific standing rules (non-negotiable invariants)

These hold on **every** orchestrator-side path and **every** write, for the life of V1.

- **B-23 — single-writer.** The flow is always **AI proposes → user accepts (or, for the Assistant, instruction = consent) → the Conductor executes.** The **Conductor is the only writer** of board / git / status. LLMs (Assistant, Stage-Agent) **never** write authoritative state directly.
- **No new verbs.** The 7+6 structured-channel verb surface is **FROZEN** (all `read|propose`, none write). Do not add verbs or entities to "complete" a feature. Every write goes through the **frozen [CONTROL_API] path**: `[control-API] request → preApiExecute (RBAC) → enqueue → Conductor writes`.
- **control-API for ALL writes.** There is no other write path. The Workspace-AI's "execute directly" (instruction = consent) is still a **[control-API] request** (the user's instruction is the authorization), never a write verb. Destructive/irreversible actions (delete workspace, remove member, kill a container, push / merge-trigger) require an **explicit confirm** before enqueue. The Assistant is scoped to a **workspace-action whitelist** — never host/system-level, never out-of-workspace (it cannot reach the host shell or another workspace).
- **`runInTenant` everywhere.** Every sync-handler AND every background worker runs under `runInTenant` row-isolation. Multi-tenancy is by construction, not by convention.
- **Single by design.** One forge (**GitLab** — `GitLabForge` is the only adapter; the `ForgeProvider` seam stays as design), one provider (**Claude PTY** — the single-spawn wrapper, no multi-provider), one host, **single-instance orchestrator** under `lease:orchestrator`. Every multi-\* surface (GitHub, built-in git-server, built-in MR/merge/CI, multi-provider, preview-deploy, analytics, voice) is **OUT of V1** and designed-but-deferred — see `V1_SCOPE.md` §4. Do not build a deferred surface.
- **The P0.5 CLI billing spike GATES the build.** It is the FIRST task. It must prove an interactive PTY bills the Max subscription, `type:http` hooks fire interactively, `/clear` vs `/compact` + `--resume` behave, and managed-token-projection auth works, **before** the container lanes spend effort. A billing/PTY RED escalates — never route around the gate to headless `claude -p` or the Agent SDK.
- **V1_SCOPE wins on conflict.** Precedence: locked V1 scope (`V1_SCOPE.md` §2/§3/§4) → the decided `REVIEW_AND_OPEN_QUESTIONS` / `REVIEW_2` answers → the build-docs' mechanics → `00_SPEC_RECONCILIATION.md` for any `handoff/`-vs-`_docs` conflict.

---

## The 4 non-overlapping build lanes (file-ownership boundaries)

V1 is built as **4 separate AI sessions**, each may use ultracode, none may overlap files. A **Phase 0** (the P0.5 spike + shared types/contracts/scaffolding) precedes them. Non-overlap is enforced by **B publishing the schema/types first** and **A the control-API contracts**, after which A/C/D build against those frozen contracts in **distinct directories**.

| Lane | Owns |
|---|---|
| **A — Engine & Orchestrator** | Server orchestrator + engine + PTY + containers / pty-agent / SSH + control-API **write-handlers** + GitLab push / create-MR-URL + the P0 spike. |
| **B — Data, tenancy & sync-backend** | Prisma schema (incl. `04b` §6–§11) + `runInTenant` + the seq / merge-on-seq event-log + sync backend + migration / bootstrap + seed. |
| **C — Frontend app & realtime-client** | Board / tickets / pipeline UI (reusing the prototype screens) + Assistant chat + realtime sync client + PWA + push + notifications + account / auth UI. |
| **D — Code-editor & changes/config** | The openvscode-server integration + the changes page (diff / highlight / edit) + stage-lock / pause / resume + per-stage config UI + the GOLDEN_PLAN_STAGE renderer + prompts. |

**When you start a session, confirm your lane and stay inside its directories.** If a task would touch another lane's files, stop and flag it rather than reaching across the boundary.

---

## Template provenance

This `CLAUDE.md` was generated **2026-06-04** as a template (`src/workspaces/_docs/REPO_CLAUDE.template.md`) for the new Workspaces repo, distilling the LuckyStack framework rules + the locked V1 scope. The authoritative, evolving specs live under `src/workspaces/_docs/` — start at `BUILD_HANDOFF.md`. Add project-specific rules below this line as the build progresses.

<!-- User project rules (none yet) -->
