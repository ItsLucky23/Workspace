# 14 — Terminals

> The multi-terminal workspace: a grid/tabs view of every live PTY across the workspace, gated on an account SSH key. Extends [01 §3-4] (Stage-Agent PTY + SessionManager lifecycle), [07 §A] (launch/teardown attaches the PTY) and [07 §B] (the `term.` proxy). Builds on the existing `Terminals.tsx` screen + `XtermTerminal.tsx` + the dev `workspacesTerminal.ts` bridge.

This doc turns the existing dummy/dev terminal screen into the real product surface: the live xterm.js panels each user opens to *watch and steer* the interactive `claude` PTY (and its sibling `server`/`client` processes) inside a ticket's container. Nothing here changes the engine — it documents the UI + the connection state machine over the architecture that already attaches the PTY in [07 §A].

---

## Scope

**In**
- The **grid / tabs** layout switch over the workspace's live `Terminal[]` — one panel per ticket, with **per-process sub-tabs** (`claude` / `server` / `client`, from `Terminal.processes`).
- The **SSH-unlock overlay** (B-05): no SSH identity → the screen is locked; "Unlock with SSH key" routes to Account. The unlock is a **nonce + `crypto.verify`** capability challenge on the `/pty` namespace ([01 §8]).
- The **terminal state machine** per panel: `connecting → live → exited → locked`, surfaced in the header `StatusPill` + footer.
- The **"..." menu** actions: restart, clear, rename, copy buffer, kill (kill behind `menuHandler.confirm`). These are control-API requests, **not** verbs.
- **Reconnect ring-buffer reattach**: on socket drop + reattach, the panel reseeds scrollback from the orchestrator's per-session ring-buffer ([01 §4]).
- **Mobile full-screen** single-panel view (no grid).

**Out**
- Spawning/tearing down the PTY itself — that's [07 §A] (the orchestrator owns the child handle under the lease). The screen only *attaches* to an already-live session.
- The Files/diff/editor surfaces (`08_CODEBASE_VIEWER`) and per-stage process *config* (that's `PipelineStageCfg.processes`, edited in `Pipeline.tsx`).
- Split-pane / pop-out windows — **deferred** (see Defaults: grid/tabs only in v1).

**Deferred**
- **Split panes + pop-out terminals** (a v1 panel is one process at a time via sub-tabs; no side-by-side or detached window).
- **Search-in-buffer** and saved layouts.
- Production write access from a *suspended* Assistant terminal (terminals attach to live worker/Assistant PTYs only).

---

## User flow

1. **Open Terminals.** If the account has no linked SSH key, the **`SshLocked`** card fills the pane: "Terminals locked — opening a terminal is shell access to a container, so it needs an SSH key." The CTA routes to **Account → SSH keys** (`navigate('settings')`). No key, no attach.
2. **Unlock (one-time, per account).** Once a key is linked, the `/pty` namespace runs the **nonce + `crypto.verify`** challenge (B-05, [01 §8]): the orchestrator issues a nonce, the client signs it with the private key (never sent), the server verifies against the stored public key and maps key → user (the dummy maps `123 → test`, `456 → mathijs`). The active identity shows as an `ssh: <name>` chip in the header.
3. **Pick a layout.** With ≥1 live terminal, a **`Segmented`** toggles **Grid** (all panels at once, `xl:grid-cols-2`) vs **Tabs** (one ticket full-height; a tab strip with a status dot per ticket).
4. **Switch processes.** Inside a panel, the **process sub-tabs** (`claude` / `server` / `client`) switch which `TerminalProcess` the single `XtermTerminal` shows. Each `(ticketId, processName)` is its own `sessionId` — switching detaches one element and reattaches another; scrollback survives because the xterm instance lives in a module-level registry ([01 §4] ring-buffer, mirrored client-side).
5. **Steer it.** The panel is a real interactive terminal: keystrokes go to the PTY (`ws-term:input`), output streams back (`ws-term:out`). The user answers a `claude>` prompt, scrolls history, or types into the `server` shell — exactly what the Stage-Agent's container exposes.
6. **Manage it ("..." menu).** Restart (re-run the process's `StageProcess` command), Clear (wipe the local buffer), Rename (panel label only), Copy buffer (scrollback → clipboard), and **Kill** (terminates the process; guarded by `menuHandler.confirm` — "The process is terminated. You can restart it after."). Every one of these is a **control-API request the Conductor/orchestrator executes**, never a new verb (B-23).
7. **Reconnect.** Drop Wi-Fi / background the tab → the panel goes `connecting`; on resocket it reattaches and the orchestrator replays the **ring-buffer** so scrollback + the live cursor reappear without a fresh spawn ([01 §4]).

**Desktop:** grid is the default (watch several agents at once); tabs for focus. The header carries the `ssh:` identity chip + the layout `Segmented`.

**Mobile:** **full-screen single panel.** The grid collapses to one terminal at a time; the ticket tab strip (already horizontally scrollable, `ws-no-scrollbar`) is the switcher, the process sub-tabs stay in the panel header. The "..." menu and SSH-unlock card render unchanged. "Look from the beach" applies — read + answer a prompt is first-class; heavy typing is desktop-first.

```
┌ Terminals            ssh: Mathijs        [ ▥ Grid | ▮▮ Tabs ] ┐
├──────────────────────────────┬──────────────────────────────┤
│ DEV-1240 · Implementatie ●busy│ DEV-1245 · Implementatie ●busy│
│ [claude] server          ⋯   │ server client [claude]    ⋯   │  ← process sub-tabs + "..."
│ claude> editing Avatar.tsx    │ claude> wiring dnd-kit…       │
│ ● Running tests…              │   added Column type           │
│   2 failing · Avatar.test.tsx │ $▌                            │
│ $▌                            │                               │
│ mathijs@dev-1240:/app   ● live│ mathijs@dev-1245:/app   ● live│  ← footer = state
└──────────────────────────────┴──────────────────────────────┘
```

---

## Data

No new persisted model. The screen renders the existing **`Terminal`** (`{ ticketId, stage, processes }`), **`TerminalProcess`** (`{ name, status, cwd, exit, lines }`), and **`TerminalLine`** (`{ tone, prefix?, text, cursor?, wait? }`) from `_data/types.ts`. Live identity comes from the existing **`SshKeyEntry`** (`fingerprint`, `userId`) and the `sshUserId` already in `WorkspacesContext`.

The four panel connection states (`connecting | live | exited | locked`) are **derived UI state**, not persisted: `locked` ⇐ no `sshUserId`; `connecting`/`live`/`exited` ⇐ the socket lifecycle + the `ws-term:exit` event already handled in `XtermTerminal`. The per-process `TerminalProcess.status` (a `TicketStatus`) drives the header `StatusPill` and the tab dot, exactly as `termStatus()` already computes it.

The reconnect scrollback is the orchestrator-side **ring-buffer** on `ManagedSession.ringBuffer` ([01 §4]) — already in the architecture, not a new field here.

**INDEX delta:** (none — reuses `Terminal`, `TerminalProcess`, `TerminalLine`, `SshKeyEntry`; the `connecting|live|exited|locked` panel state is derived UI-only)

---

## Verbs / Events / Hooks

**No new verbs.** Terminals attach to a PTY; they do not drive the structured channel.

- **Transport** is the existing socket event pair the prototype already uses: `ws-term:start` / `ws-term:input` / `ws-term:out` / `ws-term:resize` / `ws-term:exit` / `ws-term:kill` (see `XtermTerminal.tsx` + `workspacesTerminal.ts`). These are raw PTY I/O on the `/pty` namespace, **not** Stage-Agent verbs ([02 §2]).
- **Control-API, not verbs.** Restart / clear / rename / copy / kill (and the layout switch) are **control-API requests** the orchestrator executes under its single-instance lease ([07 §A], [01 §3.3]) — the same proposes/executes boundary as every other user lever (B-23). The browser *requests*; it never chooses the binary/args/cwd ([01 §8]).
- **Capability gate (B-05):** the nonce + `crypto.verify` SSH challenge runs **before** any attach on the `/pty` namespace ([01 §8]); framework socket auth covers the connection, this adds the per-session capability gate. Identity (key → user) sets which terminals the user may attach to (RBAC "Use terminals + work on tickets").
- **Hooks:** none new. The process output is raw PTY data; the *event-log* narration (commands, file-changes) still comes from the worker's `PostToolUse` hook → `TicketEvent` ([02 §3]), surfaced in Activity (doc 20), not from this screen.

---

## UI

**Reused (real names):**
- `Terminals.tsx` — the screen itself: `TerminalPanel`, `SshLocked`, the Grid/Tabs `Segmented`, `termStatus()`, the process sub-tab buttons, and the `PopMenu` "..." menu (already wired with restart/clear/rename/copy/kill + `menuHandler.confirm` on kill).
- `XtermTerminal.tsx` — the real xterm.js ⇄ socket panel with the module-level session registry that keeps PTYs alive across mounts (the client half of ring-buffer reattach).
- `TicketDetail.tsx` **Terminal** tab (`TerminalTab`) — the embedded single-panel variant with its "Open in Terminals" link; same `sessionId` scheme (`${ticketId}:${proc.name}`), so a panel opened there and here share scrollback.
- Primitives: `Segmented`, `StatusPill`, `PopMenu`, `EmptyState`, `Icon`; terminal theme tokens (`terminal-bg`/`terminal-surface`/`terminal-text`/`terminal-muted`/`terminal-green`…).
- `WorkspacesContext` — `sshUserId`, `navigate`.

**New (small):**
- A `connecting`/`exited` overlay state on `TerminalPanel` (a thin status veneer over the existing footer "● live" indicator) so the four-state machine is visible. No new component file — it's a state branch in `TerminalPanel`.

**Mobile parity:** the grid is suppressed; one full-bleed panel + the existing scrollable ticket tab strip is the switcher. `SshLocked`, the "..." menu, and the process sub-tabs render unchanged (they're already compact).

> **Interim vs production (B-31).** The dev **host-shell bridge** (`server/hooks/workspacesTerminal.ts`) is the **INTERIM**: it spawns a PTY *on the LuckyStack server host itself* (PowerShell on Windows / `$SHELL` on POSIX), hard-gated to non-production because a browser→shell channel is an RCE surface ([01 §8]). **Production is different:** the orchestrator proxies a **`/pty` namespace to a per-container `pty-agent`** ([07 §A] step 7, [07 §B] `term.<domain>`), so the shell is the isolated ticket *container*, never the host. The client (`XtermTerminal`) is identical for both — same `ws-term:*` events, same ring-buffer reattach — only the server end of the bridge swaps (B-31). The `term.<domain>` upstream is the **single-instance** orchestrator and must route **directly**, never load-balanced ([07 §B], [01 §8]).

---

## Extends

- "[01 §3.1] Stage-Agent (the worker)" — a terminal panel is the human window onto the interactive `claude` PTY (one per `(ticketId, stageId)`); `server`/`client` are its sibling `StageProcess`es. The agent self-phrases blocks *in this PTY*; answering it here = the same `request_input` loop ([02 §5]).
- "[01 §4] SessionManager & lifecycle" — `ManagedSession.ringBuffer` is the scrollback the panel reattaches to after a socket drop; `resumeAll()` means a panel survives an orchestrator restart, not just a tab switch.
- "[01 §8] Security & dev-gating" — the **SSH-key challenge** (nonce + `crypto.verify`) on the PTY namespace; host-shell paths stay dev-gated; the browser never chooses the spawn.
- "[07 §A] Ticket launch & teardown" — step 7 attaches the `claude` PTY via the pty-agent; the panels here are the view onto exactly those sessions; Kill maps to the teardown's `ptyAgent.kill`, Restart to re-running a `StageProcess` command.
- "[07 §B] Caddy subdomain proxy" — terminal WebSockets reach the orchestrator at `term.<domain>`, routed directly to the single instance (never the web-app, never the router).
- **B-31** — the pty-agent-per-container bridge that replaces the dev host-shell bridge in production.
- **B-05** — SSH key = the terminal capability gate (OAuth is login; the key unlocks shell access).

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D72–D73)

1. **14.q1 — Restart granularity → D72:** "Restart" re-runs **only the selected `StageProcess`'s command**. Container-level reactivation stays the ticket-level lever in `TicketDetail`.
2. **14.q2 — Copy-buffer scope → D73:** **Copy the full ring-buffer scrollback** (capped at the ring-buffer length), not just the visible viewport.
