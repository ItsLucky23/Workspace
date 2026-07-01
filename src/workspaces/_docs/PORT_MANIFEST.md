# PORT_MANIFEST — exactly what to bring into the fresh repo

> When you drag-and-drop `src/workspaces/` into a fresh `@luckystack`-consuming repo, this lists **every non-framework file to carry over and where it goes**, plus the wiring. Everything NOT listed here is the **LuckyStack framework** (it comes from `npm install @luckystack/*`, not copied). Generated 2026-06-04. Pairs with [MIGRATION.md] (the code-level port) and [BUILD_HANDOFF.md] §0.

---

## The big picture

The repo this manifest was written in is the **framework monorepo** (`packages/*` = the `@luckystack/*` source) + a dev-harness (`server/`, `src/` outside `_workspaces`). In the **new repo** you do NOT copy the framework — you `npm install` it. You copy only the **Workspaces app code**, which is almost entirely self-contained inside `src/workspaces/`.

**Verified 2026-06-04:** `src/workspaces/` imports **only** `@luckystack/*` + libraries (react, node-pty, @xterm/*, motion) — nothing above its own folder. So the folder is portable as-is. There is exactly **one** loose backend file + **one** wiring line outside it.

---

## 1. Files to COPY into the new repo

| From (this repo) | To (new repo) | What it is | Notes |
|---|---|---|---|
| **`src/workspaces/`** (the whole folder) | `src/workspaces/` | The entire app: `_docs/` (all the specs), the prototype UI (`_screens/`, `_shell/`, `_components/` incl. `XtermTerminal.tsx`, `_data/`, `page.tsx`), and `SESSION_STATE.md`. | Self-contained; only `@luckystack` + lib imports. This IS the drag-and-drop. |
| **`server/hooks/workspacesTerminal.ts`** | `server/hooks/workspacesTerminal.ts` (or wherever the new repo keeps server hooks) | **The one loose backend file** — a node-pty ⇄ Socket.IO **dev terminal bridge** (the `ws-term:*` protocol the `XtermTerminal.tsx` client speaks). Uses `@luckystack/core` (`registerSocketMiddleware`, `getLogger`) + `node-pty`. | **DEV-ONLY host-shell bridge** (RCE surface), gated by `NODE_ENV!=='production'` or `WORKSPACES_TERMINAL_ENABLED=1`. **Lane A replaces it** with the per-container pty-agent ([07b §8]) for the real product — keep it only so the prototype terminal works locally during the build. |
| **`ui-builder/`** (the uploaded old-repo folder) | keep alongside the repo as a **reference folder** (e.g. `ui-builder/` or `/_reference/ui-builder/`) | **Reference only** for Lane D — how Monaco + React/TS support + custom themes were applied (`ui-builder/src/sandbox/_components/editor/BaseCodeEditor.tsx` + `_functions/codeEditor/*`). | **Do NOT ship as product code.** The V1 editor is openvscode-server-in-container ([CODE_EDITOR.md]); ui-builder is a pattern reference + an optional read-only-diff fallback. |
| **`src/workspaces/_docs/REPO_CLAUDE.template.md`** | the new repo's **root `CLAUDE.md`** | The root steering file for the new repo. | It travels inside `src/workspaces/` with the folder copy, but you must **copy it to the repo root** as `CLAUDE.md` (do not leave it only in `_docs/`). |

## 2. Wiring to ADD in the new repo

| Where | What to add | Why |
|---|---|---|
| The new repo's **server entry** (`server/server.ts` or equivalent) | `import { registerWorkspacesTerminalHooks } from './hooks/workspacesTerminal';` + call `registerWorkspacesTerminalHooks();` once at startup | This is the only registration the terminal bridge needs (it self-gates to dev). In this repo it lives at `server/server.ts:33`. |

## 3. Dependencies to ADD (`package.json`)

- **`node-pty`** — the terminal bridge (`workspacesTerminal.ts`).
- **`@xterm/xterm`** (+ addons the prototype uses) — the `XtermTerminal.tsx` client.
- **Lane D, when it opens:** `@monaco-editor/react` + `monaco-editor` (the read-only-diff fallback) and the openvscode-server / code-server image bits ([CODE_EDITOR.md]) — not needed for Phase 0.
- The `@luckystack/*` packages per [SETUP_AND_PREREQUISITES.md] / [MIGRATION.md].

## 4. What you do NOT copy (it is the framework → comes from npm)

- `packages/*` (the `@luckystack/*` source).
- Almost all of `server/` (the dev-harness: `server/dev/**`, `server/prod/**`, `server/utils/**`, `server/hooks/registry.ts|notifications.ts|types.ts`, `server/auth/**`, `server/bootstrap/**`, `server.ts`, `scripts/**`) — these became the published packages; the new repo gets equivalents from `@luckystack/*` + its own thin server entry.
- `src/` outside `src/workspaces/` (the harness's other pages/components).

> If, while building, a lane finds it needs a file from this repo that is NOT in this manifest, that is a signal the manifest missed something — **flag it to the user** and add a row here, rather than silently reaching back into the old monorepo.
