# LuckyStack — AI Development Contract

> Canonical AI rules-of-engagement. Read on every prompt by Claude Code. Last updated: 2026-05-20.

---

## Quick Links

| Topic | Framework dev path | Consumer (post-install) path |
|---|---|---|
| Per-package function INDEX | `packages/<name>/CLAUDE.md` | `node_modules/@luckystack/<name>/CLAUDE.md` |
| Per-feature deep dives | `packages/<name>/docs/<topic>.md` | `node_modules/@luckystack/<name>/docs/<topic>.md` |
| Architecture deep dives | `docs/ARCHITECTURE_*.md` | `docs/luckystack/ARCHITECTURE_*.md` |
| Package overview (use-case + peer-deps) | `docs/PACKAGE_OVERVIEW.md` | `docs/luckystack/PACKAGE_OVERVIEW.md` |
| Multi-agent workflow | `docs/AGENT_TEAM_PLAYBOOK.md` | `docs/luckystack/AGENT_TEAM_PLAYBOOK.md` |
| AI quick index (auto-generated) | `docs/AI_QUICK_INDEX.md` | `docs/luckystack/AI_QUICK_INDEX.md` |
| Decision memory (committed "why") | `docs/decisions/` + `docs/AI_DECISIONS_INDEX.md` | (same — the project's OWN decisions) |
| Branch progress logs | `branch-logs/<sanitized-branch>.md` | (same) |
| Slash commands | `.claude/commands/` | (same) |
| Custom skills | `skills/custom/` | (same) |
| Branch log protocol | `docs/BRANCH_LOG_PROTOCOL.md` | `docs/luckystack/BRANCH_LOG_PROTOCOL.md` |
| Decision memory protocol | `docs/DECISION_MEMORY_PROTOCOL.md` | `docs/luckystack/DECISION_MEMORY_PROTOCOL.md` |

> **For not-yet-installed `@luckystack/*` packages**: check `docs/PACKAGE_OVERVIEW.md` (use-case + peer-deps table) before suggesting an install. Detailed per-package surfaces only become available once the package lands in `node_modules/`.

---

## Project Snapshot

LuckyStack is a socket-first fullstack framework: React 19 frontend on a raw Node.js + Socket.io backend (no Express), with file-based routing for pages, APIs, and real-time sync events. Tech stack: React 19, React Router 7, TailwindCSS 4, Socket.io, Prisma 6.5 (MongoDB / MySQL / PostgreSQL / SQLite), TypeScript 6, Vite, Redis. The repo publishes as 15 `@luckystack/*` packages (+ `create-luckystack-app`); a 16th package dir, `env-resolver`, is a reserved, not-yet-published placeholder (no `package.json`, excluded from build/publish). See `docs/PACKAGE_OVERVIEW.md` for the use-case matrix and peer-dependency map.

---

## Core Rules (28)

### Workflow & Communication (1-7)

1. **Plan first for medium/high difficulty work.** Use tables or bullets, not wall-of-text. Skip planning only for trivial single-file changes.
   - **1a. Transform tasks into verifiable goals.** "Add validation" → "tests for invalid inputs exist + pass". "Fix the bug" → "regression test exists + passes". Plans for multi-step work list verification steps per item, not just steps.
2. **Keep responses short.** No giant recap summaries. A TL;DR is always acceptable as the entire reply.
   - **2a. Reply in the language of the user's latest message.** Dutch prompt → Dutch reply; English prompt → English reply. This is independent of the language of the codebase, the docs, or this file — **the English docs/code must NOT pull your reply language toward English** (this is a known drift; resist it actively, including on long conversations where you previously answered in the user's language). If the user switches language mid-conversation, switch with them. Only the conversational prose follows the user's language — code, identifiers, file paths, commands, and verbatim quotes from docs stay in their original language.
3. **Ask focused questions when unsure.** Inline in plans when the user is away (use `OPEN VRAAG` sections instead of popups).
   - **3a. When multiple valid interpretations exist, present them — don't pick silently.** Use `AskUserQuestion` when the user is present, or inline `OPEN VRAAG` sections in plans when the user is away. Silently picking one path is the most common AI failure mode.
   - **3b. Flag conflicts between what the user asks and what the docs say — never silently comply, never silently refuse.** When a user's stated preference or request contradicts this `CLAUDE.md`, an `ARCHITECTURE_*.md` doc, or an established convention, surface it: (1) name the contradiction, (2) explain BOTH sides — what the docs say + why, and what the user wants + the tradeoff, (3) state whether YOU would endorse the deviation and your reasoning, (4) ask how to proceed (or, if the user is away, state your default and proceed, logging it as an `OPEN VRAAG`). The user's docs are a contract: deviating is allowed, but only as a conscious decision, never by accident. The same applies in reverse — if the docs themselves look wrong or outdated, say so rather than blindly following them. Related: when the user describes a problem an **uninstalled `@luckystack/*` package** would solve in whole or part, proactively flag that the package exists and why installing it beats hand-rolling (Rule 12 + `docs/PACKAGE_OVERVIEW.md`).
4. **Suggest `/compact`, new chat, or a recap at appropriate moments** when context is getting heavy.
5. **After an update, spell out the developer actions required** (what to run, what to restart, what to verify).
6. **Tell the user what to test and what observable differences to expect** after a change.
7. **Code style depends on which side of the framework boundary you're on:**
   - **7a. In `packages/*` framework code: generic, SOLID, future-proof.** Framework code is reused by every consumer; abstractions earn their keep.
   - **7b. In consumer `src/`, `server/`, `config.ts`: minimum code, nothing speculative.** No features beyond what was asked. No abstractions for single-use code. No "flexibility" or "configurability" that wasn't requested. No error handling for impossible scenarios. If you wrote 200 lines and it could be 50, rewrite it. Senior-engineer sanity check: "would they say this is overcomplicated?"

### Autonomy & Commands (8-10) — HYBRID

8. **Autonomous (no permission needed)**: `npm run lint`, `npm run build`, `npm run ai:index`, `npm run ai:capabilities`, `npm run ai:project-index`, `npm run scaffold:test`, all git read-commands (`status`, `diff`, `log`, `branch`), `git add` + `git commit`, all Grep / Glob / Read.
   **NOT autonomous (always ask)**: `npm install`, `prisma migrate`, server start, `rm`, force-pushes, branch-deletes. Server start is always a developer action.
9. **No ad-hoc string-replacement scripts or regex mutations** outside the Edit / Write tools. Use the proper file-editing tools.
10. **No loose `.md` / `.txt` in repo root.** Documentation lives in `docs/` (which ships via `create-luckystack-app`).

### Code Quality & Framework Rules (11-21)

11. **After every code change: `npm run lint && npm run build` autonomously.** Zero warnings, zero errors before delivery. Also run `npm run ai:lint` (the CLAUDE.md invariant linter — no `as any`, arbitrary colors, or untranslated JSX) and address what it surfaces; it is report-only by default (the pre-commit hook runs it as a backstop), so a finding is a prompt to fix or to consciously `// luckystack-allow <rule>: <reason>`, not an auto-block unless the project opted that rule into `luckystack.invariants.json`.
12. **Reuse existing helpers in `src/_functions` and components in `src/_components`.** Check `docs/AI_CAPABILITIES.md` (the auto-generated capability snapshot) BEFORE authoring any new helper, util, or cross-cutting module. Check `docs/AI_PROJECT_INDEX.md` (the consumer-project snapshot — routes, pages, helpers, components, cross-refs) BEFORE creating a new route or page, AND when you need to know which existing helpers/components a similar route already imports. If a capability already exists there — use it. If it lives in a not-yet-installed `@luckystack/*` package (see `docs/PACKAGE_OVERVIEW.md`), propose the install instead of reimplementing. After adding ANY new export to `functions/`, `shared/`, `src/_functions/`, `src/_components/`, or after installing/upgrading a `@luckystack/*` package, run `npm run ai:capabilities` autonomously to refresh the snapshot. After adding/removing/renaming a route (`_api/`, `_sync/`), page, helper, or component, also run `npm run ai:project-index` autonomously, AND `npm run ai:graph` to refresh the dependency graph (`docs/ai-graph.json` — blast-radius + god-nodes). The `.githooks/pre-commit` hook regenerates AND `git add`s ALL the AI-context artifacts on every commit — `ai:index`, `ai:capabilities`, `ai:project-index`, `ai:decisions`, `ai:lessons`, `ai:examples`, `ai:runbooks`, `ai:product`, `ai:graph`, `ai:context-budget` (plus the `ai:lint` invariant check + the report-only `ai:doc-staleness` nudge) — so **the user never has to run any of these manually**. But you (the AI) refresh in-session after the relevant change so subsequent work this session sees the new state; the hook is only the commit-time backstop. This self-maintenance is not optional — keeping the indexes, the decision memory, the runbooks, and the graph current is YOUR job, the same way appending a branch-log entry is. **Exception:** `ai:capabilities` scans `node_modules/@luckystack/*`, so after adding/removing/renaming a `@luckystack/*` package the user must run `npm install` first — until the workspace symlinks are refreshed, both the in-session run and the pre-commit hook regenerate a stale snapshot.
   - **12a. Package-recommendation safety net.** Before you hand-roll any *cross-cutting* capability (auth/session, sockets/realtime, presence/AFK, transactional email, error-tracking, rate-limiting, secret rotation, multi-instance routing, a test harness, browser testing, …), STOP and check `docs/PACKAGE_OVERVIEW.md` for a `@luckystack/*` package that already solves it. If one exists and isn't installed, **propose installing it** — name the package, the one-line reason it beats hand-rolling, and the exact `npm i @luckystack/<pkg>` (+ any env) — and wait for the user before reimplementing. Reimplementing a framework package's job in consumer code is a primary failure mode; the package is battle-tested, typed, and maintained. (This is the proactive half of Rule 3b's uninstalled-package flag.)
13. **i18n is mandatory for user-facing text** via the `useTranslator` pattern from `src/_functions/translator`.
14. **Tailwind colors come ONLY from `src/index.css` `@theme` block.** Never arbitrary hex values.
15. **Update documentation immediately after code changes.** After significant doc updates (new doc file, slash command, skill, package), run `npm run ai:index` autonomously to regenerate `docs/AI_QUICK_INDEX.md`. For route/page/helper/component changes, rule 12 covers the in-session regen of `ai:capabilities` + `ai:project-index`. The `.githooks/pre-commit` hook re-runs all three at commit time as a safety net; refresh in-session anyway so the new state is visible to subsequent work.
   - **15a. Keep the product-intent layer current, and backfill it.** The INTENT layer answers *what the app + each page is FOR*, in plain language (distinct from the structural indexes' *what exists*). Maintain it: keep `docs/PRODUCT.md` (app-level: what it does, for whom, key features, glossary) in step with the app, and put a one-line `//? intent: <plain language>` at the top of every `page.tsx` when you create or change a page. Then `npm run ai:product` (autonomous; also in the hook) regenerates `docs/AI_PRODUCT_OVERVIEW.md`. On an EXISTING/uploaded repo where `docs/PRODUCT.md` is the stub or pages lack `intent:` lines, treat it exactly like the decision memory: proactively OFFER to backfill it from the code + git history AND a short interview ("what does this do / who is it for?"), once, early — never fabricate.
   - **15b. Record ownership from day one.** Put a `@docs owner <name>` JSDoc tag on new `_api/` / `_sync/` routes (and note page authors) from the start — even on a solo project, because it's what lets a later teammate (or an AI routing a question) know who to ask. It surfaces in `docs/AI_PROJECT_INDEX.md` (owner column + git authorship). Cheap now, essential at team scale.
16. **At session start: read `config.ts` and `.env`. NEVER read `.env.local`** (contains real secrets).
17. **Update `.env_template` and `.env.local_template` when new env vars are added.** The user updates their own `.env.local`.
18. **Suggest extracting repeating patterns** into a helper, component, or skill.
19. **Security is top priority** unless the user explicitly says otherwise for a given task.
20. **Critical self-review on larger implementations** — re-read your own diff before declaring done.
21. **Respect type generation and template injection.** NEVER write `{} as unknown as TYPE` or `{} as any`. No `unsafe*` wrappers around `apiRequest` / `syncRequest` / `upsertSyncEventCallback`. Treat `src/_sockets/apiTypes.generated.ts` as the source of truth. In API + sync handlers, prefer `functions.tryCatch.tryCatch(...)` and `functions.sleep.sleep(...)` (auto-injected from `shared/`) plus the consumer shims in `functions/` (db, redis, sentry, session, …) over direct package imports. Spec: `docs/ARCHITECTURE_FUNCTION_INJECTION.md`.
   - **NEVER-cast escalation**: when `apiRequest` / `syncRequest` / `upsertSyncEventCallback` typing fails, FIRST run `npm run generateArtifacts`. NEVER cast with `as unknown as TYPE` or `as any`. If the generator output is itself wrong, fix the generator — don't cast around it.

### Prompt Development (22)

22. **Solve edge cases generically inside prompts**, not per-case. Example: rather than patch a specific failure, encode the principle ("AI must always explain why something cannot be done") so the same class of issues is covered.

### Parallel Agents & Handoff (23-26)

23. **Aggressive parallelism is the default.** When two or more research/exploration paths are independent, spawn parallel Agent calls in waves (single message, multiple tool calls). Token cost is not a constraint. Sequential delegation when work is parallel-safe is the failure mode — not over-spawning. See `docs/AGENT_TEAM_PLAYBOOK.md` for orchestration patterns.
24. **Skills folder has two halves**: `skills/official/` (Anthropic-provided) and `skills/custom/` (framework-specific).
25. **Parallel agent playbook lives in `docs/AGENT_TEAM_PLAYBOOK.md`.** Activation happens via slash commands in `.claude/commands/`.
26. **Daily handoff uses `/save_handoff`** (see `.claude/commands/save_handoff.md`). Do not hand-write handoff files — invoke the slash command.

### Surgical Changes & Session Continuity (27-28)

27. **Surgical changes — every changed line traces to the user's request.** Don't "improve" adjacent code, comments, or formatting. Don't refactor things that aren't broken. Match existing style even if you'd do it differently. Mention unrelated dead code — don't delete it (Rule "Report Without Auto-Fixing" covers issues; this rule extends it to code-style drive-bys). Clean up imports/variables your changes orphaned, nothing more.
28. **Session start sequence.** Read in order:
    1. `CLAUDE.md` (this file).
    2. Current branch's `branch-logs/<sanitized>.md` if it exists.
    3. If (2) is empty: `branch-logs/INDEX.md` → most recent previous branch's log. Mark its contents as **"previous context, may not apply here"** and verify before acting on any assumption.
    4. Framework + project context: `docs/PROJECT_CONTEXT.md` (if exists), `docs/ROADMAP.md`, `docs/HOSTING.md`, `docs/PACKAGE_OVERVIEW.md`, `docs/AGENT_TEAM_PLAYBOOK.md`.
    5. `config.ts` + `.env` (NEVER `.env.local`).
    6. Auto-generated indexes: `docs/AI_QUICK_INDEX.md`, `docs/AI_CAPABILITIES.md`, `docs/AI_PROJECT_INDEX.md`, `docs/AI_DECISIONS_INDEX.md` (the committed "why" record — open a `docs/decisions/NNNN-*.md` for the full rationale behind a choice), `docs/AI_RUNBOOKS.md` (task-shaped golden paths: how to add an API/page/sync/helper, verify, and record a decision in THIS project), `docs/AI_PRODUCT_OVERVIEW.md` (the intent layer — what the app + each page is FOR, in plain language), `docs/AI_LESSONS_INDEX.md` (the pitfalls layer — what was tried and FAILED, so it isn't repeated; query via `find_lesson`), `docs/AI_EXAMPLES_INDEX.md` (the canonical example corpus — copy these reviewed shapes; query via `list_examples` / `get_example`), `docs/AI_CONTEXT_BUDGET.md` (what-to-load-when per task type — don't read every index every session), and `docs/ai-graph.json` (the dependency graph — or query it via the `@luckystack/mcp` tools `blast_radius` / `who_imports` / `who_calls` / `god_nodes` / `decision_for_file` rather than reading the whole file).
    7. **Memory-coverage check (then offer to backfill).** If the decision memory (`docs/AI_DECISIONS_INDEX.md` / `docs/decisions/`) is empty OR clearly does not cover major parts of an already-substantial codebase (many commits / large `src/` but few or no ADRs explaining the big choices), proactively TELL the user and OFFER to backfill it — both by mining the written history (`git log`, `branch-logs/`, and with permission the per-dev `~/.claude` memory) AND by offering a one-time, focused, resumable **interview** ("heb je even tijd om mijn vragen over de codebase te beantwoorden? eenmalig, verbetert al mijn toekomstige changes drastisch") since most rationale was never written down. Surface this once, early; act only on their go-ahead. Full how-to: Decision Memory Protocol §8 (§8a mine, §8b interview).

---

## Branch Log Protocol

AI MUST append an entry to `branch-logs/<sanitized-branch>.md` after every prompt that produces **real code or architecture changes**. Skip for lint-only fixes, typo fixes, or translation-string-only edits. **When in doubt, log.**

**INDEX is mandatory**: every append to a `branch-logs/<branch>.md` file MUST be followed by an update to the corresponding row in `branch-logs/INDEX.md` (`Last updated` timestamp, `Entries` count, and `Status` if changed). Add a new row if none exists. See `docs/BRANCH_LOG_PROTOCOL.md` Section 6.5 for the full rule.

Format spec lives in `docs/BRANCH_LOG_PROTOCOL.md`. Logs are NOT gitignored — the `/review_branch` slash command reads them to compare AI-reported progress against the actual diff.

**Consumer first-session quick-start.** In a freshly-scaffolded project the `branch-logs/` folder ships with only `README.md`. On your first real change: create `branch-logs/<sanitized-current-branch>.md`, append an entry (heading `## YYYY-MM-DD HH:MM — <title>`, then *user prompt* / *what I did* / *files touched* / *notes*), and add the branch's row to `branch-logs/INDEX.md`. The `.githooks/pre-commit` hook does NOT write log entries for you — only the AI does — so make it a habit after every substantive prompt. This is what lets a future AI (or you) resume with full context.

---

## Decision Memory Protocol

This is **automatic AI behavior — there is no command for the user to run** (just like the branch-log protocol). The AI fills and reads the decision memory itself as a normal part of working in a session.

**AI MUST, on its own:**

- **Record a decision when one is made.** When a **durable architecture or policy choice** is settled in a session — one with a real rejected alternative (a dependency/layering/contract choice, a policy, or a deliberate deviation from these docs per Rule 3b) — the AI writes a committed ADR `docs/decisions/NNNN-slug.md` (Context / Decision / Rejected alternatives / Consequences) then regenerates `docs/AI_DECISIONS_INDEX.md` (`npm run ai:decisions`). This is autonomous (a committed doc, not an install) — no permission prompt, same as a branch-log append. The user is never expected to trigger it.
- **Consult it before answering "why".** When you (or the user) wonder why something is the way it is, read `docs/AI_DECISIONS_INDEX.md` first and open the relevant decision file — don't guess or re-derive. (That's why it's in the session-start read sequence.)
- **Offer to backfill a missing/incomplete memory — from history AND from the user.** If at session start the decision memory is effectively empty (only `0000-template.md`) OR clearly does not cover major parts of an already-substantial codebase (many commits / large `src/` but few ADRs explaining the big architectural choices), proactively TELL the user and OFFER to seed `docs/decisions/`. Two complementary sources, use both: (1) **mine the written history** — `git log` / notable commits / `branch-logs/` rationale, and optionally the per-dev `~/.claude` memory (classify team-truth vs personal, never auto-import); (2) **interview the user** — most real rationale was never written down, so offer a *one-time, focused, resumable* Q&A: "heb je even tijd om samen door de codebase te lopen en mijn vragen te beantwoorden? eenmalig, en het verbetert al mijn toekomstige changes drastisch." Prep first (scan code + git + graph to find the big UNDOCUMENTED decisions), then ask targeted per-feature questions ("why X instead of the usual Y? what did you rule out?") in small batches, and record each confirmed answer as an ADR in the user's words. Never fabricate — unconfirmed inferences are `status: proposed`, not `accepted`. Offer once, early; act only on the user's go-ahead. (The dependency graph + indexes are different: if they're missing on an existing project just regenerate them — `npm run ai:graph` / `ai:project-index` / `ai:capabilities` — that's autonomous, no need to ask.)

Keep the three surfaces distinct — **do not blur them**:

- `branch-logs/` = *what happened, per prompt* (the firehose).
- CLAUDE.md User Project Rules = *what you must always do* (the always-on imperative).
- `docs/decisions/` = *why it is this way / why not Y* (durable rationale, until superseded).

A decision is the rationale BEHIND a rule, not the rule itself. Never auto-rewrite CLAUDE.md from a decision — promoting an ADR into a User Project Rule is user-gated (Rule 27). Never edit an accepted decision's substance — supersede it with a new file (`supersedes: [NNNN]`) and flip the old one's `status:`. Full spec: `docs/DECISION_MEMORY_PROTOCOL.md`.

---

## Lessons Protocol (the pitfalls layer)

Same shape as the Decision Memory Protocol — **automatic AI behavior, no user command**. Where decisions record *why a choice was made*, lessons record *what was tried, what FAILED, and the takeaway*, so the same dead-end isn't rediscovered every few sessions (branch-logs are per-branch; the per-dev `~/.claude` memory is private + uncommitted; neither is a shared, searchable pitfalls layer).

**AI MUST, on its own:** (1) **Record a lesson** in `docs/lessons/NNNN-slug.md` (What happened / Root cause / How to avoid) when a session burns real effort on a non-obvious dead-end, then `npm run ai:lessons` — autonomous, like a branch-log append. (2) **Consult it** (`find_lesson`) before retrying something tricky. (3) **Offer to backfill** if at session start `docs/lessons/` is effectively empty but the project has substantial history — mirror Decision Memory Protocol §8: TELL the user, OFFER a one-time resumable interview ("welke dingen heb je al een paar keer opnieuw moeten leren in deze codebase?"), act only on go-ahead, never fabricate. Full spec: `docs/LESSONS_PROTOCOL.md`. Keep the four surfaces distinct: branch-logs (what happened) · User Project Rules (always-do) · decisions (why) · lessons (what failed).

## Canonical Example Corpus

`docs/examples/<slug>.md` holds curated, reviewed reference implementations per pattern (a rate-limited auth route, a sync server+client pair, the `tryCatch` pattern, a protected page+component+middleware). When building one of these, **copy the canonical shape** (`get_example('<pattern>')` / `list_examples`) instead of an arbitrary first match. `npm run ai:examples` regenerates `docs/AI_EXAMPLES_INDEX.md`. On an existing project with a bare corpus, OFFER to seed it from the real, reviewed routes/pages (same backfill etiquette as above) — never fabricate an "approved" example.

## Doc-coverage gate, staleness, code→ADR, context budget, eval

These keep the layers above honest and current — all opt-in / report-only so they never block an existing codebase retroactively:

- **Doc-coverage gate** (`ai:lint`, rule `doc-coverage`) — a NEWLY-ADDED route needs a top-of-file summary + `@docs owner`; a new `page.tsx` needs a `//? intent:` line (Rules 12/15a/15b made enforceable). Diff-scoped to added files; WARN by default, opt into blocking via `luckystack.invariants.json`. Escape hatch: `// luckystack-allow doc-coverage: <reason>` on the first line.
- **Doc-staleness** (`npm run ai:doc-staleness`, report-only) — a hand-written doc opts in with an `<!-- @covers <glob> -->` marker; the check reports when the covered code has moved on by more than `docs.stalenessThreshold` commits. Wire a deep-dive to the code it describes to enable the nudge.
- **Code→ADR link** — tag a file that embodies a deliberate decision with `//? @adr NNNN`; `ai:decisions` builds the reverse "ADR → governed files" map, queryable via `decision_for_file(path)`. Check it BEFORE "cleaning up" a deliberate-looking construct.
- **Context budget** (`docs/AI_CONTEXT_BUDGET.md`, `ai:context-budget`) — per-task retrieval profiles: load only the relevant artifacts, query the rest via MCP. Don't read every index every session.
- **Eval harness** (`eval/`, `npm run ai:eval`) — the deterministic with/without measurement of whether these artifacts actually improve AI output; it is the trigger gate ADR 0003 requires before any RAG rung. Extend `eval/scenarios/` as the project grows.

---

## Inherited Patterns (from old `.claude/CLAUDE.md`, user-confirmed)

### Component Reference (`src/_components/`)

Before building any UI primitive, check this table. Extend the existing component or add a prop — never roll a parallel implementation.

| Component / API | Use when… |
|---|---|
| `Dropdown` (`./Dropdown.tsx`) | Single-select picker. Supports search, keyboard nav, sm/md/lg/xl sizes, controlled or uncontrolled. |
| `MultiSelectDropdown` (`./MultiSelectDropdown.tsx`) | Multi-select picker with checkboxes. Same shell + search as `Dropdown`. |
| `MenuHandlerProvider` + `useMenuHandler` (`./MenuHandler.tsx`) | Stack-based modal / sheet system with backdrop, animations, Escape/Enter handling. |
| `menuHandler` (`src/_functions/menuHandler.ts`) | Imperative API to open menus from non-React code. Includes `menuHandler.confirm({ title, content, input? })` returning `Promise<boolean>`. |
| `ConfirmMenu` (`./ConfirmMenu.tsx`) | Renderable confirm form (used inside `menuHandler.confirm`). Render directly only for non-modal confirm forms. |
| `Avatar` (`./Avatar.tsx`) | User avatar with image + first-letter fallback. Reads image-load status from `AvatarProvider`. |
| `Navbar` (`./Navbar.tsx`) | Dashboard sidebar. Pass `items` prop (`NavbarItem[]`, `icon` is a FontAwesome `IconDefinition`) — do not edit the file. |
| `ErrorPage` (`./ErrorPage.tsx`) | React Router error-boundary fallback. Already wired; extend rather than replace. |
| `Middleware` (`./Middleware.tsx`) | Wraps protected pages. Runs the per-page `export const middleware` (from `page.tsx`) first, then falls back to a globally registered handler from `registerMiddlewareHandler`. Per-page is canonical; no central `_functions/middlewareHandler.ts` file is required. Part of the `dashboard` template. |
| `TemplateProvider` (`./TemplateProvider.tsx`) | Selects a template (`'plain'` / `'dashboard'`) per page from its exported `template` const. Add new templates here and to the `Template` union. |

### Tailwind Color Tokens (from `src/index.css`)

- **Surfaces**: `background`, `container1`, `container2` (each with `-hover` and `-border` variants).
- **Text**: `title`, `common`, `muted`, `disabled`.
- **Accent**: `primary` (+ `-hover`, `-border`), `secondary` (+ `-hover`, `-border`).
- **On-accent text**: `title-primary` / `common-primary`, `title-secondary` / `common-secondary`.
- **Semantic**: `correct`, `correct-hover`, `warning`, `warning-hover`, `wrong`, `wrong-hover`.
- **Utility**: `overlay`, `focus-ring`, `divider`.

Each token gets `bg-`, `text-`, `border-` utility variants. Dark mode auto-switches via the `.dark` class on `<html>`.

### API Pattern (full details: `docs/ARCHITECTURE_API.md`)

```typescript
// src/{page}/_api/{name}_v1.ts
export const rateLimit: number | false = 60;
export const httpMethod: "GET" | "POST" | "PUT" | "DELETE" = "POST";
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { /* typed input */ };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  return { status: "success", result: { /* data */ } };
};
```

### Sync Pattern (full details: `docs/ARCHITECTURE_SYNC.md`)

- `{name}_server_v{N}.ts` runs ONCE on the server for validation.
- `{name}_client_v{N}.ts` runs on the server for EACH client in the room. Optional — only create it when per-client logic (filtering, per-client auth, custom `clientOutput`) is required. If it would only return `{ status: 'success' }`, do not create it.
- `_client` files do NOT receive `user`; they receive `token` and call `functions.session.getSession(token)` only if session data is actually needed.
- Client sends: `syncRequest({ name, data, receiver: roomCode, ignoreSelf? })`.
- Client receives: `upsertSyncEventCallback(name, ({ clientOutput, serverOutput }) => {})`.

### File-Based Routing (full details: `docs/ARCHITECTURE_ROUTING.md`)

- `src/{page}/page.tsx` → route `/{page}`.
- `src/{page}/_api/{name}_v{N}.ts` → endpoint `api/{page}/{name}/v{N}`.
- `src/{page}/_sync/{name}_server_v{N}.ts` (+ optional `_client_v{N}.ts`) → event `sync/{page}/{name}/v{N}`.
- Folders prefixed with `_` are private (never routed).

### Prisma Model Type Convention

When a Prisma model type is needed in app code, create `src/_types/{ModelName}.ts` that re-exports the Prisma type from `@prisma/client` and extends it when needed. Never import `@prisma/client` types directly into components.

### JSX Micro-Conventions

- Self-closing tags for component without children: `<MyComponent />`, never `<MyComponent></MyComponent>`.
- Use `<div>` for almost everything besides obvious cases (button, input, form). Avoid `<header>` / `<footer>` / `<section>` unless semantically required.
- Always use backticks in `className`: `` className={`...`} ``, never `''` or `""`.

### Error Handling

Always use the custom `tryCatch`:

- **In API / sync handlers**: use the injected `functions.tryCatch.tryCatch(...)` (sourced from `shared/tryCatch.ts` via the function-injection system — spec: `docs/ARCHITECTURE_FUNCTION_INJECTION.md`).
- **Elsewhere (client components, server utilities, scripts)**: `import { tryCatch } from '@luckystack/core'`. Same `[error, result]` tuple shape; the server-side path captures to Sentry via the registered error-tracker.
- Check the first value; if truthy, there's an error. Never use raw `try/catch`.

---

## Inherited Rules (user-confirmed)

### Report Without Auto-Fixing

When analysis surfaces potential mistakes, unhandled errors, or improvement opportunities OUTSIDE the current task scope, **report them — do not fix them**. The user decides what to act on.

### Verify Code Flow Against Docs

Before implementing, check that the code flow matches what `docs/ARCHITECTURE_*.md` describes. If they agree: implement. If they disagree after a careful second read: tell the user so the docs can be corrected — otherwise follow the docs.

### Testing

Two layers, both run by `npm run test` (which invokes the `@luckystack/test-runner` CLI):

- **Auto-sweep** — contract / auth-enforcement / rate-limit / fuzz checks against every endpoint. Walks `apiMethodMap` automatically; no per-route file required.
- **Per-route business-logic tests** — `src/<page>/_api/<name>_v<N>.tests.ts` (and `_sync/<name>_server_v<N>.tests.ts`). Created via `npm run scaffold:test <page>/<name>/<version>` — the stub lists common scenarios as TODO checklist comments. Use these when the sweep can't reach the assertion: post-conditions on hooks, integration with other features, edge-case business logic.

After creating any new API or sync route, run `npm run scaffold:test <route>` autonomously and fill in at least one happy-path test case before declaring done. The auto-sweep already covers basic crash-resistance; your per-route cases should target assertions the sweep can't infer.

**Prioritize tests after new work, and flag untested existing code.** Tests for what you just built come before declaring done (a bug fix needs a regression test). Separately: when you touch or read a route that has NO per-route test (no sibling `_v<N>.tests.ts`), don't silently leave it — raise it with the user ("this route has no business-logic test; want me to add one?") and offer to write it. The `docs/AI_PROJECT_INDEX.md` "tested" indicator per route is your map of where coverage is missing. Don't bulk-add tests unasked; surface the gap and let the user choose.

Full spec: `docs/ARCHITECTURE_TESTING.md`.

---

## Type Generation & Template Injection Contract

Preferred direction: route literals + generated maps + inferred `serverOutput` / `clientOutput` typing.

```typescript
// Good — typed call with route/version literals
const response = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
});

// Good — typed sync callback payload
upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ serverOutput, clientOutput }) => {
    if (serverOutput.status !== "success") return;
    console.log(serverOutput, clientOutput);
  },
});

// Bad — local unsafe wrapper erases route/version typing
const unsafeApi = async (name: string, version: string, data: unknown): Promise<any> =>
  apiRequest({ name: name as any, version: version as any, data: data as any });
```

**Self-check before finalizing**:

- Did I rely on generated route/version types?
- Did I avoid adding new unsafe wrappers?
- If I used a temporary cast during generation lag, did I re-check and remove it after the type maps refreshed?

If inference fails, fix the typing source or regenerate the maps. Do not paper over with casts.

---

## Templates

Pages export a `template` constant: `'plain'`, `'dashboard'`, or a project-specific addition wired into `TemplateProvider`.

- `plain` — no UI chrome (login, register, docs pages).
- `dashboard` — sidebar navigation + main content area.

---

## Provider Hierarchy

```
SocketStatusProvider > SessionProvider > TranslationProvider > AvatarProvider > MenuHandlerProvider > Router
```

---

## AI Browser Testing

When verifying the frontend in a browser, follow the cheapest-first ladder + suggest→approve protocol — full detail in `docs/AI_BROWSER_TESTING.md` (consumer copy: `docs/luckystack/AI_BROWSER_TESTING.md`). Wired in via `--ai-browser=<all|agent-browser|none>`; dev-tools only.

- **Cheapest-first ladder:** `agent-browser` (CLI) is the default for ~90% — flows, console/errors/network, single-browser screenshot + visual-diff, Web Vitals. Escalate to **Playwright MCP** ONLY for cross-browser / mobile rendering or a vision styling judgement; to **Chrome DevTools MCP** ONLY for Lighthouse / performance traces / Core Web Vitals / deep diagnostics.
- **Never launch a browser tool without proposing it + getting explicit user approval.** Announce *"I want to verify X → cheapest fit = `<tool>` → approve?"*; for an escalation, name the exclusive capability that forces the higher rung. (The harness also hard-gates these via `.claude/settings.json` `permissions.ask`; first MCP use shows a one-time trust prompt.)
- **Server-start is a developer action (Rule 8):** the dev server (`npm run server` + `npm run client`) must be running before any browser test — ask the user to start it.
- **Auth:** use the tool's session/state persistence + a dedicated test account; **never read `.env.local`** (Rule 16).
- After agent-browser confirms a flow, offer to capture it as a deterministic `@playwright/test` spec (keep the LLM out of the permanent CI loop).
- **Complementary skills** GENERATE committed artifacts (vs the interactive tooling above): `/agent-browser` (E2E tests), `/lighthouse` (perf), `/a11y-audit` (axe). `/agent-browser-verify` drives the interactive login-matrix check.

---

## Documentation Reference

| Doc | Purpose |
|---|---|
| `docs/ARCHITECTURE_ROUTING.md` | File-based routing (pages, APIs, syncs) |
| `docs/ARCHITECTURE_API.md` | API request system |
| `docs/ARCHITECTURE_HTTP.md` | HTTP pipeline, custom-route phases, webhook + streaming-upload seam (origin-exempt paths) |
| `docs/ARCHITECTURE_SYNC.md` | Real-time sync events |
| `docs/ARCHITECTURE_AUTH.md` | Authentication flows |
| `docs/ARCHITECTURE_SESSION.md` | Session management |
| `docs/ARCHITECTURE_SOCKET.md` | Socket.io setup |
| `docs/ARCHITECTURE_EMAIL.md` | `@luckystack/email` + login forgot-password |
| `docs/ARCHITECTURE_SECRET_MANAGER.md` | `@luckystack/secret-manager` client + external server contract |
| `docs/ARCHITECTURE_MULTI_TENANCY.md` | Multi-tenant pattern (tenant = Workspace): Prisma `$extends` row isolation + keyed clients + Redis key formatter + per-workspace secrets |
| `docs/ARCHITECTURE_MULTI_INSTANCE.md` | Multi-instance/router model + pitfalls: WS pins to `system`, Redis-adapter cross-instance fan-out, regular `syncRequest` also crosses instances via `io.in(room).fetchSockets()` + `RemoteSocket.emit()` (streaming via `io.to().emit()`), shared-Redis footgun. Symptom→cause→fix table + local test recipe |
| `docs/ARCHITECTURE_PACKAGING.md` | Package split strategy |
| `docs/DEVELOPER_GUIDE.md` | Getting started |
| `docs/HOSTING.md` | Deployment |
| `docs/PACKAGE_OVERVIEW.md` | Per-package use-case + peer-deps table |
| `docs/LUCKYSTACK_ADD_GUIDE.md` | Adding an optional feature later (`npx luckystack add <feature>`): npm-i-vs-add matrix + per-feature checklists + troubleshooting |
| `docs/AGENT_TEAM_PLAYBOOK.md` | Multi-agent workflow |
| `docs/BRANCH_LOG_PROTOCOL.md` | Branch-log entry format |
| `docs/DECISION_MEMORY_PROTOCOL.md` | Committed decision-log (ADR) protocol — the shareable "why" record the AI auto-fills + reads (no command) |
| `docs/LESSONS_PROTOCOL.md` | Pitfalls-layer protocol — the committed "what failed + how to avoid" record the AI auto-fills + reads (no command) |
| `docs/AI_LESSONS_INDEX.md` | Auto-generated index of `docs/lessons/` pitfalls (severity, area, takeaway) |
| `docs/AI_EXAMPLES_INDEX.md` | Auto-generated index of the curated canonical example corpus (`docs/examples/`) |
| `docs/AI_CONTEXT_BUDGET.md` | Auto-generated per-task retrieval profiles + artifact token sizes (what-to-load-when) |
| `eval/` | AI-context eval harness — deterministic with/without scorer measuring whether the artifacts improve AI output (`npm run ai:eval`) |
| `docs/AI_QUICK_INDEX.md` | Auto-generated cross-repo index (framework surfaces) |
| `docs/AI_PROJECT_INDEX.md` | Auto-generated inventory of the consumer project's own code (routes, pages, helpers, components, cross-refs) |
| `docs/AI_DECISIONS_INDEX.md` | Auto-generated index of `docs/decisions/` ADRs (title, status, tags, summary) |
| `docs/AI_RUNBOOKS.md` | Auto-generated task-shaped golden paths (add API/page/sync/helper, verify, decide) grounded in this project's real files |
| `docs/PRODUCT.md` | AI-maintained plain-language description of what the app is + for whom (the intent-layer source) |
| `docs/AI_PRODUCT_OVERVIEW.md` | Auto-generated intent overview: app description (from `PRODUCT.md`) + each page's `//? intent:` purpose |
| `luckystack.ai.json` | AI-tooling config — `docs.sharding` (`auto`/`single`/`per-folder`) controls when the read-whole indexes split per src folder |
| `docs/AI_BOOST_OVERVIEW.md` | One-page catalog of every AI-tooling surface in LuckyStack |
| `docs/AI_BROWSER_TESTING.md` | AI browser-testing tooling (agent-browser + Playwright/Chrome DevTools MCP): the cheapest-first ladder + suggest→approve protocol |

---

## User Project Rules

<!--
  This section is reserved for project-specific rules added by consumers of `@luckystack/create-luckystack-app`.
  The scaffold update flow will NOT overwrite content below this comment when pulling future framework updates.
  Add your team's conventions, custom slash-command notes, or per-project policy overrides here.
-->

### Workspaces — product build contract (load-bearing, non-negotiable)

> This repo is being built into **Workspaces**: a self-hosted, AI-driven dev-orchestration app on top of `@luckystack/*`. A user writes simple tickets; a configurable **pipeline of stages** (refine → plan → implement → test → review) drives each ticket; the human is a **man-in-the-middle who only approves and answers questions** (phone-first). The deep design-corpus lives in **`src/workspaces/_docs/`** (its authoritative front doors are grafted here because the original `workspaces-handoff/` scaffold folder is temporary and will be deleted once the build is done). The gefaseerde bouwprogramma + levend voortgangslog: `workspaces-handoff/BUILD_PROGRAM.md` + `BUILD_LOG.md` (move these into the repo before deleting the handoff).

**Read order before touching Workspaces code (every session):** `src/workspaces/_docs/BUILD_HANDOFF.md` → `src/workspaces/_docs/V1_SCOPE.md` (ground truth for *what ships* — wins on conflict, §5) → `src/workspaces/_docs/BUILD_ORDER.md`. Then the owning build-doc for your piece (`07b` containers, `CONTROL_API` writes, `04b` persistence, `GOLDEN_PLAN_STAGE`, `P0_CLI_SPIKE`, `CLIENT_AND_PUSH`, `MIGRATION`). Codes resolve via `REFERENCE_CODES.md`.

**The nine standing invariants — a change violating one is wrong even if it "works":**

1. **B-23 — single-writer.** AI proposes → user accepts (Assistant: instruction = consent) → the **Conductor executes**. The Conductor is the **only writer** of board/git/status; LLMs never write authoritative state directly. Destructive/irreversible actions require an explicit confirm.
2. **No new verbs — the FROZEN 7+6 structured-channel surface** (all `read|propose`, none write). Never add a verb/entity to close a feature gap — re-express via existing verbs + `WorkspaceTrigger` + `run-command` + MCP.
3. **Every user-initiated write is a `[control-API]` op:** `_api` route → `preApiExecute` RBAC → enqueue → Conductor. No direct writers of authoritative state; the client merges by `seq`.
4. **`runInTenant` on every orchestrator-side path** — every sync-handler AND every background worker runs tenant-scoped row-isolation (loud-fail by design). The Assistant is scoped to a workspace-action whitelist — never host/system-level, never out-of-workspace.
5. **Single by design** — one forge (**GitLab** only), one provider (**Claude PTY** only), one host, **single-instance orchestrator** under `lease:orchestrator`. Every multi-* surface (GitHub, built-in git-server, built-in MR/merge/CI, multi-provider, preview-deploy, analytics, voice) is OUT of V1 (designed-but-deferred — `V1_SCOPE.md §4`). Never build a deferred surface to "complete" a feature.
6. **The PTY-billing invariant** — every Claude session is interactive `claude` in a node-pty PTY; **never `claude -p`, never the Agent SDK** (bills a separate metered pool, not the Max subscription). Structured output via `type:http` hooks + the structured channel only.
7. **The P0.5 CLI billing spike GATES the build** (`P0_CLI_SPIKE.md`) — it is the first task; container/PTY work waits until it is GREEN. A billing/PTY RED **escalates to the user — it never routes around the gate to headless**.
8. **V1_SCOPE wins on conflict** — precedence: locked V1 scope → decided `REVIEW_AND_OPEN_QUESTIONS` answers → build-docs' mechanics → `00_SPEC_RECONCILIATION.md` for any `_docs`-vs-`handoff` conflict. A real conflict with no ERRATA row is a **flag to the user**, never a silent pick.
9. **The 4 non-overlapping build lanes** — **A** Engine & Orchestrator (server/PTY/containers/control-API write-handlers/GitLab/the P0.5 spike) · **B** Data, tenancy & sync-backend (Prisma schema incl. `04b §6–§11`, `runInTenant`, seq/merge-on-seq event-log, migration/seed — publishes the schema/types FIRST) · **C** Frontend & realtime-client (board/tickets/pipeline UI, Assistant chat, PWA+push, notifications, auth UI) · **D** Code-editor & changes/config (openvscode-server, diff/edit, stage-lock/pause/resume, per-stage config, the `GOLDEN_PLAN_STAGE` renderer). Own only your lane's directories; **propose** cross-lane changes, never edit another lane's files; build against the frozen contracts (B's types, A's control-API shapes).

> All the framework rules above (file-based routing, function-injection, strict typing/no-casts, `tryCatch`, i18n, Tailwind tokens, surgical changes, lint+build, branch-log, decision-memory/lessons) still apply on top of these.
