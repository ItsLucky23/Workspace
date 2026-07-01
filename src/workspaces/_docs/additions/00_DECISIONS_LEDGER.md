# DECISIONS_LEDGER — the interview that produced the `additions/` set

> **What this is.** On 2026-06-11 the user and the AI ran a structured "interview-mode" sparring session to generate a **new round of additions** on top of the locked Workspaces V1 design. The user had already folded every idea they personally held into the main `_docs` set with earlier AIs; this round asked the AI to **generate novel ideas** the docs didn't cover, triage them, and spec each one. This file is the verbatim decision trail so a future builder (or AI) knows *what was decided and why* without re-deriving it. Each `NN_*.md` spec in this folder links back to its row here.
>
> **Status of these additions vs. the locked spec.** The main spec set ([V1_SCOPE.md](../V1_SCOPE.md), 01–08, the feature docs) remains authoritative on everything it already covers. These additions are **net-new** — they were checked against the "already decided" map (see §0) so none re-litigates a locked decision. Where an addition proposes a **schema or contract change**, it is flagged as a *delta to reconcile* (see §4), not a silent edit to the frozen models.

---

## 0. How these ideas were vetted (so none re-pitches a locked decision)

Five parallel reader-agents digested the full corpus first:
- **Lane A/B/C/D readers** mapped what each slice already specs (COVERED), its GAPS, its WEAKNESSES, and adjacent OPPORTUNITIES.
- **A decision-log reader** built the "ALREADY DECIDED — do not re-propose" map from [REVIEW_AND_OPEN_QUESTIONS.md], [REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE.md], and [V1_SCOPE.md §4]. Key finding: **R1 + R2 are both fully resolved (2026-06-04)** — there are essentially no open *design* forks left, only the unrun P0.5 spike and tuning knobs. So every idea below targets **genuine white space or a surfaced opportunity**, never a settled fork.

The locked invariants every addition honors (non-negotiable): **B-23** (AI proposes → user accepts → the **Conductor is the only writer**); the **frozen 7+6 verb surface** (no new structured-channel verbs — every user write is a `[control-API]` op → `preApiExecute` RBAC → enqueue → Conductor); **`runInTenant`** on every orchestrator path; the **PTY-billing** invariant (interactive `claude` in node-pty only; structured output via hooks + the structured channel); LuckyStack conventions (file-based routing, function-injection, strict typing, i18n, Tailwind tokens); and **V1_SCOPE wins on scope**.

---

## 1. Packaging / process decisions (the container for this work)

| Q | Decision |
|---|---|
| Where does the output live? | A new top-level folder **inside this repo**, designed as a clean drop-in for the future Workspaces repo. |
| What is it for? | A **drop-in build-handoff folder**: the whole frontend (plug-and-play portable TSX) + all project context, so an AI can pick it up cold. |
| Consolidation of the 3 source layers (`sparring/` → `handoff/` → `src/workspaces/_docs/`)? | **Newest-wins, one clean set.** `src/workspaces/_docs` is authoritative; older layers left untouched in place (never deleted). |
| Frontend packaging | **Real TSX app only** (the older `handoff/designs` JSX prototype is NOT included). |
| Interview order | By build lane (A/B/C/D), but the AI flagged + the user accepted that the strongest new ideas are **cross-cutting**, so a thematic pass ran first. |
| Decision style | **AI recommends a default + reasoning; user picks.** |
| New-scope tagging | **Mix** — each addition tagged V1 vs HORIZON individually (§2/§3). |
| Interview depth | **Write full specs now**, sub-decisions filled with `DEFAULT — flag if wrong` markers in each doc. |
| Folder shape | `workspaces-handoff/` with `src/workspaces/` (portable app) + `src/workspaces/_docs/` (consolidated docs incl. this `additions/` set) + `server/hooks/workspacesTerminal.ts` + a top-level `README.md`. |
| Older framework-gap docs (`FRAMEWORK_GAPS`/`REMEDIATION`) | **Excluded** — the user considers those framework gaps solved. A one-line "verify framework prerequisites at install" note replaces them (see [README](../../../README.md)). |

---

## 2. The V1 additions (build these)

Each row: the locked decision + the chosen fork. Full spec in the linked doc.

| # | Addition | Lane | Locked decision |
|---|---|---|---|
| **1** | [Intake co-pilot](./01_intake_copilot.md) | C + Assistant | **Full AI co-pilot** — every ticket creation opens a conversational Assistant that interviews the user into a well-formed ticket. `DEFAULT`: graceful fallback to plain text quick-add when offline / no Assistant turn available. Create stays a `[control-API]` op (instruction=consent); duplicate detection is deterministic. |
| **2** | [Collision radar](./02_collision_radar.md) | A (+C surface) | **Warn human + inform agent.** Conductor keeps a live `file→tickets` index from hook events → board badge + auto-raised `link-tickets` suggestion to humans, AND injects "ticket DEV-X also editing this file" into the overlapping stage's context (existing read path, no new verb). No blocking. No LLM. |
| **4** | [Codebase onboarding](./04_codebase_onboarding.md) | D + A | **Generate + human-review gate.** First-index a new repo = RAG index + health report + auto-drafted starter `CLAUDE.md`/context docs, shown for human review/edit; committed only on approval (a `[control-API]` op). Pipeline doesn't run until onboarding is approved. |
| **5** | [Answer-queue triage stack](./05_answer_queue.md) | C | **All gates, oldest-blocking-first.** One cross-ticket swipe-to-answer stack of blocking needs-input AND promote/approve gates. Reuses the one-question-per-screen card model; Approve==Promote; push deep-link target; distinct TopBar gate-badge. |
| **6** | [Presence + answer-claim](./06_presence_claim.md) | C | **Soft claim + server idempotency guard.** Show who's viewing/typing/answering; anyone may submit but the first answer wins (idempotency key) and the second sees "already answered." Presence is ephemeral (Redis room set, off the seq log). |
| **7** | [Card provenance peek](./07_card_provenance_peek.md) | C | **Compact line on card + full trail in quickview.** Last-AI-decision summary derived client-side from the already-synced `TicketEvent` log. No new storage, verb, or server path. Read-only. |
| **8** | [AI vitals heartbeat](./08_ai_vitals.md) | C | **TopBar pulse + expandable panel.** Vitals = agents working · items waiting on you · €/hr burn · quota%. Sourced from product state over the per-workspace room (NOT the operator metrics stream). Each vital deep-links. |
| **9** | [Per-stage commit (keystone)](./09_per_stage_commit.md) | D + A | **Commit per stage internally, squash on final push.** Real per-stage commits on `DEV-####` give a true `stageN-1..stageN` review diff + feedback deltas; the final push squashes to one clean commit, preserving V1's push-on-approval → GitLab create-MR-URL flow. **Unlocks #10, #12, and the AIQ §5 feedback loop.** |
| **10** | [Edit-as-review-feedback](./10_edit_as_feedback.md) | D | **Auto-capture, user can exclude.** Every paused-window edit auto-persists as `PromptFeedback{aiOutput, humanCorrection}` (baseline = #9's per-stage commit); user can mark an edit "don't learn from this." Secret-scrub + size cap. Depends on #9. |
| **13** | [Real quota probe](./13_quota_probe.md) | A + B | **Authoritative gauge + admin-configurable auto-pause.** Conductor polls `claude /usage` (once per host) as the real quota reading; admin sets a threshold below which the Conductor auto-pauses NEW stage starts (running ones finish). Degrades to "quota: estimated" if the spike finds `/usage` unreliable. |
| **15** | [Palette as action surface](./15_palette_actions.md) | C | **Reuse the Assistant consent model.** ⌘K proposes `[control-API]` ops (the existing catalogue ∩ RBAC); ordinary actions fire directly, destructive/important ones require explicit confirm. No new verb; double-enforced RBAC. |
| **16** | [Notification prefs + test-push](./16_notification_prefs.md) | C + B | **Per-type × {push, in-app} matrix + test-push.** New user-keyed `NotificationPreference` model (optional `workspaceId` for per-workspace mute). Email channel + app-level quiet-hours deferred. Test-push runs the real redacted pipeline and reports delivery / iOS limits. |

---

## 3. The HORIZON additions (designed, NOT built in V1)

| # | Addition | Lane | Locked decision (shape) |
|---|---|---|---|
| **3** | [Institutional memory](./03_institutional_memory.md) | B + A | Index **Handoff + CarryOver** per-workspace as a RAG "memory" namespace; **auto-inject** relevant prior-learnings at stage start. Reuses the existing self-hosted-embeddings + `$vectorSearch` infra. (Conscious divergence: filters on `workspaceId`/live, not `commitHash`/frozen.) |
| **11** | [Scheduling: priority + next-pick](./11_scheduling_priority.md) | A + B | **Priority field + next-ticket capacity picker only.** When a slot frees, pick highest-priority-then-oldest among admissible queued work (replaces implicit FIFO). Deadlines / SLA timers / business-hours awareness were **explicitly NOT selected** — far-future. |
| **12** | [Failure forensics](./12_failure_forensics.md) | A + B | **All three facets:** deterministic cross-ticket pattern detection + auto-remediation **suggestions** (never auto-applied — B-23) + flaky-test quarantine (per-workspace list the test/review stage respects). |
| **14** | [Predictive budget / ETA](./14_predictive_budget.md) | B + C | **Both** per-ticket ETA (extend the D4 blended estimate) **and** fleet quota-exhaustion forecast (burn rate vs the #13 probe). Deterministic projections, no LLM. |

---

## 4. Tier-2 hardening (accepted — all 4 buckets)

The readers surfaced ~15 pure correctness/robustness fixes (no product judgment). All four buckets were accepted and are catalogued, mapped to their owning docs, in **[00_TIER2_HARDENING.md](./00_TIER2_HARDENING.md)**:
1. Engine/orchestrator correctness
2. Data/observability integrity
3. Automation/editor safety
4. Push/security hygiene

---

## 5. Aggregated contract & schema deltas (reconcile before/while building)

Each spec proposed (never invented) the model fields and control-API ops it needs. A future builder must fold these into the owning docs ([04b], [CONTROL_API], [02], [P0_CLI_SPIKE]) **before** the lane builds against them. Consolidated:

| From # | Proposed delta | Owning doc to update |
|---|---|---|
| 1 | `Ticket.acceptanceCriteria?`, `Ticket.intakeStatus?`; `quick-add` op payload gains those fields | [04b], [CONTROL_API] |
| 2 | `Ticket.collisionFiles` (UI projection); `normalizeWorktreePath` helper | [04b], [07b] |
| 3 | additive nullable `RagEntry` "memory namespace" delta (design-only, HORIZON) | [04b §18] |
| 4 | new `onboarding` AgentRole; `RepoHealthReport` model; `Project.onboardingState`; `InfoDoc.status += 'drafted'`; 2 control-API ops (draft-onboarding, approve-onboarding) | [04b], [03], [CONTROL_API] |
| 5 | `AnswerQueueItem` read-view (a `QuestionSet` projection in `types.ts`, like `NotificationItem`) | `types.ts` only |
| 6 | `QuestionSet.answeredBy` (closes the [04b §14] provenance gap); `ws-ai:presence` event | [04b], [02] |
| 5 + 6 | **Reconciliation item:** answering a QuestionSet is **not** in the [CONTROL_API §8] catalogue today — it rides the `ws-ai:reply` socket, but [CLIENT_AND_PUSH §6] also calls it `[control-API]`. Standardize: add an `answer-questionset` row OR formally bless the socket path. **Flag for the user.** | [CONTROL_API] / [02] |
| 9 | squash-on-push mechanics (no model delta; uses existing `commitHash`/`CarryOver`) | [GIT_STRATEGY] |
| 10 | `PromptFeedback.excludedFromLearning`, `PromptFeedback.source`; `feedback-exclude` op | [04b]/[AIQ §5], [CONTROL_API] |
| 11 | `Ticket.priority` enum; `set-priority` op; `'priority'` `TicketSortKey` (HORIZON) | [04b], [CONTROL_API] |
| 12 | `FailureCluster`/`FailureSignature`, `TestQuarantine`/`quarantinedTestIds`; `quarantine-add`/`-release` ops (design-only, HORIZON) | [04b §18], [CONTROL_API] |
| 13 | `P0_CLI_SPIKE` delta: a "machine-parseable `/usage`" verification row (gates the authoritative gauge) | [P0_CLI_SPIKE] |
| 16 | `NotificationPreference` model (user-keyed, optional `workspaceId`); `notif-prefs-save`, `notif-test-push` ops. **Note:** the real [04b §10] `Notification` has **no** `channels` column — routing lives on the new model. | [04b §10/§11b], [CONTROL_API] |

> **Build rule (unchanged from root `CLAUDE.md` Rule 21):** if a generated type fails because a delta above isn't merged yet, **add the field/op to its owning doc + regenerate** — never cast around it. These are deltas to *land*, not to *paper over*.

---

## 6. Cross-addition dependency map

- **#9 (per-stage commit) is the keystone** → unlocks **#10** (feedback baseline), **#12** (per-stage forensics signal), and the AIQ §5 feedback loop. Build #9 first in Lane D/A.
- **#5 (answer-queue)** and **#6 (presence/claim)** share the QuestionSet-answer path + the idempotency guard — build together.
- **#8 (vitals)** reads **#5**'s blocking-gate count, **#13**'s quota%, and SpendRecord burn — build after #5/#13 land their data.
- **#13 (quota probe)** feeds **#8** and **#14**, and shares the auto-pause path with **#11**.
- **#16 (notif prefs)** ties to the Tier-2 "per-workspace push scoping" delta.

---

## 7. Open items to flag to the user

1. **QuestionSet-answer write path** — control-API vs `ws-ai:reply` socket inconsistency (§5). Needs a one-line ruling.
2. **#1 intake co-pilot cost** — full AI co-pilot spends a subscription turn per ticket creation; the offline fallback is a `DEFAULT`, confirm it.
3. **Each spec's `DEFAULT — flag if wrong` markers** — these are the AI's sub-decisions; skim them in the V1 docs and override any.
