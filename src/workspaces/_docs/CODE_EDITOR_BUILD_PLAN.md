# CODE_EDITOR_BUILD_PLAN — executable, phased plan for the hybrid VS Code + Monaco editor

> **Authority.** [CODE_EDITOR.md] is the *design* (the "what/why"); this is the *execution* plan (the "in-what-order, verify-how"). Where they disagree, CODE_EDITOR.md wins on design intent. Locked user decisions driving this plan (2026-07-02):
> - **Engine = HYBRID**: openvscode-server (real browser VS Code) *inside the ticket container* for the real editor (per-ticket live changes + whole-repo tab + extensions + LSP + themes); **Monaco** only for lightweight embedded app surfaces (Dockerfile/config editors, read-only diff fallback) where no container exists.
> - **Extensions = REAL open-vsx extensions** linked to the user profile, shared across workspaces (⇒ forces the VS Code path; Monaco has no extension host).
> - **Resource budget**: +300–800 MB RAM per active editor is acceptable (CapacityManager-budgeted, lazy start / idle stop).
>
> **How to run.** Each PHASE has a single verifiable exit criterion (Rule 1a). Do tracks in dependency order (below). Track A (Monaco-lite) is independent — it ships visible value while the infra tracks are built. Last updated: 2026-07-02.

---

## §0. Current-state snapshot (researched 2026-07-02) — what exists vs is missing

| Area | State | Key anchors |
|---|---|---|
| Ticket container launch (hardened, clones DEV branch → `/work`, L1/L2 image) | **BUILT**, wired into activation | `server/container/runtime.ts::launchTicketContainer`, `conductor.ts::provisionContainers` |
| In-container exec (run a process, write files, drive `claude` via node-pty) | **BUILT** | `stageRunner.ts::driveContainerTurn` / `writeFileInContainer` / `projectAuth`; `server/hooks/workspacesTerminal.ts` |
| L2 per-project image build | **BUILT** | `server/container/imageBuild.ts` |
| **Caddy reverse-proxy + per-ticket route (`@id` POST/DELETE)** | **DEFERRED — no code** | (doc-only in `07b §5`) |
| **Container networking** (`workspaces-net`, port exposure, dial-by-name, TLS) | **DEFERRED — no code** | `runtime.ts` `docker run` attaches no `--network`, publishes no ports |
| **Persistent in-container server manager** (start/health/idle-stop a long-running server) | **DEFERRED — no code** | — |
| Ticket detail view + tab system | **BUILT (dummy data)** | `src/workspaces/board/[ticketId]/page.tsx` (`TABS` ~L29-36, body ~L76-81) |
| Changes/diff review UI | **BUILT interim, DUMMY, read-only** | `FilesTab`→`FileDiffViewer.tsx`→`DiffView.tsx`, data = `Ticket.files` from `_data/seed.ts` |
| Whole-repo / codebase viewer | **ABSENT** | — |
| Ticket data plumbing | **ALL DUMMY** (snapshot from seed; no `apiRequest`/`syncRequest` in ticket view) | `WorkspacesProvider.tsx` snapshot |
| Control-API transport (non-AI ops) | **BUILT** (per-op `_sync` routes → conductor → realtime) | `_sync/<op>_server_v1.ts`, `conductor.ts::enqueueControlAction`/`executeAction` |
| Stage-runner engine (drives `claude` in-container; auth spike **RESOLVED**) | **PARTIAL — unwired** | `stageRunner.ts::runStage` creates no `AgentSession`; only called from a tmp demo |
| `pause` / `resume` / `kill` / `--resume` | **CONTRACT-ONLY** (fall through to a `default` no-op) | `controlApi.ts` ControlOp union; `conductor.ts::executeAction` default |
| Per-stage `userEditable` edit-lock | **DATA ONLY, unenforced** | `PipelineStage.userEditable` (schema), `PipelineStageCfg.userEditable` (types.ts) |
| Account `editorExtensions` + open-vsx render | **ABSENT** | `User.preferences Json?` exists as the persistence pattern (`updatePreferences_v1.ts`) |
| Monaco in the main app | **ABSENT** (only in the ui-builder prototype from the deleted workspaces-handoff scaffold (2026-08-23)) | root `package.json` has no `monaco-*` |
| Dockerfile review (Monaco-lite candidate) | **BUILT as `<textarea>`** | `src/workspaces/workspace/page.tsx::DockerfileReview` |

**Reality check:** the "real VS Code per ticket" path is *mostly infrastructure that does not yet exist* (Caddy, networking, TLS, editor-server lifecycle, wiring the stage engine into the conductor, and connecting the ticket UI to real data). Budget accordingly.

---

## §1. Dependency graph (build order)

```
Track A (Monaco-lite)   ── independent, do first for visible wins ──────────────┐
                                                                                 │
Track B (container editor infra)                                                 │
  B1 bake openvscode → B2 networking → B3 editor-server lifecycle                │
                     → B4 Caddy substrate → B5 edge auth                         │
        │                                                                        │
        ▼                                                                        ▼
Track C (control plane)                            Track D (ticket UI editor)
  C1 wire stage-runner + AgentSession   ─────►  D0 real ticket data (git-backed)
  C2 pause/resume/kill ops                       D1 "Changes" live editor (needs B5+C)
  C3 claude --resume + resume-with-diff           D2 "Code" whole-repo tab (needs B5)
  C4 enforce userEditable edit-lock               D3 Monaco read-only diff fallback (needs A)
        │
        ▼
Track E (account-linked extensions)   ── needs B3 (editor server) ──► E3 render-into-session
Track F (push-on-approval)            ── needs C ──► commit user edits + push + create-MR URL
```

**Sequencing (user-chosen, 2026-07-02): full substrate first.** A (quick wins) ∥ **B1→B5 complete** (the full multi-tenant Caddy substrate + edge-auth; keep a B1–B3 smoke-test as an internal checkpoint) → C (control plane) → D (ticket UI) → E (extensions) → F (push-on-approval).

---

## §2. TRACK A — Monaco-lite embedded surfaces (independent, fast)

> Goal: a reusable, lightweight Monaco wrapper for app surfaces that have no container. Deliberately **drops** the ui-builder's heavy TS-virtual-libs / onig.wasm / Tailwind-IntelliSense plumbing — syntax + themes only.

- **A1 — `MonacoLite` wrapper component.** Add `@monaco-editor/react` + `monaco-editor` to root `package.json` (⚠️ heavy dep — flag + `npm install` is a dev action). New `src/workspaces/_components/MonacoLite.tsx`: props `{ value, onChange?, language, readOnly?, height? }`; a light theme derived from `src/index.css` `@theme` tokens (light+dark); lazy-loaded so it doesn't bloat the main chunk.
  - *Exit:* renders a highlighted editor in a Storybook-less harness page; `npm run build` chunk-splits Monaco out of the main bundle; agent-browser screenshot light+dark.
- **A2 — Upgrade DockerfileReview.** Replace the `<textarea>` (`workspace/page.tsx::DockerfileReview` ~L448) with `<MonacoLite language="dockerfile" … />`. Keep the existing generate/save/build wiring + `extendsBase` validation untouched.
  - *Exit:* Dockerfile draft edits in Monaco, save/build still work; agent-browser drives generate→edit→save.
- **A3 — Monaco read-only diff fallback.** A `MonacoDiff` (read-only `DiffEditor`) as the richer no-container fallback for the changes tab, above the `FileDiffViewer` floor (CODE_EDITOR §2.2). Renders from `Ticket.files` diffs.
  - *Exit:* changes tab shows a syntax-highlit read-only diff when no live session; falls back to `FileDiffViewer` on no data.
- **A4 — (optional) config/env editors.** Where a monospace field exists and would benefit (e.g. MCP command, stage process commands), offer `MonacoLite` with the right language. Scope per-request.

---

## §3. TRACK B — Container editor infrastructure (the foundation)

- **B1 — Bake openvscode-server into the L1 base image.** Add openvscode-server (pinned version) to the `workspaces/base` image build. Bind `127.0.0.1:3000` inside the container namespace; never host-published.
  - *Exit:* `docker exec <ticket-container> openvscode-server --version` succeeds; image size delta recorded.
- **B2 — Container networking.** Attach ticket containers to a `workspaces-net` bridge in `runtime.ts::launchTicketContainer` (add `--network`). Create the network on boot if absent.
  - *Exit:* two containers on `workspaces-net` can dial each other by name; `docker network inspect` shows membership.
- **B3 — Editor-server lifecycle manager.** New `startEditorServer(container)` sibling in `runtime.ts` (or `server/container/editorServer.ts`): `docker exec -d … openvscode-server --port 3000 --connection-token <tok> --without-connection-token=false`, lazy (on first editor-open), health-checked, idle-stopped after `EDITOR_IDLE_MIN`. Persist the connection-token + in-container URL (new field on `AgentSession` or a dedicated `EditorSession` row — **BESLISSING NODIG**, see §7).
  - *Exit:* editor-open starts the server; `curl` to the in-container port returns the workbench; idle-stop verified.
- **B4 — Caddy substrate.** New `server/container/caddyRoutes.ts` driving Caddy's admin API: `upsertRoute({ id: 'route-vscode-<ticketKey>', upstream: '<container>:3000' })` (POST) + `deleteRoute(id)` (DELETE), single-upstream (never load-balanced), called from `provisionContainers` (open) / `teardownTicketContainer` (close). Boot-reconcile Caddy routes ↔ live containers under the Redis lease.
  - *Exit:* opening an editor POSTs a route; `https://vscode-<ticketKey>.<domain>` reaches the workbench; teardown DELETEs it; a mid-write crash self-heals on boot.
  - **BESLISSING NODIG (local/dev TLS + domain):** DNS-01 wildcard `*.<domain>` (public) vs internal-CA (LAN) vs a localhost port-forward for the dev vertical slice. See §7.
- **B5 — Edge auth.** Per-(user,ticket) minted URL behind the workspace session + the openvscode connection-token injected by the orchestrator; the same RBAC that gates the ticket gates the editor (`hasCapability`). A leaked subdomain alone is not an open editor.
  - *Exit:* an unauthenticated / wrong-user request to `vscode-<ticketKey>` is refused; the authorized user gets in.

> **B1–B3 smoke-test checkpoint (internal, not a shipped milestone — user chose full-substrate-first).** Before investing in B4–B5, prove *real VS Code* opens on one ticket's worktree via the simplest exposure (a dev port-forward). *Exit:* a file edited in browser VS Code shows native git decorations and lands on the container's worktree. Then proceed to the full B4–B5 substrate.

---

## §4. TRACK C — Session lifecycle + edit-lock (control plane)

- **C1 — Wire the stage-runner into the conductor + AgentSession rows.** `stageRunner.ts::runStage` must create/update an `AgentSession` row (status `ready→busy→paused→stopped`, capture `claudeSessionId`) and be invoked from the conductor's activation path (`activateWorktreesForStage`/`provisionContainers`) instead of only the tmp demo.
  - *Exit:* activating a stage creates an `AgentSession` row that transitions state; visible in the DB.
- **C2 — Implement `pause`/`resume`/`kill` ops.** Add `_sync/<op>_server_v1.ts` routes (copy `quickAdd_server_v1.ts` shape) + implement the cases in `conductor.ts::executeAction` (replace the `default` no-op). RBAC already in `OP_CAPABILITY`. `pause` parks the PTY (container kept); `kill` tears down.
  - *Exit:* Pause-AI parks the claude PTY (provably not writing); Resume re-attaches; realtime status flips.
- **C3 — `claude --resume` + resume-with-diff.** Extend `driveContainerTurn` to accept `--resume <claudeSessionId>` + a kickoff note; on resume-after-edit, `git diff` the worktree against the pre-pause state and inject "you may proceed; the user made these changes: <diff>" as the kickoff (reuses `writeFileInContainer` to land context).
  - *Exit:* a user edit made during pause is captured and appears in the agent's resumed prompt; the agent continues aware of it.
- **C4 — Enforce `userEditable` edit-lock.** Consume `PipelineStageCfg.userEditable` (currently unread): `userEditable=false` + stage running ⇒ editor opened read-only + "stage active — changes disabled" banner + Pause-AI button; paused ⇒ editable; the authoritative guarantee is that the only sanctioned user-write window is post-pause.
  - *Exit:* the changes editor is read-only while a locked stage runs and editable after Pause; state machine matches CODE_EDITOR §7 table.

---

## §5. TRACK D — Ticket UI: live changes editor + whole-repo tab (the visible payoff)

- **D0 — Real ticket data (prerequisite).** The ticket view is 100% dummy today. Back the editor's needs with real data: changed-file list + `commitHash` from the container's real git (not `Ticket.files` seed). Add the read path (an `_api` op or the snapshot) that serves the real changed set.
  - *Exit:* the ticket view shows real changed files for a ticket with a live container.
- **D1 — "Changes" live editor.** In `board/[ticketId]/page.tsx`, replace `FilesTab`'s `<FileDiffViewer>` with the openvscode session (iframe → `vscode-<ticketKey>` route) opened on the worktree, deep-linked to the first changed file, with native git decorations. Host controls: prev/next changed-file stepper, baseline toggle (whole-ticket vs per-stage delta), edit-lock banner + Pause/Resume (from Track C).
  - *Exit:* opening a ticket's Changes tab shows real browser VS Code focused on the changed files; edit-lock honored.
- **D2 — "Code" whole-repo tab.** Add a `TabDef` (`{ id: 'code', … }`) to `TABS` + a body branch: the same openvscode session opened on the full worktree (native explorer, search, multi-tab).
  - *Exit:* a new "Code" tab browses + edits the whole repo in VS Code.
- **D3 — No-container fallback.** When no live session (cold start / no container), degrade to the Track-A Monaco read-only diff (floor: `FileDiffViewer`).
  - *Exit:* the tab never shows a blank pane; fallback verified by opening a ticket with no container.

---

## §6. TRACK E — Account-linked extensions · TRACK F — push-on-approval

- **E1 — `editorExtensions` model.** Persist a per-user `string[]` of open-vsx extension ids. **BESLISSING NODIG (§7):** a first-class `User.editorExtensions String[]` column vs nesting inside the existing `User.preferences Json?` (avoids touching the framework User adapter — recommended). New `src/settings/_api/updateEditorExtensions_v1.ts` (clone `updatePreferences_v1.ts`: allow-list → `prisma.user.update` → `saveSession`).
  - *Exit:* a user's extension list persists across sessions + workspaces.
- **E2 — Account settings UI.** An "Editor extensions" card in `src/workspaces/settings/page.tsx::AccountSettings` (add/remove ids, browse open-vsx).
  - *Exit:* the user manages their extension set from account settings.
- **E3 — Render extensions into the session.** At editor-server launch (B3), install the user's set into the session's `--extensions-dir` from open-vsx (or project a per-user extensions volume); auto-capture in-session installs back to `editorExtensions`.
  - *Exit:* a user with "Tailwind + GitLens + Python" gets exactly those in *every* ticket editor, no per-ticket setup.
- **E4 — Marketplace access.** open-vsx public by default (or a self-hosted mirror — **BESLISSING NODIG**); the marketplace domain on the editor stage's egress allow-list.
  - *Exit:* installing an extension in-session works within the hardened container's egress policy.

- **F — push-on-approval (CODE_EDITOR §5).** On **complete** at the last stage, the Conductor commits any uncommitted user VS Code edits onto `DEV-####` alongside the agent's commits, pushes, and surfaces GitLab's create-MR URL. *(This subsumes the earlier deferred "commit `.workspaces/Dockerfile` to the repo" follow-up — the same new commit/push seam serves both.)*
  - *Exit:* completing a ticket pushes agent + user edits as one branch; the create-MR URL is shown.

---

## §7. Decisions (RESOLVED 2026-07-02 unless marked OPEN)

| Id | Decision | Resolution |
|---|---|---|
| **P-SLICE** | Full multi-tenant Caddy substrate (B4–B5) first, or a vertical slice first? | **RESOLVED — full substrate first** (user). B4–B5 built before the first visible editor. Note: a B1–B3 smoke-test (openvscode reachable in one container) is still wise as an internal checkpoint before B4/B5. |
| **P-TLS** | Local/dev TLS + domain for the `vscode-<ticketId>` subdomain exposure | **RESOLVED — build local now, prod domain later** (user). Build + test the full substrate with **`*.localhost` + Caddy's internal CA** (local HTTPS, no external domain needed); the **production domain is a config value** (`EDITOR_DOMAIN` or similar) filled in at deploy, driving a DNS-01 wildcard `*.<domain>`. No public domain required to build B4–B5. |
| **P-MARKETPLACE** | open-vsx public vs self-hosted mirror | **RESOLVED — open-vsx public** (user); marketplace domain on the editor egress allow-list. |
| **P-EXTSTORE** | `User.editorExtensions String[]` column vs inside `User.preferences Json?` | **RESOLVED — first-class `User.editorExtensions String[]` column** (user). ⚠️ A deliberate deviation from the schema's "User untouched / framework adapter" convention — record as an ADR when implementing E1. |
| **P-EDITORSESSION** | Persist editor connection-token/URL on `AgentSession` or a new `EditorSession` row? | **RESOLVED (default) — new lightweight `EditorSession` row** (editor lifecycle ≠ agent-turn lifecycle). |
| **P-MONACO-DEP** | Accept `monaco-editor` (multi-MB) as a main-app dependency for Track A? | **RESOLVED — yes**, lazy-loaded + chunk-split. |

---

## §8. Cross-reference

| This plan | Source |
|---|---|
| Design intent (why VS Code, edit-lock, extensions, fallback) | [CODE_EDITOR.md] |
| Container + Caddy + networking substrate | [07b_CONTAINER_RUNTIME.md] |
| Changes page (stepper, baseline toggle) | [features/07] |
| Whole-repo viewer contract | [features/08] |
| Pause/kill controls | [features/24] |
| Control-API op catalogue + RBAC | [CONTROL_API.md], `server/control/rbac.ts` |
| Account model + per-user persistence | [features/17], `src/settings/_api/updatePreferences_v1.ts` |
| Monaco reference (what NOT to re-plumb) | the ui-builder prototype from the deleted workspaces-handoff scaffold (2026-08-23) |
