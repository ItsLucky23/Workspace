# P0.5 — Gating CLI-behavior spike (blocks P1 lanes B/C/F)

> The **single most load-bearing unverified premise** of the whole architecture is that an **interactive `claude` PTY on the Max subscription** can be driven the way `[01]`–`[07]` assume: subscription-billed (not metered), emitting `type:http` hooks in interactive mode, surviving `/clear`/`/compact` + `--resume`, exposing a per-turn usage feed, and authenticated by a managed read-only credential projection. **None of that is proven against the running 2026 CLI.** This doc is the **gate** that proves it before any P1 build lane spends effort on top of it.
>
> Resolves `Q-ENG-SPIKE` (the gated P0.5 spike), and pins the empirical inputs to `Q-ENG-TOKENFEED`, `Q-ENG-CLEAR`, `Q-ENG-TURNEND`, `Q-CT-AUTH`. Cites architecture as `[01 §x]`…`[07 §x]`; codes via [REFERENCE_CODES → B#/G#]; carries the relevant `Q-*` ids inline. **No new verbs.** This is a verification harness — it introduces no protocol surface, no persistence, and no structured-channel verb (the frozen 7-worker + 6-assistant set, `[02 §2]`, is untouched).
>
> Last updated: 2026-06-04. Status: **NOT YET RUN.** `SPIKE_RESULTS.md` (the committed verdict table, §6) does not exist until a human runs this against a logged-in host.

---

## 0. Why this gates everything

`[01 §1]` makes one bet the entire system rests on:

| Mode | Bills to | Verdict in `[01 §1]` |
|---|---|---|
| **Interactive `claude` in a PTY** (OAuth `/login`) | **Max subscription** | the only mode we use |
| `claude -p` / `--print` headless | separate Agent-SDK credit pool (from 2026-06-15) | rejected — meters credits |
| Agent SDK | API key / Agent-SDK credits | rejected — not the subscription |

The headless path was **deliberately abandoned** (ERRATA E1, `00 §2`) precisely because it meters a separate pool. That trade gave up headless `--json-schema`'s guaranteed structured-exit + native token stream in exchange for **prompt discipline + hooks** (`[02 §3]`, `[06]`). Every one of those replacements is an **assumption about interactive-PTY CLI behavior that has never been measured**. If even one is false, a downstream lane silently builds on sand:

- **B (SessionManager)** assumes `--resume <claudeSessionId>` rehydrates a crashed session and that the **Stop hook** is a reliable turn-end + slot-release signal (`[01 §4]`, `Q-ENG-TURNEND`).
- **C (Structured channel)** assumes `type:http` hooks **fire in interactive mode** and POST to `registerCustomRoute` (pre-params, origin-exempt, token-gated) (`[02 §3]`).
- **F (Containers)** assumes the **managed token projection** auth model — a read-only `.credentials.json` + minimal `.claude.json` per `CLAUDE_CONFIG_DIR`, one host refresh loop — actually authenticates a containerized `claude` against the subscription (`Q-CT-AUTH`, the Container deep-dive §2).

**The gate (per `Q-ENG-SPIKE`, recommendation accepted 2026-06-04):**
1. Insert this as **P0.5**, between P0 (docs, done) and P1 (`[05]` foundations).
2. **Block P1 lanes B, C, and F** until every row in §1–§5 is `GREEN` (or `GREEN-WITH-WORKAROUND` with the workaround pinned). Lanes A (Data), D (Conductor, against contracts), and E (Client wiring against the `ws-ai:*` contract) may proceed — they depend on frozen *contracts*, not on CLI runtime behavior.
3. **Pin the exact CLI version** the spike ran against onto every result row, and bake that exact pin into the base image (`Q-CT-CLIPIN`: exact pin, never `@latest`; stamp `cliVersion` onto `AgentSession`/`TicketEvent`, `[04b §7]`).
4. **On a `RED` for billing or PTY-viability → ESCALATE to the user. Do NOT route around it to headless.** Re-instating `claude -p`/Agent-SDK to "make it work" re-breaks the load-bearing decision (`00 §1`, anti-recommendation). Metered burst stays a **P4-only, config-flagged** option (`Q-MP-BILLING`: no-headless is re-scoped to the *Claude billing path*; a future metered-API backend may legitimately be headless — but that is a different driver, not a fallback for this one).

> **Operating note on "ESCALATE."** A billing/PTY `RED` is an *architecture-level* finding, not a bug to patch in-lane. The escalation is: stop, write the `RED` row + repro into `SPIKE_RESULTS.md`, and surface it to the user with the two real options (change the engine premise, or accept metered P4). The builder never silently picks headless (Rule 3a).

---

## 1. Spike A — interactive-PTY subscription billing (NOT metered)

**The bet:** an interactive `claude` PTY spawned with a **clean env** (no `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `apiKeyHelper` — the caveat in `[01 §1]`) draws on the host's `/login` Max subscription, and the per-turn generation does **not** appear in any metered Agent-SDK credit ledger.

| # | Assumption under test | Test command / procedure | Expected (GREEN) | Verdict signal | CLI version |
|---|---|---|---|---|---|
| A1 | Spawned with a clean env, an interactive PTY uses the subscription, not an API key | In a PTY harness (node-pty), spawn `claude` with `env` stripped of `ANTHROPIC_*`/`apiKeyHelper`; run one real turn; inspect the subscription usage view (host `claude` `/usage` or account dashboard) before/after | The turn lands on the **subscription** quota; the metered Agent-SDK credit balance is **unchanged** | subscription counter increments; credit balance flat | _(pin)_ |
| A2 | A stray `ANTHROPIC_API_KEY` silently flips billing to metered | Repeat A1 **with** `ANTHROPIC_API_KEY` set; observe which ledger moves | metered ledger moves (proves the env-strip is mandatory) → SessionManager MUST spawn with a scrubbed env (`[01 §1]`, `[08]` env-injection) | credit balance drops with the key set | _(pin)_ |
| A3 | Concurrent active PTYs all bill the one subscription (no per-session key needed) | Spawn `MAX_CONCURRENT_ACTIVE` (~4, `[01 §6]`) PTYs, one turn each, clean env | all turns on the subscription; no metered spill; throttling (if any) surfaces as a rate-limit message, not a billing switch | subscription-only; rate-limit path is `Q-ENG-throttle` (A-tier §5) | _(pin)_ |

**If A1 or A3 is `RED` → ESCALATE (do not route to headless).** This is the premise of `[01 §1]`/`[01 §6]` and there is no in-lane workaround. A2 `RED` is *informational and expected* — it hard-confirms the clean-env requirement that `SessionManager.spawn*` (`[01 §4]`) and the container env-injection step (`07 §A` step 6) must honor; record it as a build constraint, not a blocker.

---

## 2. Spike B — `type:http` hook delivery in interactive mode

**The bet:** `[02 §3]` makes the Claude `type:http` hook set **the lifecycle/event backbone** — `SessionStart`, `PostToolUse(Bash|Edit|Write|mcp__*)`, `PostToolUseFailure`, `Notification(permission_prompt|idle_prompt)`, `Stop`, `PreCompact`, `UserPromptSubmit` — and they fire in **interactive** sessions (not just headless). The hook config is rendered into `.claude/settings.json` per the (now interactive-only, ERRATA E7) settings map.

| # | Assumption under test | Test command / procedure | Expected (GREEN) | Verdict signal | CLI version |
|---|---|---|---|---|---|
| B1 | `type:http` hooks fire at all in an interactive PTY | Render `.claude/settings.json` with a `type:http` hook for `SessionStart` + `Stop` pointing at a local capture endpoint (`registerCustomRoute`, pre-params, origin-exempt, `X-WS-Hook-Token`-gated, `[02 §3]`/G6/G7); start an interactive `claude`; run one turn | the endpoint receives a `SessionStart` POST at spawn and a `Stop` POST at turn end | both POSTs land, token-gated | _(pin)_ |
| B2 | `PostToolUse` fires per tool call (the `TicketEvent` source) | Add `PostToolUse` for Bash/Edit/Write; have the agent run a command + edit a file | one POST per tool use, with enough payload to build a `TicketEvent` (`[04b §6]`) | N tool uses → N POSTs | _(pin)_ |
| B3 | `Notification(permission_prompt\|idle_prompt)` fires (the `needs-input` trigger) | Configure a permission that triggers a prompt; observe | a `Notification` POST with the prompt kind → drives `needs-input` (`[02 §5]`) | POST received with kind | _(pin)_ |
| B4 | `Stop` payload distinguishes turn-end (`Q-ENG-TURNEND`) | Inspect the `Stop` POST body | enough to mark turn-end → release a concurrency slot + run the done-check/budget-check (`[01 §6]`, `[06 §2]`) | body usable as the FIFO slot-release signal | _(pin)_ |
| B5 | `PreCompact` fires near the context limit (`[06 §4]`) | Drive a session toward its window; observe | a `PreCompact` POST fires before auto-compaction → co-opted as the hard self-handoff trigger | POST fires pre-compaction | _(pin)_ |

**Workaround ladder if partial (`GREEN-WITH-WORKAROUND`):** `[02 §3]` already declares a fallback chain for turn-end — *primary* = the worker's `emit_carryover` (explicit done, structured channel); *secondary* = `Stop`; *tertiary* = PTY `onExit`; *backstop* = watchdog idle. So if `Stop` (B4) is unreliable but `PostToolUse`/`SessionStart` work, turn-end degrades to the `emit_carryover` + `onExit` + watchdog path **without** re-opening headless. **Pin the exact degrade in the result row.** A total hook `RED` (B1 fails — no hooks at all interactively) is **architecture-level**: it guts `[02 §3]` and the event-log source → ESCALATE; the deterministic backstop is the Stop-hook forced-reconciliation loop (`Q-ENG-CARRYOVER-ENFORCE`), which itself assumes a turn-end signal, so its degraded form (watchdog-only) must be documented here, not invented in lane C.

---

## 3. Spike C — `/clear` vs `/compact` and `claudeSessionId` preservation

**The bet:** `[06 §5]` defaults the token-optimization self-handoff to **`/clear` + reload** (fully fresh context, the handoff file *is* the curated state), with `/compact` as a lighter per-workspace option. Both are interactive slash commands written `\r`-terminated to PTY stdin. The hard unknown (`Q-ENG-CLEAR`): does `/clear` **rotate** the `claudeSessionId` (the id `--resume` needs, `[01 §4]`, `[04b §7]`)? If it does, a `/clear` silently orphans `--resume`.

| # | Assumption under test | Test command / procedure | Expected (GREEN) | Verdict signal | CLI version |
|---|---|---|---|---|---|
| C1 | `/clear` empties context but keeps the session resumable | Write `/clear\r` to a live PTY; capture the `claudeSessionId` before and after (from the session JSONL path / a `SessionStart`-re-fire / CLI introspection); then kill + `claude --resume <id>` | `--resume` re-attaches the SAME session after a `/clear` | resume succeeds on the pre-`/clear` id | _(pin)_ |
| C2 | If `/clear` rotates the id, the new id is **observable** so we can re-capture | If C1 shows rotation, confirm a `SessionStart` hook (Spike B) or the JSONL emits the NEW id | the new id is captured → store it on `AgentSession.claudeSessionId` (`[04b §7]`: "RE-CAPTURED if /clear rotates it") | new id observed + persisted | _(pin)_ |
| C3 | `/compact` keeps the id (the documented fallback) | Write `/compact\r`; check id stability + that context shrank | id stable, context reduced → the safe default if `/clear` rotates | id unchanged, context smaller | _(pin)_ |
| C4 | `Handoff.body` re-injection works as a normal prompt post-reset | After `/clear` (or `/compact`), send the rendered `Handoff` (a small template, NOT raw JSON, `[06 §6]`) as the opening prompt; verify the session continues coherently | the fresh context carries the handoff forward | continuation is coherent | _(pin)_ |

**Decision rule baked in (`Q-ENG-CLEAR`, accepted):** if C1 is `RED` (`/clear` rotates and C2 can't re-capture cleanly) → **default the self-handoff to `/compact`** (`[06 §5]` already offers it) and document `/clear` as opt-in only. This is a config flip inside `[06]`, **not** a headless fallback. Run this spike **before the token-optimization lane** (P2/P3 per `[05]`/`[06]`) — but the `claudeSessionId`-lifecycle answer also feeds lane B's `--resume` (C-tier blocks B's resume sub-feature, not B wholesale).

---

## 4. Spike D — per-turn token / usage feed

**The bet:** `[01 §6]` + `[06 §4]` treat the budget as **advisory** (the real limit is subscription quota), driven by `AgentSession.tokenEstimate` — explicitly *not* precise. The open question (`Q-ENG-TOKENFEED`): is there ANY authoritative per-turn usage number in interactive PTY mode (e.g. inside a hook payload), or is the orchestrator's char-count heuristic the only source?

| # | Assumption under test | Test command / procedure | Expected (GREEN) | Verdict signal | CLI version |
|---|---|---|---|---|---|
| D1 | A hook payload (`Stop`/`PostToolUse`) carries usage numbers | Inspect every interactive hook body (Spike B) for a `usage`/`tokens` field | a per-turn token count is present → feed `SpendRecord.tokensIn/Out` + `tokenEstimate` (`[04b §9]`/`[04b §7]`), still labeled ADVISORY | a usage field exists in some hook payload | _(pin)_ |
| D2 | If no hook usage, the char-count heuristic is the fallback | Disable D1's source; confirm the orchestrator can maintain `tokenEstimate` from bytes read/written to the PTY (`[06 §4]` primary) | `tokenEstimate` trackable from PTY byte stream alone, **explicitly labeled an estimate** | byte-derived estimate is computable | _(pin)_ |
| D3 | The chosen source fires the budget at ~70–80% of the window (`[06 §4]`) | Drive a long session; confirm the budget check trips before `PreCompact` | the self-handoff cycle (`[06 §2]`) triggers off the estimate before auto-compaction | budget trips at target % | _(pin)_ |

**This spike never `RED`s into an ESCALATE** — D2 (char-count heuristic) is always available as the floor, and the budget is **advisory by design** (`[01 §6]`: the cap+queue+suspend+self-handoff are the real levers, not a precise meter). The outcome just **labels the source**: hook-usage if D1 is GREEN, else a "labeled char-count estimate" (`Q-ENG-TOKENFEED` recommendation). Record which one in `SPIKE_RESULTS.md` so `SpendRecord`/`tokenEstimate` consumers (`[04b §9]`, doc 19/05) inherit the right precision caveat. **No new verbs** — spend is accrued Conductor-side from hooks/PTY bytes, never an LLM verb (`[04b §9]`).

---

## 5. Spike E — `--resume` after crash + managed-token-projection auth files

Two coupled questions that gate lane F (Containers) and lane B's resume path.

### 5a. `--resume` after an orchestrator crash (`Q-CT-RESUME`)

**The bet:** `[01 §4]` `resumeAll()` reads `AgentSession` rows in a live state and re-spawns each with `claude --resume <claudeSessionId>`; Claude persists sessions to `~/.claude/projects/<proj>/<id>.jsonl` (~30 days); containers survive (`--restart unless-stopped`, `Q-CT-PTYAGENT`) so the worker continues.

| # | Assumption under test | Test command / procedure | Expected (GREEN) | Verdict signal | CLI version |
|---|---|---|---|---|---|
| E1 | `--resume <id>` re-attaches a session after the parent PTY dies | Start a turn, kill the PTY (simulate crash), `claude --resume <id>` against the persisted JSONL | the session resumes with its prior context intact | resume succeeds, context present | _(pin)_ |
| E2 | The session JSONL survives a container `--restart unless-stopped` | Resume INSIDE the per-ticket container after a simulated orchestrator restart; the container's `CLAUDE_CONFIG_DIR` JSONL persisted on the container volume | resume works container-side; `containerId`+`worktreePath`+`ptyAgentUrl` re-associate the row (`[04b §7]`) | container-scoped resume works | _(pin)_ |
| E3 | A `--resume` does NOT corrupt when re-minting the structured-channel/hook tokens | On resume, re-mint `channelTokenId`/`hookTokenId` (`Q-ENG-TOKEN-LIFECYCLE`, `[04b §7]`); confirm the resumed session honors the new tokens | resumed session uses the freshly-minted tokens; no stale-token writes | new tokens accepted | _(pin)_ |

### 5b. Managed-token-projection auth — the files the CLI reads/writes (`Q-CT-AUTH`, CRITICAL)

**The bet (the load-bearing, currently-mis-stated part):** `07 §A`/`[01 §7]` say "mount `~/.claude`" — that is **superseded** by managed token projection (`Q-CT-AUTH`, Container deep-dive §2, signed off via `Q-SEC-CLAUDEMOUNT`). The orchestrator logs in ONCE, normalizes the token to a file it owns, and mounts ONLY a **read-only** projected `.credentials.json` + a minimal `.claude.json` into each container's own `CLAUDE_CONFIG_DIR`; ONE host-side refresh loop re-projects the refreshed token; **no container ever refreshes** (avoids the N-writer race that corrupts a shared file), and the session JSONLs are NOT shared (avoids `--resume` corruption). This spike **enumerates exactly which files the CLI reads and writes** so the projection is correct.

| # | Assumption under test | Test command / procedure | Expected (GREEN) | Verdict signal | CLI version |
|---|---|---|---|---|---|
| E4 | The CLI authenticates from a `CLAUDE_CONFIG_DIR` containing only a RO `.credentials.json` + minimal `.claude.json` | Point `CLAUDE_CONFIG_DIR` at a dir holding ONLY those two files (read-only); run a turn | the turn authenticates against the subscription with no other files present | auth succeeds from the minimal projected dir | _(pin)_ |
| E5 | The CLI does NOT try to **write** `.credentials.json` mid-session (the refresh-race premise) | Mount `.credentials.json` read-only; run a long session spanning a likely token refresh; watch for write/EACCES | the CLI tolerates a RO creds file (refresh is done host-side and re-projected); no fatal write | no fatal write to RO creds | _(pin)_ |
| E6 | The exact token-refresh mechanics (where the fresh token lands, TTL) are known so the host refresh loop can re-project | On the host, force/observe a token refresh; record the file path + format + cadence the CLI rewrites | the host refresh-loop contract is fully specified (path, format, cadence) → implementable in lane F | refresh path + cadence captured | _(pin)_ |
| E7 | On **macOS** the OAuth token is in the Keychain (service `claude-code`), NOT `~/.claude` — projection must export it | If the spike host is macOS: locate the token (Keychain vs file); confirm it can be exported to a projected file | the host-OS-agnostic projection works (export-from-Keychain on macOS, file on Linux) | token exportable on the spike OS | _(pin)_ |
| E8 | Session JSONLs are per-container (NOT shared) so concurrent `--resume` can't corrupt | Run two containers with separate `CLAUDE_CONFIG_DIR`s; confirm each writes its own `projects/*.jsonl`, no cross-writes | each container owns its JSONLs; no shared-writer corruption | isolated JSONL dirs confirmed | _(pin)_ |

**If E4/E5 is `RED` → ESCALATE (lane F is blocked, do not route to headless).** A failure here means the projection model can't authenticate a containerized `claude`, which collapses the entire container engine (`07 §A`, Container deep-dive). The options are then auth-model-level (the §4 "host auth-broker" alternative in `Q-CT-AUTH`, research-grade), not a headless flip. E7 only applies if the spike runs on macOS; on a Linux/WSL2 host (the user's box, `Q-NET-DOCKER`) it is N/A — record it so.

> **Correction the spike forces into `07`/`01`:** the current "mount `~/.claude`" wording in `07 §A` (mounts list), `07 §G`, and `[01 §7]` is the **pre-`Q-CT-AUTH`** phrasing. The spike's E4–E8 results are the empirical basis for replacing it with the managed-projection language. This is flagged here (Report-Without-Auto-Fixing) — the doc edit lands when lane F implements, citing this spike; **this doc does not edit `07`/`01`.**

---

## 6. The committed `SPIKE_RESULTS.md` output format

When the spike runs, the operator commits a `src/workspaces/_docs/SPIKE_RESULTS.md` with **exactly** this shape. It is the artifact that flips the P1 B/C/F gate from blocked to open. Until it exists and every gating row is `GREEN`/`GREEN-WITH-WORKAROUND`, lanes B/C/F do not start.

```md
# SPIKE_RESULTS.md — P0.5 CLI-behavior spike verdicts

> Run by: <name>  ·  Date: <YYYY-MM-DD>  ·  Host OS: <linux | wsl2 | macos>
> Claude CLI version (EXACT, pinned into the base image, Q-CT-CLIPIN): <x.y.z>
> Subscription: Max (host `claude /login`-ed)  ·  Env: clean (no ANTHROPIC_*/apiKeyHelper)
> GATE: P1 lanes B/C/F are BLOCKED until every gating row below is GREEN or GREEN-WITH-WORKAROUND.

## Verdict legend
- GREEN — assumption holds as specified.
- GREEN-WITH-WORKAROUND — holds via a pinned degrade (state it in the Workaround column).
- RED-ESCALATE — load-bearing failure; surfaced to the user; NO headless fallback taken.
- N/A — not applicable on this host OS (record why).

## Results
| Spike | Row | Assumption | Verdict | Evidence (log/screenshot ref) | Workaround / degrade (if any) | Blocks lane |
|---|---|---|---|---|---|---|
| A | A1 | PTY uses subscription, clean env | <GREEN/RED-ESCALATE> | <ref> | — | B,C,F |
| A | A2 | stray ANTHROPIC_API_KEY → metered | <GREEN(expected)> | <ref> | clean-env spawn is mandatory | (constraint) |
| A | A3 | concurrent PTYs all on subscription | <…> | <ref> | — | B,F |
| B | B1 | type:http hooks fire interactively | <…> | <ref> | — | C |
| B | B2 | PostToolUse per tool call | <…> | <ref> | — | C |
| B | B3 | Notification(permission/idle) fires | <…> | <ref> | — | C |
| B | B4 | Stop = turn-end / slot-release | <…> | <ref> | else emit_carryover+onExit+watchdog | B,C |
| B | B5 | PreCompact fires near limit | <…> | <ref> | else byte-estimate budget only | (P2/P3 token-opt) |
| C | C1 | /clear keeps resumable session | <…> | <ref> | else default /compact | B(resume), P2/P3 |
| C | C2 | rotated id is observable | <…> | <ref> | re-capture via SessionStart/JSONL | B(resume) |
| C | C3 | /compact keeps id | <…> | <ref> | — | P2/P3 |
| C | C4 | Handoff re-injection coherent | <…> | <ref> | — | P2/P3 |
| D | D1 | hook payload carries usage | <…> | <ref> | else char-count estimate (advisory) | (advisory only) |
| D | D2 | byte-derived estimate works | <…> | <ref> | — | (advisory only) |
| D | D3 | budget trips at ~70–80% | <…> | <ref> | — | (P2/P3 token-opt) |
| E | E1 | --resume after PTY crash | <…> | <ref> | — | B(resume),F |
| E | E2 | resume survives container restart | <…> | <ref> | — | F |
| E | E3 | resume re-mints tokens cleanly | <…> | <ref> | — | B,F |
| E | E4 | auth from minimal RO CLAUDE_CONFIG_DIR | <GREEN/RED-ESCALATE> | <ref> | — | F |
| E | E5 | CLI tolerates RO .credentials.json | <GREEN/RED-ESCALATE> | <ref> | — | F |
| E | E6 | host token-refresh path/cadence captured | <…> | <ref> | — | F |
| E | E7 | macOS Keychain export (if macOS) | <…/N/A> | <ref> | — | F (macOS only) |
| E | E8 | per-container JSONLs (no shared-writer) | <…> | <ref> | — | F |

## Pinned decisions emitted by this run
- Turn-end signal: <Stop hook | emit_carryover+onExit+watchdog>.            (Q-ENG-TURNEND)
- Self-handoff reset command default: </clear | /compact>.                   (Q-ENG-CLEAR)
- Token/usage source: <hook-payload usage | labeled char-count estimate>.    (Q-ENG-TOKENFEED)
- Auth projection: confirmed files = [.credentials.json (RO), .claude.json]. (Q-CT-AUTH)
- CLI version pinned into base image: <x.y.z>.                               (Q-CT-CLIPIN)

## Escalations (RED-ESCALATE rows)
<one block per RED: assumption, repro, the two real options surfaced to the user — change-engine-premise vs accept-metered-P4 — NEVER a silent headless flip.>
```

---

## 7. Where this sits in the build plan

- **P0** (docs) — done. This spike doc is the last P0 artifact.
- **P0.5** (THIS spike) — run before P1. Gates **B/C/F**; A/D/E[client] may proceed against frozen contracts (`[05]` P1 table).
- **On all-GREEN** — commit `SPIKE_RESULTS.md`, bake the pinned CLI version into the base image (`Q-CT-CLIPIN`, lane F), open B/C/F.
- **On a billing/PTY/auth RED** — ESCALATE per §0/§1/§5; the resolution is architecture-level (engine premise or P4 metered), recorded as an escalation block, never an in-lane headless workaround.

**No new verbs.** This doc is a verification harness; the frozen verb surface (`[02 §2]`), the carry-over envelope (`[02 §4]`), and the data model (`[04]`/`[04b]`) are inputs it tests, not surfaces it extends. Every "write" implied by a passing spike (a `TicketEvent`, a `SpendRecord`, an `AgentSession` row) remains a **Conductor / `[control-API]`** action (B-23), never a model-callable verb.
