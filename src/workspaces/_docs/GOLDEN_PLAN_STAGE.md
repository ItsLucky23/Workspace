# GOLDEN_PLAN_STAGE — one fully-rendered stage (the config-renderer's first regression test)

> **Worked example: the PLAN stage of the `professional` preset, rendered to literal artifacts.** This is the canonical reference for the config-rendering layer — the deterministic function that turns a `PipelineStageCfg` (+ its `AgentRole`, preset, carry-over, and the per-session tokens) into the exact files + launch command a stage-AI runs with. Per `Q-PROD-GOLDEN` (LOCKED 2026-06-04) it is the renderer's **first regression test**: a golden fixture the renderer's output is diffed against, so every unverified CLI assumption surfaces concretely instead of as prose.
>
> **Scope.** One stage, end to end: `.claude/settings.json` · `.mcp.json` · `CLAUDE.md` · the stage-instructions (`--append-system-prompt` content) · the interactive launch command · the exact `type:http` hook wiring (which hooks → which orchestrator endpoints). Keyed to the **VERB_REGISTRY** (`[02 §2]`), the **managed-token-projection** mount (`Q-CT-AUTH`/`Q-SEC-CLAUDEMOUNT`), and the typed `StageKind` (`[04b §12]`). Cites architecture as `[01 §x]`…`[07 §x]`, feature docs as `[features/NN]`, codes via `REFERENCE_CODES.md`, and carries each `Q-*` id inline.
>
> **Engine is interactive PTY only** (`[01 §1]`, ERRATA E1/E7 in `[00 §2]`): every flag below is the **interactive** realization. The headless `claude -p … --json-schema …` rows of `handoff/CLAUDE_SETTINGS_MAP.md` are **SUPERSEDED** — structured output rides the structured channel (`emit_carryover` over the whitelisted CLI/HTTP helper), **not** `--json-schema`. Headless survives only as the P4 burst path (`Q-MP-BILLING`).
>
> **No new verbs.** This doc renders config; it introduces no protocol surface. Every "write" implied is a `[control-API]` Conductor action (B-23), never an LLM verb.

---

## 0. Why the Plan stage, and what "golden" means here

The Plan stage is chosen deliberately: it is the hardest *non-container* stage to render correctly and so exercises the most renderer branches.

- It is a **host-side reasoning role** — `AgentRole.needsWorkspace = false` (`[03 §3.2]`, `[features/02 §Tier definitions]`: "Refine/Plan stay lightweight host-side reasoning sessions"). So it runs in a **minimal RO container** (`Q-CT-HOSTROLES`: no worktree, no integration creds, egress to Anthropic + the orchestrator only) — **not** the L3 per-ticket code container. This makes it the cleanest demonstration of the managed-token-projection mount in isolation, without the worktree/clone machinery a `code` stage adds.
- It carries the **richest read skills** of any reasoning stage (RAG + graphify + symbol-index — `seed.ts:601-606`, `[features/02]`) but **no write/exec tools** — so its `.mcp.json` is non-trivial while its `permissions.allow` stays read-only, which is exactly the invariant the renderer must never violate.
- It is the `professional` preset's **Opus/high** stage with `maxTurns: 20` and `autoEscalate: true` — the model/effort/budget render path at its most loaded.
- It receives a carry-over envelope **from Refinement** (`refine` → `plan`) and emits one **to Coding** — so it exercises both injection directions of `[02 §4]`.

"Golden" = the renderer, fed the fixture inputs in §1, MUST produce byte-equivalent §2–§6 artifacts (modulo the documented per-spawn substitutions: the re-minted tokens, the container-assigned `CLAUDE_CONFIG_DIR`, the `claudeSessionId`, and the injected carry-over body). The regression test (`[features/05]` Testing, `Q-INF-TESTING`) pins this.

---

## 1. Fixture inputs (what the renderer is given)

These are the resolved inputs for this golden render — the `PipelineStageCfg` row + its joined `AgentRole`, preset provenance, the prior carry-over, and the per-session security context. Values match `STAGE_CONFIGS`'s `plan` entry (`seed.ts:601-606`) generalized into the `professional` preset (`[features/02]`).

```jsonc
// resolved PipelineStageCfg (the 'plan' stage of a professional-preset workspace)
{
  "id": "plan",                       // free-string stage id (StageKind reconciliation, [04b §12])
  "kind": "plan",                     // typed StageKind — drives role logic, NOT the board column key
  "name": "Plan",
  "order": 2,
  "roleKey": "plan",                  // AgentRole binding ([03 §3]); professional Plan is a reasoning role
  "aiEnabled": true,
  "modelCfg": {                        // seed.ts:602 — Opus/high, escalation on
    "base": { "model": "opus", "effort": "high", "maxTurns": 20 },
    "autoEscalate": true,
    "rules": [                         // escalationRules() — score-banded (seed.ts:565-567)
      { "id": "r-high", "minScore": 7, "model": "opus",   "effort": "high",   "maxTurns": 30 },
      { "id": "r-mid",  "minScore": 4, "model": "sonnet", "effort": "medium", "maxTurns": 20 },
      { "id": "r-low",  "minScore": 1, "model": "haiku",  "effort": "low",    "maxTurns": 10 }
    ]
  },
  "skillKeys": ["rag", "graphify", "symbol"],          // seed.ts:603
  "sourceIds": ["summary", "dbschema", "authspec"],    // context-docs → CLAUDE.md @imports
  "visibleStageIds": ["refined"],                       // cross-stage read scope (app-layer, NOT .claude)
  "commands": [],                                        // Plan does no Bash/Edit/Write — read-only reasoning
  "tools": [],                                           // no mongo/redis tier (needsWorkspace=false)
  "processes": [],                                        // no dev servers
  "hooks": { "SessionStart": true, "Stop": true, "PostToolUse": true,
             "Notification": true, "PreCompact": true, "UserPromptSubmit": true },
  "systemPrompt": "",                  // empty → falls back to the resolved AgentRole.systemPromptTemplate (D2 layer 1→2)
  "promptTemplate": "Produce a step-by-step implementation plan.\nFrom Refined: {{summary}}\nKnown files: {{changedFiles}}",
  "customInstructions": "Output a numbered plan + risks + a rollback note. No edits. Reference the db-schema where relevant."
}
```

```jsonc
// resolved AgentRole 'plan' (code fixture, [03 §3.2]); supplies the base systemPromptTemplate (D2 layer 1)
{
  "key": "plan",
  "label": "Planner",
  "needsWorkspace": false,            // ⟵ host-side reasoning role → minimal RO container (Q-CT-HOSTROLES)
  "systemPromptTemplate": "You are the Planning stage of an automated delivery pipeline. You read the refined ticket and the codebase context, then produce a precise, ordered implementation plan. You NEVER edit files or run commands. You report exclusively through the structured channel: call `request_input` when a decision needs a human, and `emit_carryover` with your plan when done.",
  "outputSchema": { "summary": "string", "changedFiles": "string[]", "openQuestions": "string[]", "commitHash": "string" },
  "artifactKind": "report",
  "defaultModelCfg": { "model": "opus", "effort": "high", "maxTurns": 20 }
}
```

```jsonc
// per-session context the renderer also receives (not stage config — runtime)
{
  "workspaceId": "WS",
  "ticketId": "DEV-1240",
  "stageId": "plan",
  "sessionKey": "worker:DEV-1240:plan",        // AgentSession.sessionKey ([04b §7])
  "commitHash": "abc123",                       // frozen at worktree creation (DH5 commit-hash)
  "channelToken": "<re-minted per spawn>",      // structured-channel token, bound to sessionKey (Q-ENG-TOKEN-LIFECYCLE)
  "hookToken": "<re-minted per spawn>",         // SEPARATE WS_HOOK_TOKEN, same lifecycle, distinct secret
  "configDir": "/home/agent/.claude-DEV-1240",  // container-assigned CLAUDE_CONFIG_DIR (per-stage re-render, Q-CT-UNIT)
  "carryOverFromRefine": {                       // the envelope injected from the refine stage ([02 §4])
    "summary": "Stabilize the fallback identity key across ?v= cache-busts; do not change the public Avatar API.",
    "changedFiles": ["src/_components/Avatar.tsx", "src/_functions/avatar.ts"],
    "openQuestions": [],
    "commitHash": "abc123"
  }
}
```

> **Renderer contract.** Given exactly the three blocks above, the renderer emits §2 (`.claude/settings.json`), §3 (`.mcp.json`), §4 (`CLAUDE.md`), §5 (stage-instructions), and §6 (launch command). The only values that differ between two spawns of the SAME stage are the re-minted `channelToken`/`hookToken` (`Q-ENG-TOKEN-LIFECYCLE`), the `configDir` (`Q-CT-UNIT`), the captured `claudeSessionId`, and the injected carry-over body — everything else is a pure function of the fixture and is diffed verbatim by the regression test.

---

## 2. `.claude/settings.json` (rendered into `$CLAUDE_CONFIG_DIR`)

The interactive-mode settings. Read-only permissions (Plan never writes), the six enabled hooks pointed at the orchestrator, the model/effort, and the egress-allow-list note. **No `--json-schema`, no `-p`** (those are the SUPERSEDED headless rows of `CLAUDE_SETTINGS_MAP §1b/§2`, ERRATA E7).

```jsonc
{
  "model": "opus",
  "permissions": {
    // Plan is read-only reasoning: it may read the worktree-context docs and call its three
    // declared MCP skills, and NOTHING that mutates state. The structured-channel helper
    // (ws ...) is the ONLY Bash it may run — and that helper exposes only read|propose VERBS.
    "allow": [
      "Read(**)",
      "mcp__rag__semantic_search",
      "mcp__graphify__impact_of",
      "mcp__graphify__graph_query",
      "mcp__symbol__lookup_symbol",
      "mcp__symbol__get_signature",
      "Bash(ws emit-carryover:*)",      // VERB: emit_carryover  (propose-grade)
      "Bash(ws request-input:*)",        // VERB: request_input   (read/blocking)
      "Bash(ws report-status:*)",        // VERB: report_status   (read)
      "Bash(ws emit-event:*)",           // VERB: emit_event      (propose)
      "Bash(ws emit-signal:*)",          // VERB: emit_signal     (propose)
      "Bash(ws emit-handoff:*)",         // VERB: emit_handoff    (propose, within-session)
      "Bash(ws query-context:*)"         // VERB: query_context   (read/synchronous)
    ],
    // deny-first precedence (CLAUDE_SETTINGS_MAP §2): explicitly forbid the write/exec built-ins
    // so a prompt-injected attempt to edit is REFUSED, not queued for approval.
    "deny": [
      "Edit(**)",
      "Write(**)",
      "Bash(git push:*)",
      "Bash(rm:*)",
      "WebFetch"
    ]
    // NOTE: there is no "ask" tier here — Plan is fully read-only, so every sensitive action is a
    // hard deny. A code stage uses "ask" + the Notification(permission_prompt) → needs-input escalation.
  },
  "hooks": {
    "SessionStart": [{ "hooks": [{
      "type": "http",
      "url": "http://orchestrator.internal/hooks/session-start?ticket=DEV-1240&stage=plan&session=worker:DEV-1240:plan",
      "headers": { "Authorization": "Bearer $WS_HOOK_TOKEN" },
      "allowedEnvVars": ["WS_HOOK_TOKEN"]
    }] }],
    "PostToolUse": [{ "matcher": "Bash|Read|mcp__.*", "hooks": [{
      "type": "http",
      "url": "http://orchestrator.internal/hooks/ticket-event?ticket=DEV-1240&stage=plan",
      "headers": { "Authorization": "Bearer $WS_HOOK_TOKEN" },
      "allowedEnvVars": ["WS_HOOK_TOKEN"]
    }] }],
    "Notification": [{ "matcher": "permission_prompt|idle_prompt", "hooks": [{
      "type": "http",
      "url": "http://orchestrator.internal/hooks/needs-input?ticket=DEV-1240&stage=plan",
      "headers": { "Authorization": "Bearer $WS_HOOK_TOKEN" },
      "allowedEnvVars": ["WS_HOOK_TOKEN"]
    }] }],
    "Stop": [{ "hooks": [{
      "type": "http",
      "url": "http://orchestrator.internal/hooks/stop?ticket=DEV-1240&stage=plan&session=worker:DEV-1240:plan",
      "headers": { "Authorization": "Bearer $WS_HOOK_TOKEN" },
      "allowedEnvVars": ["WS_HOOK_TOKEN"]
    }] }],
    "PreCompact": [{ "hooks": [{
      "type": "http",
      "url": "http://orchestrator.internal/hooks/pre-compact?ticket=DEV-1240&stage=plan",
      "headers": { "Authorization": "Bearer $WS_HOOK_TOKEN" },
      "allowedEnvVars": ["WS_HOOK_TOKEN"]
    }] }],
    "UserPromptSubmit": [{ "hooks": [{
      "type": "http",
      "url": "http://orchestrator.internal/hooks/prompt-submit?ticket=DEV-1240&stage=plan",
      "headers": { "Authorization": "Bearer $WS_HOOK_TOKEN" },
      "allowedEnvVars": ["WS_HOOK_TOKEN"]
    }] }]
  }
}
```

**Render rules behind this file (so the renderer is reproducible):**

- **`model`** = `modelCfg.base.model` (`"opus"`). The renderer writes the *base* model into settings; **auto-escalation** (`autoEscalate:true`) re-renders + re-spawns at a higher band when `report_status.complexityScore ≥ minScore` (`seed.ts:565-567`) — escalation is a **Conductor** re-spawn, not an in-session model swap (`[01 §4]`). `effort:"high"` and `maxTurns:20` are NOT settings keys in interactive mode (they have no settings.json home in the PTY path); they are applied on the **launch command** (§6) where the CLI accepts them.
- **`permissions.allow`** = the seven VERB allow-patterns (one per `ws <verb>` CLI helper, derived FROM the **VERB_REGISTRY** — `Q-ENG-VERB-CONFORMANCE`, `[02 §2]`) + the read built-ins + the declared MCP tools (one allow per `skillKeys` entry, expanded to that skill's tool names from the skill catalog). **Every entry is a read or propose surface; the conformance test asserts no `Edit`/`Write`/state-mutating `Bash` ever appears in an allow list** (B-23, the structural no-write-verb guarantee).
- **`permissions.deny`** = the renderer's standing read-only-role deny set (Edit/Write/push/rm/WebFetch). Deny wins over allow (`CLAUDE_SETTINGS_MAP §2` deny-first), so even a prompt-injected edit attempt is refused.
- **`hooks`** = one `type:http` block per `true` entry in `PipelineStageCfg.hooks`. Each URL is `http://orchestrator.internal/hooks/<kind>` (the containerized orchestrator's DNS name on `workspaces-net` — `Q-NET-DOCKER`), carrying `ticket`/`stage`/`session` query params and the per-session `$WS_HOOK_TOKEN` (the re-minted `hookTokenId`, `[04b §7]`). `allowedEnvVars` whitelists the token env so the CLI forwards it. See §7 for the endpoint contract.
- **`$WS_HOOK_TOKEN`** is injected into the container's env via the tmpfs env-file at boot (`Q-SEC-CREDLIFETIME`), never baked into the image, never written into settings.json as a literal.

---

## 3. `.mcp.json` (the three Plan skills, stdio servers)

One MCP-server entry per `skillKeys` entry (`rag`/`graphify`/`symbol`), launched with `--strict-mcp-config` (§6) so the stage sees ONLY its own skills (no leak between stages, `[02 §2 Scoping]`, `[features/15]`). The RAG + symbol servers are handed the frozen `commitHash` so their slices are frozen-per-ticket (DH5 commit-hash, B-25); graphify is `live` (`seed.ts:359`).

```jsonc
{
  "mcpServers": {
    "rag": {
      "type": "stdio",
      "command": "ws-skill-rag",
      "args": ["--commit", "abc123", "--workspace", "WS", "--ticket", "DEV-1240"],
      "env": { "RAG_DB_TIER": "mongo:ro" }     // the slice store is read via the ro keyed client (B-O8, G9)
    },
    "graphify": {
      "type": "stdio",
      "command": "graphify-mcp",
      "args": ["--mode", "live", "--workspace", "WS"]
    },
    "symbol": {
      "type": "stdio",
      "command": "ws-skill-symbol",
      "args": ["--commit", "abc123", "--workspace", "WS"]
    }
  }
}
```

**Render rules:** the skill catalog maps each `skillKey` → `{ command, exposedTools[], frozen|live, tier? }`. `frozen` skills get `--commit <commitHash>`; `live` skills do not. The DB tier (`RAG_DB_TIER`) is resolved inside the MCP server via `getPrismaClientFor('mongo:ro')` (G9/B-O8) — it is **app-layer, never a `.claude` key** (`CLAUDE_SETTINGS_MAP §2` `StageToolPermission` row). The `exposedTools[]` of each skill is exactly the set that appears as `mcp__<skill>__<tool>` in §2's allow list — the renderer keeps these two in sync (a skill tool not in the allow list is unreachable; an allow entry with no server is dead). **CLI-client-first is canonical, MCP the exception** (`Q-INT-MECHANISM`) — Plan happens to be MCP-heavy because its skills are genuinely typed query surfaces; a DB-read integration would instead be a whitelisted CLI client in the allow list.

---

## 4. `CLAUDE.md` (worktree/context root, rendered into `$CLAUDE_CONFIG_DIR`'s working dir)

The domain-rules + context-doc imports. `customInstructions` becomes the body (`CLAUDE_SETTINGS_MAP §2`: "`customInstructions` → the stage `CLAUDE.md`"); each `sourceIds` entry becomes an `@import` of its rendered context-doc (B-14). This is distinct from the **system prompt** (§5) — `CLAUDE.md` is per-turn task framing / domain rules; the system prompt is the appended persona/contract (`[features/02 §Resolved 3]`).

```markdown
# Plan stage — DEV-1240

Output a numbered plan + risks + a rollback note. No edits. Reference the db-schema where relevant.

## Context documents (frozen @ abc123)
@.claude/context/summary.md
@.claude/context/dbschema.md
@.claude/context/authspec.md

## Hard rules
- You are read-only. Do not Edit, Write, or run state-mutating Bash.
- When you need a human decision, call `ws request-input` (the structured channel) — do not guess.
- When your plan is ready, call `ws emit-carryover` with the envelope (see the system prompt).
- Reference the DB schema (`@.claude/context/dbschema.md`) where the plan touches persisted shapes.
```

**Render rules:** body = `customInstructions` verbatim. The `@import` block = one line per `sourceIds` entry, each resolved to a context-doc the renderer materializes under `.claude/context/<id>.md` from `InfoSource` (the `summary`/`dbschema`/`authspec` rows, `seed.ts:328-352`), frozen at `commitHash` for `frozen` sources. The "Hard rules" footer is the renderer's standing read-only-role boilerplate (it mirrors the `deny` set in §2 in prose so the model knows *why* a tool is refused, reducing wasted refused-tool turns). `visibleStageIds: ["refined"]` does NOT appear here — cross-stage visibility is enforced app-side in the `query_context` handler (`CLAUDE_SETTINGS_MAP §2`: "`visibleStageIds` → app-layer"), not via a `.claude` key.

---

## 5. Stage instructions (`--append-system-prompt` content)

The resolved system prompt = D2 layering (`[features/02 §Resolution order]`): `AgentRole.systemPromptTemplate` (layer 1) ◀ preset override (layer 2, none here) ◀ user edit (layer 3, `systemPrompt:""` → empty, so the resolved value is layer 1). Appended via `--append-system-prompt` on the launch command (§6). The carry-over envelope from Refinement is rendered into the prompt body through the `promptTemplate` (`[02 §4]` injection A→B), NOT pasted as raw JSON.

```text
You are the Planning stage of an automated delivery pipeline. You read the refined ticket and the
codebase context, then produce a precise, ordered implementation plan. You NEVER edit files or run
commands. You report exclusively through the structured channel: call `request_input` when a decision
needs a human, and `emit_carryover` with your plan when done.

## Your task (carried over from Refinement)
Produce a step-by-step implementation plan.
From Refined: Stabilize the fallback identity key across ?v= cache-busts; do not change the public Avatar API.
Known files: src/_components/Avatar.tsx, src/_functions/avatar.ts

## How to finish
When your plan is complete, emit the carry-over envelope for the Coding stage:

    ws emit-carryover --file plan-out.json

where plan-out.json matches:
    { "summary": "<one-paragraph plan summary>",
      "changedFiles": ["<files the plan will touch>"],
      "openQuestions": ["<anything the next stage must resolve>"],
      "commitHash": "abc123" }

Optionally include a ```ws-estimate``` fenced block in your summary with
{ tokenEstimate?, durationEstimate?, confidence? } so the orchestrator can size the Coding turn (D4/D27).
```

**Render rules:**
- **Layer resolution:** the renderer flattens layer 1 → layer 2 at instantiation (frozen into `PipelineStageCfg.systemPrompt` on create); a non-empty layer 3 (user edit) would replace it. Here `systemPrompt` is empty so the resolved value is the role template.
- **Carry-over injection:** `promptTemplate`'s `{{summary}} {{changedFiles}}` chips (the `CARRY_VARS` in `seed.ts`) are filled from `carryOverFromRefine` (§1) by the **Conductor** before spawn (`[02 §4]`). `{{openQuestions}}`/`{{commitHash}}` are available but unused by this template. If Plan needs the FULL prior output beyond the subset, it calls `query_context` (B-O2 on-demand) — it is never pre-loaded.
- **The fenced-block convention** (`[04b §14]`, `[02 §4]`): the prompt teaches the agent the `ws-estimate` / `ws-carryover` blocks so the Conductor can parse `tokenEstimate`/`durationEstimate` from the summary (parse-failure falls back to treating the summary as the human one-liner — advisory, no crash). The envelope schema does NOT change; the blocks ride the existing `emit_carryover` payload. **No new verbs.**

---

## 6. Interactive launch command (the managed-token-projection mount)

The orchestrator `docker run`s a **minimal RO container** (`Q-CT-HOSTROLES` — Plan is `needsWorkspace=false`, so no worktree clone, no integration creds), then starts the interactive `claude` PTY inside it via the in-container pty-agent (`B-31`, `Q-CT-PTYAGENT`). This is the **interactive** realization (`[01 §1]`); there is no `-p`, no `--output-format stream-json`, no `--json-schema` (SUPERSEDED, E7).

```bash
# (a) launch the minimal RO container on the shared bridge, mounting ONLY the projected creds RO
docker run -d --name ws-plan-DEV-1240 \
  --network workspaces-net \                               # Caddy/orchestrator reach by DNS name (Q-NET-DOCKER)
  --cap-drop ALL --security-opt no-new-privileges \         # hardening table (Q-CT-LIMITS)
  --user agent --pids-limit 512 --memory 3g --cpus 2 \
  --read-only --tmpfs /tmp \                                 # minimal RO root; reasoning role writes nothing
  -e CLAUDE_CONFIG_DIR=/home/agent/.claude-DEV-1240 \        # per-stage config dir (Q-CT-UNIT)
  -e HTTPS_PROXY=http://egress-proxy.internal:3128 \         # forced egress; allow-list = Anthropic + orchestrator only (Q-CT-EGRESS)
  -e HTTP_PROXY=http://egress-proxy.internal:3128 \
  --env-file /run/ws/DEV-1240-plan.env \                    # tmpfs env-file: WS_HOOK_TOKEN, channel token (Q-SEC-CREDLIFETIME)
  -v /run/ws/projected-creds:/home/agent/.claude-DEV-1240/.credentials.json:ro \   # MANAGED TOKEN PROJECTION (Q-CT-AUTH)
  -v /run/ws/DEV-1240-plan/claude.json:/home/agent/.claude-DEV-1240/.claude.json:ro \
  -v /run/ws/DEV-1240-plan/settings.json:/home/agent/.claude-DEV-1240/settings.json:ro \
  -v /run/ws/DEV-1240-plan/mcp.json:/home/agent/.mcp.json:ro \
  -v /run/ws/DEV-1240-plan/CLAUDE.md:/home/agent/work/CLAUDE.md:ro \
  -v /run/ws/DEV-1240-plan/context:/home/agent/work/.claude/context:ro \
  workspaces/base:1.4.0                                     # pinned base image; CLI pinned EXACT inside (Q-CT-CLIPIN)

# (b) the in-container pty-agent starts the interactive Claude PTY in the work dir:
claude \
  --settings /home/agent/.claude-DEV-1240/settings.json \   # the §2 file
  --mcp-config /home/agent/.mcp.json --strict-mcp-config \   # the §3 file; ONLY these skills (Q-INT-MECHANISM)
  --append-system-prompt "$(cat /home/agent/work/stage-instructions.txt)" \   # the §5 content
  --effort high \                                            # modelCfg.base.effort (no settings.json home in PTY mode)
  --max-turns 20 \                                           # modelCfg.base.maxTurns — runaway cap (B-35)
  # model comes from settings.json ("opus"); auto-escalation re-spawns at a higher band (Conductor, not in-session)
  # NO -p / --json-schema / --output-format stream-json — interactive PTY only (ERRATA E1/E7)
  # on resume after crash/suspend: append  --resume <claudeSessionId>  (re-minted tokens, Q-CT-RESUME / Q-ENG-TOKEN-LIFECYCLE)
```

**The managed-token-projection mount (the load-bearing, `Q-CT-AUTH` / `Q-SEC-CLAUDEMOUNT` part):**

- The orchestrator runs `claude login` **ONCE** on the host, normalizes the OAuth token to a file IT owns (exporting from the macOS Keychain where applicable), and projects ONLY a **read-only `.credentials.json`** + a minimal `.claude.json` into each container's `CLAUDE_CONFIG_DIR`. **It NEVER bind-mounts the whole `~/.claude`** (that would leak `projects/*.jsonl` session history and let N containers race-corrupt the refresh-rewritten credentials file).
- One **host-side refresh loop** re-projects the refreshed token into live containers; **no container ever refreshes its own token** (`Q-CT-AUTH`). Because the mount is `:ro`, a container physically cannot rewrite it.
- Egress is forced through `egress-proxy.internal` with a per-stage allow-list (`Q-CT-EGRESS`); for Plan that is **Anthropic + the orchestrator only** (no GitLab, no npm — Plan reads, it does not fetch). This is the documented mitigation for the accepted B-26 mounted-cred residual risk (`Q-SEC-CLAUDEMOUNT`, sign-off 2026-06-04).
- `CLAUDE_CONFIG_DIR` is **per-stage** (`.claude-DEV-1240` re-rendered on each stage transition within the same container for `code` roles; for Plan the container is the disposable minimal-RO one). A stage transition is a NEW PTY with a freshly-rendered config dir (`Q-CT-UNIT`), never a recreated container for `code` roles.

---

## 7. Hook wiring — which hook → which orchestrator endpoint

Each `type:http` hook in §2 POSTs to a `registerCustomRoute` endpoint on the LuckyStack server, `pre-params` phase, **origin-exempt** (`registerOriginExemptPath`, G6 RESOLVED-FW), `X-WS-Hook-Token`-gated (the per-session `hookTokenId`, `[04b §7]`), each wrapping its work in `runInTenant(workspaceId, …)` (`Q-SEC-RUNINTENANT`, mandatory for this background path). The payload carries `session_id`/`tool_name`/`tool_input`/`tool_result` (`CLAUDE_SETTINGS_MAP §3`).

| Hook (matcher) | Endpoint | Conductor effect | Verb? |
|---|---|---|---|
| `SessionStart` | `/hooks/session-start` | register/refresh the `AgentSession` row (`[04b §7]`); confirm carry-over was injected | none (Conductor write via `[control-API]`) |
| `PostToolUse` (`Bash\|Read\|mcp__.*`) | `/hooks/ticket-event` | append a coalesced `TicketEvent` (DH5 event-granularity) — the event-log source | none |
| `Notification` (`permission_prompt\|idle_prompt`) | `/hooks/needs-input` | set `Ticket` → `needs-input`; fire a `Notification` (B-34, redacted push, `Q-SEC-NOTIF-PUSH`) | none |
| `Stop` | `/hooks/stop` | **turn-end** → release the concurrency slot (`Q-ENG-TURNEND`); run the **forced-reconciliation loop** (`Q-ENG-CARRYOVER-ENFORCE`); token-budget check (06) | none |
| `PreCompact` | `/hooks/pre-compact` | near-context-limit → co-opt as a token-optimization / self-handoff trigger (06) | none |
| `UserPromptSubmit` | `/hooks/prompt-submit` | log the prompt (incl. voice transcript) as a `TicketEvent` | none |

**The Stop-hook is the spine** of this stage's correctness (`Q-ENG-TURNEND` + `Q-ENG-CARRYOVER-ENFORCE`): on `Stop`, the Conductor checks for a schema-valid `emit_carryover`. If present → mark the stage `done`, offer promote-to-Coding. If absent → `--resume` the SAME `claudeSessionId` with a hard templated demand to emit it; after N failures → land the ticket in `needs-input` with a system-authored question (the deterministic backstop the PTY pivot needs, since interactive mode has no `--json-schema` structured-exit). The `Stop`-hook also releases the FIFO concurrency slot — there is no headless stream to derive turn-end from. **No new verbs.**

---

## 8. UNVERIFIED — flags/behaviors pending the P0.5 CLI spike

This render bakes in several CLI behaviors that the **P0.5 gating spike** (`Q-ENG-SPIKE`, blocks P1) must confirm against the running 2026 CLI. Each is flagged here so the golden test fails *loudly* if the spike contradicts it. If the spike fails on billing/PTY → **escalate, do not route to headless** (E1).

| Assumed in this render | Where | If the spike disproves it |
|---|---|---|
| Interactive PTY (`claude` with no `-p`) bills the **Max subscription**, not a metered pool | §6 launch | **Blocks everything.** Escalate; metered headless stays P4-only (`Q-MP-BILLING`). |
| `type:http` hooks **fire in interactive** sessions (not headless-only) | §2 hooks, §7 | The entire hook backbone collapses; fall back to PTY `onExit` + watchdog for turn-end (degraded) and re-design the event source. |
| The `Stop` hook fires reliably at turn-end and is the slot-release + carry-over-enforcement signal | §7 | Use the idle-timeout watchdog as primary turn-end (`Q-ENG-TURNEND` option 2) — weaker. |
| `--effort` and `--max-turns` are accepted **interactive** flags (not print/background-only) | §6 launch | Move effort into the system prompt as guidance; enforce max-turns via the Stop-hook turn counter. |
| `--append-system-prompt` (string form) is accepted interactively (vs only `--append-system-prompt-file`) | §6 launch | Switch to writing `stage-instructions.txt` and `--append-system-prompt-file` (already materialized in §6 mount). |
| Hook payloads carry a **per-turn usage/token** field | §7 Stop, budget | Fall back to a labeled char-count estimate (`Q-ENG-TOKENFEED`) — budget stays advisory. |
| `--resume <claudeSessionId>` re-attaches after an orchestrator crash with the projected RO creds | §6, `Q-CT-RESUME` | Re-spawn from scratch with re-injected carry-over (loses in-session context). |
| `/clear` vs `/compact` preserves the `claudeSessionId` (for the 06 self-handoff) | (06 path) | Default to `/compact`; capture + update the rotated id (`Q-ENG-CLEAR`). |
| A read-only container (`--read-only` + tmpfs) does not break the CLI's own scratch writes under `CLAUDE_CONFIG_DIR` | §6 | Mount `CLAUDE_CONFIG_DIR` as a writable tmpfs volume (creds file stays `:ro` within it). |

**The spike commits a pass/fail table to `SPIKE_RESULTS.md` (`Q-ENG-SPIKE`); this golden fixture is re-validated against it before the renderer's regression test is declared green.**

---

## 9. This is the renderer's first regression test

Per `Q-PROD-GOLDEN` (LOCKED 2026-06-04): wire the §1 fixture inputs into the config-renderer and assert byte-equivalence against §2–§6 (modulo the §1 per-spawn substitutions). Place it as the **first** renderer test so:

- every **unverified §8 flag** surfaces as a concrete diff the moment the CLI behaves differently than assumed (not as buried prose);
- the **VERB_REGISTRY → allow-list** generation (`Q-ENG-VERB-CONFORMANCE`) is exercised end-to-end (the seven `ws <verb>` allow entries are generated FROM the registry; the test asserts no write verb leaks in — B-23);
- the **managed-token-projection mount shape** (`Q-CT-AUTH`) is pinned (RO `.credentials.json`, never a whole-`~/.claude` mount) so a future "convenience" change that bind-mounts the whole dir fails the test;
- the **StageKind reconciliation** (`[04b §12]`) is exercised (`kind:"plan"` drives role logic; the board column keys on the free-string `id`, not the kind).

It pairs with the **deterministic-Conductor unit tests** + the **fake `EngineDriver`** + the **event-log subscribe-before-fetch race test** (`Q-INF-TESTING`, `[features/05]` Testing) as the first vertical slice the build lands. A `code`-stage golden (with the worktree clone, `mongo:rw` tier, `ask`-tier permissions, and the L3 per-ticket container) is the natural **second** fixture — deferred until this one is green.

---

*End of GOLDEN_PLAN_STAGE.md. No new verbs. The seven allow-listed `ws <verb>` patterns are the frozen read|propose surface ([02 §2]); no write verb appears. Every state write is a [control-API] Conductor action (B-23). Headless flags are SUPERSEDED (ERRATA E1/E7); interactive PTY only. Unverified flags (§8) gate on the P0.5 spike (Q-ENG-SPIKE).*
