# 24 — Pause & kill controls

> The lifecycle levers over running agents: **per-ticket pause/resume** (suspend the session, keep it for `--resume`), **kill** (teardown the container), and the workspace-wide **"pause all agents"**. Every lever is a **control-API request the Conductor executes — NOT a structured-channel verb** (`[02 §1]`, `[01 §4]`). RBAC is ticket-scoped (D69): ticket-pause for anyone who can "work on tickets"; **kill + pause-all = Admin+**. Extends `[01 §3.3]` (Conductor = the only writer of status/lifecycle), `[01 §4]` (the propose → accept → Conductor-executes boundary), `[02 §1]` (the state machine + control-API levers), and feature 11 (the AI panel's `TicketControlBar` proposes the same actions). Realizes B-35 (runaway → stuck → needs-input + auto-pause).

---

## Scope

**In**
- **Per-ticket pause/resume**: pause suspends the running `AgentSession` (the PTY is parked, the container **kept** so the session can `--resume`); resume re-attaches and continues. Status moves `busy → paused → busy` ([02 §1]).
- **Per-ticket kill**: tears down the container + worktree session (the destructive option — branch + `TicketEvent` audit are retained per [07 §A]). Reactivation re-runs the launch sequence on the branch.
- **Workspace "pause all agents"**: a single lever that pauses every running session in the workspace (the existing `BoardHeader` button); resumable.
- **Runaway → stuck → needs-input** (B-35): the heartbeat/idle/iteration-cap watcher escalates a runaway session to `stuck`, then to `needs-input` with a notification — an *automatic* Conductor lever, the deterministic sibling of a manual pause.
- **RBAC (D69)**: ticket-scoped pause/resume for **"work on tickets"** (Owner/Admin/Member); **kill + pause-all = Admin+**. Reuses the B-28 tiers; no matrix change.

**Out**
- The runaway *detection* internals (heartbeat watcher, iteration cap) — that is B-35 / the orchestrator runtime; this doc surfaces the resulting `stuck`/`needs-input` states + the manual levers.
- Budget auto-pause (the `WorkspaceBudget.autoPause` cap-driven pause, B-35 / DATAMODEL §8) — same Conductor pause mechanism, but cap-triggered; documented under spend (feature 05 / P4), cited not restated.
- The container teardown mechanics — **[07 §A]** (kill reuses the teardown step).

**Deferred**
- A scheduled pause window ("pause all overnight") — expressible later as a cron `WorkspaceTrigger` (doc 10); not v1 UI.
- Selective bulk-kill of a filtered set (v1 bulk is pause/resume across a selection; kill stays per-ticket + the destructive `menuHandler.confirm`).

---

## User flow

1. **Pause a ticket.** From the board card menu (`cardMenuItems` already has **Pause agent / Resume agent**), the ticket detail, or the AI panel's `TicketControlBar` (feature 11), a user with "work on tickets" presses **Pause**. This **proposes** a `pause` control-API request; the Conductor suspends the session (PTY parked, container kept) and flips status to `paused` ([02 §1]). The card/header shows the paused pill; the UI holds an optimistic "requested…" state until the Conductor confirms via the live status push (~10s timeout, mirroring feature 11's D60).
2. **Resume.** **Resume agent** → a `resume` control-API request → the Conductor re-attaches the parked session (`--resume`) and status returns to `busy`. The scrollback ring-buffer (B-31) means resume picks up where it left off.
3. **Kill (Admin+).** From the ticket detail (the existing **Teardown container** danger button in `OverviewTab`, already gated through `menuHandler.confirm` with a type-to-confirm input) → a `kill` control-API request → the Conductor tears down the container ([07 §A] teardown); **branch + `TicketEvent` retained**. Non-Admin users see the action disabled with a tooltip (D69).
4. **Pause all agents (Admin+).** The `BoardHeader` **Pause all agents** button (already `menuHandler.confirm`-guarded) → a single `pause-all` control-API request the Conductor runs **serially** across every running session (no optimistic mutation; batched, per the bulk-ops default). Resume-all restores them.
5. **Runaway auto-escalation (B-35).** A session that idles past the heartbeat/iteration cap is moved by the watcher to **`stuck`**, then escalated to **`needs-input`** + a notification (feature 18). This is the Conductor's automatic pause-equivalent — the user's lever is then to answer (the needs-input reply) or pause/kill. The `stuck`/`needs-input` pills already render (`StatusPill`, seed has a `stuck` terminal for DEV-1242).

### Desktop + mobile + mockup

- **Desktop:** levers live where they already are — the card `PopMenu` (Pause/Resume), `OverviewTab`'s Teardown danger button (kill), `BoardHeader`'s Pause-all, and feature 11's `TicketControlBar`. Admin-only actions are disabled-with-tooltip for Members (D69).
- **Mobile:** the card menu + ticket sheet carry Pause/Resume as full-width taps; Pause-all sits in the board header overflow. Kill keeps the type-to-confirm `menuHandler.confirm` on mobile too.

```
Board header:            [ Sprint ▾ ] [⏸ Pause all] (Admin+) [filter] [+]
Card ⋯ menu:             Open ticket · Open terminal · ⏸ Pause agent / ▶ Resume agent
Ticket › Overview:       [ 🗄 Teardown container ]  (kill — Admin+, type DEV-#### to confirm)
States:  busy → ⏸ paused → busy        runaway → ⚠ stuck → ❓ needs-input (auto, B-35)
```

---

## Data

No new persisted models — pause/kill operate over the existing `AgentSession` + `Ticket.status` (DATAMODEL §5 / §4):

| Field | Type | Note |
|---|---|---|
| `TicketStatus` | `'idle' \| 'needs-input' \| 'busy' \| 'done' \| 'paused' \| 'stuck'` | already in `types.ts` — `paused` (manual) and `stuck` (runaway, B-35) are the relevant states; AI-owned/read-only (`[01 §3.3]`). |
| `AgentSession.status` | `'starting'\|'running'\|'needs-input'\|'done'\|'stuck'\|'killed'\|'error'` | server-side (DATAMODEL §5); pause parks `running`, kill → `killed`. |
| `AgentSession.lastHeartbeatAt` | `DateTime?` (server) | the B-35 runaway/stuck-detection input (DATAMODEL §5/§8). |

Pause keeps the container (session resumable); kill sets it disposable ([07 §A]). No new field — the state machine + control-API cover it.

**INDEX delta:** (none)

---

## Verbs / Events / Hooks

**No new verbs.**

- **Every lever is a control-API request the Conductor executes — NOT a verb** (`[01 §4]`, `[02 §1]`). The user's three levers + the lifecycle controls are control-API requests (`pause` / `resume` / `kill` / `pause-all` / `resume-all`); the Conductor is the only writer of status + the only thing that touches the session/container (`[01 §3.3]`). AI proposes → user accepts → Conductor executes (B-23) — the AI panel's `TicketControlBar` (feature 11) *proposes* these same actions and can't bypass the boundary because no Assistant verb writes.
- **`run-command` allow-list / [07 §A]**: kill reuses the registered teardown action ([07 §A] teardown); pause/resume park/re-attach the PTY session under the single-instance lease. The browser requests the action; it never chooses the binary/cwd ([01 §8]).
- **`WorkspaceTrigger` ([03 §1])**: an automation like "on budget cap → pause all" or "on stuck → notify" is a trigger consuming the existing event + the `pause`/notify control-API action — not a new verb. Budget auto-pause (B-35) is exactly this, cap-driven.
- **Runaway watcher (B-35)**: the heartbeat/idle/iteration-cap escalation (`busy → stuck → needs-input` + notification) is a **deterministic Conductor mechanism**, not an LLM action and not a verb.
- **RBAC gating (D69)**: ticket pause/resume requires "work on tickets"; kill + pause-all require Admin+ — enforced at the control-API boundary (the `preApiExecute`/membership check, DATAMODEL §1), the same place the B-28 matrix is enforced. Reuses the B-28 tiers; no matrix change.

---

## UI

**Reused (real components)**
- `Board.tsx` `cardMenuItems` — already lists **Pause agent / Resume agent** (toggling on `ticket.status === 'paused'`); this doc wires them to the control-API and RBAC-gates them.
- `Board.tsx` `BoardHeader` — the **Pause all agents** button (already `menuHandler.confirm`-guarded) becomes the Admin+ `pause-all` lever.
- `TicketDetail.tsx` `OverviewTab` — the **Teardown container** danger `WsButton` (already type-to-confirm via `menuHandler.confirm`) is the `kill` lever, RBAC-gated to Admin+.
- `TicketDetail.tsx` — the `needs-input` / `done` banners + `StatusPill` already render `paused`/`stuck`/`needs-input`.
- feature 11's `TicketControlBar` (Pause/Resume/Promote/Stop) — the AI-panel surface that *proposes* the same control-API actions; `stop`/kill keeps the `menuHandler.confirm` (D57).
- `menuHandler.confirm`, `WsButton`, `IconButton`, `StatusPill`, `PopMenu` (`_components/primitives`).

**New (small, scoped)**
- RBAC-disabled wrappers on the existing Pause/Resume/Kill/Pause-all triggers (disabled-with-tooltip for users below the required tier, D69) — a small gating helper, not new chrome.
- An optimistic "requested…" state on the lever buttons that times out ~10s if the Conductor never confirms (reuses feature 11's D60 pattern).

**Mobile parity:** Pause/Resume as full-width taps in the card menu + ticket sheet; Pause-all in the board header overflow; kill keeps type-to-confirm. Same RBAC gating.

---

## Extends

- "[01 §3.3] Conductor = the only writer of board/git/status" — pause/resume/kill/pause-all are Conductor-executed; status is AI-owned/read-only; the user's levers are control-API requests, never direct writes.
- "[01 §4] propose → accept → Conductor executes" — the AI panel proposes these controls; the Conductor executes; no Assistant verb writes (B-23 structural).
- "[02 §1] state machine + the three user levers + control-API" — pause/resume/kill/pause-all are control-API requests the Conductor runs, explicitly **not** new structured-channel verbs.
- "[07 §A] Ticket launch & teardown sequence" — kill reuses the teardown step (pty kill + Caddy route delete + container remove); branch + `TicketEvent` retained.
- "feature 11 (Workspace-AI panel)" — its `TicketControlBar` proposes Pause/Resume/Promote/Stop; `stop` confirms via `menuHandler.confirm` (D57); buttons show "requested…" then time out ~10s (D60).
- "B-35 — spend/budget + runaway-control; stuck/idle/loop-detection → auto-escalate to needs-input (heartbeat/timeout/iteration-cap); budget-cap → auto-pause" — the automatic-lever decision this doc realizes alongside the manual ones.
- "D69 — ticket-scoped pause/resume for 'work on tickets'; kill + workspace pause-all = Admin+; reuses B-28 tiers, no matrix change; levers → control-API, never verbs" — the locked RBAC decision.

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D87)

1. **24.q1 — paused-session resource hold → D87:** a paused ticket **keeps its container** for `--resume`, but the container is **reclaimed after a generous, configurable idle window**, with a **notification sent before reclaim**. After reclaim the session is resumable only via full reactivation.
