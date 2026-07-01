# `additions/` — the 2026-06-11 new-ideas round (INDEX)

> **Read this after [V1_SCOPE.md](../V1_SCOPE.md) and [BUILD_HANDOFF.md](../BUILD_HANDOFF.md).** This folder is a **net-new round of additions** generated in an interview-mode sparring session on 2026-06-11 — ideas the main doc set didn't already cover. Each was vetted against the "already decided" map so **none re-litigates a locked decision**, and each honors the same invariants (B-23 Conductor-only-writer · frozen verb surface · `runInTenant` · PTY-billing · V1_SCOPE-wins).
>
> **Precedence:** the main docs still govern everything they already cover. These additions either fill genuine white space or productionize a surfaced opportunity. Where one needs a schema/contract change it is a **delta to reconcile** ([DECISIONS_LEDGER §5](./00_DECISIONS_LEDGER.md)), not a silent edit to the frozen models.

---

## Start here

| Doc | Purpose |
|---|---|
| **[00_DECISIONS_LEDGER.md](./00_DECISIONS_LEDGER.md)** | The full interview trail: every decision + chosen fork, the aggregated contract/schema deltas, the dependency map, and the open items to flag. **Read first.** |
| **[00_TIER2_HARDENING.md](./00_TIER2_HARDENING.md)** | ~15 pure correctness/robustness fixes (no product judgment), each mapped to its owning doc. |
| This INDEX | The per-addition map + the V1/HORIZON split + the lane assignment + the build order. |

---

## The V1 additions (build these)

| # | Addition | Lane | One-line |
|---|---|---|---|
| 1 | [Intake co-pilot](./01_intake_copilot.md) | C + Assistant | Conversational AI ticket-authoring at creation time (fallback to plain quick-add offline). |
| 2 | [Collision radar](./02_collision_radar.md) | A (+C) | Live `file→tickets` index → warn humans + inform the overlapping agent. No LLM. |
| 4 | [Codebase onboarding](./04_codebase_onboarding.md) | D + A | First-index a new repo: health report + auto-drafted context docs behind a human-review gate. |
| 5 | [Answer-queue triage stack](./05_answer_queue.md) | C | One cross-ticket swipe-to-answer stack of everything the AI is waiting on. |
| 6 | [Presence + answer-claim](./06_presence_claim.md) | C | Who's viewing/typing/answering; soft claim + idempotency guard so two people don't race. |
| 7 | [Card provenance peek](./07_card_provenance_peek.md) | C | "Why is this card here?" — last AI decision on the card + full trail in quickview. |
| 8 | [AI vitals heartbeat](./08_ai_vitals.md) | C | TopBar pulse: working · waiting-on-you · €/hr · quota% — product state, not operator metrics. |
| 9 | [Per-stage commit (keystone)](./09_per_stage_commit.md) | D + A | Commit per stage internally, squash on push → real incremental review + feedback deltas. |
| 10 | [Edit-as-review-feedback](./10_edit_as_feedback.md) | D | Auto-capture in-editor human edits as PromptFeedback (depends on #9). |
| 13 | [Real quota probe](./13_quota_probe.md) | A + B | Poll `claude /usage` as authoritative quota → vitals + admin-configurable auto-pause. |
| 15 | [Palette as action surface](./15_palette_actions.md) | C | ⌘K proposes control-API ops (consent model, confirm-on-important). No new verb. |
| 16 | [Notification prefs + test-push](./16_notification_prefs.md) | C + B | Per-type × {push, in-app} matrix + a test that verifies the fragile iOS push chain. |

## The HORIZON additions (designed, deferred — build in a future lane)

| # | Addition | Lane | One-line |
|---|---|---|---|
| 3 | [Institutional memory](./03_institutional_memory.md) | B + A | Index Handoff/CarryOver as RAG; auto-inject prior learnings at stage start. |
| 11 | [Scheduling: priority + next-pick](./11_scheduling_priority.md) | A + B | Ticket priority + a capacity scheduler that picks highest-priority-then-oldest. |
| 12 | [Failure forensics](./12_failure_forensics.md) | A + B | Cross-ticket pattern detection + remediation *suggestions* + flaky-test quarantine. |
| 14 | [Predictive budget / ETA](./14_predictive_budget.md) | B + C | Per-ticket ETA + fleet quota-exhaustion forecast (deterministic). |

---

## Which lane builds what (maps onto [V1_SCOPE §6] A/B/C/D)

- **Lane A — Engine/Orchestrator:** 2 (index), 9 (commit/squash), 11, 12, 13 (probe/auto-pause).
- **Lane B — Data/tenancy/sync:** 3, 11, 12, 13, 14, 16 (NotificationPreference).
- **Lane C — Frontend/realtime:** 1, 5, 6, 7, 8, 15, 16 (matrix UI), and the surface of 2.
- **Lane D — Editor/changes/config:** 4 (review surface), 9 (per-stage review), 10 (feedback capture).

## Build order (the keystone first)

1. **#9 per-stage commit** — keystone; unlocks #10, #12, and the AIQ feedback loop.
2. **#2 collision radar** + **#13 quota probe** — cheap, high-leverage, mostly deterministic.
3. **#5 answer-queue** + **#6 presence/claim** — shared QuestionSet-answer path; build together.
4. **#1 intake co-pilot**, **#4 onboarding** — author/onboard surfaces.
5. **#7 peek**, **#8 vitals**, **#15 palette**, **#16 notif prefs** — UI surfaces over already-synced state.
6. **HORIZON (#3, #11, #12, #14)** — when their lanes open.

---

## Before a lane starts: land its deltas

Every addition that needs a new field or op **proposed** it rather than inventing — see **[DECISIONS_LEDGER §5](./00_DECISIONS_LEDGER.md)** for the consolidated table. Fold the relevant rows into [04b_DATA_MODEL_ADDENDA.md](../04b_DATA_MODEL_ADDENDA.md) / [CONTROL_API.md](../CONTROL_API.md) / [02_PROTOCOL_AND_FLOW.md](../02_PROTOCOL_AND_FLOW.md) / [P0_CLI_SPIKE.md](../P0_CLI_SPIKE.md) **first**, then build against the regenerated types (root `CLAUDE.md` Rule 21 — never cast around a missing delta).

## Open items to flag (from DECISIONS_LEDGER §7)

1. **QuestionSet-answer write path** — control-API vs `ws-ai:reply` socket inconsistency; needs a one-line ruling.
2. **#1 intake cost** — a subscription turn per ticket creation; confirm the offline fallback `DEFAULT`.
3. Skim each spec's **`DEFAULT — flag if wrong`** markers and override any.
