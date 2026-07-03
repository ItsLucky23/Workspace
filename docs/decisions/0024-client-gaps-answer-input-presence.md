---
id: 0024
title: Close client gaps — needs-input answer-to-AI + realtime presence
status: accepted
date: 2026-07-03
tags: [workspaces, client, needs-input, presence, realtime]
supersedes: []
---

# 0024 — Client gaps: answer-the-AI + presence

## Context

Goal-item #17 had three client gaps. Two are built here; the third is deliberately relocated.

1. The needs-input **"Send"** button was a stub (cleared the input, told the AI nothing) — the
   human-in-the-loop couldn't actually answer the AI's open question.
2. **Presence** ("who's viewing") was FAKE — the header showed `members.slice(0, 3)`.
3. **Real usage/spend figures** — the Usage page shows seed dummies (`SPEND_7D`/`USAGE_ROWS`).

## Decision

- **Answer-the-AI (`answer-input` control-op):** a human answer records the answer as a comment
  (audit trail), clears the needs-input banner, sets the ticket back to `idle`, and RE-FIRES the
  parked turn with `claude --resume` + the answer as the prompt — reusing #1's resume path
  (`resumePrompt` threads `reprovisionTicket → provisionContainers → runStage → driveContainerTurn`).
  A dedicated `_sync/answerInput` route (RBAC `workTickets`) + `ctx.answerInput` + a wired
  `NeedsInputBanner`. No new AI-channel verb — `answer-input` is a control-op like `resume`.
- **Realtime presence** via a PURE RELAY sync event (`_sync/presence`): a client viewing a ticket
  pings `{ticketKey, viewing}` on open + a 12s heartbeat + on close; the server echoes the
  *authenticated* userId (never client-supplied) to the whole room. Clients keep a per-user
  `{ticketKey, lastSeen}` map, prune entries older than 25s, and render live viewer avatars on the
  ticket header (self excluded). No server state + no Conductor write (presence is ephemeral), so
  the socket layer's room fan-out (Redis adapter under `WS_MULTI_INSTANCE`) makes it
  multi-instance-safe for free.
- **Real usage/spend → deferred to #16.** The data does not exist yet: `SpendRecord` is written
  nowhere and `AgentSession.tokenEstimate` is unpopulated. #16 (kosten-tracking) is the very next
  item and BUILDS that recording. Displaying real figures is meaningless without the recording, and
  wiring an empty aggregate now would just show zeros and then be reworked. So the "echte
  usage/spend-cijfers" display is folded into #16 (recording + display together). Flagged per Rule
  3b — a conscious relocation, not a silent drop.

## Rejected alternatives

- **A raw-socket presence protocol** (like `ws-term:*`). The sync layer already broadcasts to the
  room + fans out cross-instance; a sync relay reuses it with no new socket wiring and no server
  presence store.
- **Server-authoritative presence roster.** Needs a shared (Redis) store to be correct
  cross-instance; the ping/last-seen model is eventually-consistent, self-healing (a crashed viewer
  ages out), and needs zero server state.
- **Answer by re-queuing a fresh turn (no `--resume`).** Loses the AI's context; the parked session
  has a resumable `claudeSessionId`, so continuing it with the answer is correct.
- **Build the usage display now against empty data.** Zeros + rework; #16 is its natural home.

## Consequences

- The human can answer the AI and the turn continues with that answer — the loop is closed.
- Viewers see who else is on a ticket, live + multi-instance-safe.
- Verified: `answerInput.test.mts` (4/4) — empty answer rejected, a real answer clears the banner +
  idles the ticket + records the comment; full suite 26/26. Browser: the banner→answer→Send→banner-
  clears flow proven end-to-end on the running app. Presence renders without error (full multi-
  viewer needs two sessions). Usage display tracked with #16.
