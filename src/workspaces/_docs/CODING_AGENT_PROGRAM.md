# Coding-Agent Program — Claude Code + pi (Codex) behind one seam

> Written 2026-08-23. Executes Fase 3 of `AI_PROVIDER_EXPANSION_PLAN.md` with the owner's revised decision: the second
> harness is **pi** (`@earendil-works/pi-coding-agent`), NOT the OpenAI Codex CLI. Supported subscriptions are exactly
> two: **Claude** (Pro/Max) and **Codex** (ChatGPT Plus/Pro). Supported harnesses are exactly two: **Claude Code** and
> **pi**. Rule: Claude subscription → user picks Claude Code (default) or pi; Codex subscription → pi, forced.
> Status table at the bottom is the live progress record.

## 1. Facts the design rests on (verified 2026-08-23, host spike GREEN)

| Fact | Source |
|---|---|
| pi runs interactively in a node-pty; `--provider openai-codex --model <id>` bills the ChatGPT subscription (`$0.002 (sub)` in the footer) | host spike `tmp/pi-spike/spike.mjs` |
| `--session-id <id>` creates-or-resumes an exact session → crash-recovery `--resume` equivalent | spike (remembered 4711 after resume) |
| Extension events `agent_settled` / `tool_execution_end` / `session_before_compact` / `tool_call{block}` = Claude's Stop / PostToolUse / PreCompact hooks + permission gate | `docs/extensions.md` (local pi 0.80.7) |
| `-e <file> --no-extensions` loads exactly our extension; `--approve` skips the project-trust prompt; `--thinking <level>` takes the same five levels as `StageEffort` | `pi --help` |
| Credentials: `~/.pi/agent/auth.json` (`openai-codex` = OAuth access+refresh+expires, auto-refresh); config dir env `PI_CODING_AGENT_DIR` | `docs/providers.md`, README |
| pi 0.84.x adds `pi auth check --provider openai-codex --json` (in-container auth probe, like `claude auth status`) | research (npm 0.84.2) |
| pi has NO permission prompts and NO MCP — the container boundary + a `tool_call` gate replace both | README philosophy |
| **Claude Pro/Max through pi bills "extra usage" per token — NOT plan quota** | `docs/providers.md` §Claude Pro/Max |
| Codex models on the subscription provider: `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5`, `gpt-5.6-luna/sol/terra`, `gpt-5.3-codex-spark` | `pi --list-models openai-codex` |

**OPEN VRAAG A (owner).** The Claude-via-pi option is metered (extra usage) per Anthropic's policy. That contradicts ADR 0321
("no metered coding"). Built as asked — the option exists — but it is OFF by default and the UI warns in red. Say the
word and it becomes Claude Code-only (one line).

## 2. Design

### 2.1 One setting per workspace — `CodingAgentConfig`

```ts
interface CodingAgentConfig {
  subscription: 'claude' | 'codex';        // which seat pays
  harness: 'claude-code' | 'pi-agent';     // which interactive CLI runs in the PTY
  tierModels: Record<StageModelTier, string>; // haiku|sonnet|opus tier → concrete model id for this harness
}
```

Stored as EnvVar `__coding_agent` (JSON) — the same store as the AI overrides; written by ONE control-API op
`save-coding-agent` (Conductor single-writer, B-23). Server-side rule: `subscription === 'codex'` ⇒ `harness = 'pi-agent'`
whatever the payload says. Defaults: `{ claude, claude-code, {haiku:'haiku', sonnet:'sonnet', opus:'opus'} }` (= today).
Codex defaults: `{ haiku:'gpt-5.4-mini', sonnet:'gpt-5.6-luna', opus:'gpt-5.6-sol' }`.

The stage editor keeps its three **tiers** (`StageModelTier` stays `haiku|sonnet|opus` in storage — no migration); the
labels become tier names with the resolved model for the workspace's harness in parentheses.

### 2.2 The adapter seam — `server/orchestrator/codingAgents/`

```ts
interface CodingAgentAdapter {
  id: 'claude-code' | 'pi-agent';
  binary: string;                                   // in-container binary
  processMatch: string;                             // /proc cmdline needle for the kill script
  turnArgs(o: { resumeSessionId?: string; model?: string; effort?: StageEffort }): string[];
  projectAuth(container, runDocker): Promise<void>; // host creds → agent-owned dir in the container
  authenticated(container, runDocker): Promise<boolean>;
  afterTurn?(container, runDocker): Promise<void>;  // pi: copy the refreshed OAuth back to the projection
  readyMatches(buffer: string): boolean;            // PTY prompt-ready detection
  confirmsTrust: boolean;                           // claude: send \r on the trust prompt; pi: --approve
}
```

`stageRunner.driveContainerTurn` consumes the adapter; the capture files stay where they are (`/work/.claude/turn-stop.json`,
`tool-calls.jsonl`, `precompact-signal`) — the pi extension writes the SAME files, so `turnResult`, `toolTrail`, the
pre-compact handoff and `killClaudeByContainer` (now parameterised by `processMatch`) do not change shape.

- **claude-code** = today's behaviour, moved verbatim (`buildTurnArgs`, `projectAuth`, `containerClaudeAuthenticated`).
- **pi-agent**: argv `--provider openai-codex|anthropic --model <id> --thinking <effort> --session-id <uuid>
  --no-extensions -e /opt/workspaces/pi/workspaces.ts --no-skills --no-prompt-templates --approve
  --append-system-prompt /work/.claude/stage-instructions.txt`. CLAUDE.md in `/work` is auto-loaded as context.
  Auth: host `~/.pi/agent/auth.json` → `data/_auth/pi-auth.json` (refreshed before each turn, newest `expires` wins between
  host and projection) → container `/home/agent/.pi/agent/auth.json` (0600, `PI_CODING_AGENT_DIR` pinned). After the
  turn the container's refreshed file is copied back to the projection so a rotated refresh-token is not lost.
- **The pi extension** (`docker/pi/workspaces.ts`, baked into the base image): `agent_settled` → `turn-stop.json`
  `{last_assistant_message, session_id}`; `tool_execution_end` → one JSONL line (same `tool_name`/`tool_input` keys the
  trail parser reads); `session_before_compact` → `precompact-signal`; `tool_call` → blocks anything matching the
  `permissions.deny` patterns of `/work/.claude/settings.json` (`Bash(prefix:*)`, `Read(/auth/**)`), so the stage's
  deny set is honoured on both harnesses.

### 2.3 Container image

`docker/base.Dockerfile`: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@<pin>` next to the pinned Claude
CLI, `COPY docker/pi/ /opt/workspaces/pi/`, label `org.workspaces.pi-version`. `runtime.ts` adds `-e PI_CODING_AGENT_DIR=/home/agent/.pi/agent`.

### 2.4 Host readiness + UI

- `readiness.ts`: `host.piAgent` (binary on host) + `host.codexAuth` (auth.json has `openai-codex`) → snapshot `readiness.codingAgent`.
- Workspace AI page gets a **Coding agent** section above the connections list: subscription picker (Claude / Codex),
  harness picker (disabled + forced to pi for Codex; for Claude shows the extra-usage warning when pi is chosen), tier→model
  map (three inputs with the catalog models as suggestions), and the readiness state (“pi installed · Codex signed in on
  the host”), with the `SetupNotice` pattern when something is missing.
- The pipeline stage editor shows the resolved model per tier.
- One-shot features: a `codex-cli` subscription backend (transport `pi-cli`, `pi -p --mode json` on the Codex seat — the
  same seat, not metered; `-p` is only forbidden for the CODING agent) so Codex appears in the connections list like Claude Code.

### 2.5 Invariant 6 (CLAUDE.md) — final wording

> The CODE-writing agent is always an interactive harness in a node-pty PTY on a subscription seat: **Claude Code** (Claude
> subscription) or **pi** (Codex subscription; optionally Claude, which Anthropic bills as extra usage — warned, off by
> default). Never `-p`/headless for coding, never the Agent SDK, never an API key. Other providers may serve non-coding
> features (ADR 0007).

## 3. Phases + verification

| # | Phase | Verification |
|---|---|---|
| 1 | Host spike (pi in PTY, sub billing, resume, extension capture) | `tmp/pi-spike` — **GREEN 2026-08-23** |
| 2 | Adapter seam + pi extension + config op + readiness + catalog entry | unit: `codingAgents.test.mts` (args, forced harness, tier map, deny-gate matcher); existing stageRunner/modelSelect tests green |
| 3 | UI (coding-agent section, stage-editor labels, i18n ×4) | tsc client, Playwright `workspaceAi.spec` |
| 4 | Base image rebuild with pi pinned + extension baked | `docker run … pi --version` + `pi auth check` inside |
| 5 | Live e2e: ticket through an aiEnabled stage on **pi/Codex** in the real container, capture + tool trail + resume | integration `piAgentStage.test.mts` (gated on Docker + host Codex auth) |
| 6 | ADR + CLAUDE.md invariant 6 + docs (`AI_PROVIDER_EXPANSION_PLAN` Fase 3 closed, `KEY_SETUP_GUIDE`) | doc review |

## 4. Status

| Phase | Status |
|---|---|
| 1 | ✅ |
| 2 | ✅ 2026-08-23 — `server/orchestrator/codingAgents/*` + `docker/pi/workspaces.ts` + `save-coding-agent` op + readiness + `codex-cli` catalog entry; `codingAgents.test.mts` 43/43, sync-route tests 3/3 |
| 3 | ✅ 2026-08-23 — `CodingAgentSection` (workspace AI page), stage-editor tier→model label, i18n ×4; client tsc clean |
| 4 | ✅ 2026-08-23 — `workspaces/base:0.1.0` rebuilt in place (claude-pin unchanged): `pi 0.84.2` + `/opt/workspaces/pi/workspaces.ts` baked, verified in-container |
| 5 | ✅ 2026-08-23 — `tests/integration/piAgentStage.test.mts` 10/10 LIVE: echte Codex-turn in `workspaces/base`, extensie-capture, `--session-id` resume in dezelfde sessie, OAuth copy-back |
| 6 | ✅ 2026-08-23 — ADR 0322, CLAUDE.md invariant 6 rewritten, `AI_PROVIDER_EXPANSION_PLAN` Fase 3 closed, `KEY_SETUP_GUIDE` coding-agent section |
