---
id: 0023
title: Claude CLI presence is not Max-subscription readiness
severity: critical
area: production, stage-runner, claude-cli, systemd
date: 2026-07-27
---

# 0023 — verify the projected subscription login before opening a stage PTY

## What happened

A production ticket container had the pinned Claude Code binary and a healthy shell, but every stage turn waited
four minutes for a Stop-hook capture and then retried. `/var/lib/workspaces/auth` was empty, and the workstation
credential copied during diagnosis had already expired. `claude --version` remained green throughout, while
`claude auth status` reported `loggedIn:false`.

## Root cause

Readiness proved only that the executable existed. The stage runner opened an interactive PTY without first
proving the projected Max-subscription session. On the hardened host, `ProtectHome=true` also made the default
`/home/lucky23/.claude` refresh source unsuitable for the service even if an operator login existed there.

## How to avoid

- Keep `CLAUDE_CONFIG_DIR` and `WS_AUTH_DIR` in a dedicated service-readable directory outside the protected
  home, with credentials mode `0600`.
- Verify `claude auth status` and require `loggedIn:true`; `claude --version` is only a binary probe.
- Check auth inside the actual ticket container immediately before spawning the interactive PTY.
- Treat missing/expired auth as a fatal, user-actionable stage state (`stuck`), not as a turn timeout eligible for
  automatic retry.
- Recovery remains the normal interactive `claude /login` + projection refresh. Never route around the failure
  with `claude -p`, the Agent SDK, or an API key.
