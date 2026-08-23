---
title: Coding-agent seats are Claude and Codex; pi is the Codex harness (forced), optional for Claude (warned)
status: accepted
date: 2026-08-23
tags: [ai-providers, pipeline, billing, invariant-6, pi-agent, codex]
supersedes: []
---

# Context

ADR 0321 generalized invariant 6 to "any interactive vendor CLI in a PTY on a subscription seat" and named the OpenAI Codex CLI as the first extra adapter. The owner then decided (2026-08-23): **not** the Codex CLI — Codex runs through the **pi coding agent** (`@earendil-works/pi-coding-agent`), and only **two** subscriptions are supported at all: Claude and Codex (ChatGPT). A host spike (2026-08-23) proved pi's viability: a PTY turn bills the ChatGPT subscription (`(sub)` in the footer), `--session-id` resumes an exact session, and a `-e` extension can write the exact capture files the stage runner already reads for Claude.

The spike also surfaced a billing fact: a **Claude** Pro/Max seat used through pi is billed per token as **extra usage** on top of the plan — it does not draw from the plan's included quota. That collides with ADR 0321's "never metered" purpose.

# Decision

1. **Two subscription seats only**: `claude` and `codex`. Two harnesses only: `claude-code` and `pi-agent`.
2. **Codex ⇒ pi, forced server-side** (`harnessFor` in `server/orchestrator/codingAgents/config.ts`): no payload can store a combination the runner cannot run.
3. **Claude ⇒ choice**, default `claude-code`. Claude-via-pi is **allowed but loudly warned** in the UI (extra-usage billing). OPEN VRAAG A: the owner may later demote it to blocked.
4. **Adapter seam**, not a second runner: `driveContainerTurn` drives one interface (`CodingAgentAdapter` — turnArgs / projectAuth / authenticated / afterTurn / readyMatches / prepareHost). The capture files are the shared contract (`turn-stop.json`, `tool-calls.jsonl`, `precompact-signal`), written by Claude's hooks and by the baked pi extension (`docker/pi/workspaces.ts`).
5. **Config is one EnvVar** (`__coding_agent`, JSON) written only by the Conductor's `save-coding-agent` op (B-23); the stage tiers stay abstract (`haiku|sonnet|opus` storage keys) and the config maps each tier to a concrete model id per (seat, harness).
6. **pi auth is copy-back**: the host's `~/.pi/agent/auth.json` is projected into the container before a turn and the (possibly refreshed) token is copied back after — freshest `expires` wins — because pi rotates refresh tokens in place.
7. **One image**: pi (`0.84.2`, pinned, `--ignore-scripts`) + the extension are baked into `workspaces/base` next to the pinned Claude CLI.

# Rejected alternatives

- **Codex CLI as the second adapter** (ADR 0321's candidate) — rejected by the owner: pi gives one harness for both non-Claude seats, with extensions, session resume and a deny-hook seam; the Codex CLI would be a third TUI contract to reverse-engineer.
- **pi for everything (drop Claude Code)** — rejected: Claude-via-pi bills extra usage instead of plan quota; Claude Code remains the only harness that spends the Claude plan.
- **A separate `pi.json` config model** — rejected for one normalised EnvVar: single writer, single parse point, snapshot delta by seq.
- **Blocking Claude-via-pi outright** — deferred (OPEN VRAAG A): warned-but-allowed keeps the escape hatch when Claude Code itself is broken on a host.

# Consequences

- CLAUDE.md invariant 6 is rewritten to the two-seat form (this ADR records the approval; ADR 0321 stays accepted — its "never metered" purpose now lives in the UI warning + default).
- `//? @adr 0322` marks `server/orchestrator/codingAgents/*`, `docker/pi/workspaces.ts`, and the save path.
- The one-shot feature layer gains a `codex-cli` provider (pi `--mode json -p`, `pi-cli` transport) so NON-coding features can also spend the Codex seat — unchanged rules for everything else (ADR 0007).
- New host readiness bits (`codingAgent: {claudeCode, piAgent, codexAuth}`) drive SetupNotice gates on the workspace AI page.
