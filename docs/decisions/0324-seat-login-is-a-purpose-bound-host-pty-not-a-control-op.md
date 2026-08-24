---
id: 0324
title: Seat login is a purpose-bound host PTY over the terminal relay, not a control-op
status: accepted
date: 2026-08-24
tags: [security, coding-agent, terminal, hosting, ux]
supersedes: []
---

## Context

The coding seats (ADR 0322: Claude Code on a Claude subscription, pi on a Codex/ChatGPT subscription)
authenticate through interactive OAuth flows in their CLIs. Until now that meant SSH-ing into the
host, exporting the right config-dir env and running the CLI by hand (docs/HOSTING.md §Claude auth) —
exactly the "extra server step" the owner ruled out for the install story on 2026-08-24: *"het project
moet gewoon installen en runnen zijn … géén extra stap dat iemand ook nog op de server moet inloggen;
liever een web-UI met een beetje hulp via de terminal."*

The terminal relay (`server/hooks/workspacesTerminal.ts`) already streams PTYs to the browser, but its
header states a hard invariant: NO host-shell mode, for anyone. The design sketch
(`src/workspaces/_docs/SEAT_LOGIN_WEB_UI.md` §5) assumed the flow would be a control-op with an
effectMatrix row.

## Decision

A **seat-login PTY**: the `ws-term:start` payload may carry `seat: 'claude' | 'codex'` instead of a
workspace/ticket container target. The server then:

- authorizes via `authorizeSeatLogin` — **host-superadmin only** (`User.admin` or
  `WS_SUPERADMIN_EMAILS`, ADR 0287), because the flow writes the HOST CLI's OAuth store that every
  workspace's pipeline borrows;
- spawns a **fixed, server-side argv** (`seatLoginCommand`): `claude /login`, or the pi TUI pinned to
  `--provider openai-codex` (pi 0.84.2 has no `auth login` subcommand — `pi auth` is print/check only,
  the login is the TUI's `/login`); the client names a seat, never a command;
- uses the existing allowlist-only CLI envs (`buildClaudeCliEnv` / `buildPiCliEnv`) so no app/db
  secrets cross into the model process, and a 15-minute wall-clock cap (interrupt-then-kill,
  lesson 0009);
- on exit refreshes the auth projections (`refreshProjectedClaudeAuth` / `refreshProjectedPiAuth`),
  resets the cached host readiness (new `resetHostReadiness`) and pings the workspace room
  (`broadcastWorkspaceDirty`) so the new `readiness.codingAgent.claudeAuth` / `codexAuth` bits flip
  live in every open client.

The UI is the existing Backends section (`CodingAgentSection`): the seat-auth SetupNotice gains a
"Log in via the browser terminal" button that opens an inline `XtermTerminal` with the new `seat`
prop; a `seatAuth` row in the SetupChecklist points at the same section and counts as done when the
harness CLI is absent (nothing a UI login can fix — the ADR 0316 retirement rule).

## Rejected alternatives

- **A control-op (`enqueue → Conductor spawns`), as the design doc sketched.** The Conductor holds
  the serial per-workspace lease; a minutes-long interactive PTY inside it stalls every other write.
  It is also not a write of authoritative state (board/git/status untouched — the CLI writes its own
  OAuth file), so invariant 3 does not require an op. The existing container terminals set the
  precedent: session-shaped flows authorize directly in the socket handler. An op classified
  `excluded` would additionally fail the `opEffectCoverage` guard (matrix keyset ≡ ENABLED_OPS), so
  the doc's "wél een effectMatrix-rij" was wrong as written.
- **A separate `_api` mint route + Redis-tokened socket session.** More moving parts for the same
  single enforcement point; the socket handler already reads the authenticated session and is where
  the container-terminal authorization lives. If a future need arises (audit rows, multi-instance
  leader pinning), the mint route is the natural upgrade path.
- **A generic host-shell mode gated on superadmin.** Rejected outright — the no-host-shell invariant
  stays; this exception is purpose-bound to two fixed argvs.

## Consequences

- Fresh installs sign both seats in from the browser; SSH remains a fallback, and docs/HOSTING.md
  keeps the manual recipe for recovery.
- The relay's "no host shell" header now documents this one exception explicitly.
- Multi-instance: the PTY runs on whichever instance the socket lands on, not the leader. That is
  acceptable — the login writes to the shared auth dir (`WS_AUTH_DIR` / `PI_CODING_AGENT_DIR`), which
  all instances read; readiness on other instances catches up within its 30s TTL.
- `pi auth check --provider openai-codex` stays the truth-probe for the Codex seat; the Claude probe
  is presence-only (`hostClaudeAuthPresent`) — an expired-but-present credential still reads ready
  until the runner's own `claude auth status` check fails (accepted; the stuck-reason surfaces it).
