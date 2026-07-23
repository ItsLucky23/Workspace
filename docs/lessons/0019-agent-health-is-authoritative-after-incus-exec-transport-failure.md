---
id: 0019
title: Authenticated agent health can succeed even when the Incus configure exec reports failure
severity: high
area: compose-runner, incus, agent-bootstrap
date: 2026-07-23
---

# 0019 — the healthy agent behind a timed-out configure command

## What happened

During cold full-VM acceptance, the workspace agent answered 200 with the correct workspace-derived token while the
controller continued its configure loop until the full provision timeout. Restarting the controller made the same
VM immediately reusable.

## Root cause

`configureAgent` required both `incus exec ... workspaces-compose-agent-configure` to exit zero and the authenticated
health check to pass in the same iteration. Restarting systemd inside the guest can complete successfully while the
Incus exec transport closes late or reports non-zero. The agent was already correctly configured, but the transport
status overruled the stronger end-state proof.

## How to avoid

- Treat an authenticated health response using the expected workspace-specific token as the authoritative
  post-condition.
- Probe health before and after each configure attempt; only retry when the desired end state is still absent.
- Keep the exec error as diagnostic context, not as a reason to reject a sandbox whose identity-bound agent is live.
- Test the partial-success shape explicitly: configure transport fails, authenticated health succeeds, provisioning
  returns the sandbox without waiting for the deadline.
