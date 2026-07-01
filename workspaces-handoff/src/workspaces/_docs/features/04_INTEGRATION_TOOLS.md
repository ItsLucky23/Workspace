# 04 — Integration tools (CLI-client-first)

> Configuring workspace **Integration tools** + **Env vars** and binding them per-stage with a `ro`/`rw` tier, so a stage-agent can reach a real third-party tool (e.g. query the workspace database to *see the data*). Extends [03 §5] (integrations: goal-defined, mechanism-open), [02 §2] (`emit_signal`, `query_context`), [01 §8] (secrets-at-spawn, egress sandbox). Reads from the INDEX: CLI-client-first is firm; **no new persistence** beyond the existing `IntegrationTool` / `EnvVar` / `StageToolCfg`.

The contract is fixed by [03 §5]: a stage selects a workspace-configured `IntegrationTool` by id + a `ro`/`rw` tier (`StageToolCfg`, **B-O8**); env vars hold the secrets. The **open** part — *how* the agent reaches the tool — this doc nails to **CLI-client-first**: a whitelisted CLI client runs in the container via Bash, with creds injected from env at the tier. MCP is the exception, used only where a CLI client can't (semantic RAG).

---

## Scope

**In**
- The per-tool **bind**: which CLI client + version, its Bash arg format, and the `permissions.allow` entries that whitelist it (e.g. `"Bash(mysql:*)"`). Known `IntegrationTool.type`s come from a per-type allow-pattern map; a custom type declares its own `command` + allow pattern. Any wrapper is an **allow-listed run-command**, never a new structured-channel verb.
- The `ro`/`rw` **tier** (`StageToolCfg.tier`, B-O8) → which **separate per-tier credential** gets injected at spawn (a read-only DB user for `ro`, a read-write user for `rw`; short-lived, scoped).
- The **base-image client list** (pre-baked: `psql`, `mysql`, `mongosh`, `redis-cli`, `curl`, `git`, `gh`) + per-project `Dockerfile ADD` for project-specific clients the base lacks.
- The **error path**: a failed/denied tool call is non-blocking → `emit_signal` (an observation, not a stop); after **3 consecutive failures on the same tool** the Conductor escalates to `needs-input` + a notification (threshold configurable).
- A worked example (MySQL `ro`: the agent runs `mysql` via Bash to read live rows).

**Out**
- The credential decrypt/scoping machinery itself (orchestrator phase, [01 §8]) — here it's "the `ro`/`rw` env var the tier maps to is injected at container start, never baked into the image".
- Authoring the tools/env in the first place — that UI already exists (`WorkspaceSettings` Env + Integrations tabs); this doc only adds the *reach mechanism* semantics.
- MCP-server authoring beyond the existing `IntegrationTool.mcp` toggle (kept as the documented escape hatch).

**Deferred**
- An MCP server *per* tool (the per-tool JS server [03 §5] flags as "not built, may not need for v1"). Reserved for cases a CLI client genuinely can't cover.

---

## User flow

1. **Configure once (workspace).** In `WorkspaceSettings` → **Env** the user adds the connection secrets (`EnvVar{key,value,secret}`); in → **Integrations** they add an `IntegrationTool` (type e.g. `mysql`), mapping each `IntegrationField` to an `EnvVar` (`IntegrationField.envVarId`). The MCP toggle stays **off** for CLI-reachable tools (the default); it's flipped on only for the RAG-class exception.
2. **Bind per stage.** In `Pipeline` → **Integrations** tab (`IntegrationsTab` in `Pipeline.tsx`) the user toggles the tool on for a stage and picks **Read** (`ro`) or **Write** (`rw`) — exactly the existing control. The bind is a `StageToolCfg{toolId, tier}` on that `PipelineStageCfg`.
3. **Spawn-time wiring (orchestrator).** When the stage-agent's container starts, the orchestrator: (a) renders the tool's CLI into `permissions.allow` (e.g. `"Bash(mysql:*)"`) from the per-`type` allow-pattern map (custom types use their declared `command` + pattern); (b) injects the **tier-matched, short-lived** credential into the container env — a **separate per-tier DB credential** (the read-only user for `ro`, the read-write user for `rw`), never the raw long-lived secret baked in ([01 §8]); (c) ensures the client binary is present (base image — `psql`/`mysql`/`mongosh`/`redis-cli`/`curl`/`git`/`gh` — or per-project `Dockerfile ADD`).
4. **Agent uses it.** Mid-task the agent runs the client through its native **Bash** tool — `mysql -h $DB_HOST -u $DB_USER_RO ... -e "SELECT ..."` — and "sees the data" in stdout, just like a developer would. Because the verb is `Bash` + an allow-listed pattern, **no new structured-channel verb is involved**.
5. **Failure is non-blocking (until it isn't).** If the call errors (auth, denied write on a `ro` bind, host blocked by egress) the agent doesn't stall: it `emit_signal({type:'observation', ...})` and continues or self-phrases a question — the Conductor logs it; it does not become a hard `stuck` on its own. After **3 consecutive failures on the same tool** the Conductor escalates to `needs-input` + a notification (threshold configurable); the signals before that stay non-blocking observations.

**Desktop / mobile:** no new screen — this lives entirely in the two existing tabs (`WorkspaceSettings` Integrations/Env, `Pipeline` Integrations). The `Pipeline` Read/Write segmented control already renders inline on mobile, so parity is automatic (B-37).

### Worked example — MySQL read access ("let the agent see the data")
```
Workspace Env:        DB_HOST, DB_USER_RO (mysql:ro creds), DB_USER_RW (mysql:rw creds)
IntegrationTool:      { name:'App DB (prod)', type:'mysql',
                        fields:[host→DB_HOST, user→DB_USER_RO], mcp:{enabled:false} }
Plan stage binds:     StageToolCfg{ toolId:'tool-appdb', tier:'ro' }
Orchestrator renders: permissions.allow += "Bash(mysql:*)"; inject DB_USER_RO creds (ro)
Agent (in Bash):      mysql -h $DB_HOST -u $DB_USER_RO appdb -e "SELECT status, count(*) FROM orders GROUP BY status;"
                      → reads real rows to ground its plan. A write would need a rw bind (which the
                        "rw on a non-impl stage" validator already warns about, Pipeline.validate()).
```

---

## Data

**No new persistence.** Everything is already in `types.ts` (and DATAMODEL §2):
- `EnvVar{ id, key, value, secret }` — the secrets/config.
- `IntegrationField{ id, label, placeholder?, envVarId }` + `IntegrationTool{ id, name, type, fields[], mcp{enabled,command} }` — the workspace-level tool.
- `StageToolCfg{ toolId, tier: 'ro'|'rw' }` on `PipelineStageCfg.tools[]` — the per-stage bind (B-O8). Real model: `StageToolPermission{tool,tier}`, DATAMODEL §2.

The CLI client + version + arg format + `permissions.allow` entry are **rendered at spawn** from `IntegrationTool.type` via a per-type allow-pattern map (the `INTEGRATION_TYPES` catalog, already in `seed.ts`) — they are *derived config*, not stored rows. A custom (non-catalogued) type carries its own `command` + allow pattern; any wrapper is an allow-listed run-command, never a new verb. `permissions.allow` is part of the existing `PipelineStage.claudeSettings` render (CLAUDE_SETTINGS_MAP §2), not a new field. The `ro`/`rw` tier resolves to a **separate per-tier credential** (a read-only DB user vs a read-write user) injected at spawn — credential selection, not a new persisted field.

**INDEX delta:** (none — reuses existing `IntegrationTool`, `IntegrationField`, `EnvVar`, `StageToolCfg`)

---

## Verbs / Events / Hooks

**No new verbs.** The reach mechanism is the native **`Bash`** tool gated by a `permissions.allow` pattern (`"Bash(mysql:*)"`) — a `.claude/settings.json` permission, not a structured-channel verb (CLAUDE_SETTINGS_MAP §2). Around it:
- **`emit_signal`** ([02 §2]) — a failed/denied tool call becomes a non-blocking `observation` signal consumed serially by the Conductor; it does not auto-`stuck`. After **3 consecutive failures on the same tool** the Conductor escalates to `needs-input` + a notification (threshold configurable).
- **`query_context`** ([02 §2]) — when the agent needs a tool-derived fact *now* and the answer already lives in the DB/event-log, it asks the orchestrator instead of re-running the client.
- **Hooks:** the existing `PostToolUse(Bash)` hook already turns each client invocation into a `TicketEvent` (the event-log source, [02 §3]) — so DB reads show up in Activity for free; nothing new to toggle.
- **Tier enforcement** is primarily via the **separate per-tier DB credential** picked at spawn (the `ro` bind injects a read-only DB user, so a write fails server-side, B-O8); the existing `PreToolUse` app-gating still applies on top of the permission rule — consistent with CLAUDE_SETTINGS_MAP §3.

The credential **tier** + the stage **egress allow-list** ([01 §8]) cap the reach regardless of mechanism. MCP transport is allowed only for the semantic-RAG exception; when used, `--strict-mcp-config` scopes the stage to its declared servers ([02 §2] scoping).

---

## UI

**Reused (no new components)**
- `WorkspaceSettings.tsx` — **Env** tab (`EnvTab`: add/reveal/secret-mask `EnvVar`s) and **Integrations** tab (`IntegrationsTab` + `IntegrationToolForm`: type → fields → env-var mapping + MCP toggle). The MCP toggle copy gets a one-liner: *"leave off for CLI-reachable tools (default); on only for tools no CLI client covers."*
- `Pipeline.tsx` — **Integrations** tab (`IntegrationsTab`): the per-stage on/off + **Read/Write** (`ro`/`rw`) segmented control, and the empty-state CTA that deep-links to `WorkspaceSettings` integrations. The existing `validate()` rule ("`rw` on a non-`impl` stage" warning) stays as the guard.
- Primitives: `Toggle`, `Dropdown`, `Segmented`, `WsButton`, `Icon` — all already used by both tabs.

**Mobile parity:** both tabs are already mobile-laid-out (the Read/Write control is a compact inline segmented control); no parity work beyond what exists.

---

## Extends

- "[03 §5] Integrations — goal-defined, mechanism-open" — this doc fixes the open mechanism to **whitelisted CLI client in the container (rec. v1)**, keeps **MCP server per tool** as the exception (semantic RAG), and inherits the credential-tier + egress-allow-list caveat verbatim.
- "[02 §2] Structured channel" — `emit_signal` (non-blocking failure) + `query_context` (synchronous fact pull); the tool itself is plain `Bash`, no verb.
- "[02 §3] Hooks" — `PostToolUse(Bash)` makes every client call a `TicketEvent`; `PreToolUse` enforces the tier.
- "[01 §8] Security & dev-gating" — secrets injected at spawn (short-lived, scoped), never baked in; egress allow-list bounds where the client can reach; the browser never chooses the binary/args.

---

## Resolved

1. **04.q1 — Client → `permissions.allow` rendering:** a per-`IntegrationTool.type` allow-pattern map for known types (`mysql`→`"Bash(mysql:*)"`, `mongo`→`"Bash(mongosh:*)"`, `redis`→`"Bash(redis-cli:*)"`, …). Custom types declare their own `command` + allow pattern. Any wrapper is an **allow-listed run-command**, never a new verb.
2. **04.q2 — Base-image client list:** the base image bakes common clients — `psql`, `mysql`, `mongosh`, `redis-cli`, `curl`, `git`, `gh`. Project-specific clients ship via a per-project `Dockerfile ADD`.
3. **04.q3 — `ro`/`rw` enforcement point:** enforced via **separate per-tier DB credentials** (a read-only user and a read-write user); the tier picks the credential at spawn (B-O8). `PreToolUse` app-gating stays on top.
4. **04.q4 — Failure escalation threshold:** escalate after **3 consecutive failures on the same tool** → `needs-input` + notification (configurable); signals before that stay non-blocking `observation`s.
