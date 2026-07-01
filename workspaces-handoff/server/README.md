# server/ — the one backend file to port

> This folder holds the **single non-framework backend file** Workspaces needs ported into the new repo. Everything else backend is provided by `@luckystack/*` (the framework) and by the build itself (the orchestrator/engine you'll build per the docs). See [`../src/workspaces/_docs/PORT_MANIFEST.md`](../src/workspaces/_docs/PORT_MANIFEST.md) for the authoritative copy-list.

## `hooks/workspacesTerminal.ts` — the dev terminal PTY bridge

**What it is.** The proven **node-pty ↔ socket** bridge that powers the in-app terminal (`_components/XtermTerminal.tsx`). It registers a dev-only PTY bridge on the socket layer so the prototype's terminal view can attach to a real shell. It logs `"[workspaces] dev terminal PTY bridge registered (non-production only)"` on boot.

**Why it's the one file that ships.** It is the **only already-real backend piece** of the prototype — the battle-tested pattern the production engine extends. In V1 the orchestrator's in-container **pty-agent replaces the host-shell backend** of this bridge (the socket/relay seam stays, the host-shell backend is swapped — a hard prod boot-guard must crash if the dev host-shell flag is set without the container backend). See [`../src/workspaces/_docs/07b_CONTAINER_RUNTIME.md` §9](../src/workspaces/_docs/07b_CONTAINER_RUNTIME.md) (pty-agent) and [`01_ARCHITECTURE.md`](../src/workspaces/_docs/01_ARCHITECTURE.md).

**How to port it (per PORT_MANIFEST).**
1. Copy `hooks/workspacesTerminal.ts` into the new repo's `server/hooks/`.
2. Add its **one registration line** to the server entry, e.g.:
   ```ts
   import { registerWorkspacesTerminalHooks } from './hooks/workspacesTerminal';
   // …in server bootstrap:
   registerWorkspacesTerminalHooks(/* io / deps per the framework's server seam */);
   ```
3. **Production safety:** this is a **dev-only** bridge to a host shell. Do **not** ship the host-shell backend to production — replace it with the in-container pty-agent ([07b §9]) and guard it behind the non-production flag (it already logs "non-production only").

> This file was copied verbatim from the LuckyStack-v2 source repo on 2026-06-11. It is dev-tooling — not the production terminal path.
