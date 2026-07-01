# Addition 10 — Edit-as-review-feedback

> **Tier:** V1 · **Lane:** D · **Status:** NEW (2026-06-11). **Depends on #9 (per-stage commit).**
> **Pitch:** the diff the human makes during a paused stage — already computed for the resume prompt — is *also* routed to a `PromptFeedback` record (`aiOutput` = the stage's per-stage commit from #9; `humanCorrection` = the user's diff), auto-captured, user-excludable, feeding the per-workspace few-shot loop so the pipeline learns *this team's* corrections for free.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #10 — **LOCKED 2026-06-11: auto-capture, user can exclude.**

> **Authority & prereqs.** This is a Lane-D ([V1_SCOPE §6]) addition over [`CODE_EDITOR`](../CODE_EDITOR.md) §4 (the edit-lock / pause / resume git-diff capture), [`AI_QUALITY_AND_EVALS`](../AI_QUALITY_AND_EVALS.md) §5 (the `PromptFeedback` model + the few-shot loop + the "MR edit delta" signal it names), [`features/07_CODE_CHANGES_REVIEW`](../features/07_CODE_CHANGES_REVIEW.md) (the reject-`--resume`-note machinery this rides), [`04b_DATA_MODEL_ADDENDA`](../04b_DATA_MODEL_ADDENDA.md) (the persisted-shape ledger; this proposes a 2-field delta to AIQ §5's `PromptFeedback`), [`CONTROL_API`](../CONTROL_API.md) §8 (the exclude op), and **[additions/09 per-stage commit](./09_per_stage_commit.md)** (the per-stage baseline). **[V1_SCOPE] wins on any conflict.** Codes via [REFERENCE_CODES]. Cite as `[additions/10 §N]`.
>
> **No new verbs.** This addition adds zero structured-channel verbs. The capture is a Conductor-side side-effect of the existing `resume` [control-API] op (the diff is already computed for the `--resume` prompt — [CODE_EDITOR §4]); the exclude is a new [control-API] op (a Conductor write of a flag), never a client mutation, never an LLM verb (B-23). The frozen 7+6 surface ([02 §2], all `read|propose`) is untouched.

---

## 1. The gap this closes (V1's no-sync single-commit editor starves the feedback loop)

[AI_QUALITY_AND_EVALS §5] names the **richest** feedback signal as *"the before→after delta when a human **edits** a code diff before merge (the MR review)"* ([AIQ §5.1] table row 2) — a labeled `(aiOutput, humanCorrection)` pair that, promoted to a few-shot example, teaches the pipeline this team's taste. But **V1 deliberately has no built-in MR** ([V1_SCOPE §3.1], [04b §18] — `MergeRequest`/`ReviewThread` are DEFERRED). The merge happens **on GitLab**, off-platform. So the single highest-signal capture point AIQ §5 relies on **does not exist inside V1** — the human's edit lands on GitLab's MR UI, where Workspaces never sees the before→after pair.

Yet V1 *does* produce that exact pair, in a different place: the **paused-stage edit window** ([CODE_EDITOR §4], [V1_SCOPE §3.2]). When a `userMayEdit=false` stage is paused and the human edits the AI's output in the in-container VS Code session, the orchestrator already **computes `git diff` of the worktree against the pre-pause state** and injects it into the agent's `--resume` prompt (*"you may proceed; the user made these changes: \<diff\>"*). **That diff IS the `humanCorrection`.** The agent's output it corrects is the **per-stage commit** that #09 freezes as the stage's baseline. The pair is computed and thrown away after the resume.

| AIQ §5 assumed capture point | V1 reality | This addition's fix |
|---|---|---|
| Human edits the diff **on the built-in MR** before merge | No built-in MR ([04b §18] DEFERRED); merge is on GitLab, off-platform | Capture the **paused-stage edit** instead — the same `(aiOutput, humanCorrection)` shape, on-platform |
| The before→after delta = the MR edit | The before→after delta = the **resume git-diff** ([CODE_EDITOR §4]) | Route that same diff to `PromptFeedback`, not just to `--resume` |
| `aiOutput` = the diff the AI produced | The agent's output for the touched files at pause time | The **#09 per-stage commit** — the clean, frozen baseline of "what the AI wrote" |

**Net:** V1's no-sync, single-commit-on-complete editor ([V1_SCOPE §3.1 step 3/4]) would otherwise **starve** the §5 feedback loop of its best signal. This addition restores it by reusing the resume-diff that [CODE_EDITOR §4] already computes — zero new compute, zero new diff, one extra write target.

---

## 2. Locked decision (auto-capture, user can exclude)

**LOCKED ([DECISIONS_LEDGER] #10, 2026-06-11): every paused-window edit auto-persists as a `PromptFeedback` record; the user can mark a given edit "don't learn from this" to exclude it.**

| Axis | Decision | Why |
|---|---|---|
| **Default behavior** | **Auto-capture.** Every `resume`-with-changes (a non-empty paused-edit diff) writes a `PromptFeedback` row automatically — no opt-in, no per-edit prompt. | The signal is high-value and ephemeral; an opt-*in* would capture ~nothing (nobody clicks "save this as training data"). Compounding quality needs the default-on path ([AIQ §5 pitch]). |
| **User control** | **Exclude after the fact.** The user can flag any captured edit "don't learn from this" → a [control-API] op sets a flag on the row; the few-shot curation (§3.4) skips flagged rows. | Mirrors CLAUDE.md "report, don't auto-decide": capture by default, let the human veto. An edit that was a one-off hack or contains noise is excludable without blocking the loop. |
| **Capture point** | The **same git diff** already computed for the resume-with-changes `--resume` prompt ([CODE_EDITOR §4]) — routed to `PromptFeedback` *in addition to* the resume prompt. **No second diff.** | Reuse, not recompute (Rule 7b). The diff exists for exactly one tick; fork it. |
| **`aiOutput` baseline** | The **stage's per-stage commit from [additions/09]** — the frozen "what the AI produced" for those files. | #09's per-stage delta is the *clean* source of the negative half of the pair; without a per-stage commit the baseline would be ambiguous (whole-ticket vs prev-stage). #09 is the dependency that makes the pair well-defined. |
| **Scope** | **Per-workspace** (`runInTenant`, [04b §11c]); feeds the few-shot loop **capped 3–5 per role/AIQ** ([AIQ §5.3], `Q-AIQ-FEWSHOT-CAP`). | Examples teach *this* team; never cross tenants ([AIQ §5.3], `Q-AIQ-FEWSHOT-SCOPE`). |
| **Safety** | **Secret-scrub + size cap** gate every captured row before any reuse — ties to the Tier-2 resume-diff hardening ([CODE_EDITOR §4] / `Q-EDITOR-READONLY-ENFORCE`-adjacent) and the AIQ §5.4 `redactionState` gate. | The diff is about to enter a model prompt; a smuggled secret/PII or a 50k-line diff must not. |
| **Exclude transport** | A **[control-API] op** (`feedback-exclude`) → `preApiExecute` RBAC → Conductor sets the flag (B-23). **Never a client mutation.** | Same single-writer invariant as every other lever ([CONTROL_API §7]); the flag is authoritative state, so the Conductor writes it. |

This addition does **not** change the resume flow itself ([CODE_EDITOR §4] is untouched) — it **tees** off it.

---

## 3. Build-ready mechanics

### 3.1 Capture point (reuse resume-diff; baseline = #09 per-stage commit)

The capture is a Conductor side-effect of the existing `resume` op. The sequence, with the new step **bolded**:

```
1. Stage is userMayEdit=false, running → user clicks Pause-AI
     → `pause` [control-API] op → Conductor parks the Stage-Agent PTY,
       AgentSession.status → 'paused', container kept ([CONTROL_API §8], [CODE_EDITOR §4]).
2. User edits in the in-container VS Code session (the sanctioned write window, [CODE_EDITOR §7]).
3. User clicks Resume-AI → `resume` [control-API] op → Conductor, BEFORE re-attaching the agent:
     a. computes  D = `git diff <pre-pause-tree>..<worktree>`   ← the resume-diff, ALREADY computed ([CODE_EDITOR §4])
     b. injects D into the `--resume` prompt ("you may proceed; the user made these changes: <D>")
  >> c. **TEE: if D is non-empty, also enqueue a `feedback-capture` Conductor write (§3.2):**
  >>      **aiOutput        = the #09 per-stage commit for the touched files (the frozen baseline)**
  >>      **humanCorrection = D (the same diff)**
  >>      **→ PromptFeedback row, kind:'edit', redactionState:'pending', source:'paused-edit'**
     d. re-attach the agent (`--resume` on claudeSessionId), AgentSession.status → 'busy',
        editor returns to read-only ([CODE_EDITOR §4]).
```

**Baseline resolution (the #09 dependency, [additions/09]).** The `aiOutput` half is **not** the whole-ticket diff and **not** "the file contents at pause time" — it is the **per-stage commit [additions/09] freezes for this stage**, scoped to the files the user touched. Concretely:

- #09 commits the agent's output **once per stage** at a known `commitHash` (the per-stage baseline). [features/07] 07.q1 already resolves the per-stage delta as the commit-range `prevStage.commitHash..thisStage.commitHash`.
- The capture's `aiOutput` = the **content of the user-touched files at the #09 per-stage commit** (the agent's last word on those files before the human touched them).
- The capture's `humanCorrection` = `D`, the paused-edit diff against that same tree.
- So the pair is exactly *"what the AI wrote for these files (#09 commit) → what the human changed it to (`D`)"* — a clean, well-scoped before→after, which is precisely why **#09 is the dependency**: without a per-stage commit the "before" is ambiguous.

> **DEFAULT — flag if wrong:** the capture fires **only on a non-empty paused-edit diff** (`userMayEdit=false` → pause → edit → resume). The `userMayEdit=true` concurrent-write mode ([CODE_EDITOR §7]) is **NOT** captured in V1 — there the agent and human interleave writes with no clean pre-pause boundary, so there is no well-defined `(aiOutput, humanCorrection)` pair. Capturing that mode is `Q-FB-CONCURRENT` (§5).

### 3.2 Data model (PromptFeedback record; cite/propose 04b + AIQ §5)

`PromptFeedback` **already exists** — [AIQ §5.1] defines it in full. This addition **reuses it as-is** and proposes a **2-field delta** (consistent with [04b]'s "reconcile deltas into bodies" discipline). The existing fields map directly:

| AIQ §5.1 field | This addition uses it as |
|---|---|
| `workspaceId` | tenant scope (`runInTenant`, [04b §11c]) — per-workspace by construction |
| `roleKey` | the **#09 stage's `kind`** ([04b §12] `StageKind`: `code`/`review`/…) whose output was edited |
| `ticketId` | the ticket whose paused stage was edited |
| `promptVersionId` | the `PromptVersion` that produced the edited output ([AIQ §4] join — "which prompt the human corrected") |
| `kind` | **`'edit'`** (the paused-edit is an edit, not a bare reject) |
| `aiOutput` | the **#09 per-stage-commit content** of the touched files (§3.1) |
| `humanCorrection` | the **resume-diff `D`** ([CODE_EDITOR §4]) |
| `reason` | optional — a free-text note the user may attach when excluding (§3.3) |
| `promotedToFewShot` | set by the §3.4 curation (Admin+ `fewshot-promote`, [AIQ §5.2]) — unchanged |
| `redactionState` | **`'pending'`** at capture → `'clean'` after the secret-scrub (§3.3) — the existing AIQ §5.4 gate, reused |

**Proposed 2-field delta to `PromptFeedback` ([AIQ §5.1], reconciled in [04b] when its lane opens):**

```prisma
model PromptFeedback {
  // … all existing AIQ §5.1 fields unchanged …
  excludedFromLearning Boolean @default(false)   // NEW — D10: user marked "don't learn from this";
                                                  //   curation (§3.4) skips rows where true. Set ONLY
                                                  //   by the `feedback-exclude` [control-API] op (§3.3).
  source               String  @default("paused-edit")  // NEW — provenance: 'paused-edit' (this addition)
                                                  //   | 'reject' | 'promote-edit' | 'missed-question'
                                                  //   (the other AIQ §5.1 capture rows). Lets the few-shot
                                                  //   renderer + analytics distinguish edit-as-feedback.
  @@index([workspaceId, roleKey, promotedToFewShot, excludedFromLearning])  // curation scan excludes flagged
}
```

- `excludedFromLearning` is the locked-decision's "don't learn from this" flag. **It is a Conductor-written flag, never a client field** ([CONTROL_API §7]). It does **not** delete the row (append-only spirit, [04b §11a]) — it suppresses the row from §3.4 curation.
- `source='paused-edit'` distinguishes this addition's rows from the other AIQ §5.1 capture points (reject, promote-with-edit, missed-question) so the renderer can label them and analytics can measure their yield separately.
- **No other `PromptFeedback` change.** `PromptVersion.fewShotRefs[]` ([AIQ §4.1]) still references promoted rows; the versioned-bank model is untouched.

> **04b note:** `PromptFeedback` is an AIQ-§5-owned model, not yet folded into [04b §6–§17]. When AIQ's persistence lands in the V1 schema, these two fields land with it; this addition is the design record for the delta (mirroring how [04b §18] pins deferred shapes — except this is V1-IN, not deferred).

### 3.3 Exclude flow (control-API op) + secret-scrub + size cap

**Exclude — a new [control-API] op** ([CONTROL_API §8] catalogue grows by one row; **no new verb**):

| `op` | Target | RBAC ([CONTROL_API §5]) | Conductor action | Owning doc |
|---|---|---|---|---|
| `feedback-exclude` | `{ feedbackId }` (+ optional `{ reason }`) | **work-on-tickets** (D69) — the same cap that gates pause/resume; the editor user owns their edit | set `PromptFeedback.excludedFromLearning = true` (+ `reason` if given) | [additions/10], [AIQ §5] |

- The UI surface is a small **"don't learn from this"** affordance on the changes page / the per-ticket activity, next to a captured paused-edit (a `TicketEvent` of `type:'file-change'` with `metadata.source:'paused-edit'` can carry the `feedbackId` deep-link, [04b §6]). One tap → `feedback-exclude` → `ControlAck` → the row is flagged on the Conductor's next drain ([CONTROL_API §6]).
- **Never a client mutation** ([CONTROL_API §7], the locked decision): the browser *requests* the exclude; the Conductor writes the flag. Optimistic UI may show "excluded…" pending the `seq`-merged confirmation ([CONTROL_API §6.3]).
- **Default un-exclude is out of V1 scope** (`Q-FB-UNEXCLUDE`, §5) — exclude is one-way in V1; re-including is a future op.

**Secret-scrub + size cap (the safety gate, before any reuse):**

- **`redactionState` gate (reused, [AIQ §5.4]):** the captured row is written `redactionState:'pending'`. A **secrets/PII scan** must mark it `'clean'` before the §3.4 curation may promote it — it is about to be injected into a model prompt. This is the *existing* AIQ §5.4 credential-hygiene gate (`Q-SEC-CREDLIFETIME`-adjacent), not a new mechanism. A row that fails the scan stays `'pending'` and is never promotable.
- **Size cap (ties to Tier-2 resume-diff hardening):** the captured `humanCorrection` diff is **capped** (a configurable `FEEDBACK_DIFF_MAX_BYTES`, default small — e.g. 32 KB). A paused edit larger than the cap is **captured with the diff truncated + flagged `redactionState:'pending'` and a `metadata.truncated:true`** so it is never silently promoted; the few-shot renderer ([AIQ §5.3]) only ever renders bounded examples (the K-cap there is per-example *count*; this cap is per-example *size*). This is the same hardening posture the resume-diff itself needs ([CODE_EDITOR §4] injects `D` into a prompt — an unbounded `D` is already a resume-prompt hazard; this addition shares the cap).
- Both gates run **Conductor-side under `runInTenant`** ([04b §11c]) — the capture write, the scan, and the cap are all orchestrator paths, never client.

### 3.4 Feeding the few-shot loop (cite AIQ)

The captured rows feed the **existing [AIQ §5.2] curation pipeline unchanged** — this addition only *supplies* rows, it does not alter how they become examples:

```
PromptFeedback(kind:'edit', source:'paused-edit', redactionState:'clean', excludedFromLearning:false)
  → (optional) the workspace Assistant CLUSTERS similar paused-edits + PROPOSES the N highest-signal
       as few-shot candidates (propose_suggestion → 'config-review' WorkspaceSuggestion, [AIQ §5.2]) — read|propose only
  → an Admin+ ACCEPTS via [control-API] `fewshot-promote` ([AIQ §5.2]) → Conductor writes:
       PromptFeedback.promotedToFewShot = true
       a NEW PromptVersion whose fewShotRefs[] includes it ([AIQ §4.1] — versioned WITH the prompt)
  → the renderer appends the example BELOW the resolved §2 prompt, capped 3-5 per role ([AIQ §5.3], Q-AIQ-FEWSHOT-CAP)
```

- **The curation filters on the new flags:** only `excludedFromLearning:false` **and** `redactionState:'clean'` rows are eligible (the §3.2 index supports the scan). A user-excluded paused-edit is invisible to clustering; a still-`pending` (un-scrubbed/over-cap) row is too.
- **The AI proposes, a human promotes** ([AIQ §5.2], B-23) — this addition adds **no** auto-promotion. Auto-*capture* (§2) ≠ auto-*promote*: capture is default-on (the locked decision); promotion stays the deliberate, RBAC-gated, eval-gated [AIQ §5.2/§5.4] path. A paused-edit becomes a few-shot example only after Admin accept + a passing golden score ([AIQ §5.4]).
- **The example renders per [AIQ §5.3]** — the `(aiOutput, humanCorrection)` pair becomes the *"✗ AI produced … ✓ Human corrected to …"* block below the resolved prompt, teaching the lesson ("don't add the refactor the ticket didn't ask for", etc.). `source:'paused-edit'` lets the renderer caption it *"learned from an in-editor correction"*.
- **Eval-gated (the loop closes on AIQ §3/§4):** a `PromptVersion` carrying a new paused-edit example must pass the golden set ([AIQ §3], [AIQ §5.4]) before promotion to `default` — so an overfit paused-edit that *degrades* output fails the gate and never ships. The loop is **measured**, not blind.

---

## 4. Invariants honored

| Invariant | How this addition keeps it |
|---|---|
| **B-23 — Conductor is the only writer** | Capture is a Conductor side-effect of the existing `resume` op; exclude (`feedback-exclude`) and promote (`fewshot-promote`) are [control-API] → `preApiExecute` → Conductor writes. The AI never writes a `PromptFeedback` row, never excludes, never promotes its own example ([AIQ §5.2]). |
| **FROZEN verbs (no new verbs)** | Zero structured-channel verbs added. The frozen 7+6 ([02 §2], all `read|propose`) is untouched. Capture rides the existing `resume` flow; curation rides the existing `propose_suggestion`; exclude/promote are [control-API] ops (verb-free, [CONTROL_API §4]). |
| **`runInTenant`** | The capture write, the secret-scrub, the size cap, and the exclude flag are all orchestrator-side paths under `runInTenant(workspaceId, …)` ([04b §11c]); feedback is per-workspace, never cross-tenant ([AIQ §5.3] `Q-AIQ-FEWSHOT-SCOPE`). |
| **PTY-billing** | No extra model turn. The capture reuses the diff already computed for `--resume`; the secret-scrub is deterministic Conductor code; clustering/promotion are the *existing* AIQ §5 paths (the optional Assistant clustering is already budgeted there). This addition spends **zero** new subscription turns. |
| **LuckyStack conventions** | `feedback-exclude` is a file-based `_api` route (`src/workspaces/_api/feedback-exclude_v1.ts`, `method:"POST"`, `auth:{login:true}`, `preApiExecute` RBAC, typed `apiRequest` — no `as any`, [CONTROL_API §3]); the new `PromptFeedback` fields follow the Prisma/tenant conventions ([04b]); reuses the injected error/tenant shims (root `CLAUDE.md` Rule 21). |
| **V1_SCOPE wins** | This addition lives entirely inside V1-IN surfaces: the [V1_SCOPE §3.2] pause/resume-with-changes flow + the [AIQ §5] feedback loop. It restores the §5 "MR edit delta" signal that V1's no-built-in-MR scope ([V1_SCOPE §3.1], [04b §18]) removed — *without* re-instating the deferred MR entity. No deferred surface is touched. |
| **#09 dependency** | The `aiOutput` baseline is the [additions/09] per-stage commit — the addition is correct **only** when #09 has committed the stage's output. Without #09 the "before" is undefined (§1, §3.1). |

---

## 5. Open sub-decisions (DEFAULTs)

> Defaults recommended inline; each flags a genuine fork. None blocks the §3 mechanics.

| Id | Question | Recommended DEFAULT |
|---|---|---|
| **Q-FB-09-PREREQ** | [additions/09] (per-stage commit) and [00_DECISIONS_LEDGER] do **not yet exist** in `additions/` (the folder is empty as of 2026-06-11). This addition cites both as dependencies. | **Author #09 first** (it is the clean `aiOutput` baseline). Until #09 lands, this addition's capture cannot resolve a well-defined "before" (§3.1) — it is **blocked on #09**, by design (the task names it as a dependency). Create `00_DECISIONS_LEDGER.md` with the #10 LOCKED row alongside. **Flagged for the user.** |
| **Q-FB-CONCURRENT** | Capture paused-edits only, or also the `userMayEdit=true` concurrent-write mode ([CODE_EDITOR §7])? | **Paused-edits only in V1.** Concurrent mode interleaves agent+human writes with no clean pre-pause boundary → no well-defined `(aiOutput, humanCorrection)` pair (§3.1). Concurrent-mode capture is a future opt-in. |
| **Q-FB-MULTI-PAUSE** | A stage paused→edited→resumed **multiple times** produces multiple diffs. One `PromptFeedback` row per pause, or one merged per stage? | **One row per pause-resume cycle** (each is a distinct correction event). Curation (§3.4) already clusters; merging at capture time would lose the per-correction signal. |
| **Q-FB-EXCLUDE-WINDOW** | How long can a user exclude a captured edit after the fact? | **Until it is promoted to a few-shot example** (`promotedToFewShot=true`). Once promoted (Admin+ accept + golden gate, [AIQ §5.2/§5.4]) it is part of a `PromptVersion`; excluding then = rolling back that version (a separate, heavier op). Pre-promotion exclude is the cheap path. |
| **Q-FB-UNEXCLUDE** | Can a user un-exclude (re-include) a flagged edit? | **No in V1** — exclude is one-way (§3.3). Re-including is a future `feedback-include` op; V1 keeps the surface minimal (Rule 7b). |
| **Q-FB-SOURCE-WEIGHT** | Should `source:'paused-edit'` rows be weighted differently from `reject`/`promote-edit` rows in clustering? | **No weighting in V1** — all `clean`, non-excluded `kind:'edit'` rows are equal candidates; `source` is provenance/labeling only. Weighting is a curation-tuning future. |

---

## 6. Build checklist (per-lane + verification)

> Lane **D** owns this addition ([V1_SCOPE §6]); the `PromptFeedback` delta + `feedback-exclude` handler touch **Lane B** (schema) and **Lane A** (control-API handler) contracts — coordinate via the frozen contract publish ([V1_SCOPE §6] non-overlap rule). The addition is correct when:

**Lane B (data) — the 2-field delta**
- [ ] `PromptFeedback.excludedFromLearning Boolean @default(false)` added ([AIQ §5.1] body); index `@@index([workspaceId, roleKey, promotedToFewShot, excludedFromLearning])` updated (§3.2).
  - *Verify:* a unit test asserts a default-`false` new row, and that the curation scan query ([AIQ §5.2]) filters `excludedFromLearning:false AND redactionState:'clean'`.
- [ ] `PromptFeedback.source String @default("paused-edit")` added; the other AIQ §5.1 capture points set their own `source`.
  - *Verify:* a paused-edit capture writes `source:'paused-edit'`; a reject writes `source:'reject'`.

**Lane A (engine/orchestrator) — capture tee + exclude op**
- [ ] On `resume` with a **non-empty** paused-edit diff `D`, the Conductor **tees** a `feedback-capture` write: `kind:'edit'`, `aiOutput`=#09 per-stage-commit content of touched files, `humanCorrection`=`D`, `redactionState:'pending'`, `source:'paused-edit'`, `promptVersionId`=the producing version (§3.1, §3.2). **The `--resume` injection is unchanged.**
  - *Verify:* a fake-driver test ([TESTING_STRATEGY §3]) pauses → edits → resumes and asserts (a) the `--resume` prompt still carries `D`, **and** (b) exactly one `PromptFeedback` row was written with the right pair; an **empty** edit writes **no** row.
- [ ] `feedback-exclude` [control-API] route (`src/workspaces/_api/feedback-exclude_v1.ts`): `method:"POST"`, `auth:{login:true}`, `preApiExecute` RBAC = work-on-tickets (D69), enqueues a Conductor write of `excludedFromLearning=true` (+ optional `reason`); returns `ControlAck` ([CONTROL_API §6]). **No inline mutation** (§3.3, [CONTROL_API §7]).
  - *Verify:* the auto-sweep ([ARCHITECTURE_TESTING]) contract-tests auth + rate-limit; a unit test asserts the handler enqueues a signal and **does not** write the flag directly.
- [ ] **Secret-scrub** marks the captured row `redactionState:'clean'` only after a passing PII/secret scan ([AIQ §5.4]); a failing scan leaves it `'pending'` (never promotable).
  - *Verify:* a row whose `humanCorrection` contains a planted secret stays `'pending'` and is excluded from the §3.4 candidate scan.
- [ ] **Size cap** `FEEDBACK_DIFF_MAX_BYTES` (env, default 32 KB): an over-cap `D` is captured truncated + `metadata.truncated:true` + `redactionState:'pending'` (§3.3).
  - *Verify:* an over-cap edit is captured truncated and is **not** promotable while `pending`.
  - *Action:* add `FEEDBACK_DIFF_MAX_BYTES` to `.env_template` + `.env.local_template`.
- [ ] All four orchestrator paths (capture, scan, cap, exclude-flag) run under `runInTenant` ([04b §11c]).

**Lane D (editor/changes UI) — the exclude affordance**
- [ ] A **"don't learn from this"** control on the changes page / activity next to a captured paused-edit (deep-linked via the `file-change` `TicketEvent` `metadata.source:'paused-edit'` + `feedbackId`, [04b §6]) → one-tap `feedback-exclude`; optimistic "excluded…" → `seq`-merged confirm ([CONTROL_API §6.3]).
  - *Verify:* agent-browser confirms the control fires `feedback-exclude` and reflects the confirmed flag (suggest→approve, root `CLAUDE.md` AI-browser ladder).
- [ ] i18n on all user-facing text (`useTranslator`, root `CLAUDE.md` Rule 13); colors from `src/index.css` `@theme` only (Rule 14).

**Cross-cutting (curation reuse — Lane B/A already own these via [AIQ §5])**
- [ ] The §3.4 loop is the **unchanged** [AIQ §5.2] curation — verify only that paused-edit rows surface as candidates (clustering input) and that promotion is still Admin+ accept + golden-gated ([AIQ §5.4]); **no auto-promotion** added.
- [ ] **Prereq gate:** [additions/09] exists and commits a per-stage baseline before this addition's capture can resolve `aiOutput` (Q-FB-09-PREREQ).

---

## 7. Citations

| This addition | Builds on / cited from |
|---|---|
| §1 the gap (no-MR starves §5) | [V1_SCOPE §3.1] (push-on-approval, no built-in MR), [04b §18] (`MergeRequest` DEFERRED), [AIQ §5.1] ("MR edit delta" signal) |
| §2 locked decision | [DECISIONS_LEDGER] #10, [CODE_EDITOR §4] (resume-diff capture point), [additions/09] (per-stage commit baseline) |
| §3.1 capture point | [CODE_EDITOR §4] (pause/edit/resume + the `git diff` injected into `--resume`), [CONTROL_API §8] (`pause`/`resume` ops), [features/07] 07.q1 (per-stage delta range), [additions/09] |
| §3.2 data model | [AIQ §5.1] (`PromptFeedback` body — reused), [04b §12] (`StageKind` for `roleKey`), [04b §11a] (append-only), [AIQ §4.1] (`PromptVersion.fewShotRefs[]`) |
| §3.3 exclude + scrub + cap | [CONTROL_API §5/§7/§8] (the op + enqueue-not-write), [AIQ §5.4] (`redactionState` gate), [CODE_EDITOR §4] (resume-diff hardening tie) |
| §3.4 few-shot loop | [AIQ §5.2] (curation), [AIQ §5.3] (render + K-cap), [AIQ §5.4] (eval-gated), [AIQ §4.1] (versioned bank), [AIQ §3] (golden gate) |
| §4 invariants | B-23 + [01 §3.3] (single writer), [02 §2] (frozen verbs), [04b §11c] (`runInTenant`), [CONTROL_API §3/§4] (control-API), [V1_SCOPE §3.2] |
| §6 build checklist | [TESTING_STRATEGY §3] (fake driver), [ARCHITECTURE_TESTING] (auto-sweep), [V1_SCOPE §6] (lanes), root `CLAUDE.md` (Rules 7b/13/14/21, AI-browser ladder) |

**Self-check:** No new verbs — capture rides the existing `resume` flow; exclude/promote are [control-API] ops; curation rides the existing `propose_suggestion` ([AIQ §5.2]). No write verb granted to any LLM session; every write is a Conductor action (B-23). `runInTenant` on every orchestrator path. Zero new subscription turns (PTY-billing untouched — the diff is reused, not recomputed). V1_SCOPE wins: this restores the [AIQ §5] feedback signal that V1's no-built-in-MR scope removed, without re-instating any deferred surface. Reuses the existing `PromptFeedback` model with a flagged 2-field delta; reuses #09's per-stage commit as the clean baseline. **Flagged:** [additions/09] and [00_DECISIONS_LEDGER] do not yet exist (Q-FB-09-PREREQ) — #09 is the hard prerequisite for the `aiOutput` baseline. This doc edits no existing file.
