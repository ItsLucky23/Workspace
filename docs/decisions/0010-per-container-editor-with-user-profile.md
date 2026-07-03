---
id: 0010
title: Per-container VS Code editor with a projected per-user profile (extensions + auth)
status: accepted
date: 2026-07-03
tags: [editor, container, extensions, auth, multi-tenancy]
supersedes: []
relates: [0008, 0009]
---

## Context

The V1 code editor is the real browser VS Code (openvscode-server), per [CODE_EDITOR.md] and the
hybrid decision ([[workspaces-editor-plan]]): Monaco for lightweight embedded surfaces,
openvscode-server for the full editor. An open question was *where* the full editor runs:

- **Central editor + git worktrees** — one openvscode-server on the host that opens each ticket's
  worktree folder. Cheap, no per-ticket container for the editor, and extension logins persist for
  free (one shared user-data-dir). But the editor's LSP / "run" / integrated terminal only see the
  HOST toolchain, not the project's — so a Python/Go/… project gets no working IntelliSense, no
  in-project terminal, no per-project toolchain, unless the host happens to have every toolchain.
- **Per-container editor** — openvscode-server INSIDE each ticket container (07b / [0008]). The
  editor sees exactly the project's L2 toolchain + installed deps + the agent's worktree, so LSP,
  "run", terminal, and extensions all work against the real project. Costs +300–800 MB/session and
  each container has its OWN filesystem, so extension installs + auth logins do NOT carry across
  tickets/workspaces by default.

The user weighed both and chose the **per-container editor** (it is the better editor experience),
**with the explicit requirement that the per-user editor storage — installed extensions AND auth
tokens (secret storage) — is carried into every session** so a login (GitHub, the Claude extension,
…) done once follows the user across all their tickets and workspaces.

## Decision

1. **The full editor runs per-ticket, INSIDE the ticket container** (openvscode-server on the fixed
   in-container port, exposed via the Caddy route — [0008], CODE_EDITOR §1). Not a central editor.
2. **A durable per-user editor PROFILE is projected into each editor session**, so extensions + auth
   follow the user. The profile is the openvscode `--user-data-dir` (settings, `globalStorage`, and
   the **secret storage** where extension auth tokens live) + the `--extensions-dir`.
3. **Projection is copy-in / capture-back via `docker cp`** at editor-session start/stop (NOT a live
   shared volume), because:
   - the editor server starts via `docker exec` on an already-running container, so a volume mount
     (which is fixed at `docker run`) would force a change to the container-launch path; copy-in via
     `docker cp` keeps the whole mechanism in the editor layer with zero container-launch change;
   - it avoids two concurrent editors (same user, two tickets) corrupting one shared user-data-dir —
     each session gets its own in-container copy, and changes are captured back to the per-user store
     on install/login events + session end.
   Store location: `data/editor-profiles/<userId>/{user-data,extensions}` (host, gitignored, tenant-
   scoped). Reuses the `runInTenant` boundary like every other orchestrator path.

## Rejected alternatives

- **Central editor on host + worktrees** — rejected as the *primary* editor: no per-project toolchain
  ⇒ no real LSP/run/terminal. (Kept conceptually as the Monaco light tier for browsing/diffs, which
  needs no container.)
- **Live shared per-user Docker volume** mounted into every session — simplest and instantly shared,
  but two concurrent editors on one user-data-dir risk VS Code state corruption, and it forces the
  mount into the container-launch path. Kept as a documented upgrade if copy-in/out latency bites.
- **No profile persistence** (per-container, logins re-done each ticket) — rejected: the user
  explicitly wants logins/extensions to follow them (the central-editor perk, preserved here).

## Consequences

- **New**: `server/container/editorProfile.ts` (per-user store + `docker cp` project/capture) wired
  into `server/container/editorServer.ts::startEditorInContainer`. The per-user set of extension ids
  (`User.editorExtensions`, [[workspaces-editor-plan]] Track E) seeds the profile.
- **Security (flagged)**: the projected profile carries **auth tokens** into a container that also
  runs the repo's code + arbitrary extensions — a malicious extension/repo could read them. Mitigated
  by the container's **egress allow-list** (tokens can't be exfiltrated to arbitrary hosts), tenant
  isolation (only that user's containers get their profile), and the per-stage network/tool config —
  the same posture as the projected subscription creds (CODE_EDITOR §6.2). Secret-at-rest hardening of
  the host store (`data/editor-profiles/`) is a follow-up.
- **Concurrency**: capture-back is last-writer-wins across a user's concurrent sessions for the
  profile (extension installs / settings). Accepted for the small self-hosted V1; the live-volume or a
  per-key merge is the upgrade path.
- **Crash window**: changes not yet captured back on a hard crash are lost. Capture on install/login
  events (not only session-end) keeps the window small.
- **VERIFIED (2026-07-03)** end-to-end against real Docker:
  - `scripts/spike/editorProfileSpike.mts`: a login captured from container C1 and projected into a
    fresh container C2 is present in C2 — the login carries across tickets via the per-user profile.
  - `scripts/spike/openEditorSpike.mts`: the full PRODUCT orchestration `openEditorForTicket`
    (`editorSession.ts`) — real `launchTicketContainer` (hardened container + `DEV-####` worktree) →
    proxy-net attach → profile projection → openvscode serving on :3000 in the container (302) →
    per-ticket proxy route built. All green.
  - **Profile transport = `tar` streamed through `docker exec` as the `agent` user**, NOT `docker cp`
    + chown: the hardened container drops ALL caps (no CAP_CHOWN), so `docker cp`'s root-owned files
    would be unwritable by the agent. (Bug found + fixed during verification.)
  - Wired: `src/workspaces/_api/openEditor_v1.ts` (login-gated) + a ticket "Code" tab "Open live
    VS Code" button. Also a dev launcher `npm run editor:launch` for testing without the app.
  - **Still to run for the clickable product path**: a reverse proxy (`server/proxy`, Caddy/nginx) up
    on the shared network so the `vscode-<slug>` subdomain resolves; and a real activated ticket
    (linked repo + branch) so `openEditor_v1` has a container to open.
