# GIT_STRATEGY — branch / MR / merge / conflict / rollback across PARALLEL tickets

> **The git operating model under the Conductor.** Workspaces runs ~8 active and up to ~16 resident ticket containers ([07b §8]) — each on its OWN `DEV-####` branch off a frozen baseline, each editing an isolated clone-into-volume checkout ([07b §4]). The hard problem this doc owns is what happens **between** those parallel branches: how they are named, what base they rebase onto, **in what order they merge** (the single-writer serialization that prevents races), what happens when **two tickets touch the same files**, what a **failing CI gate** does to a pending merge, how a **bad merged change is rolled back**, and how every one of those behaves across the three forge modes ([FORGE_ABSTRACTION §4]: GitLab / GitHub / built-in). It is the git-layer companion to `[07 §A]` (the launch/teardown *sequence* that creates the branch + worktree) and `[07b]` (what a container/checkout *is*); it cites `[FORGE_ABSTRACTION]` for the pluggable forge seam and the Workspaces-owned `MergeRequest` shape, `[CONTROL_API]` for the write transport, and `[04b]` for the persisted rows. Codes resolve via `[REFERENCE_CODES]`. Prereq: `[07 §A]`, `[07b §3/§4]`, `[FORGE_ABSTRACTION §3/§4/§7]`, `[CONTROL_API §7/§8]`, `[features/24]`. Last updated: 2026-06-04.
>
> **No new verbs.** Nothing here adds, renames, or relaxes a structured-channel verb. The frozen `[02 §2]` surface (7 worker + 6 assistant verbs, all `read|propose`, none write) is untouched. **Every git write — branch, rebase, push, open/merge an MR, resolve a conflict, revert a bad merge — is a `[control-API]` route → `preApiExecute` RBAC → enqueue ONE `WorkspaceSignal` → the single-instance Conductor (the only writer, `[01 §3.3]`) → `forge.repoHosting.*`/`forge.mergeRequests.*`** ([FORGE_ABSTRACTION §3]). The AI **proposes** (`propose_suggestion` "ready to merge"); a human **accepts**; the **Conductor merges** (B-23). No LLM session ever pushes, merges, or reverts.

---

## §0. The model in one paragraph

Each ticket that enters an `aiEnabled` stage gets ONE branch `DEV-<ticketNumber>` created at `[07 §A]` step 5, checked out from a **frozen baseline `commitHash`** captured at step 3 (DH5 — the ticket stays on that hash even as the default branch advances). The agent edits inside an isolated **clone-into-volume** checkout ([07b §4]) — so N parallel tickets never share a working tree and can never corrupt each other's index *while editing*. They only interact at the **merge boundary**, and that boundary is **serialized by the Conductor**: merges are not concurrent — each is a `[control-API]` op the single-instance Conductor drains one-at-a-time under `lease:orchestrator` ([01 §3.3], G8/G16, [CONTROL_API §7]). Before a merge the Conductor **rebases (or merges) the default branch into the ticket branch**, runs the **CI gate** ([FORGE_ABSTRACTION §8] — a sequence of container jobs on the orchestrator), and only merges on green. If the rebase hits a **conflict** (two tickets touched the same lines), the Conductor re-activates the ticket's stage agent with the conflict as a `--resume` prompt (the agent proposes a resolution → human accepts) or escalates to `needs-input` ([features/24], B-35). A **bad merged change** is undone by a forward `git revert` (never a history rewrite) — itself a `[control-API]` op, itself a normalized merge `ForgeEvent` that re-runs teardown + the RAG delta ([07 §A]/[07 §D]). All of this is identical in shape across the three forge modes; only *which forge the Conductor's merge call lands on* differs ([FORGE_ABSTRACTION §4]).

---

## §1. Branch naming — `DEV-<ticketNumber>` per ticket

`[07 §A]` step 5 already names the branch/worktree from the ticket prefix: **`git worktree add` (host) → `git clone --branch DEV-#### --single-branch` (container)** ([07b §4]). This doc pins the naming contract:

- **One branch per ticket, `DEV-<ticketNumber>`** — the ticket number is the stable, human-readable, forge-portable key. NOT per-stage: a stage transition is a new PTY in the SAME container on the SAME branch ([07b §3], `Q-CT-UNIT`) — stages produce sequential commits on one branch, never sibling branches. This keeps the frozen-`commitHash`-per-ticket unit (DH5) intact and means the MR target is a single branch ([FORGE_ABSTRACTION §7.2] `MergeRequest.sourceBranch = 'DEV-####'`).
- **The branch is durable; the container is disposable.** Teardown retains the branch + `TicketEvent` audit and discards the container ([07 §A] back-half). Re-activation re-clones `DEV-####` and re-runs steps 1–7 — so a branch outlives many container generations.
- **Cross-mode portability.** `DEV-####` is the branch name on the external GitLab/GitHub remote (external modes) **and** on the orchestrator-hosted bare repo (built-in mode, [FORGE_ABSTRACTION §7.1]) — the same literal, so the `MergeRequest.sourceBranch` row and the agent's local branch agree in every mode. **`Q-GIT-BRANCHNAME` (§9)** records the recommended scheme and the one fork (collision-safe suffixing).

**No new verbs.** The branch is created by the orchestrator at `[07 §A]` step 5 — deterministic git mechanics, not a protocol surface.

---

## §2. Base-branch + rebase policy — frozen baseline in, fresh base at merge

Two distinct "base" moments, and they are deliberately different:

| Moment | Base used | Why |
|---|---|---|
| **At branch creation** (`[07 §A]` step 3/5) | the **frozen `commitHash`** = HEAD of the default branch *at activation* (DH5) | the agent (and its RAG snapshot, [07 §D]) edit against ONE immutable snapshot; if the default branch advances mid-ticket the ticket does NOT drift — code state + RAG context stay frozen until re-activation. This is the load-bearing isolation that lets parallel tickets reason against stable context. |
| **At merge time** (this doc) | the **current** default-branch HEAD (re-pulled just before merge) | the merge must land on top of whatever else merged while this ticket was open. The Conductor **rebases/merges the live default into `DEV-####`** before the merge so the integration is current, the CI gate runs against the real post-merge tree, and conflicts surface BEFORE the merge, not after. |

**Recommended default: rebase-then-merge for the integration prep, but the merge itself is a forge merge-commit (no fast-forward-only).** Concretely, just before merging the Conductor does an **`origin/<default>` integration into `DEV-####`** — recommended **`git rebase origin/<default>`** (linear, clean history; the ticket's commits replay on top of current main) with a **`git merge` fallback** when the team prefers preserving the branch shape. Either way the *final* merge into the default branch produces a forge merge record (the `MergeRequest`), so the audit trail ("which ticket merged what") is explicit. **`Q-GIT-REBASE-POLICY` (§9)** records the rebase-vs-merge fork.

- **Why re-integrate before merge, not continuously:** continuously rebasing every open branch onto every other merge would (a) churn the frozen baseline DH5 promises to keep, (b) invalidate the per-commit RAG snapshot, and (c) spawn a rebase storm under parallel load. Re-integration is **lazy** — it happens only when a ticket is actually being merged (`mr-merge` is requested), at which point it's a single serialized operation.
- **Stale-baseline detection (advisory).** When `DEV-####`'s frozen baseline is far behind the live default (many merges landed since), the Conductor can surface an advisory "this ticket is N commits behind base" on the MR (a `TicketEvent`, [04b §6]); the human's lever is to **re-activate** the ticket (re-runs `[07 §A]` 1–7 on a fresh baseline) or proceed and let the merge-time rebase reconcile. No automatic forced re-baseline (that would break DH5 silently).

**No new verbs.** Rebase/integration is a Conductor git action behind `[control-API]`.

---

## §3. Merge order + serialization — the Conductor is the only merger

This is the core race-prevention guarantee. Parallel tickets edit in isolation (§0); the **only** point they can race is integration into the shared default branch. That point is single-threaded by construction:

- **The Conductor is the only writer of git** ([01 §3.3], [FORGE_ABSTRACTION §3]). A human's "Merge" button is a **`mr-merge` `[control-API]` op** ([FORGE_ABSTRACTION §7.2], catalogue addition to [CONTROL_API §8]) → `preApiExecute` RBAC → ONE `WorkspaceSignal` on the serial signal-log → the single-instance Conductor drains it **serially under `lease:orchestrator`** (G8/G16). Two "Merge" clicks for two different tickets do NOT execute concurrently — they queue, and the Conductor processes them one at a time.
- **Per-merge sequence (the serialized unit), executed atomically by the Conductor:**
  1. **Pull** current `origin/<default>` (`forge.repoHosting.pull()`).
  2. **Integrate** it into `DEV-####` (rebase/merge, §2).
  3. **Conflict check** — clean? continue. Conflict? branch to §4 (do NOT merge; re-activate or escalate).
  4. **CI gate** — run the pipeline ([FORGE_ABSTRACTION §8]); green? continue. Red? branch to §5 (block the merge).
  5. **Merge** (`forge.mergeRequests.merge(mrId, strategy)`) → produces the merge commit + a normalized merge `ForgeEvent`.
  6. **Post-merge fan-out** — the merge event drives teardown ([07 §A]) + the RAG delta-index ([07 §D]); both are forge-blind (they read the normalized event, [FORGE_ABSTRACTION §7.2]).
- **Why serial, not optimistic-parallel-with-retry:** a 5-person team's merge cadence is low (handfuls per day, not thousands), so the simplest correct model wins (Rule 7b). Serial merges mean step 2's rebase always sees a stable default HEAD — there is no "someone merged between my rebase and my merge" window, because nobody else is merging during this signal. A parallel merge engine with optimistic-concurrency retries is **deferred** (`Q-GIT-MERGE-CONCURRENCY`, §9) — unnecessary complexity for the target scale.
- **Ordering = signal-log order.** Merges happen in the order their `mr-merge` signals were enqueued ([CONTROL_API §6.4] serial drain). No priority queue in v1; the human controls order by when they click Merge.

**No new verbs.** Merge is a `[control-API]` Conductor action; the AI can only `propose_suggestion("ready to merge")` ([FORGE_ABSTRACTION §7.2], B-23).

---

## §4. Conflict handling — two tickets touch the same files

Because tickets branch off a **frozen** baseline and merge **lazily** (§2), the conflict surfaces deterministically at §3 step 2 (the merge-time integration), never mid-edit (isolated checkouts, [07b §4]). The resolution path:

1. **Detect.** The Conductor's rebase/merge in §3 step 2 returns a conflict (`forge.mergeRequests.conflictState(mrId)` reports `conflict`; the `MergeRequest.state` flips to `'conflict'`, [FORGE_ABSTRACTION §7.2]). The Conductor does **not** merge.
2. **Resolve via the stage agent (`--resume`) — recommended default.** The Conductor re-activates the ticket's stage in its container ([07b §3]) and feeds the conflict as a **`--resume` prompt** (the conflicting hunks + the standard "resolve these conflicts, keep both intents where possible" instruction). The agent edits the working tree to resolve — and per B-23 it **proposes** the resolution (a normal stage output: changed files + `emit_carryover`), it does **not** complete the merge. The human reviews the resolution in the MR/changed-files surface ([features/07], expanded per the BUILTIN_MR_REVIEW context) and **accepts** → the Conductor re-enters §3 from step 2. This reuses the existing reject-reopens-stage loop ([features/07] 07.q3: a free-text note becomes the `--resume` prompt and the stage flips `done → busy`) — conflict resolution is the *same machinery* with the conflict as the note.
3. **Escalate to `needs-input` when the agent can't (or shouldn't).** If the agent's resolution attempt fails, loops, or the conflict is semantic (both tickets changed the same logic with incompatible intent), the Conductor escalates the ticket to **`needs-input`** + a notification ([features/24], B-35 runaway→stuck→needs-input is the same escalation lever). The human resolves manually (in the editor surface) or sequences the tickets (merge one, re-activate the other onto the new baseline so the conflict disappears).
4. **The "merge one, re-baseline the other" exit is often cleanest.** Two tickets on the same file frequently stop conflicting once the first merges and the second re-activates onto the new default HEAD (its frozen baseline now includes the first ticket's change). The Conductor surfaces this as the recommended action when a conflict is detected on a second same-file ticket.

- **No auto-merge of conflicts, ever.** The Conductor never picks `--ours`/`--theirs` autonomously — that is a silent correctness hazard. Resolution is always agent-proposes-or-human-resolves, then human-accepts (B-23).
- **`Q-GIT-CONFLICT-RESOLVER` (§9)** records the fork: agent-`--resume` first (recommended) vs straight-to-`needs-input` (more conservative, no AI conflict edits).

**No new verbs.** Conflict resolution rides the existing `--resume` + `emit_carryover` + accept loop; the merge stays a `[control-API]` Conductor action.

---

## §5. Failing CI gate before merge

The CI gate is §3 step 4 — **a sequence of container jobs on the orchestrator** ([FORGE_ABSTRACTION §8]: a pipeline = ordered build/test/lint job containers under the same lease + limits, or an external/forge-native runner per `Q-FORGE-CI-RUNNER`). On a failing gate:

- **The merge is blocked — the Conductor does NOT merge.** A red pipeline at step 4 stops the per-merge sequence before step 5. `MergeRequest.state` stays `open`; the pipeline failure is a `TicketEvent` (`type:'ci'`, [FORGE_ABSTRACTION §8], [04b §6]) the MR/board surfaces render.
- **The failure routes back to the agent like a conflict (recommended default).** The Conductor re-activates the stage with the **failing job's output as a `--resume` prompt** ("tests X/Y failed: <log tail>; fix and re-emit") — the same `done → busy` reopen loop as §4 and [features/07] 07.q3. The agent proposes a fix; human accepts; the Conductor re-runs §3 from step 2 (re-integrate → re-gate → merge). For an external/forge-native runner the failed pipeline status arrives as a normalized `ForgeEvent` ([FORGE_ABSTRACTION §3] webhooks) and drives the same reopen.
- **Required vs advisory gate (the fork).** **Recommended default: CI is a BLOCKING gate for `mr-merge`** (no merge on red) — a 5-person team wants the safety. A per-workspace/per-pipeline **`allowMergeOnRedCI` advisory mode** is the opt-out (the human can still merge a red MR with an explicit Admin+ confirmation, for a known-flaky test). `Q-GIT-CI-GATE` (§9) records this.
- **No CI configured = no gate.** In GitLab/GitHub modes where the workspace drives its own forge pipeline and Workspaces' built-in CI is off ([FORGE_ABSTRACTION §8] "no built-in CI forced on a forge-SoT workspace"), the gate defers to the forge's merge-request approval rules — Workspaces federates the forge's CI status onto the MR but does not impose a second gate.

**No new verbs.** `ci-run`/`ci-cancel` are `[control-API]` ops; the gate decision is a Conductor step, not an LLM verb ([FORGE_ABSTRACTION §8]).

---

## §6. Rollback / revert of a bad merged change

Once a change is merged into the default branch and tickets have re-baselined onto it, the **only safe undo is a forward revert — never a history rewrite**:

- **`git revert <mergeCommit>` (a new commit that undoes the merge), surfaced as a `mr-revert` `[control-API]` op.** Recommended default. A revert is itself a normal change on the default branch: it produces a new commit + a normalized merge `ForgeEvent`, so it re-runs the RAG delta-index ([07 §D]) and is fully audited in `TicketEvent` ([04b §6]). It does NOT rewrite shared history, so the ~16 other tickets that already re-baselined onto the bad commit are unaffected — their next re-activation picks up the revert like any other forward change.
- **NEVER `reset --hard` / `push --force` on the default branch.** Rewriting published history on a branch other parallel tickets branched from is a corruption hazard (their baselines point at commits that vanished). This mirrors the framework's destructive-op caution. Force-push to the default branch is not a `[control-API]` op at all.
- **Revert authoring.** A revert may be **agent-assisted** (the Conductor can re-activate the originating ticket's stage with "revert merge <hash>, here's why" as the `--resume` prompt → agent proposes → human accepts) or **direct** (the human requests `mr-revert` and the Conductor performs the `git revert` deterministically — no edit needed for a clean revert). A revert that itself conflicts (subsequent changes touched the reverted lines) routes through §4.
- **Re-doing the change after a revert** is a fresh ticket (or a re-activated one) — a new `DEV-####` branch off the post-revert baseline. The revert + the redo are two audited merges, not a mutated history.
- **`Q-GIT-REVERT-SCOPE` (§9)** records the fork: forward-`git revert` (recommended, history-safe) vs a heavier "rollback to tag" snapshot model.

**No new verbs.** `mr-revert` is a `[control-API]` Conductor action; the AI at most proposes the revert (B-23).

---

## §7. How this differs across the three forge modes

The **shape** of §1–§6 is identical in every mode (single-writer Conductor, serial merges, frozen baseline, forward revert) — the seam ([FORGE_ABSTRACTION §3/§4]) means only the *backend the Conductor's git/MR call lands on* changes. The table pins the per-mode differences:

| Concern | **GitLab** (today, SoT=`forge`, B-29) | **GitHub** (future, SoT=`forge`) | **Built-in** (SoT=`workspaces`) |
|---|---|---|---|
| **Where `DEV-####` lives** | GitLab remote (`forge.repoHosting.push()`) | GitHub remote | orchestrator-hosted **bare repo** ([FORGE_ABSTRACTION §7.1], `Q-FORGE-GITHOST`) |
| **The MR** | GitLab MR; Workspaces' `MergeRequest` row is a **cache/projection** (`mrUrl` → GitLab, [04b §13]) | GitHub PR; row is a projection | **Workspaces-owned `MergeRequest`** is AUTHORITATIVE ([FORGE_ABSTRACTION §7.2]) |
| **Who performs the merge** | Conductor calls `forge.mergeRequests.merge` → **delegates to GitLab's merge**; merge arrives back as a GitLab `Merge Request Hook` ([07 §C]) | delegates to GitHub's merge; arrives as a GitHub webhook (HMAC, [07 §C] G7 seam) | Conductor merges the bare repo **directly** + a built-in git hook **synthesizes** the same normalized merge `ForgeEvent` ([FORGE_ABSTRACTION §7.2]) |
| **CI gate (§5)** | defaults to **GitLab CI** (forge-native); built-in container CI only if explicitly enabled (`Q-FORGE-CI-RUNNER`) | GitHub Actions | **built-in container CI** ([FORGE_ABSTRACTION §8]) is the default |
| **Conflict surface (§4)** | rebase happens in the orchestrator's checkout regardless of forge; GitLab may also report MR conflict state, federated onto the row | same, GitHub PR conflict state | conflict is computed entirely in the orchestrator-hosted repo; the `MergeRequest.state='conflict'` is the only source |
| **Revert (§6)** | `git revert` pushed to the GitLab remote → GitLab merge event | pushed to GitHub | committed to the bare repo + synthesized event |
| **Merge order / serialization (§3)** | **identical** — the Conductor serializes regardless of forge (the lease + signal-log are forge-blind, [FORGE_ABSTRACTION §1]) | identical | identical |
| **Frozen baseline / rebase (§2)** | identical — DH5 + merge-time rebase are orchestrator-side, not forge-side | identical | identical |

- **The invariant across modes:** the Conductor cannot tell which forge produced a merge/conflict event — it reads a **normalized `ForgeEvent`** ([FORGE_ABSTRACTION §3] conformance bar point 1). So §3–§6 logic is written once and runs on all three; a `BuiltinForge`/`GitHubForge` is an adapter, not a re-implementation of the git strategy ([FORGE_ABSTRACTION §5] regression contract for GitLab).
- **External-mode federation caveat.** In GitLab/GitHub modes the *actual merge* is the forge's (Workspaces requests it); the forge's own branch-protection/approval rules may add gates beyond Workspaces' CI gate. Workspaces respects the forge as SoT (B-29) — it does not fight the forge's merge rules, it federates them onto the MR surface.
- **Mixed-SoT is out of v1** (`Q-FORGE-SOT-MIXED`): one `forgeMode` per workspace covers repo + MR + CI together, so the git strategy never spans two forges within one workspace.

**No new verbs.** Mode selection is a `[control-API]` setup op ([FORGE_ABSTRACTION §6]); the git writes are Conductor actions regardless of mode.

---

## §8. The parallel-merge worked example (5-person team, 3 tickets, same morning)

Concrete trace of the serialization + conflict + CI machinery, to pin the model:

```
09:00  DEV-1241, DEV-1242, DEV-1243 all activate off main@abc123 (frozen baseline, DH5)
       → 3 branches, 3 clone-volumes, 3 containers, 3 isolated checkouts ([07b §4])
       → none can corrupt another while editing (no shared worktree)

11:30  DEV-1241 done → human clicks Merge → mr-merge signal #1 enqueued
       Conductor (serial, leased): pull main@abc123 (unchanged) → rebase (clean)
         → CI gate: build+test+lint job containers ([FORGE_ABSTRACTION §8]) → GREEN
         → merge → main@def456 → teardown DEV-1241 + RAG delta ([07 §A]/[07 §D])

11:45  DEV-1242 done → Merge → mr-merge signal #2 enqueued (waits, serial drain)
       Conductor: pull main@def456 (advanced!) → rebase DEV-1242 onto def456
         → touches the SAME file DEV-1241 changed → CONFLICT (§4)
         → MergeRequest.state='conflict'; Conductor re-activates DEV-1242 stage
           with the conflict as a --resume prompt → agent proposes resolution
         → human accepts → Conductor re-enters §3 step 2 → rebase clean → CI GREEN → merge → main@ghi789

11:50  DEV-1243 done → Merge → signal #3 → pull main@ghi789 → rebase (clean, different files)
         → CI gate: a test DEV-1241's merge broke → RED (§5) → merge BLOCKED
         → Conductor re-activates DEV-1243 with the failing-test log as --resume
         → agent proposes fix → human accepts → re-gate GREEN → merge → main@jkl012

13:00  prod incident traced to DEV-1242's merge → human clicks Revert (§6)
       Conductor: git revert <DEV-1242 merge commit> → main@mno345 (forward commit, no rewrite)
         → DEV-1241/1243 already merged are untouched; RAG delta re-indexes the revert
```

Every write in the trace is a serialized `[control-API]` → Conductor action; no two merges ran concurrently; no history was rewritten; every conflict/CI-fail looped back through the agent-proposes → human-accepts boundary (B-23). The same trace runs unchanged in built-in mode (the merges land on the bare repo + synthesized events) or GitHub mode (delegated to GitHub PRs).

---

## §9. Open questions (Q-GIT-*) — defaults recommended, user to confirm/override

| id | Question | Recommendation | Why | Options |
|---|---|---|---|---|
| `Q-GIT-REBASE-POLICY` | Rebase or merge the default branch into `DEV-####` before merging? | **Rebase `origin/<default>` into the ticket branch (linear), with a per-workspace `merge` fallback.** | Linear history is easier to review/revert and keeps the MR diff clean against current base; a `merge` fallback serves teams that want branch shape preserved. The merge-time re-integration is lazy (§2), so the cost is one rebase per actual merge, not continuous. | (A) rebase [recommended] · (B) merge-commit integration · (C) per-workspace setting defaulting to rebase |
| `Q-GIT-CONFLICT-RESOLVER` | Who resolves a same-file conflict at merge? | **Stage agent via `--resume` proposes a resolution → human accepts (reusing the reject-reopens-stage loop); escalate to `needs-input` if the agent fails or the conflict is semantic.** | Reuses existing [features/07] machinery (conflict = the reject note); keeps B-23 (AI proposes, human accepts, Conductor merges); no autonomous `--ours`/`--theirs`. | (A) agent-`--resume` first [recommended] · (B) straight-to-`needs-input` (no AI conflict edits) · (C) Conductor auto-rebase only, human resolves in editor |
| `Q-GIT-CI-GATE` | Is the CI pipeline a blocking gate for merge? | **Blocking by default (no merge on red); a per-workspace `allowMergeOnRedCI` Admin+ override for known-flaky cases.** | A 5-person team wants the safety; the override is the escape hatch a forge would call "merge despite pipeline". | (A) blocking + override [recommended] · (B) always blocking (no override) · (C) advisory-only (never blocks) |
| `Q-GIT-REVERT-SCOPE` | How is a bad merge rolled back? | **Forward `git revert <mergeCommit>` via a `mr-revert` `[control-API]` op; never `reset --hard`/`push --force` on a shared branch.** | History-safe: other parallel tickets that already re-baselined onto the bad commit are unaffected; the revert is itself an audited merge + RAG delta. | (A) forward `git revert` [recommended] · (B) revert + auto-open a fix ticket · (C) heavier rollback-to-tag snapshot model |
| `Q-GIT-MERGE-CONCURRENCY` | Serial merges, or a parallel merge engine with optimistic retry? | **Serial — one `mr-merge` signal drained at a time under `lease:orchestrator`; defer any parallel-merge optimization.** | At 5-person/handfuls-per-day cadence, serial is the simplest correct model (Rule 7b) and eliminates the rebase-then-someone-merged race window. Parallel-with-retry is unneeded complexity. | (A) serial [recommended] · (B) parallel + optimistic-concurrency retry (deferred) |
| `Q-GIT-BRANCHNAME` | Branch naming when a ticket is re-activated / two share a number space? | **`DEV-<ticketNumber>` (one durable branch per ticket); a collision-safe suffix only if a forge requires unique short-lived branches.** | The ticket number is the stable forge-portable key; re-activation reuses the same branch (the container is what's disposable, not the branch). | (A) `DEV-####` reused [recommended] · (B) `DEV-####-<attempt>` per re-activation · (C) `DEV-####/<stageKind>` (rejected — breaks the one-branch-per-ticket / DH5 unit) |
| `Q-GIT-BASE-STALENESS` | What happens when a ticket's frozen baseline is far behind the live default? | **Advisory "N commits behind" on the MR; the human's lever is re-activate (fresh baseline) or proceed (merge-time rebase reconciles). No automatic forced re-baseline.** | Auto-re-baselining would break DH5 (frozen code + RAG snapshot) silently; the merge-time rebase already handles correctness — staleness is a UX hint, not a correctness gate. | (A) advisory + human lever [recommended] · (B) auto-re-baseline past a threshold (rejected — breaks DH5) · (C) block merge past a hard staleness limit |

---

## §10. Self-check (review invariants)

- **No new verbs** introduced anywhere. The frozen `[02 §2]` surface (7 worker + 6 assistant, all `read|propose`) is untouched; `VERB_REGISTRY` conformance (`Q-ENG-VERB-CONFORMANCE`) is unaffected.
- **No write verb granted to any LLM session.** Every git write — branch, rebase, push, open/merge MR, resolve conflict, revert — is a Conductor action behind `[control-API]` (B-23, [01 §3.3]). The AI proposes (`propose_suggestion` "ready to merge"); a human accepts; the Conductor writes via `forge.repoHosting.*`/`forge.mergeRequests.*`.
- **Single-writer serialization preserved.** Merges drain serially under `lease:orchestrator` (G8/G16, [CONTROL_API §7]); no two merges run concurrently → no rebase-then-someone-merged race (§3).
- **Frozen baseline (DH5) intact.** Branches edit against the frozen `commitHash`; the only fresh-base moment is the lazy merge-time rebase (§2). No silent re-baselining (`Q-GIT-BASE-STALENESS`).
- **Isolation preserved.** Parallel tickets edit isolated clone-into-volume checkouts ([07b §4]); they interact only at the serialized merge boundary (§0).
- **History-safe rollback.** Rollback is forward `git revert`, never a shared-branch history rewrite (§6) — parallel tickets that re-baselined are unaffected.
- **Forge-mode-agnostic.** §3–§6 read normalized `ForgeEvent`s ([FORGE_ABSTRACTION §3]); the same logic runs on GitLab / GitHub / built-in — only the merge call's backend differs (§7). GitLab mode is non-regressive ([FORGE_ABSTRACTION §5]).
- **Multi-tenancy preserved.** Every orchestrator-side git/merge/CI worker runs under `runInTenant(workspaceId, …)` ([04b §11c], `Q-SEC-RUNINTENANT`).
- **Every genuine fork is an open question** (§9) with a recommended default — `Q-GIT-REBASE-POLICY`, `Q-GIT-CONFLICT-RESOLVER`, `Q-GIT-CI-GATE`, `Q-GIT-REVERT-SCOPE`, `Q-GIT-MERGE-CONCURRENCY`, `Q-GIT-BRANCHNAME`, `Q-GIT-BASE-STALENESS`.
- This doc **edits no existing file** — it is the new git-strategy layer the MR / CI / forge docs cite as `[GIT_STRATEGY §N]`.
