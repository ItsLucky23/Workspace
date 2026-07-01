# Addition 09 — Per-stage commit (keystone)

> **Tier:** V1 · **Lane:** D (changes/review) + A (orchestrator/git) · **Status:** NEW (2026-06-11).
> **Pitch:** Make each pipeline stage boundary a **real commit on `DEV-####`** so review is truly incremental and the eval loop captures per-stage human-edit deltas — then **squash those commits into one clean commit at the final push**, leaving the existing V1 push-on-approval → GitLab create-MR-URL flow ([V1_SCOPE §3.1]) byte-identical from GitLab's side.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #9.
>
> **No new verbs.** Nothing here adds, renames, or relaxes a structured-channel verb. The frozen 7+6 surface ([02 §2], all `read|propose`, none write) is untouched. Every commit — the per-stage commit, the squash, the reject-reopen amend, the paused-edit fold-in — is a **deterministic git action the single-instance Conductor performs** behind `[control-API]` (B-23, [01 §3.3], [GIT_STRATEGY §0]). The LLM never authorizes a write; it `emit_carryover`s, the Conductor commits. This is the load-bearing invariant of this whole addition (§4).

---

## 1. The gap this closes (single-end-commit degrades review + eval; this is the keystone)

Today V1 has **no defined commit cadence inside the pipeline**. [GIT_STRATEGY §1] states "stages produce sequential commits on one branch" as an aspiration, but no doc pins **who commits, when, and against what baseline** at a stage boundary — and the V1 push flow ([V1_SCOPE §3.1 step 4], [CODE_EDITOR §5]) only mandates a single commit-and-push at the **last** stage's `complete`. If that is the *only* commit, two things degrade:

| Degraded today (single end-commit) | What the keystone restores |
|---|---|
| **Review can't be incremental.** [features/07] offers a **baseline toggle (D10)**: whole-ticket *or* per-stage delta `prevStage.commitHash..thisStage.commitHash` ([features/07] 07.q1). With one terminal commit there is **no `prevStage.commitHash`** — the per-stage-delta baseline resolves to an empty/degenerate range, so the toggle is dead and the reviewer only ever sees the whole-ticket blob. | A real `prevStageN-1.commitHash..thisStageN.commitHash` range per boundary → the [features/07] D10 toggle works as specified; the prev/next stepper walks a *true* stage delta (§3.2). |
| **The eval loop has no per-stage human-edit delta.** [AI_QUALITY_AND_EVALS §5] turns every human **edit** of AI output into a `PromptFeedback(kind:'edit')` row whose value is the **before→after delta** ([AIQ §5.1]). The paused-editor edits ([CODE_EDITOR §4]) and the reject-reopen corrections are *per-stage* signals — but with no per-stage commit boundary, the "before" (the stage's AI output) and the "after" (the human correction) are smeared into one diff, so the feedback row's `aiOutput`/`humanCorrection` ([AIQ §5.1]) can't be cleanly separated per role. | A committed `commitHash` frozen **per stage** ([07 §A] step 3, [04b §6] `metadata.commitHash`) gives the eval loop a clean `roleKey`-attributable before/after per boundary → `PromptFeedback` rows are per-stage-accurate, feeding the few-shot bank ([AIQ §5.2]) and the A/B outcome join ([AIQ §4.3]). |
| **Forensics (#12) can't replay "what did stage N actually change".** The `TicketEvent` log ([04b §6]) records `file-change` events, but without a per-stage commit there is no git object to diff a stage against — the RAG delta-indexer ([07 §D]) also keys on commit ranges (`git.diffNames(prevCommit, commitHash)`). | Each stage's commit is a durable, diffable git object stamped into `TicketEvent.metadata.commitHash` ([04b §6]) → stage-level forensics and a precise delta-index input. |

> **Why "keystone":** edit-as-feedback (#10) needs the per-stage *delta* to know what the human changed; forensics (#12) needs the per-stage *commit object* to replay it; the AI-quality feedback loop ([AIQ §5]) needs both to attribute corrections to the right `roleKey`. All three unlock from one mechanic — a real commit at each stage boundary — which is why this is the single highest-leverage V1 addition.

---

## 2. Locked decision (per-stage commit internally, squash on push)

**Commit per stage INTERNALLY, squash on final push.**

- **During the pipeline:** each stage boundary (`done`, the moment the worker `emit_carryover`s and the Conductor freezes the stage's `commitHash` — [07 §A] step 3, [02 §4]) becomes a **real commit on the `DEV-####` branch** ([GIT_STRATEGY §1]). The per-stage commits give a genuine `stageN-1..stageN` diff for incremental review ([features/07] D10) and clean per-stage feedback deltas ([AIQ §5]).
- **On the final stage's `complete`:** the push **squashes** the per-stage commits into **one clean commit** before `git push` to the GitLab remote — so the GitLab create-MR-URL flow ([V1_SCOPE §3.1 steps 4–6], [CODE_EDITOR §5]) is unchanged and the external MR is clean (no `wip: refine`, `wip: plan`, … noise on GitLab).
- **Full per-stage granularity is preserved in our own records** — the `TicketEvent` log ([04b §6] `metadata.commitHash` per boundary) and the `CarryOver` envelopes ([04b §14], `{ summary, changedFiles[], openQuestions[], commitHash }`) keep each stage's commit hash + delta after the squash discards the intermediate commits from git history. The external MR loses the per-stage commits; our event log does not.

**This deviates from nothing in V1_SCOPE — it *implements* the missing cadence inside it.** [V1_SCOPE §3.1] already says the push is the agent's commits **plus** the user's edits as "one branch tip"; this addition pins that "one branch tip" = the **squash result** of the per-stage commits, and adds the internal commits that were previously unspecified. The external contract ([V1_SCOPE §3.1 steps 5–6]: push → create-MR URL → user merges on GitLab) is preserved exactly.

**DEFAULT — flag if wrong** (each is an `Q-PSC-*` sub-decision in §5, with a recommended default):
1. The squash happens **at push time via git, interactive-free** — recommended `git reset --soft <merge-base>` then a single `git commit` (equivalent to `git merge --squash`), authored by the **Conductor**, never an interactive rebase.
2. **Reject-reopens-stage (`done → busy`, [features/07] 07.q3) amends/replaces that stage's commit** rather than stacking a new sibling commit — the stage's `commitHash` is rewritten in place, so a re-run of stage N still yields exactly one stage-N commit.
3. **User edits made in the paused editor ([CODE_EDITOR §4]) are committed into the *current* stage's commit** before the next stage starts — the human delta rides inside the stage boundary it belongs to, so the per-stage diff and the `PromptFeedback` delta are attributed to the right `roleKey`.

---

## 3. Build-ready mechanics

### 3.1 Per-stage commit creation (Conductor, on stage boundary; cite [07], [GIT_STRATEGY])

The commit lands at the **same instant the Conductor already freezes the stage's `commitHash`** — no new lifecycle step, a fill-in of an existing one:

1. **Trigger.** The worker finishes a stage and calls `emit_carryover` ([02 §2], the only exit the §2 prompts name — [AIQ §2]). The `Stop` hook → done-check ([02 §3], [features/07] "Verbs/Events/Hooks") flips `(stage, busy) → (stage, done)` — the Conductor is the only writer ([01 §3.3]).
2. **Commit (the new fill-in).** Before/at that flip, the **Conductor** runs, inside the ticket container's worktree ([07b §4]), the deterministic sequence:
   ```
   git add -A                                  # the agent's edits to the worktree
   git commit -m "ws-stage: <stageKind> (<stageId>)"   # Conductor-authored, NOT the LLM
   commitHash = git rev-parse HEAD             # this IS [07 §A] step-3's frozen hash for the NEXT stage
   ```
   This is the concrete realization of [07 §A] step 3 ("Capture `commitHash` — the frozen snapshot baseline, DH5") at a *stage boundary* rather than only at ticket activation. The hash is frozen per stage (DH5 — commit-hash binding-timing, [REFERENCE_CODES]).
3. **Record.** The Conductor writes the boundary into:
   - `TicketEvent` ([04b §6]) — `type:'status-change'` (the `done` flip) carrying `metadata.commitHash` + `metadata.changedFiles[]`, `seq`-ordered, `stageId` set, `actor:'conductor'`.
   - the `CarryOver` envelope ([04b §14], [02 §4]) — `{ summary, changedFiles[], openQuestions[], commitHash }`, the machine stage→stage record. The envelope's `commitHash` **is** this commit.
4. **Authorship invariant.** The commit is a `[GIT_STRATEGY §0]` Conductor git action — the LLM `emit_carryover`s (propose-grade), the Conductor commits (B-23). No `git commit` is ever issued by a `claude` PTY; the agent has no write verb and no push/commit capability ([07 §A] checklist, [GIT_STRATEGY §10]).
5. **`runInTenant`.** The commit, the `rev-parse`, and the two record-writes all run under `runInTenant(workspaceId, …)` ([04b §11c]) — every orchestrator-side path, no exception ([CODE_EDITOR §7]).

> **No new branch, no per-stage branch.** Stages commit **sequentially on the one `DEV-####` branch** — never sibling branches ([GIT_STRATEGY §1] "NOT per-stage … stages produce sequential commits on one branch"). The one-branch-per-ticket / frozen-baseline unit (DH5) is intact.

### 3.2 Incremental review baseline (real `stageN-1..stageN`; cite [features/07] D10)

With §3.1's commits in place, the [features/07] **baseline toggle (D10)** resolves to real ranges:

- **Whole-ticket (default, D10):** diff `branchBase..currentTip` — the frozen baseline `commitHash` at activation ([07 §A] step 3) `..` the latest stage commit. Unchanged from [features/07].
- **Per-stage delta (the toggle, [features/07] 07.q1):** diff `prevStage.commitHash..thisStage.commitHash` — now a **genuine commit range** because both endpoints are real commits from §3.1. Before this addition that range was empty; now it is the exact set of files the stage changed.
- The host drives this through the existing editor contract: `setBaselineCommit(hash)` ([features/07] Data table, [CODE_EDITOR §3]) flips which commit the in-container VS Code git-decorations / `query_context` diff against. The **prev/next stepper** ([features/07] 07.q4) walks the changed-file set of *that* range.
- **Native git decorations get this for free** ([CODE_EDITOR §3.2]): because the per-stage commits are real git objects in the container, VS Code's SCM gutter shows the stage delta natively — no synthesized `setChangedFiles(TicketFile[])` paint on the live path (that contract survives only for the no-container `FileDiffViewer` fallback, [CODE_EDITOR §2.2]).
- **`query_context` read path** ([features/07] "Verbs/Events/Hooks", B-O2): the diff is a read at the chosen baseline — "the whole-ticket-vs-stage-delta toggle is just *which two commits* the host asks `query_context` to diff" ([features/07] §Verbs). No new verb.

### 3.3 Squash-on-final-push (preserve V1 push-on-approval → create-MR-URL; cite [CODE_EDITOR §5], [V1_SCOPE §3.1])

The squash slots **between [CODE_EDITOR §5] step 2 (commit user edits) and step 3 (`git push`)** — it does not change the boundaries of that flow, it cleans the branch tip just before it leaves the container:

1. User clicks **complete** at the **last** stage — a `[control-API]` op the Conductor executes ([CONTROL_API §8], the §3.1 complete/push op, [CODE_EDITOR §5 step 1]).
2. Conductor **commits any uncommitted user edits** onto `DEV-####` ([CODE_EDITOR §5 step 2]) — these are the final-stage paused-edits (§3.4), folded into the final stage commit.
3. **Squash (the new fill-in), Conductor-authored, interactive-free** (recommended default, `Q-PSC-SQUASH-MECHANISM`):
   ```
   base = git merge-base DEV-#### origin/<default>     # the branch's fork point (frozen activation baseline)
   git reset --soft <base>                             # collapse all per-stage commits, keep the tree
   git commit -m "<ticket title> (DEV-####)"           # ONE clean commit = the full ticket delta
   ```
   Equivalent to `git merge --squash` of the branch onto its base; **no `git rebase -i`** (interactive flags are unavailable in this environment and would break the deterministic Conductor — [GIT_STRATEGY §6] destructive-op caution). The squash is a **local history collapse on the not-yet-pushed `DEV-####`**, so it rewrites only commits that have never left the container — *not* a shared-history rewrite ([GIT_STRATEGY §6] forbids force-rewriting *published* history; this branch is unpushed, so the prohibition does not apply).
4. Conductor runs `git push DEV-####` to the GitLab remote (`forge.repoHosting.push()`, [FORGE_ABSTRACTION §3], GitLab adapter only — [CODE_EDITOR §5 step 3], [V1_SCOPE §3.1 step 4]).
5. GitLab prints the **"create merge request" URL**; the platform surfaces the clickable create-MR URL ([V1_SCOPE §3.1 step 5], [CODE_EDITOR §5 step 4]).
6. The user creates/merges the MR **on GitLab** ([V1_SCOPE §3.1 step 6]). [BUILTIN_MR_REVIEW] stays deferred ([V1_SCOPE §4]).

> **What GitLab sees vs what we keep:** GitLab sees **one clean commit** (step 3's squash result) — the external MR is exactly as clean as today's single-end-commit flow. We keep the **full per-stage granularity** in `TicketEvent.metadata.commitHash` + the `CarryOver` envelopes (§3.1 step 3, [04b §6]/§14), so #10/#12/[AIQ §5] lose nothing when git discards the intermediate commits. The squash is the *only* place the per-stage commits are collapsed, and it is post-review (the user already reviewed incrementally in §3.2 before clicking complete).

### 3.4 Reject/re-open + paused-edit interaction

Two existing V1 loops interact with the per-stage commit; both reuse the `--resume`-with-a-note machinery ([features/07] 07.q3, [GIT_STRATEGY §4], [CODE_EDITOR §4]):

- **Reject re-opens the stage (`done → busy`) → amend, don't stack** (recommended default, `Q-PSC-REOPEN-AMEND`). [features/07] 07.q3: a reject re-opens the *same* stage with the reject note as the `--resume` prompt; the stage flips `done → busy`. The agent produces a corrected output and `emit_carryover`s again → §3.1 fires again. To keep "one stage = one commit", the Conductor **rewrites the stage's commit in place** rather than appending a second stage-N commit:
  ```
  git reset --soft HEAD~1     # drop the prior stage-N commit, keep its tree
  git add -A ; git commit -m "ws-stage: <stageKind> (<stageId>)"   # re-commit the corrected stage output
  ```
  The new `commitHash` supersedes the old in the `CarryOver` envelope + a fresh `TicketEvent` ([04b §6]); the prior is retained in the append-only log as a superseded boundary (the log never deletes — [04b §11a]). Net: the per-stage-delta range (§3.2) stays single-commit-clean, and the **reject→correction pair is the richest `PromptFeedback(kind:'reject')` signal** ([AIQ §5.1]) — captured per stage.
- **Paused-edit fold-in → commit into the current stage's commit** (recommended default, `Q-PSC-PAUSED-EDIT-FOLD`). When a `userMayEdit=false` stage is paused ([CODE_EDITOR §4]), the user edits the worktree; on **resume**, the orchestrator already captures the user-diff and injects it into the agent's `--resume` ("you may proceed; the user made these changes: …", [CODE_EDITOR §4]). The per-stage commit (§3.1) at that stage's boundary **includes those user edits** (the `git add -A` sweeps the worktree, agent + human edits together) — so the human delta rides inside the stage boundary it belongs to. The captured user-diff is *also* the `PromptFeedback(kind:'edit')` before→after for that `roleKey` ([AIQ §5.1]) — the keystone's #10 unlock.
  - **`userMayEdit=true` (concurrent-write opt-in, [CODE_EDITOR §7]):** same fold-in — the boundary commit sweeps whatever is on the worktree (last-write-wins on disk is accepted, [CODE_EDITOR §7]); the human edits are simply less cleanly separable from the agent's (an accepted V1 rough edge, not a per-stage-commit problem).

### 3.5 What this unlocks (#10, #12, [AIQ §5] feedback)

| Unlock | Needs from this addition | Where it lands |
|---|---|---|
| **#10 edit-as-feedback** | the per-stage human-edit **delta**, attributed to a `roleKey` | §3.4 paused-edit fold-in → `PromptFeedback(kind:'edit')` `aiOutput`/`humanCorrection` ([AIQ §5.1]) → curated few-shot bank ([AIQ §5.2]) |
| **#12 forensics** | a durable, diffable **commit object** per stage | §3.1 `commitHash` in `TicketEvent.metadata` ([04b §6]) + the `CarryOver` envelope ([04b §14]); survives the §3.3 squash in our records |
| **[AIQ §5] feedback loop** | clean per-stage **before/after** to score + A/B prompts | §3.2 real `stageN-1..stageN` range + §3.4 reject/edit pairs → `PromptFeedback` ([AIQ §5.1]) → `PromptVersion` eval-gate + A/B join ([AIQ §4.3/§5.4]) |

The eval loop ([AIQ §5]) is explicit that it needs the per-stage delta: a correction smeared across the whole-ticket diff can't be attributed to "the Code stage's `PromptVersion`" for the A/B outcome join ([AIQ §4.3], the `promptVersionId` field on `PromptFeedback`, [AIQ §5.1]). The per-stage commit is what makes that attribution exact.

---

## 4. Invariants honored (Conductor-only-writer; V1 scope preserved)

- **B-23 / Conductor is the ONLY writer.** Every commit (per-stage §3.1, squash §3.3, reject-amend §3.4, paused-edit fold-in §3.4) is a **Conductor-authored deterministic git action** behind `[control-API]` ([01 §3.3], [GIT_STRATEGY §0/§10]). The `claude` PTY `emit_carryover`s and edits the worktree; it **never** issues `git commit`/`git push` and has no write verb. "The Conductor makes the commits, never the LLM directly authorizing a write" — exactly B-23.
- **FROZEN 7+6 verb surface — no new verbs.** The only worker exits involved are the existing `emit_carryover` / `request_input` ([02 §2], [AIQ §2]); commit/squash/amend are `[control-API]` ops, not verbs ([GIT_STRATEGY §10], [CODE_EDITOR §8]).
- **DH5 frozen baseline intact.** The per-stage `commitHash` *is* [07 §A] step-3's frozen hash, now captured per boundary; the activation baseline is still frozen for the ticket's life ([GIT_STRATEGY §2]); no silent re-baselining.
- **One branch per ticket.** Stages commit sequentially on `DEV-####`; no sibling/per-stage branches ([GIT_STRATEGY §1]).
- **V1 push-on-approval → create-MR-URL preserved exactly.** [V1_SCOPE §3.1 steps 4–6] / [CODE_EDITOR §5] are unchanged from GitLab's side — the squash makes the external MR a single clean commit (what GitLab already expected); no built-in MR/merge/CI is introduced ([V1_SCOPE §4]).
- **`runInTenant` everywhere.** Every commit/diff/record path runs under `runInTenant(workspaceId, …)` ([04b §11c], [CODE_EDITOR §7]).
- **Append-only records preserved.** `TicketEvent` + `CarryOver` are append-only ([04b §11a]); a reject-amend (§3.4) writes a *new* superseding boundary, never mutates the old row — only git history (unpushed) is collapsed.
- **PTY-billing untouched.** No change to the interactive-`claude`-PTY billing path ([01 §1], [P0_CLI_SPIKE]); the Conductor's git work is host-side Node, not a model turn.
- **Edits no existing file.** This is the additions-layer spec the changes-review/git docs will cite as `[additions/09]`; it proposes deltas to [07 §A] (commit at stage boundary), [features/07] (D10 now resolvable), and [CODE_EDITOR §5] (squash step) rather than editing them.

---

## 5. Open sub-decisions (DEFAULTs)

| id | Question | Recommended default | Why | Options |
|---|---|---|---|---|
| `Q-PSC-SQUASH-MECHANISM` | How is the final-push squash performed? | **`git reset --soft <merge-base>` + one `git commit`, Conductor-authored, interactive-free** (§3.3). | Deterministic, no interactive rebase (unavailable + breaks the deterministic Conductor); collapses only unpushed local history, so [GIT_STRATEGY §6]'s no-published-rewrite rule is not triggered. | (A) soft-reset + commit [rec] · (B) `git merge --squash` onto base · (C) cherry-pick onto a fresh branch tip |
| `Q-PSC-REOPEN-AMEND` | Does a reject-reopen (`done → busy`) amend the stage's commit or stack a new one? | **Amend/replace in place** (`reset --soft HEAD~1` + re-commit, §3.4) so one stage = one commit. | Keeps the per-stage-delta range (§3.2) single-commit-clean; the reject/correction pair is still captured in the append-only log + `PromptFeedback`. | (A) amend in place [rec] · (B) stack a `fixup` commit, squash at push · (C) keep both, mark the superseded one in metadata |
| `Q-PSC-PAUSED-EDIT-FOLD` | Where do paused-editor user edits land? | **Folded into the *current* stage's boundary commit** (§3.4) so the human delta is attributed to the right `roleKey`. | The per-stage diff + the `PromptFeedback(kind:'edit')` delta both want the edits inside the stage they happened in ([AIQ §5]). | (A) fold into current stage [rec] · (B) a separate `user-edit` commit between stages · (C) defer all user edits to the final-stage commit |
| `Q-PSC-COMMIT-EMPTY` | What if a stage changes no files (e.g. a pure review/plan stage, `needsWorkspace=false`)? | **Skip the commit; still freeze a `commitHash` = the prior commit** (the boundary's hash is the unchanged HEAD) and still write the `CarryOver`/`TicketEvent`. | Reasoning roles ([AIQ §2.1/§2.2], [GOLDEN_PLAN_STAGE §2] deny-Write) produce no worktree change; an empty commit is noise. The boundary still has a hash (the unchanged HEAD) so §3.2's range is well-defined (it's just empty for that stage). | (A) skip + reuse HEAD [rec] · (B) `--allow-empty` marker commit per stage · (C) commit only `code`/`test` stages, name others by carry-over only |
| `Q-PSC-COMMIT-MSG` | Per-stage commit message format? | **`ws-stage: <stageKind> (<stageId>)`** (machine-stable, discarded at squash). | They never reach GitLab (squashed away), so the format only needs to be greppable in local history + the event log; the final squash message is the ticket title. | (A) `ws-stage: <kind>` [rec] · (B) include the carry-over `summary` first line · (C) include `seq` for ordering |

> All defaults are **the locked decision's** defaults (§2). Each is flagged here so Lane A/D leads (or the user) can override before build; none blocks the §2 decision.

---

## 6. Build checklist (per-lane + verification)

**Lane A (orchestrator / git) — the commit + squash mechanics:**
- [ ] At the stage-boundary done-flip ([07 §A], [02 §3]), the **Conductor** runs `git add -A` + `git commit` + `rev-parse` in the ticket worktree ([07b §4]); the resulting hash is [07 §A] step-3's frozen `commitHash` for the next stage (§3.1). **Verify:** a 5-stage golden ticket ([AIQ §3.5]) ends with 5 (or fewer, per `Q-PSC-COMMIT-EMPTY`) sequential commits on `DEV-####` before push.
- [ ] The commit is **Conductor-authored**; no `claude` PTY ever issues `git commit`/`git push` (B-23). **Verify:** the [02b §D] `VERB_REGISTRY` conformance test + a check that the agent container has no push capability ([07 §A] checklist) — the commit author is the Conductor identity, not the agent.
- [ ] Final-stage `complete` runs the **interactive-free squash** (`reset --soft <merge-base>` + one commit, §3.3) **then** `git push` ([CODE_EDITOR §5]). **Verify:** after push, `git log origin/<default>..DEV-####` on the remote shows **exactly one** commit; the create-MR URL is surfaced ([V1_SCOPE §3.1 step 5]).
- [ ] Reject-reopen **amends** the stage commit in place (§3.4, `Q-PSC-REOPEN-AMEND`). **Verify:** a reject→correction on stage N leaves exactly one stage-N commit; the superseded boundary is still in the append-only `TicketEvent` log ([04b §11a]).
- [ ] Every git path runs under `runInTenant` ([04b §11c]). **Verify:** the `currentWorkspaceId()`-throws test ([04b §11c]) covers the commit/squash worker.

**Lane D (changes / review) — the incremental baseline + edit fold-in:**
- [ ] The [features/07] **baseline toggle (D10)** resolves per-stage delta to the real `prevStage.commitHash..thisStage.commitHash` range; `setBaselineCommit(hash)` + the prev/next stepper walk that range (§3.2). **Verify:** with ≥2 committed stages, toggling to "This stage" shows only that stage's changed files (native VS Code git decorations, [CODE_EDITOR §3.2]).
- [ ] Paused-editor user edits are **folded into the current stage's boundary commit** (§3.4, `Q-PSC-PAUSED-EDIT-FOLD`) and the captured user-diff is emitted as the `PromptFeedback(kind:'edit')` before→after ([AIQ §5.1]). **Verify:** pause → edit → resume → next stage; the stage's commit contains the human edit, and a `PromptFeedback` row carries the delta with the correct `roleKey`/`promptVersionId`.
- [ ] No-container fallback path is unaffected — `FileDiffViewer` ([CODE_EDITOR §2.2]) still renders from `Ticket.files` when no commit/editor session is up ([features/07] 07.q5).

**Cross-cutting (data + eval):**
- [ ] Each boundary writes `TicketEvent.metadata.commitHash` + `changedFiles[]` ([04b §6]) and a `CarryOver` envelope with that `commitHash` ([04b §14], [02 §4]). **Verify:** the per-stage commit hashes are recoverable from the event log + envelopes *after* the §3.3 squash discards them from git history.
- [ ] The [AIQ §3] golden-tickets replay lane still passes (the per-stage commit is a new, deterministic, zero-subscription step). **Verify:** `GT-001`…`GT-006` ([AIQ §3.5]) replay green; `GT-003` (scope-creep) and `GT-005` (reviewer-catch) now score against a real per-stage delta.

---

## 7. Citations

| Cited | What this addition takes from it |
|---|---|
| [GIT_STRATEGY](../GIT_STRATEGY.md) §0/§1/§2/§4/§6/§10 | Conductor-only-writer git model; one durable `DEV-####` branch, sequential stage commits (not sibling branches); frozen activation baseline (DH5); reject = `--resume` reopen; no published-history rewrite (the squash is on the *unpushed* branch); no-new-verbs self-check. |
| [CODE_EDITOR](../CODE_EDITOR.md) §3/§4/§5/§7 | Native git decorations on the in-container worktree (real commits → free stage-delta gutter); edit-lock / pause / resume-with-changes; the push-on-approval ride-along (user edits committed with the agent's) — the squash slots between commit-edits and push; concurrency model + `runInTenant`. |
| [features/07_CODE_CHANGES_REVIEW](../features/07_CODE_CHANGES_REVIEW.md) D10 / 07.q1 / 07.q3 / 07.q4 | The baseline toggle (whole-ticket vs `prevStage..thisStage` delta) this addition makes *resolvable*; reject-reopens-stage; the stepper that walks the delta. |
| [07_ORCHESTRATOR](../07_ORCHESTRATOR.md) §A / §D | Launch/teardown 7-step sequence; step-3 `commitHash` freeze (now per stage boundary); the RAG delta-indexer that diffs commit ranges. |
| [04b_DATA_MODEL_ADDENDA](../04b_DATA_MODEL_ADDENDA.md) §6 / §11a / §11c / §14 | `TicketEvent` (`metadata.commitHash`, `changedFiles[]`, `seq`, append-only); `CarryOver` envelope (`{ summary, changedFiles[], openQuestions[], commitHash }`); `runInTenant` mandate. |
| [AI_QUALITY_AND_EVALS](../AI_QUALITY_AND_EVALS.md) §3 / §4 / §5 | The feedback loop that needs per-stage deltas: `PromptFeedback(kind:'edit'/'reject')` before→after, `promptVersionId` attribution, few-shot promotion, golden-ticket replay + A/B join. |
| [V1_SCOPE](../V1_SCOPE.md) §3.1 / §4 | The push-on-approval → GitLab create-MR-URL flow this addition preserves exactly; the deferred built-in MR/merge/CI list (not re-instated). |
| [REFERENCE_CODES](../REFERENCE_CODES.md) | B-23 (no-write-verb), DH5 (commit-hash binding-timing, stage/status shape), B-O2/B-O6. |
| [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #9 | The locked "per-stage commit internally, squash on push" decision this spec builds out. |

---

*End of additions/09_per_stage_commit.md. No new verbs. The Conductor — never the LLM — makes one real commit per stage on `DEV-####` (unlocking incremental review + per-stage feedback deltas for #10/#12/[AIQ §5]) and squashes them into one clean commit at the final push, preserving the V1 push-on-approval → GitLab create-MR-URL flow byte-identical. B-23, DH5, one-branch-per-ticket, `runInTenant`, and PTY-billing all intact; this doc edits no existing file.*
