# Trust & Safety UX — the controls that make an autonomous AI dev system trustworthy

> **⚑ V1 SCOPE:** per-stage proceed-or-gate + the changes-page edit-lock are IN for V1; the auto-merge end of the autonomy spectrum (full-auto-merge) and the AuditEntry rollback surface are DEFERRED — see [V1_SCOPE.md] §4. Read [V1_SCOPE.md] first.

> The human-facing trust surface over the locked engine: a **dry-run / shadow mode** (the AI produces the full plan + diff but the Conductor does NOT execute until a human *promotes*), **rollback / revert** of a merged AI change, an **immutable audit trail** (who approved / merged / killed / promoted what — distinct from the activity feed), and **per-workspace autonomy levels** (full-auto ↔ gate-every-stage). None of these adds engine surface: every one rides B-23 (AI proposes → human accepts → Conductor executes — the only writer), the frozen 7+6 verb surface, and `[control-API]` as the sole human write path. Cites architecture as `[01 §x]`…`[07 §x]`, `[07b]`, `[02b §x]`, `[CONTROL_API §x]`, `[04b §x]`, `[FORGE_ABSTRACTION §x]`; codes via [REFERENCE_CODES]; carries `Q-TRUST-*` ids inline. Last updated: 2026-06-04.
>
> **No new verbs.** This doc introduces **zero** structured-channel verbs. The frozen surface ([02 §2]: 7 worker + 6 assistant, all `read|propose`, none write) is untouched. Every trust control is either (a) a *read/projection* over already-persisted rows (audit, dry-run preview), or (b) a **[control-API] route → `preApiExecute` RBAC → enqueue a `WorkspaceSignal` → the single-instance Conductor (the only writer, [01 §3.3])**. The trust controls *gate* and *record* Conductor writes; they never add a write path around the Conductor.

---

## 0. One-paragraph summary

An autonomous AI dev system earns trust not by being correct, but by being **legible, reversible, and gateable**. The locked architecture already supplies the spine: B-23 makes every AI session **propose-only** ([02b §A], [02 §7]) — a worker `emit_carryover`s a diff + a `commitHash`, it never merges or sets status; the Conductor is the sole writer ([01 §3.3]); and the human's accept/promote/kill are `[control-API]` requests ([CONTROL_API]). This doc names four trust controls that **compose over** that spine without widening it: **(1) Dry-run / shadow mode** — leverage the fact that *every* stage is already propose-only, and add a per-workspace/per-stage **promotion gate** so the AI builds the full plan + diff but the Conductor withholds the irreversible side-effects (push / open-MR / merge / preview-up) until a human promotes; **(2) Rollback / revert** of a merged AI change — a forward `git revert` + a new ticket, a Conductor action behind `[control-API]`, riding `[FORGE_ABSTRACTION §7.2]`'s `MergeRequest` + the [07_CODE_CHANGES_REVIEW] review surface; **(3) Audit trail** — an **immutable, append-only `AuditEntry` projection** of the *decision* events (who approved / merged / killed / promoted / changed-autonomy), distinct from the [20] activity feed (which narrates *what the agent did*); **(4) Per-workspace autonomy levels** — a `Workspace.autonomyLevel` that picks, per stage class, whether `stage.on_approval` auto-promotes ([03 §1]) or holds at `done` for a human gate ([07_CODE_CHANGES_REVIEW]). All four are the same B-23 boundary tuned by configuration, never a new mechanism.

---

## 1. What this doc does NOT change (the trust spine it builds on)

These are already-locked and are the load-bearing reason the four controls need no engine surface:

| Spine invariant | Where | Why it already gives us trust-by-construction |
|---|---|---|
| **B-23: AI proposes → human accepts → Conductor executes** | [02b §A], [02 §7], [01 §4] | Every AI write is *already* a proposal an LLM cannot execute. Dry-run is not a new "don't execute" mode — it is the **default** the architecture already enforces; what this doc adds is *when the human promotion is required vs auto*. |
| **The Conductor is the only writer** | [01 §3.3], [CONTROL_API §7] | Rollback, autonomy-flips, and the gate are all Conductor actions. No trust control writes state directly — they enqueue a `WorkspaceSignal` and the Conductor writes. |
| **Frozen 7+6 verb surface, all `read\|propose`, none write** | [02 §2], [02b §D] `VERB_REGISTRY` | The `VerbTag` union has **no `write` member** ([02b §D.1]) — an agent *structurally cannot* merge, push, or self-promote. The trust controls never need to "lock down" a verb because no write verb exists to lock down. |
| **`[control-API]` = the single human write transport** | [CONTROL_API] | Every trust lever (promote, rollback, set-autonomy, override-gate) is a row in the [CONTROL_API §8] catalogue — `preApiExecute` RBAC → enqueue → Conductor. No bespoke transport. |
| **Append-only `TicketEvent` log + merge-on-`seq`** | [04b §6], [20], B-21/B-22 | The audit trail is a **derived projection** of already-persisted Conductor-written rows + `[control-API]` `signalSeq` ([CONTROL_API §6.2]); it needs no new write path, only a new *read* lens. |
| **`runInTenant` on every orchestrator path** | [04b §11c], B-O8, `Q-SEC-RUNINTENANT` | Audit reads, rollback writes, and autonomy reconciles are all tenant-scoped; the trust surface is per-workspace by construction. |

**Implication:** the trust controls are a **UX + configuration + projection** layer. The only net-new persisted shapes are an `AuditEntry` projection (§4) and a `Workspace.autonomyLevel` enum + an optional per-stage override (§5). Everything else reuses existing rows.

---

## 2. Dry-run / shadow mode — the full plan + diff, withheld until a human promotes (`Q-TRUST-DRYRUN`)

### 2.1 The insight: dry-run is the architecture's *default*, not a bolt-on

The naive ask ("add a dry-run mode where the AI proposes but doesn't execute") is **already true of every stage**. Per [02b §A] / [02 §7], a Stage-Agent's *only* terminal output is `emit_carryover` — a `{ summary, changedFiles[], openQuestions[], commitHash }` envelope ([02 §4]). It commits to its **worktree** ([07 §A]) but it **never pushes, never opens an MR, never sets `Ticket.status`, never merges** — all of those are Conductor actions a human triggers via `[control-API]` (promote / `mr-open` / `mr-merge`, [CONTROL_API §8], [FORGE_ABSTRACTION §7.2]). So the diff already exists, frozen at a `commitHash` (DH5), reviewable in [07_CODE_CHANGES_REVIEW], **before any irreversible side-effect**.

What "dry-run / shadow mode" *adds* is therefore narrow and precise: a **promotion gate** that withholds the **irreversible / externally-visible** side-effects of a completed stage until a human promotes, and a **SHADOW marker** on the surfaces so the human can tell "this is a proposal awaiting promotion" from "this is live."

### 2.2 What is reversible-by-default vs what the gate withholds

| Stage side-effect | Reversible? | Gate behaviour in shadow mode |
|---|---|---|
| Commit to the **worktree** (the agent's edits) | Yes — local to the disposable worktree ([07 §A]); thrown away on kill | **Always allowed** — this IS the proposed diff; shadow mode needs it to exist to show it. |
| Set `Ticket.status` / write `TicketEvent` / `CarryOver` | Yes — board-local state, AI-owned ([01 §3.3]) | **Always allowed** — the `done` state is what surfaces the promote gate. |
| **Push** `DEV-####` to the remote / bare repo ([FORGE_ABSTRACTION §3] `repoHosting.push`) | Hard to reverse (external history) | **Withheld until promote** (shadow). |
| **Open an MR** ([FORGE_ABSTRACTION §7.2] `mr-open`) | Externally visible | **Withheld until promote** (shadow). |
| **Merge** an MR (`mr-merge`) | The irreversible one — see §3 rollback | **Always gated** — never auto in shadow; the highest-trust gate. |
| **preview-up** ([23], [CONTROL_API §8]) | Reversible (`preview-down`) but resource-spending + externally reachable | **Withheld until promote** in shadow; auto in full-auto. |

So **shadow mode = "let the agent produce + commit + report the full plan and diff; hold every *externally-visible or spending* side-effect at a human promotion gate."** It is the [07_CODE_CHANGES_REVIEW] `done → review → promote` loop, made the **mandatory** path (no `stage.on_approval` auto-advance, [03 §1]) and surfaced with a SHADOW marker.

### 2.3 How it composes (no new mechanism)

- **The gate IS the existing promote gate.** [07_CODE_CHANGES_REVIEW] already surfaces **Approve == Promote** at `(stage, done)` and **Reject re-opens the stage** (`done → busy`, `--resume` with the reject note). Shadow mode simply forces that gate on (disables any `stage.on_approval → start-stage` auto-promote, [03 §1]) — which is exactly the **`gate-every-stage` autonomy level** (§5). *Dry-run / shadow mode is the UX name for the most cautious autonomy level applied to a single run.*
- **The SHADOW marker is a render flag, not a state.** A stage in shadow surfaces a `warning`-toned **"SHADOW — proposal, not yet promoted"** chip on the ticket card, the [07] review header, and the [20] activity row. It is derived from `(autonomyLevel gates this stage) ∧ (stage.status==='done') ∧ (not yet promoted)` — no persisted field beyond the autonomy config (§5).
- **A *whole-ticket* dry-run** ("plan the entire pipeline but execute nothing") = a ticket run at `autonomyLevel='gate-every-stage'`: each stage completes, proposes its diff, and holds; the human walks the plan stage-by-stage in [07_CODE_CHANGES_REVIEW] and the [20] rewind scrubber. There is **no separate "dry-run engine"** — it is the cautious autonomy level (§5) plus the shadow marker.
- **Promotion is a `[control-API]` op.** Promoting a shadowed stage = the existing promote path (the Conductor carries A→B and/or fires the withheld side-effect). No new verb; no new write path. The AI never promotes itself ([02b §D] — no write verb exists).

### 2.4 `Q-TRUST-DRYRUN` (open question)

> **Is "shadow mode" a distinct first-class concept, or purely the `gate-every-stage` autonomy level (§5) named for a single run?**
> **Recommendation: purely the autonomy level + a SHADOW render marker — do NOT add a separate `Ticket.dryRun` boolean or a parallel execution path.** Rationale: the architecture is *already* propose-only; a separate dry-run path would duplicate the promote gate and risk two code paths drifting (the [00_SPEC_RECONCILIATION] anti-pattern). A per-run override ("run *this* ticket in shadow even though the workspace is full-auto") is then just a per-ticket autonomy override (§5.3), not a new subsystem.
> **Options:** (a) **[recommended]** shadow = `gate-every-stage` (workspace or per-ticket) + a render marker, zero new persisted field beyond autonomy; (b) a per-ticket `Ticket.dryRun` boolean that forces the gate for that ticket only (one extra field, slightly more discoverable, mild duplication risk); (c) a full parallel "plan-only, never touch a worktree" mode (rejected — the worktree commit IS the proposed diff; without it there is nothing to review).

**No new verbs.** Shadow mode reuses `emit_carryover` (the diff source), the [07] promote gate, and `[control-API]` promote. Nothing is added.

---

## 3. Rollback / revert of a merged AI change (`Q-TRUST-ROLLBACK`)

### 3.1 The one truly irreversible step is *merge* — so rollback targets it

Everything before merge is reversible by killing the ticket (the worktree + branch are disposable, [24] kill, [07 §A] teardown). The trust-critical case is **after** a merge has landed AI-authored code on the default branch. Rollback must therefore operate at the **`MergeRequest`** + git layer ([FORGE_ABSTRACTION §7.2]).

### 3.2 Forward-revert, not history rewrite (recommended)

**Recommendation (`Q-TRUST-ROLLBACK`): rollback = a forward `git revert` of the merge, materialized as a new auto-created ticket + MR — never a force-push / history rewrite.** A `git revert <mergeCommit>` (or revert-of-merge with `-m 1`) produces a **new commit that undoes the change** while preserving history. This is:

- **Forge-agnostic** — it is a `repoHosting` + `mergeRequests` operation ([FORGE_ABSTRACTION §3]) that works identically in GitLab / GitHub / built-in mode (the Conductor calls `forge.repoHosting`/`forge.mergeRequests`; the merge that re-lands the revert emits the same normalized `ForgeEvent`, [FORGE_ABSTRACTION §7.2]).
- **Safe under the single-instance lease** — the revert is a Conductor git write under `lease:orchestrator` (G8/G16), serialized like every other git write ([07 §A]).
- **Auditable** — the revert is its own `MergeRequest` row + `AuditEntry` (§4), so "we rolled back !88" is permanent record, not a vanished commit.
- **Non-destructive to other work** — a force-push would orphan everyone's branches pulled from the default; a revert never does.

### 3.3 The flow (every step a Conductor action behind `[control-API]`)

```
Human opens a merged MR in the review surface ([07_CODE_CHANGES_REVIEW] / the MR doc) →
  presses "Revert this merge"  (RBAC: Admin+, §3.5)
    → [control-API] op `mr-revert { mergeRequestId }`         // NEW catalogue row, §3.4
    → preApiExecute RBAC → enqueue WorkspaceSignal → Conductor:
        1. forge.repoHosting: create revert branch `revert-DEV-####` off default
        2. git revert -m 1 <mergeCommit>  (under lease, runInTenant)
        3. forge.mergeRequests.open(revert branch → default)  → a new MergeRequest row
        4. materialize a tracking Ticket (DEV-####, [CONTROL_API §9] direct creation) so the
           revert is a first-class board item with its own review + merge gate
        5. append AuditEntry{ action:'revert', actor, targetMr, newMr } (§4)
    → ws-ai:* confirmation at the next seq → optimistic "reverting…" reconciles (CONTROL_API §6.3)
  → the revert MR is itself reviewed + merged through the NORMAL gate (it is not auto-merged —
    a revert is a code change like any other; §2.2 "merge is always gated").
```

The revert is **not** auto-merged: even undoing a change goes through the human merge gate ([FORGE_ABSTRACTION §7.2] — "the AI never merges"). The only thing the AI might do is `propose_suggestion("this merge broke CI — consider reverting")` ([02 §2]) which a human accepts ([CONTROL_API §4] bridge) — the AI never reverts on its own.

### 3.4 Catalogue additions (rows in [CONTROL_API §8], not verbs)

| `op` | Target | RBAC | Conductor action | Owning doc |
|---|---|---|---|---|
| `mr-revert` | `{ mergeRequestId }` | **Admin+** (`Q-TRUST-ROLLBACK-RBAC`, §3.5) | revert-of-merge → new branch + MR + tracking ticket + `AuditEntry` | this doc + the MR doc |
| `set-autonomy` | `{ workspaceId, level }` / `{ ticketId, level }` | **Admin+** (§5.4) | persist `Workspace.autonomyLevel` / per-ticket override + `AuditEntry` | this doc |

Both are ordinary [CONTROL_API §8] rows — `preApiExecute` RBAC → enqueue → Conductor. **No new verbs.**

### 3.5 `Q-TRUST-ROLLBACK` + `Q-TRUST-ROLLBACK-RBAC` (open questions)

> **`Q-TRUST-ROLLBACK` — revert strategy: forward-revert vs history-rewrite vs branch-reset?**
> **Recommendation: forward `git revert` → new MR + tracking ticket, merged through the normal gate.** Rationale above (§3.2): non-destructive, forge-agnostic, auditable. Options: (a) **[recommended]** forward revert-of-merge; (b) `git reset --hard` + force-push (rejected — destroys others' pulled history, violates the "no force-push" posture of the [01 §3.3] writer model); (c) a "revert range" picker for multi-MR rollback (a P2 extension on top of (a) — defer).
>
> **`Q-TRUST-ROLLBACK-RBAC` — who may revert a merged AI change?**
> **Recommendation: Admin+** (same tier as `kill` / `mr-merge` in [CONTROL_API §8] / [FORGE_ABSTRACTION §7.2]). Reverting default-branch history is at least as consequential as merging. Options: (a) **[recommended]** Admin+; (b) "work on tickets" (rejected — too broad for a default-branch mutation); (c) Admin+ **and** requires the revert MR to clear the same approval count as the original merge (a stricter P2 policy — defer behind (a)).

**No new verbs.** Rollback is `mr-revert` ([control-API]) + a Conductor git write + the existing review/merge gate; the AI's only participation is the existing `propose_suggestion`.

---

## 4. The audit trail — immutable record of *decisions*, distinct from the activity feed (`Q-TRUST-AUDIT`)

### 4.1 Why it is NOT the activity feed

[20_ACTIVITY_AND_EVENT_LOG] already renders the **`TicketEvent`** stream: *what the agent did* — commands, file-changes, ai-messages, status moves, MRs ([04b §6], `EVENT_TINT`). That is the **operational narrative**. The audit trail answers a different, **trust** question: ***who decided what, and when*** — who approved a stage, who merged an MR, who killed a ticket, who promoted a shadowed change, who raised the budget cap, who changed the autonomy level, who reverted a merge. These are **human-decision** facts, and for trust they must be:

- **Immutable + append-only** — never edited, never deleted, no mark-read mutation (unlike [18] notifications).
- **Attributed** — every entry names the **human actor** (the `[control-API]` caller's `userId`, resolved at `preApiExecute`, [CONTROL_API §5]) or `SYSTEM` for Conductor-automatic actions (B-35 auto-pause, the [02b §B] escalation).
- **Separable + exportable** — a compliance/forensic lens, filterable to *decisions only*, distinct from the noisy operational feed.

### 4.2 It is a projection of already-persisted facts (minimal new storage)

The audit entries are **derived from rows the system already writes**: every `[control-API]` request already carries a `userId` (the authenticated caller, [CONTROL_API §5]), an `op`, a `target`, and lands at a `signalSeq` ([CONTROL_API §6.2]); the Conductor already writes the resulting state at a `seq`. The audit trail is the **decision-bearing subset** of those, captured as an explicit append-only `AuditEntry` so it cannot be reconstructed-away or lost in `TicketEvent` coalescing (B-21 coalesces operational events; **audit entries are never coalesced**).

```prisma
// Append-only, immutable. Written ONLY by the Conductor as a side-effect of executing a
// decision-bearing [control-API] op (or a SYSTEM auto-action). Never updated, never deleted.
model AuditEntry {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId               // tenant; runInTenant-scoped
  seq         Int                                  // monotonic per-workspace (Redis INCR, [01 §5]) — ordering + catch-up
  actorId     String?  @db.ObjectId               // the human who decided (null ⇒ SYSTEM)
  actorKind   String                               // 'user' | 'system'  (system = B-35 auto-pause, [02b §B] escalation)
  action      String                               // 'approve' | 'promote' | 'merge' | 'revert' | 'kill' | 'pause' |
                                                   //   'pause-all' | 'raise-cap' | 'set-autonomy' | 'change-role' |
                                                   //   'remove-member' | 'transfer-ownership' | 'accept-suggestion'
  target      Json                                 // { ticketId? , mergeRequestId? , memberId? , stageId? , … }
  detail      Json?                                // op-specific: { fromLevel, toLevel } | { newCap } | { rejectNote } | …
  signalSeq   Int?                                 // the [control-API] signalSeq this decision came in on (CONTROL_API §6.2)
  controlReqId String?                             // the clientRequestId for idempotency cross-ref (CONTROL_API §6.4)
  createdAt   DateTime @default(now())

  @@index([workspaceId, seq])
  @@index([workspaceId, action])
}
```

- **Which ops write an audit entry:** the **decision-bearing** subset of the [CONTROL_API §8] catalogue — `approve`/promote, `mr-merge`, `mr-revert`, `kill`, `pause`/`pause-all`, `raise-cap`/`edit-budget`, `set-autonomy`, `change-role`/`remove-member`/`transfer-ownership`/`delete-workspace`, `accept-suggestion`. Pure read ops, `mark-read`, and high-frequency operational events ([20]) do **not** — they would drown the trust signal. (`Q-TRUST-AUDIT-SCOPE`, §4.5.)
- **Immutability is enforced structurally:** there is **no `[control-API]` op that mutates an `AuditEntry`** — the catalogue ([CONTROL_API §8]) simply does not contain one, exactly as the [02b §D] `VerbTag` union has no `write` member. Append is the only operation. A DB-level rule (no update/delete grant on the collection for the app's `mongo:rw` tier, B-O8) backstops it.

### 4.3 The surface

- **A dedicated "Audit" view** (workspace-scoped, Admin+ visibility — `Q-TRUST-AUDIT-RBAC`, §4.5): a chronological, **filter-by-action / filter-by-actor** table, each row deep-linking (D65 `navigate({...})`) to the ticket/MR/member it concerns. It reuses [20]'s timeline shell + the B-22 **subscribe-first → snapshot → merge-on-`seq`** catch-up (the `AuditEntry.seq` is the merge key), so the audit view is live + reconnect-safe with zero new realtime plumbing.
- **An "Export" affordance** (the [20] "exporting the log is later" deferral, realized here for audit specifically since compliance needs it): a CSV/JSON dump of the `AuditEntry` rows for a date range. Read-only, Admin+.
- **Distinct tint from activity:** audit rows use a single sober tone (no per-action rainbow) to read as a ledger, not a feed.

### 4.4 What it gives the 5-person team

For the killer-feature MR workflow ([FORGE_ABSTRACTION §7.2]) the audit trail is the answer to *"who approved the merge that broke prod?"* and *"when did we switch this workspace to full-auto, and who?"* — questions the operational [20] feed cannot answer cleanly because it interleaves agent narration with human decisions. The audit trail is the **accountability layer** an autonomous system needs before a team will trust it with `set-autonomy='full-auto'`.

### 4.5 `Q-TRUST-AUDIT`, `Q-TRUST-AUDIT-SCOPE`, `Q-TRUST-AUDIT-RBAC` (open questions)

> **`Q-TRUST-AUDIT` — dedicated `AuditEntry` row, or a typed filter over `TicketEvent`?**
> **Recommendation: a dedicated append-only `AuditEntry` projection.** Rationale: `TicketEvent` is coalesced (B-21) and operational; decisions must be **never-coalesced, immutable, attributed, and exportable** — a filter over a coalescing log cannot guarantee that. The extra model is cheap (it is written as a Conductor side-effect of ops that already run). Options: (a) **[recommended]** dedicated `AuditEntry`; (b) a `TicketEvent` subtype + an "audit" filter (rejected — coalescing + the shared mutation surface weaken the immutability guarantee); (c) write *both* (the `TicketEvent` for the feed, the `AuditEntry` for the ledger) — partially true already since the Conductor writes the operational event regardless; the recommendation is that the **ledger** is its own row.
>
> **`Q-TRUST-AUDIT-SCOPE` — which ops are audited?**
> **Recommendation: the decision-bearing subset only** (§4.2 list) — never read ops, `mark-read`, or operational hooks. Keeps the ledger high-signal. Options: (a) **[recommended]** decision-bearing subset; (b) every `[control-API]` write op (noisier, includes bulk-move spam); (c) configurable per-workspace audit policy (a P2 over-engineering — defer).
>
> **`Q-TRUST-AUDIT-RBAC` — who can read the audit trail?**
> **Recommendation: Admin+** (it exposes who-did-what across all members). Options: (a) **[recommended]** Admin+; (b) all members can see their own entries + Admins see all (a reasonable P2 refinement); (c) Owner-only (too narrow for a 5-person team).

**No new verbs.** The audit trail is a projection written by the Conductor as a side-effect of existing [control-API] ops; reading/exporting it is a read `_api`, never a verb. There is deliberately **no op to mutate it** (immutability by absence).

---

## 5. Per-workspace autonomy levels — full-auto ↔ gate-every-stage (`Q-TRUST-AUTONOMY`)

### 5.1 The dial

Trust is not binary. A team starting out wants to gate every stage; a team that has come to trust the pipeline on a low-risk repo wants it to run end-to-end. The dial is a per-workspace `Workspace.autonomyLevel` that the **promote gate** ([07_CODE_CHANGES_REVIEW]) and the **`stage.on_approval` trigger** ([03 §1]) both branch on:

| `autonomyLevel` | `stage.on_approval` auto-promote? | Externally-visible side-effects (push / mr-open / preview-up) | Merge | Shadow marker (§2) |
|---|---|---|---|---|
| **`gate-every-stage`** (most cautious — = full dry-run, §2) | **Off** — every stage holds at `done` for a human promote | Withheld until per-stage promote | Always human-gated | Shown on every `done` stage |
| **`gate-key-stages`** (default, recommended) | Auto for low-risk stages (refine/design); **off** for code/build stages | Withheld until promote on code/build stages | Always human-gated | Shown on gated stages only |
| **`full-auto`** | **On** — stages auto-advance through the pipeline | Fired automatically as each stage completes | **STILL human-gated** (the one floor, §5.2) | Not shown (nothing held except merge) |
| **`full-auto-merge`** (V1: OUT — deferred with the MR entity, see V1_SCOPE §4) | **On** — stages auto-advance through the pipeline | Fired automatically as each stage completes | **Auto** — pipeline advances AND the Conductor auto-fires `mr-merge` on green CI; gated by passing required CI + Admin+ to enable | Not shown (nothing held) |

> **DECISION 2026-06-04 (user — overrides the §5.5 `Q-TRUST-AUTOMERGE` "no for v1" recommendation):** auto-merge **IS a first-class, configurable v1 option.** The user wants the FULL spectrum configurable — from approving literally every stage, to "100% vibe-coded sites, lightning fast." Add a fourth level **`full-auto-merge`** (the pipeline advances AND the Conductor auto-fires `mr-merge` on a green-CI MR without a human gate). It is gated by: passing required CI (`Q-CI-MERGE-GATE`), the approval rule (which may be set to `minApprovals:0`), and RBAC (enabling auto-merge / setting this level = **Admin+**; a Member can never loosen). **The default stays `gate-key-stages`** and the human-merge floor below is the **default**, not an absolute — auto-merge is an explicit opt-in, never the out-of-the-box behaviour. Folds into: the §5.1 table (a `full-auto-merge` row), the `Workspace.autonomyLevel` enum (+`'full-auto-merge'`), and the auto-merge path in [BUILTIN_MR_REVIEW]/[GIT_STRATEGY] (Conductor fires `mr-merge` when CI is green and the level is `full-auto-merge`). Read §5.2 below as "the default floor".

### 5.2 The default floor: **merge is human-gated unless `full-auto-merge` is explicitly enabled**

Even at `full-auto`, **a human still merges** ([FORGE_ABSTRACTION §7.2] — "the AI never merges (B-23)"). `full-auto` means the pipeline *advances itself to a mergeable MR* without per-stage babysitting; it does **not** mean the AI lands code on the default branch. This is the line that keeps `full-auto` trustworthy: the worst case of a runaway pipeline is *an MR sitting open*, never *unreviewed code in production*. (A future `Q-TRUST-AUTOMERGE` could let a team opt into auto-merge on green CI for trivial stages — recorded below as a deliberate **non-default** so the floor is explicit, not accidental.)

### 5.3 Per-stage + per-ticket overrides

- **Per-stage class** is the natural granularity (matching DH5 stage/status shape, [04b]): `gate-key-stages` gates *code/build* stages and auto-advances *refine/design*. The mapping (which stage classes are "key") is a workspace config, defaulting to "gate any stage that produces a `commitHash` diff" (i.e. any stage with code output → [07_CODE_CHANGES_REVIEW] applies).
- **Per-ticket override** realizes the §2.4 "run *this* ticket in shadow" ask: a `Ticket.autonomyOverride?` that tightens (never loosens beyond Admin) the workspace level for one ticket — e.g. a workspace on `full-auto` runs a risky migration ticket at `gate-every-stage`. The override is set via `set-autonomy { ticketId, level }` ([CONTROL_API §8], §3.4).
- **Tightening is always allowed; loosening is Admin+.** A Member can make a ticket *more* cautious than the workspace default; only Admin+ can set a workspace or ticket to a *less* gated level than the workspace default (`Q-TRUST-AUTONOMY-RBAC`, §5.5).

### 5.4 Data + control

```prisma
// Addition to Workspace (tenant root).
// Workspace.autonomyLevel: 'gate-every-stage' | 'gate-key-stages' | 'full-auto' | 'full-auto-merge'  @default("gate-key-stages")
//   'full-auto-merge' (V1: OUT — deferred with the MR entity, see V1_SCOPE §4)

// Addition to Ticket (optional per-ticket tightening; §5.3).
// Ticket.autonomyOverride: String?   // same enum; null ⇒ inherit Workspace.autonomyLevel
```

- **Setting it is a `[control-API]` op** — `set-autonomy` (§3.4 catalogue row) → `preApiExecute` Admin+ RBAC → enqueue → Conductor writes the field + an `AuditEntry{ action:'set-autonomy', detail:{ fromLevel, toLevel } }` (§4). Autonomy changes are **always audited** — "who turned on full-auto" is exactly the trust question §4 exists to answer.
- **The gate-decision is the Conductor's, read at promote time.** When a stage hits `done`, the Conductor consults `effectiveLevel = ticket.autonomyOverride ?? workspace.autonomyLevel` and either fires the `stage.on_approval → start-stage` auto-promote ([03 §1]) or holds + surfaces the [07] promote gate. No new mechanism — the autonomy level is just *which branch of the already-existing promote logic runs*.

### 5.5 `Q-TRUST-AUTONOMY`, `Q-TRUST-AUTONOMY-RBAC`, `Q-TRUST-AUTOMERGE` (open questions)

> **`Q-TRUST-AUTONOMY` — what is the default autonomy level for a new workspace?**
> **Recommendation: `gate-key-stages`** — auto-advance the cheap planning stages, gate every code/build stage (anything that produces a diff to review). This is the trust-building middle: the agent feels autonomous on low-risk work but a human always reviews code before it can be merged. Options: (a) **[recommended]** `gate-key-stages`; (b) `gate-every-stage` (safest first-run, but heavy babysitting may sour first impressions); (c) `full-auto` (rejected as a default — a new team has no basis to trust the pipeline yet).
>
> **`Q-TRUST-AUTONOMY-RBAC` — who can change autonomy, and can it be loosened per-ticket?**
> **Recommendation: setting the *workspace* level = Admin+; *tightening* a ticket below the workspace default = any "work on tickets"; *loosening* a ticket = Admin+.** Members can always be *more* cautious; only Admins can grant *more* autonomy. Options: (a) **[recommended]** asymmetric (tighten = member, loosen = Admin); (b) all autonomy changes Admin+ (simpler, but blocks a Member from shadowing their own risky ticket); (c) Owner-only for `full-auto` specifically (a stricter variant — reasonable to layer on (a)).
>
> **`Q-TRUST-AUTOMERGE` — should `full-auto` ever auto-MERGE on green CI?**
> **Recommendation: NO for v1 — merge is always human-gated, even at `full-auto` (§5.2 floor).** Auto-merge is the single step that puts unreviewed AI code on the default branch; it must be an explicit, separate, deliberately-non-default opt-in, never folded into `full-auto`. Options: (a) **[recommended]** never auto-merge in v1; (b) a separate `full-auto-merge` level gated behind green built-in CI ([FORGE_ABSTRACTION §8]) + N approvals, **Owner-only**, as a P2 — kept distinct from `full-auto` so the floor stays explicit; (c) per-stage-class auto-merge for trivial stages (rejected — too easy to misconfigure into shipping unreviewed code).

**No new verbs.** Autonomy is a `Workspace`/`Ticket` field set via the `set-autonomy` [control-API] op; the gate decision is the Conductor branching existing promote logic. No structured-channel surface changes.

---

## 6. How the four controls reinforce each other (the trust loop)

```
   ┌─ autonomy level (§5) decides ─▶  does this stage GATE? ──yes──▶ SHADOW marker (§2)
   │                                                                      │
   │                                                          human reviews diff [07_CODE_CHANGES_REVIEW]
   │                                                                      │
   │                                              ┌── Reject ──▶ re-open stage (busy, --resume)
   │                                              │
   │                                              └── Promote ──▶ [control-API] ──▶ Conductor writes
   │                                                                      │                  │
   │                                                                      │           AuditEntry (§4)
   │                                                                      ▼
   │                                                         (eventually) human MERGES the MR
   │                                                                      │  ──────▶ AuditEntry (§4)
   │                                                                      ▼
   └──────────────────── if it goes wrong ─────────▶  mr-revert (§3) ──▶ Conductor ──▶ AuditEntry (§4)
```

- **Autonomy** sets *how much* the human is asked to gate; **shadow** is the *visible state* of a held proposal; **the review surface** is *where* the human decides; **audit** is the *permanent record* of every decision; **rollback** is the *escape hatch* when a merged decision was wrong. Each is the same B-23 boundary seen from a different angle.
- Every arrow that *writes* is a Conductor action behind `[control-API]`; every arrow that *records* is an append-only projection; no arrow is an AI write (the AI's only inbound arrows are `emit_carryover` (the diff) and `propose_suggestion` (e.g. "consider reverting") — both `propose`, [02 §2]).

---

## 7. INDEX delta

Net-new persisted shapes (additive, tenant-scoped, fold into the [04b §13] field sweep):

- `Workspace.autonomyLevel` (`'gate-every-stage' | 'gate-key-stages' | 'full-auto'`, default `gate-key-stages`) — §5.4.
- `Ticket.autonomyOverride?` (same enum, nullable ⇒ inherit) — §5.3.
- `AuditEntry` (net-new model, append-only, immutable) — §4.2.

Net-new `[control-API §8]` catalogue rows (ops, **not verbs**): `mr-revert`, `set-autonomy`. (`mr-revert` is co-owned with the MR doc; `set-autonomy` is owned here.)

Render-only / derived (no persistence): the **SHADOW marker** (§2.2, derived from autonomy + stage state), the **Audit view + Export** (§4.3, a read lens over `AuditEntry`).

---

## 8. Self-check (review invariants)

- **No new verbs** introduced anywhere. The frozen `[02 §2]` surface (7 worker + 6 assistant, all `read|propose`) is untouched; `VERB_REGISTRY` conformance (`Q-ENG-VERB-CONFORMANCE`, [02b §D]) is unaffected.
- **No write verb granted to any LLM session.** Every trust write — promote, `mr-revert`, `set-autonomy` — is a Conductor action behind `[control-API]` (B-23, [01 §3.3]). The AI's only participation is `emit_carryover` (the diff) + `propose_suggestion` (e.g. "consider reverting"), both `propose`.
- **Dry-run / shadow is the architecture's default, not a new path** — it is the `gate-every-stage` autonomy level + a render marker; the worktree commit IS the proposed diff (§2.1).
- **Rollback is non-destructive** — forward `git revert` → new MR + tracking ticket, merged through the normal human gate; never a force-push / history rewrite (§3.2).
- **Merge is always human-gated**, even at `full-auto` — the one non-negotiable floor (§5.2); auto-merge is a deliberate non-default (`Q-TRUST-AUTOMERGE`).
- **The audit trail is immutable by absence** — no `[control-API]` op mutates an `AuditEntry`, mirroring how no `write` member exists in the `VerbTag` union (§4.2).
- **Audit is distinct from the activity feed** — decisions (who approved/merged/killed/promoted), never-coalesced + attributed + exportable, vs [20]'s coalesced operational narrative (§4.1).
- **Single-instance + lease preserved** — rollback git writes + autonomy reconciles run under `lease:orchestrator` (G8/G16); **multi-tenancy preserved** — every path runs under `runInTenant(workspaceId, …)` (`Q-SEC-RUNINTENANT`, [04b §11c]).
- **Forge-agnostic** — rollback + the merge gate ride `[FORGE_ABSTRACTION §3/§7.2]`'s `repoHosting`/`mergeRequests` capabilities, identical across GitLab / GitHub / built-in modes.
- **Every genuine fork is an open question** with a recommended default — `Q-TRUST-DRYRUN`, `Q-TRUST-ROLLBACK`, `Q-TRUST-ROLLBACK-RBAC`, `Q-TRUST-AUDIT`, `Q-TRUST-AUDIT-SCOPE`, `Q-TRUST-AUDIT-RBAC`, `Q-TRUST-AUTONOMY`, `Q-TRUST-AUTONOMY-RBAC`, `Q-TRUST-AUTOMERGE`.
- This doc **edits no existing file** — it is a new trust-surface doc the MR / autonomy / review docs cite as `[TRUST_SAFETY_UX §N]`.
```