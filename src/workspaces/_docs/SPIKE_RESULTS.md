# SPIKE_RESULTS.md — P0.5 CLI-behavior spike verdicts

> Run by: AI (Claude Code, on the user's Max subscription) · Date: 2026-07-02 · Host OS: windows (win32)
> Claude CLI version (EXACT, pin into the base image, Q-CT-CLIPIN): **2.1.198**
> Model observed in the interactive PTY: `claude-fable-5` (the session default).
> Subscription: Max (host `claude` logged in; `~/.claude/.credentials.json` present)
> Env: clean (spawned with ANTHROPIC_*/bedrock/vertex STRIPPED)
> Harness: `scripts/spike/hookCapture.mts` (capture endpoint) + `scripts/spike/runSpikeAuto.mts`
> (node-pty driver: renders `.claude/settings.json` with BOTH `type:http` and `type:command`
> hooks per event, auto-confirms the folder-trust prompt, drives one real Bash-tool turn).
> GATE: P1 lanes B/C/F were BLOCKED until the gating rows below are GREEN.

## Verdict legend
- GREEN — holds as specified.
- GREEN-WITH-WORKAROUND — holds via a pinned degrade (stated in Workaround).
- RED-ESCALATE — load-bearing failure surfaced to the user; NO headless fallback.
- PARTIAL / NOT-RUN — not fully exercised this pass (stated).

## Results
| Spike | Row | Assumption | Verdict | Evidence | Workaround / note | Blocks lane |
|---|---|---|---|---|---|---|
| A | A1 | interactive PTY on clean env uses the **subscription** | **GREEN** | A real turn (Bash tool `echo` + assistant reply "done") completed in a node-pty `claude` spawned with ANTHROPIC_* stripped — no API key present to bill a metered pool, so the turn draws on the `/login` Max subscription. | — | B,C,F |
| A | A2 | stray ANTHROPIC_API_KEY → metered | NOT-RUN | (informational row; the clean-env spawn is already enforced by SessionManager/`runSpikeAuto` scrubbing) | clean-env spawn mandatory | (constraint) |
| A | A3 | concurrent PTYs all on subscription | NOT-RUN | single-PTY only this pass | — | B,F |
| B | B1 | `type:http` hooks fire in interactive mode | **GREEN** | With a completed turn, the capture endpoint received `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` via **`type:http`** (and via `type:command`). | SessionStart via `type:http` did NOT fire — use `type:command` for SessionStart. | C |
| B | B2 | PostToolUse fires per tool call | **GREEN** | `PostToolUse` POST received (701 bytes) with `session_id`/`prompt_id`/tool context after the Bash `echo`. | — | C |
| B | B3 | Notification(permission/idle) fires | NOT-RUN | no permission/idle prompt triggered this pass (echo pre-approved) | — | — |
| B | B4 | Stop = turn-end / slot-release | **GREEN** | `Stop` POST (504 bytes) carries `last_assistant_message:"done"`, `session_id`, `prompt_id`, `stop_hook_active:false`, `background_tasks:[]` → a usable turn-end + slot-release signal. | — | B,C |
| B | (SessionStart) | SessionStart fires interactively | **GREEN-WITH-WORKAROUND** | `SessionStart` fired via **`type:command`** (353 bytes, `source:"startup"`) but NOT via `type:http`. | render SessionStart as `type:command`; other events can use `type:http`. | C |
| C | — | /clear vs /compact + claudeSessionId | NOT-RUN | every hook payload DOES carry `session_id` + `transcript_path` (the `~/.claude/projects/<proj>/<id>.jsonl`), so the id + JSONL location the resume model needs are observable. Full /clear-rotation test pending. | run before the token-opt lane | B(resume),P2/P3 |
| D | D1 | hook payload carries usage/tokens | **RED (non-blocking)** | No `usage`/`tokens`/`cost` field in any hook payload (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop). | Spike D never blocks (doc §4): use the **labeled char/byte estimate** for `tokenEstimate`/`SpendRecord`. | (advisory only) |
| D | (payload) | hooks carry rich lifecycle data | **GREEN** | payloads include `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort.level`, `hook_event_name`, `last_assistant_message` (Stop). | — | — |
| E | — | --resume after crash + managed-token auth files | NOT-RUN | `~/.claude/.credentials.json` present (471 bytes) = the file the projection mounts; `transcript_path` per session confirms per-session JSONLs under `~/.claude/projects/`. Full crash-resume + RO-mount test pending. | run before lane F container auth | F |

## Pinned decisions emitted by this run
- **Billing**: interactive PTY on clean env bills the Max subscription. (Q-ENG-SPIKE / [01 §1]) — **GREEN, gate open.**
- **Turn-end signal**: the `Stop` hook (carries `last_assistant_message` + `session_id`). (Q-ENG-TURNEND)
- **Hook transport**: `type:http` for UserPromptSubmit/PreToolUse/PostToolUse/Stop; **`type:command` for SessionStart** (its http variant did not fire). (Q-ENG — architecture note: `[02 §3]`'s "all type:http" must special-case SessionStart.)
- **Token/usage source**: no hook usage field → **labeled char/byte estimate** (advisory). (Q-ENG-TOKENFEED)
- **Session id + transcript path**: present in every hook payload → the `--resume` id + JSONL path are observable. (Q-CT-RESUME / Q-ENG-CLEAR foundations)
- **CLI version pinned into the base image**: **2.1.198**. (Q-CT-CLIPIN)

## Gate status
**The gating rows (A1 billing, B1/B2/B4 hooks) are GREEN.** P1 lanes B/C/F are UNBLOCKED for
build, with two carried notes: (1) render **SessionStart as `type:command`** (http finicky);
(2) drive the budget off a **labeled char/byte estimate** (no hook usage field). The deeper
C (/clear-rotation) and E (crash-resume + RO-credential-mount) rows remain NOT-RUN and should
be verified before their specific sub-features (resume, token-optimization, container auth) ship
— they are not blockers for starting lane F's provisioning skeleton.

## Escalations (RED-ESCALATE rows)
None. The only RED (D1, no hook usage field) is explicitly non-blocking (labeled-estimate fallback).

## UPDATE 2026-07-02 — Container-auth spike (Row E) → GREEN

Verified live: an interactive `claude` PTY INSIDE an L3 container, with the host's
one-time-login creds projected read-only (`data/_auth/.credentials.json` → copied to an
agent-owned `CLAUDE_CONFIG_DIR=/home/agent/.claude`, 0600), authenticates on the Max
**subscription** (clean container env, no `ANTHROPIC_*`, never `-p`) and runs a full turn.
A ticket ran end-to-end through the `refined` stage: container → rendered `.claude` config →
autonomous claude turn → `ws-carryover` emitted → Stop hook captured → CarryOver persisted →
ticket auto-advanced to `plan` → AgentSession `stopped` (claudeSessionId captured for
`--resume`). Gotchas that gated it: lesson 0009 (CLAUDE_CONFIG_DIR explicit, bypassPermissions,
`sh -c` Stop hook). The one-time host login (no per-container email code) is confirmed
sufficient — the refresh loop (re-project on token refresh) is the remaining prod hardening.
