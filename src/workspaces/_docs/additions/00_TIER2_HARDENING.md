# TIER-2 HARDENING — correctness/robustness fixes (no product judgment)

> **What this is.** Alongside the 16 product additions ([00_INDEX.md](./00_INDEX.md)), the reader-agents surfaced a batch of pure **correctness / robustness** fixes — holes and risks in the existing design that need a build-doc edit, not a product decision. The user accepted **all four buckets** on 2026-06-11.
>
> **How to use this.** These are NOT new features. Each row is a fix to fold into its **owning doc** when that lane builds. They honor the same invariants (B-23 · frozen verbs · `runInTenant` · PTY-billing). Where a fix needs a field/op, it's a [DECISIONS_LEDGER §5](./00_DECISIONS_LEDGER.md) delta. Cite each by its `T#` code.

---

## Bucket 1 — Engine / orchestrator correctness (Lane A)

| T# | Fix | Why it matters | Owning doc |
|---|---|---|---|
| **T1** | **Carry-over adequacy check** — a deterministic, Conductor-side gate that the `emit_carryover` envelope is *semantically adequate*, not just schema-valid: non-empty `summary` over a length floor, `changedFiles` cross-checked against the `PostToolUse(Edit\|Write)` hook events actually seen this stage, `commitHash` verified to be a real ref in the worktree. | A worker can emit a valid-but-useless envelope and the Stop-loop marks the stage `done`; the next stage gets garbage. The hook event-log already holds the ground truth to diff against — no LLM needed. | [02b §B](../02b_PROTOCOL_ADDENDA.md), [02 §4](../02_PROTOCOL_AND_FLOW.md) |
| **T2** | **Slot-release on `needs-input` + turn aging** — explicitly release the concurrency slot when a worker blocks on `request_input` (it isn't generating), re-acquire on `--resume`; age interactive Assistant turns ahead of long-idle worker turns in the FIFO. | Today a blocked-on-user worker may hold its slot; 4 stuck tickets can freeze the whole host. A one-line state-machine rule the docs are missing. | [01 §6](../01_ARCHITECTURE.md), [02b §B.1](../02b_PROTOCOL_ADDENDA.md) |
| **T3** | **Staged, capacity-aware `resumeAll()`** — recovery re-spawns through the *same* CapacityManager admission gate, priority-ordered (needs-input first, then busy, then idle), staggered to respect `MAX_CONCURRENT_ACTIVE`. | ~16 resident sessions all re-minting tokens + `--resume` at boot blows past the active cap instantly (thundering herd). | [01 §4](../01_ARCHITECTURE.md), [07b §9.2](../07b_CONTAINER_RUNTIME.md), [08](../08_DEPLOYMENT.md) |
| **T4** | **Mid-turn board-reconcile guard** — a GitLab-webhook reconcile that would mutate a ticket with a live `busy` Stage-Agent defers (or snapshot-and-replays) rather than racing the agent's pending carry-over; heal on the next reconcile cron. | "GitLab wins" is undefined when the agent is mid-turn on that ticket; a naive reconcile can clobber an in-flight stage. | [07 §C](../07_ORCHESTRATOR.md) |
| **T5** | **Warm-pool image-generation tagging** — tag each warm container with the L2 content-hash it was built from; drain stale-tagged warm containers when L2 rebuilds. | A stale warm container can serve an old image after a Dockerfile/lockfile change. Trivial label check. | [07b §8.4](../07b_CONTAINER_RUNTIME.md) |

## Bucket 2 — Data / observability integrity (Lane B)

| T# | Fix | Why it matters | Owning doc |
|---|---|---|---|
| **T6** | **`seq`-integrity gauge** — `ws_seq_gaps_total` / `ws_seq_collisions_total` operator metrics over the one invariant the whole sync surface rests on. | A collision after a Redis loss is a data-corruption early-warning; today it's only caught by a client re-fetch + a DR verify step. | [OBSERVABILITY §2](../OBSERVABILITY.md) |
| **T7** | **Backup-freshness gauge + alert** — `ws_last_successful_backup_age_seconds` + an alert when it exceeds the RPO. | A silently-failing `mongodump` cron is invisible until a restore is attempted; DR mandates *drills* but not *liveness*. | [OBSERVABILITY §2](../OBSERVABILITY.md), [DR_RUNBOOK](../DR_RUNBOOK.md) |
| **T8** | **`SpendRecord` idempotency key** — a `turnKey` = `(sessionKey, claudeSessionId, turnSeq)` so spend accrual is replay-safe. | DR claims reducer idempotency but spend isn't covered; a re-delivered Stop hook double-counts a turn's spend. | [04b §9](../04b_DATA_MODEL_ADDENDA.md), [DR §6](../DR_RUNBOOK.md) |
| **T9** | **Denormalize `cliVersion`/`baseImageRef`** onto the durable `TicketEvent` (mr/file-change types) + `SpendRecord`. | Makes the B-36 "which CLI built this MR" audit answerable from the append-only log alone, surviving `AgentSession` recycling. | [04b](../04b_DATA_MODEL_ADDENDA.md) |
| **T10** | **`runInTenant`-coverage test + delete-cascade test** — executable tests asserting (a) every background worker wraps in `runInTenant`, and (b) the ordered teardown leaks no tenant rows. | The 8-item `runInTenant` checklist is prose; the VERB_REGISTRY test makes B-23 structural but nothing makes tenancy structural. A new worker can silently skip it; a missed `TENANT_MODELS` entry leaks rows. | [TESTING_STRATEGY](../TESTING_STRATEGY.md), [MIGRATION §7](../MIGRATION.md) |

## Bucket 3 — Automation / editor safety (Lane A + D)

| T# | Fix | Why it matters | Owning doc |
|---|---|---|---|
| **T11** | **`WorkspaceTrigger` run-ledger + `automation.failed` event + dead-letter** — an append-only `TriggerRun` row (`triggerId, firedAt, outcome, error?, dedupeHit?`), a visible failed-fires lane, and an `automation.failed` event that can itself trigger a `notify`. | A failing nightly `ai:refresh-docs` is currently invisible; `run-command`/`cron` triggers have no failure trail. | [03 §1.4](../03_AUTOMATION_AND_PLUGINS.md), [10](../features/10_AUTOMATIONS_SCREEN.md) |
| **T12** | **`editor.*` / `review.*` / `pause` / `resume` trigger events** — extend `TriggerEventKind` so automations can react to the editor/review/pause/resume surface (e.g. `{on:'review.rejected', action:'notify'}`). | A whole automation category the engine currently can't see; pure additive enum + normalizer entries. | [03](../03_AUTOMATION_AND_PLUGINS.md), [10](../features/10_AUTOMATIONS_SCREEN.md) |
| **T13** | **Stale-buffer guard (`userMayEdit=true`)** — watch the worktree (the file-change stream already exists) and push a "the agent just changed this open file — reload?" toast into the VS Code session. | In concurrent-write mode VS Code silently shows a stale buffer; cheap mitigation without CRDT sync. | [CODE_EDITOR §7](../CODE_EDITOR.md) |
| **T14** | **Resume-diff size-cap + secret-scrub** — bound and sanitize the `git diff` injected into the `--resume` prompt (and into the #10 feedback record). | Feeding a raw diff into `--resume` is prompt-injection-shaped and unbounded; a large or secret-bearing diff goes straight into the model. | [CODE_EDITOR §4](../CODE_EDITOR.md) |
| **T15** | **Second golden fixture (code-stage) + render-drift canary** — write the deferred `code`-stage golden so the renderer's coverage of the write-tier, `userMayEdit`/edit-lock, and integration-tool allow-list is asserted; add a scheduled job that diffs the golden render against the *running* CLI and alerts on drift. | The one existing golden is the easiest (read-only, no-container) stage; the risky surfaces are unproven, and the §8 unverified-flag table is a one-time spike, not standing protection. | [GOLDEN_PLAN_STAGE §8](../GOLDEN_PLAN_STAGE.md) |

## Bucket 4 — Push / security hygiene (Lane B + C + D)

| T# | Fix | Why it matters | Owning doc |
|---|---|---|---|
| **T16** | **Per-workspace push scoping on `PushSubscription`** — a `mutedWorkspaceIds[]` (or per-workspace opt-in) so a multi-workspace user can silence a noisy workspace per-device. | One device subscription spans all workspaces today; no per-workspace mute. Ties directly into [#16 notif prefs](./16_notification_prefs.md). | [04b §10/§11b](../04b_DATA_MODEL_ADDENDA.md) |
| **T17** | **Admin extension allow/deny policy** — intersect the user's account-linked `editorExtensions[]` with a workspace-level allow/deny policy before rendering them into a container. | The auto-capture design follows a possibly-malicious/abandoned extension id across every ticket container with no removal/trust story. | [CODE_EDITOR §6](../CODE_EDITOR.md) |

---

## Build guidance

- These ride **with** their lane's product work — they're not a separate phase. When Lane A builds the engine, it lands T1–T5; Lane B lands T6–T10 + T16; Lane D lands T13–T15 + T17; the automation events (T11–T12) land with whichever lane owns the trigger engine.
- The metric fixes (T6, T7) are cheap and high-leverage — land them early so the system is observable while the rest is built.
- T1 (carry-over adequacy) and T2 (slot-release) are the two that most directly protect pipeline integrity and host liveness — prioritize them within Lane A.
