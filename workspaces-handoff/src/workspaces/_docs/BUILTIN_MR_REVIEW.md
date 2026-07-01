# Built-in MR review — the full merge-request experience (threads · approvals · merge · conflicts) over the forge seam

> **⚑ V1 SCOPE:** mostly DEFERRED — there is NO built-in MergeRequest entity and NO on-platform merge in V1; push-on-approval → the GitLab ‘create merge request’ URL replaces this ([V1_SCOPE.md] §3.1). This doc is the design-horizon record. Read [V1_SCOPE.md] first.

> The killer feature for a 5-person team. Expands the ticket-local "changed-files review" ([07_CODE_CHANGES_REVIEW]) into a **full merge-request surface**: rich diff, review threads/comments anchored to file+line, approvals + approval rules, merge (fast-forward / squash / merge-commit) with conflict handling, and the federation rule for external forges. This doc OWNS the `MergeRequest`/`ReviewThread`/`ReviewComment`/`Approval` schema + the review UX; [FORGE_ABSTRACTION] owns the `mergeRequests` capability seam (`Q-FORGE-MR-EXPANSION-OWNER` assigns the split). In **built-in** mode Workspaces owns the MR (sourceOfTruth=`workspaces`, [FORGE_ABSTRACTION §4]); in **external** mode it federates with the GitLab MR / GitHub PR via `ForgeProvider.mergeRequests`. Cites architecture as `[01 §x]`…`[07 §x]`, `[07b]`, `[CONTROL_API]`, `[04b §N]`, `[FORGE_ABSTRACTION §N]`; codes via [REFERENCE_CODES]. Last updated: 2026-06-04.
>
> **No new verbs.** This doc introduces **zero** structured-channel verbs. The frozen 7+6 surface ([02 §2], all `read|propose`, none write) is untouched. Every MR write — open, comment, resolve-thread, approve, merge, close, reopen — is a **[control-API] route → `preApiExecute` RBAC → enqueue a Conductor action**, drained serially by the single-instance Conductor (the only writer, [01 §3.3]). An AI stage-agent NEVER writes an MR; it `propose_suggestion`s ("ready to merge"), a human accepts, the Conductor merges (B-23). The review read path is `query_context` ([02 §2]) — the same diff path [07] already uses.

---

## 0. One-paragraph summary

Today the review surface is **ticket-local** ([07]): a stage finishes, the user opens **Files & refs**, steps through the changed files at the frozen `commitHash` (DH5), and approves-or-rejects via the stage's `approve` QuestionSet — and the "MR" itself is just `Ticket.mrUrl` pointing at a GitLab MR ([04b §13], `Q-DATA-ASSIGNMENT`). That floor is too ticket-local for a team that lives in code review. This doc keeps [07] as the **inline-promote gate** and adds a **first-class `MergeRequest` entity** with the four things a real review needs: **(1) rich diff** — reusing the **UI-Builder `CodebaseEditor` in changed-files mode** ([08_CODEBASE_VIEWER]/[07]), never a parallel diff impl; **(2) review threads/comments** anchored to `(filePath, line, side, baseCommit)`, resolvable, with replies; **(3) approvals + approval rules** (N-approver gates, RBAC-tied, single-Owner-aware, [04b §11e]); **(4) merge** (fast-forward / squash / merge-commit) with **conflict detection + resolution** tied to the [07 §A] git substrate. In **built-in** mode the `MergeRequest` row is **authoritative** and the merge runs against the orchestrator-hosted bare repo ([FORGE_ABSTRACTION §7.1]); in **external** mode the row is a **cache/projection** and `merge`/`diff`/threads **federate** to the forge MR/PR where the API allows ([FORGE_ABSTRACTION §3]). Every write routes through `[control-API]` → Conductor; the AI only proposes. **No new verbs.**

---

## 1. Where this sits — [07] is the floor, this is the full surface

| Surface | [07_CODE_CHANGES_REVIEW] (floor, ships first) | This doc (full MR, the killer feature) |
|---|---|---|
| **Scope** | One **stage's** output before promote; the `done`-banner gate. | The whole **branch → target** change set (`DEV-####` → default), spanning all stages of the ticket. |
| **Diff** | Changed-files stepper at the frozen stage `commitHash`; whole-ticket vs stage-delta toggle (D10). | Same UI-Builder editor ([08]) + the same toggle, **plus** line-anchored comment gutters + thread markers in the diff. |
| **Verdict** | The stage `approve` QuestionSet (Approve == Promote; Reject re-opens the stage, [07] q3). | A **structured approval set** (N approvers + rules) gating **merge**, distinct from the per-stage promote gate. |
| **Comments** | **None** ([07] "line-level review comments / threaded code review — out for v1"). | **Review threads/comments** anchored to file+line+side, resolvable, with replies (§4). |
| **Merge** | Out (promote ≠ merge; merge is the forge's). | **Owned** (built-in) or **federated** (external): fast-forward / squash / merge-commit + conflict handling (§6). |
| **Entity** | No new persisted model (baseline is a UI toggle, [07] Data). | `MergeRequest` + `ReviewThread` + `ReviewComment` + `Approval` (§3). |

**The relationship is additive, not a rewrite.** [07]'s changed-files stepper, its `FileDiffViewer` interim, its `query_context` diff path, and its baseline toggle are **reused verbatim** as the diff pane of the MR view. This doc wraps that pane in the MR shell (header · threads · approvals · merge bar) and adds the persisted entities. A team that only wants the inline promote gate keeps [07]; a team that wants real review opens the MR. `Q-MR-FLOOR` (§9) records whether the MR view **replaces** the [07] tab or sits beside it — recommended: **the MR is the [07] tab, expanded** (one surface, the promote gate becomes the merge gate when an MR exists).

---

## 2. The `MergeRequest` lifecycle (built-in mode — Workspaces owns it)

In built-in mode (`Workspace.forgeMode='builtin'`, sourceOfTruth=`workspaces`, [FORGE_ABSTRACTION §4]) the `MergeRequest` row is **authoritative** — there is no external MR to defer to. The lifecycle is a small, Conductor-owned state machine; every transition is a `[control-API]` op → Conductor → `forge.mergeRequests.*` ([FORGE_ABSTRACTION §3]).

```
            mr-open                      mr-ready / mr-draft
   (none) ──────────▶ draft ◀───────────────────────────────▶ open
                        │                                        │
                        │ mr-ready                               │ mr-approve × (rules met, §5)
                        ▼                                        ▼
                       open ──────────────────────────────▶ approved
                        │                                        │
                        │ mr-close          mr-merge (FF/squash/merge-commit, §6)
                        ▼                                        ▼
                      closed ◀── mr-reopen ──── merged ◀── (conflict? → conflict, §6.3)
```

| State | Meaning | Entered by | RBAC (§5) |
|---|---|---|---|
| `draft` | WIP; not yet review-ready (an AI stage may still be iterating). Approvals **cannot** be cast on a draft. | `mr-open {draft:true}` or `mr-draft` | work-on-tickets |
| `open` | Review-ready; threads + approvals accumulate. | `mr-open` / `mr-ready` | work-on-tickets |
| `approved` | Approval rules satisfied (§5); the **Merge** button unlocks. Still re-openable to `open` if a new commit lands ([07 §A] head moves). | Conductor, when `mr-approve` makes the rule pass | (derived; not a user-set state) |
| `merged` | `forge.mergeRequests.merge` succeeded; teardown + RAG delta fire (§7). **Terminal.** | `mr-merge` (Conductor) | work-on-tickets (merge cap, §5) |
| `closed` | Abandoned without merge; branch retained ([07 §A] "branch + `TicketEvent` retained"). Reopenable. | `mr-close` | work-on-tickets |
| `conflict` | A merge attempt hit conflicts against `targetBranch` (§6.3). Transient; resolves back to `open`/`approved` once resolved. | Conductor, on a failed merge precheck | (derived) |

- **Approvals reset on new head (`Q-MR-APPROVAL-RESET`, §9).** When a new commit lands on `sourceBranch` (a stage re-runs, [07] Reject loop, or a fixup), the `headCommit` advances. **Recommended default: stale-approval invalidation** — approvals cast against the prior `headCommit` are marked stale (not deleted; [04b §11a] append-only spirit) and the MR drops `approved → open`. This is the GitHub/GitLab "dismiss stale approvals" posture; it prevents merging code nobody reviewed. The alternative (sticky approvals) is faster but unsafe for a real team.
- **State is a Conductor write, always.** No `_api` handler flips `MergeRequest.state` inline ([CONTROL_API §7]); it enqueues a `WorkspaceSignal`, the Conductor drains it serially and writes the row + a `TicketEvent` (`type:'mr'`, [04b §6]) so the board/activity surfaces render the transition from the same `seq`-ordered log.

**No new verbs.** Every transition above is a `[control-API]` op (§8), never a structured-channel verb.

---

## 3. Data model additions

Four net-new tenant-scoped, append-aware models. `MergeRequest`'s seam-relevant shape is pinned in [FORGE_ABSTRACTION §7.2]; this doc owns the **full** schema + the three review models. All carry `workspaceId` (tenant, [04b §11]); all fold into the [04b §13] field sweep and the INDEX delta table.

```prisma
// The merge request. AUTHORITATIVE in built-in mode (sourceOfTruth='workspaces');
// a CACHE/PROJECTION of the forge MR/PR in gitlab/github mode (url = Ticket.mrUrl, [04b §13]).
model MergeRequest {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId               // tenant
  ticketId      String?  @db.ObjectId               // the DEV-#### ticket this MR belongs to (null for non-ticket MRs)
  number        Int                                  // per-workspace human id (Redis INCR ws:{id}:mrseq) → "MR #42"
  title         String
  description   String                               // markdown; seeded from the carry-over summary on open ([02 §4])
  sourceBranch  String                               // 'DEV-####'
  targetBranch  String                               // the project default ([07 §A])
  baseCommit    String                               // merge-base frozen at open ([07 §A] DH5); the diff/comment anchor baseline
  headCommit    String                               // current tip of sourceBranch; advances on re-run → approval reset (§2)
  state         String                               // 'draft'|'open'|'approved'|'merged'|'closed'|'conflict' (§2)
  mergeStrategy String?                              // 'fast-forward'|'squash'|'merge-commit' — chosen at merge (§6), null until merged
  mergeCommit   String?                              // resulting commit after a successful merge (squash/merge-commit); null for FF
  authorId      String?  @db.ObjectId               // opener (human) or null when AI-proposed→human-accepted (B-23; provenance in TicketEvent)
  externalRef   Json?                                // external mode: { mrIid?, prNumber?, url } cache of the forge MR/PR ([FORGE_ABSTRACTION §3])
  url           String?                              // builtin: app.<domain>/.../mr/<number>; external: the forge MR/PR url (= Ticket.mrUrl)
  createdAt     DateTime @default(now())
  mergedAt      DateTime?
  closedAt      DateTime?

  @@unique([workspaceId, number])
  @@index([workspaceId, state])
  @@index([workspaceId, ticketId])
}

// A review conversation anchored to a location in the diff (or MR-level when filePath is null).
model ReviewThread {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId               // tenant
  mergeRequestId String  @db.ObjectId
  filePath      String?                              // null ⇒ an MR-level (non-line) thread
  line          Int?                                 // 1-based line in the anchored side; null ⇒ file-level
  side          String?                              // 'base'|'head' — which side of the diff the line is on (the [08] CodeRange side)
  anchorCommit  String                               // the headCommit the thread was anchored against (for re-anchoring on new head, §4)
  status        String   @default("open")            // 'open'|'resolved' — resolvable; resolution is a Conductor write
  resolvedById  String?  @db.ObjectId
  createdAt     DateTime @default(now())
  resolvedAt    DateTime?

  @@index([workspaceId, mergeRequestId, status])
  @@index([workspaceId, mergeRequestId, filePath])
}

// A single comment inside a thread. APPEND-ONLY (an edit is a new comment / superseding append, [04b §11a]).
model ReviewComment {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId               // tenant
  threadId      String   @db.ObjectId
  authorId      String   @db.ObjectId               // the human commenter (AI never authors a review comment, §4)
  body          String                               // markdown
  createdAt     DateTime @default(now())

  @@index([workspaceId, threadId, createdAt])
}

// An approval cast against a specific head. Stale-on-new-head (§2 Q-MR-APPROVAL-RESET).
model Approval {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId               // tenant
  mergeRequestId String  @db.ObjectId
  approverId    String   @db.ObjectId               // the WorkspaceMember who approved
  headCommit    String                               // the headCommit approved (stale if MR.headCommit advances, §2)
  stale         Boolean  @default(false)             // set true (not deleted) when headCommit advances ([04b §11a])
  createdAt     DateTime @default(now())

  @@unique([workspaceId, mergeRequestId, approverId, headCommit])  // one live approval per (member, head)
  @@index([workspaceId, mergeRequestId, stale])
}
```

- **External mode reuses the same rows as a cache.** In `gitlab`/`github` mode `MergeRequest.externalRef` carries the forge MR/PR identity and `url` mirrors `Ticket.mrUrl` ([04b §13]). Threads/comments/approvals mirror the forge's where the API allows (§8 federation); where it does not, they degrade to read-only forge data + a "comment on GitLab" deep-link (`Q-MR-FED-WRITE`, §9). **No schema fork** — the columns are forge-derived caches the adapter fills, exactly like [FORGE_ABSTRACTION §4]'s `Ticket.mrUrl` posture.
- **Append-only where it matters.** `ReviewComment` and `Approval` are append-grade (join the [04b §11a] set in spirit — an edited comment is a new append; a withdrawn approval is `stale=true`, never a hard delete). `MergeRequest`/`ReviewThread` are mutable rows the Conductor writes (state/status transitions). All six review-write paths are Conductor actions (§8).
- **Delete-cascade.** `MergeRequest`/`ReviewThread`/`ReviewComment`/`Approval` join the workspace teardown cascade ([04b §11d]) alongside `Ticket`/`TicketEvent`.

**INDEX delta:** `MergeRequest` (full schema; [FORGE_ABSTRACTION §7.2] pinned the seam shape), `ReviewThread`, `ReviewComment`, `Approval` (net-new persisted models); the [07] `DiffBaseline` UI type is reused unchanged.

**No new verbs.** These are persisted rows the Conductor writes via `[control-API]`; nothing here is a structured-channel verb.

---

## 4. Rich diff + review threads/comments (reuse the [08] editor seam — no parallel impl)

**The diff IS the [08]/[07] editor.** The MR diff pane is the **UI-Builder `CodebaseEditor` in changed-files mode** ([07], [08_CODEBASE_VIEWER]) — driven through the **same mount/props contract** (`openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`, [08]). The host calls `setChangedFiles(mr.changedFiles)` and `setBaselineCommit(mr.baseCommit)`; the whole-MR-vs-per-stage toggle (D10) and the prev/next stepper from [07] are reused verbatim. Until UI-Builder lands the interim is the existing read-only `FileDiffViewer`/`DiffView` ([07] ⚠) — comment gutters degrade to a flat per-file comment list in the interim (`Q-MR-INTERIM`, §9). **No parallel diff implementation** — this is the same rule [07]/[08] already enforce (D7).

**Threads anchored to file+line+side.** A review thread is a `ReviewThread` anchored to `(filePath, line, side, anchorCommit)` — `side` is the [08] `CodeRange` side (`base`/`head`). The host opens a thread by reading the editor's current selection (the `CodeRange` from `revealRange`/the gutter click) and enqueuing `mr-comment {filePath, line, side, body}` (§8). The Conductor materializes the `ReviewThread` (if new) + the first `ReviewComment` and emits a `TicketEvent` (`type:'comment'`, [04b §6]) so the thread appears live in the diff and the activity log from the same `seq` stream.

- **Re-anchoring on new head (`Q-MR-REANCHOR`, §9).** When `headCommit` advances, a thread's `(filePath, line)` may have moved. **Recommended default: best-effort re-anchor by diff-hunk mapping, fall back to "outdated" badge** — the Conductor maps the old line through the `anchorCommit..headCommit` hunk diff ([07 §A] `git.diffNames`/hunk data); if the line still exists it re-anchors, else the thread is flagged **outdated** and pinned to the file (still readable, not lost). This mirrors GitHub/GitLab outdated-thread behavior and avoids silently dropping review context.
- **Resolve / reopen.** A thread resolves via `mr-resolve-thread {threadId}` → Conductor sets `status='resolved'` + `resolvedById`. Approval rules MAY require all threads resolved before merge (§5, a per-workspace rule flag). Reopen is the symmetric `mr-reopen-thread`.
- **The AI never authors a review comment.** `ReviewComment.authorId` is always a human ([04b] — the AI's output is the *code under review*, not the review). An AI stage-agent surfaces its readiness via `propose_suggestion` ("ready for review / ready to merge", [02 §2]) which becomes a `WorkspaceSuggestion` ([04b §8]); a human reading the MR is the reviewer. **No agent write to any review row.**

**No new verbs.** Comment/resolve are `[control-API]` ops; the read path is `query_context` ([02 §2]); the agent's only touch is `propose_suggestion` (propose-grade).

---

## 5. Approvals + approval rules (RBAC-tied, single-Owner-aware)

An MR gates merge on an **approval rule** evaluated by the Conductor. The rule is a small per-workspace (optionally per-project) config; the default is deliberately light for a 5-person team.

**Approval-rule shape (config, not a new persisted MR field):**

| Field | Meaning | Default |
|---|---|---|
| `minApprovals` | N distinct non-stale approvals required to reach `approved`. | **1** (light default for a small team; `Q-MR-MIN-APPROVALS`, §9) |
| `requireAllThreadsResolved` | All `ReviewThread.status` must be `resolved` before merge. | **false** (advisory; teams opt in) |
| `excludeAuthor` | The MR author's own approval does not count toward `minApprovals`. | **true** (you don't approve your own MR) |
| `requiredApproverRole` | Optional: approvals must come from a `WorkspaceRole` capability (e.g. "review code"). | none (any work-on-tickets member, B-08) |

- **RBAC tie-in (B-08, [04b §11e]).** Casting an approval requires the **"work on tickets"** capability (Owner/Admin/Member, D69) — or `requiredApproverRole` when set. The check is in `preApiExecute` ([CONTROL_API §5]); an unauthorized `mr-approve` returns a denied `ControlAck` and enqueues nothing. Approval rules live on the same `RBAC_CAPABILITIES` matrix ([16 §RBAC], B-28) — **no matrix change** (D69 posture).
- **Single-Owner awareness ([04b §11e], D77).** The approval model never grants merge rights a role doesn't already have; the single-Owner invariant is orthogonal (it governs ownership transfer, not merges). A workspace with one Owner + four Members still works: `minApprovals:1, excludeAuthor:true` means any second member can approve.
- **Approval is a Conductor write.** `mr-approve {mergeRequestId}` → `preApiExecute` RBAC → enqueue → Conductor appends an `Approval` row (against the current `headCommit`), re-evaluates the rule, and if satisfied transitions `open → approved` + emits the `TicketEvent`. Withdrawing is `mr-unapprove` → `Approval.stale=true` (never hard-deleted, [04b §11a]) → re-evaluate (may drop back to `open`).
- **Merge cap.** The **Merge** action itself is gated on **work-on-tickets** (D69) — the same cap that promotes a stage ([07]). A higher bar (Admin+ to merge to the default branch) is a `Q-MR-MERGE-CAP` opt-in (§9); recommended default is **work-on-tickets** to keep the small-team flow frictionless.

**No new verbs.** Approve/unapprove are `[control-API]` ops gated in `preApiExecute`; the Conductor evaluates the rule and writes.

---

## 6. Merge + conflict handling (ties to the [07 §A] git substrate)

Merge is the one MR action that touches git. In **built-in** mode the Conductor merges against the **orchestrator-hosted bare repo** ([FORGE_ABSTRACTION §7.1]); in **external** mode it **delegates** to `forge.mergeRequests.merge` (the forge performs the merge, §8). Either way the trigger is `mr-merge {mergeRequestId, strategy}` → `[control-API]` → Conductor → `forge.mergeRequests.merge(mrId, strategy)` ([FORGE_ABSTRACTION §3]).

### 6.1 Merge strategies

| Strategy | What it does | When |
|---|---|---|
| `fast-forward` | Move `targetBranch` to `headCommit` (no merge commit). Requires `targetBranch` is an ancestor of `headCommit` (linear). | Default when linear; cleanest history. |
| `squash` | Collapse the branch's commits into one new commit on `targetBranch`. `mergeCommit` = the squash commit. | Default for noisy AI-iteration branches (many fixup commits) — recommended default, `Q-MR-DEFAULT-STRATEGY` (§9). |
| `merge-commit` | A two-parent merge commit. Preserves branch topology. | When history matters / non-linear. |

**Recommended default: `squash`** — AI stage iteration ([07] Reject loop) produces many small commits; squash keeps `targetBranch` history readable. Per-workspace overridable; the merge bar offers all three (the chosen one persists to `MergeRequest.mergeStrategy`).

### 6.2 The merge precheck (always, before any write)

Before merging, the Conductor runs a **precheck** against the frozen substrate:
1. **State gate** — MR is `approved` (rule satisfied, §5) and not `draft`/`merged`/`closed`.
2. **Head freshness** — `headCommit` matches the row (no race with an in-flight stage re-run); if not, abort + emit a `ws-ai` conflict correction ([CONTROL_API §6.3]).
3. **Conflict probe** — a dry-run merge of `headCommit` into `targetBranch` ([07 §A] git substrate / `forge.mergeRequests.conflictState`). Clean → proceed; conflicting → §6.3.

### 6.3 Conflict handling

When the probe (or the forge) reports conflicts, the Conductor transitions the MR to **`conflict`** and emits a `TicketEvent` (`type:'mr'`, metadata `{conflictFiles[]}`). **No merge write happens.** Resolution paths (`Q-MR-CONFLICT-RESOLVE`, §9):

- **Recommended default (v1): rebase-back-to-the-agent.** The conflicted state surfaces in the MR with the conflicting files listed; the user **re-opens the stage** ([07] Reject loop, q3) with "resolve conflicts against `targetBranch`" as the `--resume` prompt for the **same agent**. The agent rebases/merges `targetBranch` into `DEV-####` in its worktree ([07 §A]), pushes a new `headCommit`, the MR drops back to `open` (approvals reset, §2), and the merge is re-attempted. This reuses the existing agent-loop + the single-instance git lease (G8/G16) — **no new conflict-editor surface in v1**.
- **Deferred (P2): in-MR 3-way conflict editor.** Resolving conflicts directly in the UI-Builder editor ([08] `edit` mode) is the natural upgrade once [08]'s `edit` mode lands (it is itself deferred, [08] q3). Until then, conflict resolution is the agent's job — consistent with B-23 (the human doesn't hand-edit; the agent proposes, the Conductor writes).
- **External mode** defers conflict semantics to the forge (`forge.mergeRequests.conflictState` / the forge's own conflict UI); the built-in MR shows the forge's conflict status + a deep-link.

### 6.4 Post-merge — teardown + RAG delta fire identically

On a successful merge the Conductor writes `state='merged'` + `mergeCommit`/`mergedAt`, then **synthesizes the same normalized merge `ForgeEvent`** the [07 §C] webhook would ([FORGE_ABSTRACTION §7.2]) — so the **[07 §A] container teardown** + the **[07 §D] RAG delta-index** run **identically**, whether the merge came from a GitLab webhook (external) or a built-in git hook on the bare repo. The Conductor can't tell which forge produced the merge ([FORGE_ABSTRACTION §3] conformance bar). Branch + `TicketEvent` are **retained** ([07 §A]); only the container is torn down.

**No new verbs.** `mr-merge` is a `[control-API]` op → Conductor → `forge.mergeRequests.merge`; conflict resolution rides the existing [07] agent re-open loop.

---

## 7. How an AI stage-agent's output becomes a reviewable MR (B-23 end-to-end)

This is the load-bearing all-in-one flow — the AI proposes, a human reviews, the Conductor merges — with **no write verb** anywhere:

1. **Agent works** in its `DEV-####` worktree ([07 §A]); on stage end it `emit_carryover`s the envelope (`{summary, changedFiles[], commitHash}`, [02 §4]). The Conductor freezes the snapshot (DH5).
2. **MR open is a Conductor action.** When the ticket reaches a review-bearing stage (or the user opens review), a `mr-open` `[control-API]` op enqueues → the Conductor materializes the `MergeRequest` (built-in) or opens the forge MR/PR + caches it (external, `forge.mergeRequests.open`, [FORGE_ABSTRACTION §3]). `description` is seeded from the carry-over `summary`; `changedFiles` from the envelope. The agent did **not** open the MR — it proposed readiness (`propose_suggestion` "ready for review", [04b §8]); the human/auto-trigger accepted; the Conductor wrote (B-23).
3. **Human reviews** in the MR surface (§4): rich diff, threads/comments, approve. The AI never comments or approves.
4. **Reject loops to the agent.** A review thread asking for a change → the user re-opens the stage ([07] q3); the thread/comment context can seed the `--resume` prompt. The stage flips `done → busy`, the agent fixes, pushes a new `headCommit`, approvals reset (§2), threads re-anchor (§4).
5. **Approve → merge.** Once the approval rule passes (§5), a human triggers `mr-merge` (§6). **The AI never merges** (B-23) — even a `stage.on_approval` auto-promote trigger ([03 §1]) routes through the **same** `[control-API]` → Conductor path; the Conductor is the only writer ([01 §3.3]).
6. **Merge → teardown + delta** (§6.4).

**The B-23 invariant, stated once:** the AI's entire MR surface is `read` (`get_ticket`/`query_context`) + `propose` (`propose_suggestion`). It cannot open, comment, approve, or merge an MR. Every one of those is a human-initiated `[control-API]` write the Conductor executes. **No new verbs; no write verb granted to any LLM session.**

---

## 8. Control-API operations + external-mode federation

Every MR write is one route in the `[control-API]` family ([CONTROL_API §3]): `method:"POST"`, `auth:{login:true}`, `preApiExecute` RBAC (§5), enqueue a Conductor action ([CONTROL_API §7]), return `ControlAck` ([CONTROL_API §6]). **None is a verb.** New catalogue rows extending [CONTROL_API §8] (and the [FORGE_ABSTRACTION] `mr-*` rows):

| `op` | Target / payload | RBAC (§5) | Conductor action → adapter | Federation in external mode |
|---|---|---|---|---|
| `mr-open` | `{ticketId, draft?}` | work-on-tickets | materialize `MergeRequest` / `forge.mergeRequests.open(branch, base, meta)` | opens the GitLab MR / GitHub PR; caches `externalRef`/`url` |
| `mr-ready` / `mr-draft` | `{mergeRequestId}` | work-on-tickets | flip `draft ⇄ open` | flips the forge MR draft/ready state where supported |
| `mr-comment` | `{mergeRequestId, filePath?, line?, side?, body, threadId?}` | work-on-tickets | append `ReviewThread`(+`ReviewComment`) | posts to the forge MR/PR thread where the API allows; else read-only + deep-link (`Q-MR-FED-WRITE`) |
| `mr-resolve-thread` / `mr-reopen-thread` | `{threadId}` | work-on-tickets | set `ReviewThread.status` | mirrors forge thread resolution where supported |
| `mr-approve` / `mr-unapprove` | `{mergeRequestId}` | work-on-tickets (or `requiredApproverRole`) | append/stale `Approval`; re-eval rule (§5) | casts the forge approval where the forge has one; else built-in-only approval gate |
| `mr-merge` | `{mergeRequestId, strategy}` | work-on-tickets (merge cap, §5) | precheck (§6.2) → `forge.mergeRequests.merge(id, strategy)` → synthesize merge `ForgeEvent` (§6.4) | delegates to the forge's merge; the forge merge webhook drives teardown |
| `mr-close` / `mr-reopen` | `{mergeRequestId}` | work-on-tickets | flip `closed ⇄ open` | closes/reopens the forge MR/PR |

- **Federation degradation (`Q-MR-FED-WRITE`, §9).** Some forge APIs don't expose line-anchored thread writes or programmatic approvals uniformly across GitLab/GitHub. **Recommended default: federate reads always; federate writes where the API supports it, else fall back to a built-in record + a "open on \<forge\>" deep-link** — the user is never blocked, and the built-in row stays the local read model. Full bidirectional write-federation is a per-adapter capability flag, not a v1 guarantee.
- **The AI-proposed bridge.** An `mr-open`/`mr-ready` can originate from an accepted `WorkspaceSuggestion` ("ready to merge", [04b §8], [CONTROL_API §4 bridge]) — the accept is itself an `accept-suggestion` `[control-API]` call. The verb proposes; the control-API (on human accept) requests; the Conductor writes.

**No new verbs.** All `mr-*` ops are `[control-API]` routes; pipeline/CI status on the MR is Conductor-written events ([FORGE_ABSTRACTION §8]).

---

## 9. Open questions (Q-MR-*) — defaults recommended, user to confirm/override

| id | Question | Recommendation | Why |
|---|---|---|---|
| `Q-MR-FLOOR` | Does the full MR view replace the [07] changed-files tab or sit beside it? | **Expand the [07] tab into the MR view — one surface; the promote gate becomes the merge gate when an MR exists.** | Avoids two parallel review surfaces; [07]'s stepper/diff/baseline reuse verbatim as the MR diff pane. A team wanting only inline promote keeps the same tab without an MR row. |
| `Q-MR-APPROVAL-RESET` | Do approvals survive a new head commit? | **No — stale-invalidate on new `headCommit` (drop `approved → open`); mark `Approval.stale=true`, never delete.** | Merging code nobody re-reviewed is the classic review-bypass bug; matches GitHub/GitLab "dismiss stale approvals". Sticky approvals are faster but unsafe for a real team. |
| `Q-MR-MIN-APPROVALS` | Default `minApprovals`? | **1, `excludeAuthor:true`.** | Light default for a 5-person team — one peer approval, you can't approve your own. Per-workspace overridable upward. |
| `Q-MR-MERGE-CAP` | RBAC to merge to the default branch? | **work-on-tickets (same as stage promote).** | Keeps the small-team flow frictionless; Admin+-to-merge is a per-workspace opt-in for teams that want a gate. |
| `Q-MR-DEFAULT-STRATEGY` | Default merge strategy? | **`squash`.** | AI iteration ([07] Reject loop) yields many fixup commits; squash keeps `targetBranch` readable. FF/merge-commit offered per-merge. |
| `Q-MR-CONFLICT-RESOLVE` | How are merge conflicts resolved in v1? | **Rebase-back-to-the-agent ([07] re-open loop); no in-UI conflict editor in v1.** | Reuses the existing agent loop + single-instance git lease; an in-MR 3-way editor rides [08]'s deferred `edit` mode (P2). Consistent with B-23 (agent proposes, Conductor writes). |
| `Q-MR-REANCHOR` | What happens to a thread when its line moves? | **Best-effort re-anchor by hunk mapping; else flag "outdated" + pin to file (never drop).** | Matches forge outdated-thread behavior; preserves review context across re-runs without silent loss. |
| `Q-MR-FED-WRITE` | How far does external-mode write-federation go? | **Reads always federate; writes federate where the forge API supports it, else built-in record + deep-link.** | GitLab/GitHub thread/approval write APIs differ; never block the user — the built-in row is the local read model, the deep-link is the escape hatch. Per-adapter capability flag, not a v1 guarantee. |
| `Q-MR-INTERIM` | Comment gutters before UI-Builder lands? | **Degrade to a flat per-file comment list over the `FileDiffViewer` interim; full line-anchored gutters land with UI-Builder.** | [07]/[08] already gate the rich editor behind UI-Builder (D7); threads still persist + render, just without inline gutters until the editor mounts. |

---

## 10. Composition — how 07 / 08 / 22 / FORGE_ABSTRACTION compose

| Doc | Today | Over this MR surface |
|---|---|---|
| **[07_CODE_CHANGES_REVIEW]** | Ticket-local changed-files stepper + `approve` promote gate; no comments, no merge. | The **floor**: its diff pane, stepper, baseline toggle (D10), and `FileDiffViewer` interim are reused verbatim as the MR diff; its Reject loop is the conflict-resolution + change-request loop (§6.3/§7). |
| **[08_CODEBASE_VIEWER]** | The full UI-Builder editor + the mount/props contract; shared with [07]. | The MR diff IS this editor in changed-files mode (§4); line-anchored comments use its `CodeRange`/`side`. Conflict editor (P2) rides its deferred `edit` mode. |
| **[22] / board sync** | `Ticket.mrUrl` is a GitLab MR url cache (B-29, [04b §13]). | In external mode `MergeRequest` caches the forge MR/PR (`externalRef`/`url` = `Ticket.mrUrl`); the board renders MR state from the `TicketEvent` (`type:'mr'`) stream in every mode. |
| **[FORGE_ABSTRACTION]** | Defines the `mergeRequests` capability + the three modes + sourceOfTruth flip. | This doc is the **surface** over that seam (`Q-FORGE-MR-EXPANSION-OWNER`): it owns the `MergeRequest`/review schema + UX; the seam owns which adapter the Conductor calls (built-in row vs forge MR/PR). |
| **[CONTROL_API]** | The write transport; §8 catalogue. | All `mr-*` ops (§8) are new catalogue rows in the same family — `preApiExecute` → enqueue → Conductor → adapter. None is a verb. |
| **[04b §6] TicketEvent** | The `seq`-ordered append-only log; `type` includes `'mr'`/`'comment'`. | Every MR transition + comment emits a `TicketEvent`, so board/activity/MR surfaces render from one stream. |

---

## 11. Self-check (review invariants)

- **No new verbs** introduced anywhere. The frozen `[02 §2]` surface (7 worker + 6 assistant, all `read|propose`) is untouched; `VERB_REGISTRY` conformance (`Q-ENG-VERB-CONFORMANCE`) is unaffected.
- **No write verb granted to any LLM session.** Open / comment / resolve / approve / merge / close are **all** human-initiated `[control-API]` writes the Conductor executes (B-23, [01 §3.3]). The AI's entire MR surface is `get_ticket`/`query_context` (read) + `propose_suggestion` (propose). It never authors a review comment, casts an approval, or merges.
- **Conductor is the only writer.** No `_api` handler mutates `MergeRequest`/`ReviewThread`/`ReviewComment`/`Approval` inline ([CONTROL_API §7]); each enqueues a `WorkspaceSignal` the single-instance Conductor drains under `lease:orchestrator` (G8/G16).
- **Diff reuses the [08]/[07] editor seam** — no parallel diff implementation (D7); the interim is the existing `FileDiffViewer` ([07] ⚠).
- **Built-in vs external is the FORGE_ABSTRACTION flip** — authoritative row (sourceOfTruth=`workspaces`) vs forge MR/PR cache (sourceOfTruth=`forge`, B-29); the Conductor stays forge-blind, only the adapter differs.
- **Multi-tenancy preserved** — every orchestrator-side MR write runs under `runInTenant(workspaceId, …)` ([04b §11c]); the four models are tenant-scoped + join the teardown cascade ([04b §11d]).
- **Append-only respected** — `ReviewComment`/`Approval` are append-grade ([04b §11a] spirit); a withdrawn approval is `stale=true`, never hard-deleted.
- **Every genuine fork is an open question** (§9) with a recommended default — `Q-MR-FLOOR`, `Q-MR-APPROVAL-RESET`, `Q-MR-MIN-APPROVALS`, `Q-MR-MERGE-CAP`, `Q-MR-DEFAULT-STRATEGY`, `Q-MR-CONFLICT-RESOLVE`, `Q-MR-REANCHOR`, `Q-MR-FED-WRITE`, `Q-MR-INTERIM`.
- This doc **edits no existing file** — it is the new MR surface the forge/CI/git docs cite as `[BUILTIN_MR_REVIEW §N]`, sitting over `[FORGE_ABSTRACTION]`'s `mergeRequests` capability.
