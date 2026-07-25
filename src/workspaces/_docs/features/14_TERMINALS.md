# 14 — Terminals

> The multi-terminal workspace: tabs/grid over every live ticket-container shell. Access uses the LuckyStack login
> session, workspace RBAC and an exact server-derived container identity. SSH keys are not a terminal gate (ADR
> 0301). Extends [01 §3-4], [07 §A] and the per-container pty-agent contract.

---

## Scope

**In**

- Tabs by default and an optional desktop grid over running ticket containers.
- One interactive shell per ticket, with reconnect/scrollback through the terminal relay.
- Visible connecting/live/exited state, process controls and mobile single-panel behavior.
- Server-side authorization before attach: valid session, `workTickets` capability, canonical container name and
  exact workspace/ticket Docker labels.

**Out**

- Browser-selected host shells, binaries, args or container names.
- An SSH nonce/signature challenge or external SSH daemon.
- Spawning/tearing down the worker itself; the orchestrator owns that lifecycle.

**Deferred**

- Split panes, pop-out terminals, saved layouts and search-in-buffer.

---

## User flow

1. Open **Terminals** while logged in.
2. The page requests the running containers for the active workspace.
3. If Docker, a repository or a running ticket is missing, the page names that actual prerequisite. There is no
   SSH-unlock screen.
4. Select a ticket tab or the desktop grid.
5. Input/output is relayed only after the server resolves the canonical ticket container and re-checks its labels.
6. Reconnect reattaches to the container terminal; controls remain scoped to that exact session.

---

## Security boundary

Terminal authorization is deliberately one straightforward chain:

1. LuckyStack authenticates the socket session.
2. `server/hooks/workspacesTerminal.ts` requires the `workTickets` capability for the requested workspace.
3. The server derives the canonical container name from `(workspaceId, ticketKey)`; the browser cannot choose it.
4. Docker labels must match the same workspace and ticket before attach.
5. Production has no host-shell fallback. The shell runs inside the ticket container/VM boundary.

A stored SSH public key adds no permission and is never consulted by this chain. This replaces the earlier B-05
nonce + `crypto.verify` design-horizon proposal (ADR 0301).

---

## Data and transport

No new persisted model. The screen renders the existing `Terminal`, `TerminalProcess` and `TerminalLine` shapes.
The logged-in user is display context only; authorization comes from the server session and RBAC.

Terminal socket events are transport, not structured-channel verbs. Mutating product state still goes through the
control API and Conductor. Raw terminal input can affect only the already-authorized ticket container.

---

## UI

- `page.tsx` — tabs/grid, prerequisite states and running-container polling.
- `TerminalPanel.tsx` — panel controls and viewer label.
- `XtermTerminal.tsx` — xterm.js relay and scrollback lifecycle.
- `server/hooks/workspacesTerminal.ts` — session/RBAC/container-label enforcement.

Mobile uses one full-screen panel and the horizontally scrollable ticket tabs. Desktop can opt into the grid.

---

## Resolved

1. Restart acts on the selected process, not the whole workspace.
2. Copy buffer uses the bounded scrollback.
3. **ADR 0301:** no SSH capability challenge. Session + RBAC + exact container labels are the terminal boundary.
