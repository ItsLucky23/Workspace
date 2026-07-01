# AI_QUALITY_AND_EVALS — the layer that makes the pipeline produce GOOD output

> The output-quality contract. Every other doc proves the pipeline *runs* (the Conductor transitions correctly, the renderer emits byte-equivalent config, the forge writes are Conductor actions, the event log doesn't drop). **None of them proves the pipeline produces output a human wants to merge.** That is this doc: the actual system-prompt *content* per role (not just the rendering mechanism), a golden-tickets eval harness that regression-tests prompts + pipeline against known-good outcomes without burning subscription turns, prompt versioning + per-workspace A/B, and the feedback loop that turns human rejects/edits into few-shot examples that make a workspace's prompts measurably better over time.
>
> **Authority & prereqs.** Builds on [`GOLDEN_PLAN_STAGE`](./GOLDEN_PLAN_STAGE.md) (the D2 layering rendered to literal artifacts — §5 stage-instructions), [`features/02_PIPELINE_PRESETS`](./features/02_PIPELINE_PRESETS.md) (the D2 3-layer prompt resolution + the 3/5/7 tiers), [`02b_PROTOCOL_ADDENDA`](./02b_PROTOCOL_ADDENDA.md) (§B carry-over enforcement, §D `VERB_REGISTRY`, §E fenced-block summary contract, §F `emit_output`→`emit_carryover`), [`TESTING_STRATEGY`](./TESTING_STRATEGY.md) (§3 fake/replay `EngineDriver` — the seam this doc's harness rides), and [`03_AUTOMATION_AND_PLUGINS §3`](./03_AUTOMATION_AND_PLUGINS.md) (`AgentRole.systemPromptTemplate` — the base prompt layer). Cites architecture as `[01 §x]`…`[07 §x]`, `[07b]`, `[CONTROL_API]`, `[04b §N]`, `[FORGE_ABSTRACTION §N]`; codes via [`REFERENCE_CODES`](./REFERENCE_CODES.md) (B-23, B-O2, B-O4, B-14, B-25, B-35, D2, D4, D27, D49, G2). Carries `Q-AIQ-*` open questions inline. Last updated: 2026-06-04.
>
> **No new verbs.** This doc governs prompt *content*, eval *fixtures*, and feedback *capture* — it introduces zero structured-channel verbs. The frozen 7+6 surface ([02 §2], all `read|propose`, none write) is untouched. Every quality artifact this doc adds (a prompt version, an A/B assignment, a few-shot example promoted from a human edit) is a **[control-API] route → `preApiExecute` RBAC → Conductor write** (B-23, the Conductor is the only writer, [01 §3.3]); the prompts merely *render into* the §5 stage-instructions the [GOLDEN_PLAN_STAGE] renderer already emits.

---

## 0. The uncovered gap, named

The build docs form a chain from HTTP edge to durable write — and every link is tested ([TESTING_STRATEGY §7]). But the chain proves **mechanics**, not **merit**:

| Already covered | The merit question it does NOT answer |
|---|---|
| The renderer emits byte-equivalent config ([GOLDEN_PLAN_STAGE §9]) | Is the prompt it renders any *good*? |
| The Conductor walks the right transitions ([TESTING_STRATEGY §2]) | Did the agent produce a plan a human would accept? |
| The carry-over envelope validates ([02b §B]) | Is the *content* of the carry-over correct, or just schema-valid? |
| No write verb leaks (B-23, [02b §D]) | Does the Code stage write code that *passes review*? |
| The event log doesn't drop ([TESTING_STRATEGY §4]) | Does the Review stage catch the bug the Code stage introduced? |

A schema-valid `emit_carryover` whose `summary` is wrong, whose `changedFiles` miss the real change, or whose plan is hallucinated **passes every test in the build plan** and **fails the user**. This doc closes that gap with four pillars:

1. **System-prompt content per role** (§2) — the actual prompt scaffolds for Refine/Plan/Code/Review/Test, made concrete (the D2 layer-1 `AgentRole.systemPromptTemplate` bodies, with quality principles), not just the rendering mechanism [GOLDEN_PLAN_STAGE] already pins.
2. **Golden-tickets eval harness** (§3) — a fixture set of known tickets with expected outcomes, replayed against the **fake `EngineDriver`** ([TESTING_STRATEGY §3]) so the whole pipeline + prompts regression-test with **zero subscription turns**, plus an opt-in **live** lane for real-prompt scoring.
3. **Prompt versioning + per-workspace A/B** (§4) — a `PromptVersion` row, immutable + content-hashed, with an A/B split so a workspace can measure prompt B against prompt A on its own tickets.
4. **The feedback loop** (§5) — capture every human reject/edit of AI output as a `PromptFeedback` row; promote the highest-signal ones into a per-workspace **few-shot example bank** that renders into the §2 prompt, so the pipeline gets better at *this team's* code over time.

**No new verbs.** Each pillar is config + data the Conductor writes; none is an agent-facing verb.

---

## 1. Where prompt quality lives in the layered model (recap, then the content gap)

[features/02 §Resolution order] (D2) defines the 3-layer prompt resolution; [GOLDEN_PLAN_STAGE §5] renders it to literal `--append-system-prompt` text. The layers, restated as the **quality ownership** they imply:

```
1. AgentRole.systemPromptTemplate   (base — per roleKey, CODE fixture, [03 §3.2])
        ▼ overridden by                  ── §2 of THIS doc owns the CONTENT of this layer
2. preset per-stage override         (the WorkspacePreset fixture — CODE, per tier+stage)
        ▼ overridden by                  ── tier-specific tightening (e.g. professional dual-review)
3. user per-stage edit               (PipelineStageCfg.systemPrompt — DATA, per workspace)
        ▼ augmented by                   ── §5 few-shot bank renders BELOW the resolved prompt
   few-shot example block            (PromptFeedback-derived — DATA, per workspace, §5)
```

Three corrections to the prior docs' framing this doc makes explicit:

- **[GOLDEN_PLAN_STAGE §5] showed the *mechanism* (D2 flatten → `--append-system-prompt`) but used a thin placeholder body.** §2 here supplies the *real* layer-1 content for all five roles — the part that actually determines output quality.
- **The few-shot bank (§5) is a NEW fourth render input**, appended *below* the resolved layer-3 prompt (so user edits always win on conflict, but learned examples augment). It is per-workspace data, rendered by the same renderer, never a new layer of the *override* chain — it is additive context, not an override.
- **`systemPrompt` ≠ `customInstructions` ≠ `promptTemplate`** ([features/02 Resolved q3], [GOLDEN_PLAN_STAGE §4/§5]): `systemPrompt` is the persona/contract (this doc's quality surface); `customInstructions` is the per-turn `CLAUDE.md` domain rules; `promptTemplate` is the carry-over `{{chips}}` template. §2 owns only `systemPrompt`.

---

## 2. The system-prompt content per role (the layer-1 scaffolds)

These are the **`AgentRole.systemPromptTemplate` bodies** ([03 §3.2], CODE fixtures) — the base layer every preset and user edit refines. Each is a real scaffold (not a placeholder), built around five **cross-role quality principles** that the eval harness (§3) scores against:

> **The five quality principles (P1–P5), enforced by prompt + scored by §3):**
> **P1 — Report through the channel, never narrate-and-stop.** Every role finishes with a verb (`emit_carryover`); a prose-only turn is a §B reconciliation failure ([02b §B]). The prompt makes the verb the *only* exit.
> **P2 — Stay inside the role's write surface.** Reasoning roles (`needsWorkspace=false`) NEVER Edit/Write ([GOLDEN_PLAN_STAGE §2] deny set); code roles edit only the worktree. The prompt states the surface so refused-tool turns aren't wasted.
> **P3 — Ask, don't guess.** When a decision is underdetermined, `request_input` with a self-structured `Question[]` ([02b §G]) — never a confident hallucination. CLAUDE.md rule 3a's "present interpretations, don't pick silently" as a *prompt* principle.
> **P4 — Ground every claim in the context.** Cite the loaded context-docs / RAG / graph; do not invent files, symbols, or APIs. The single biggest source of un-mergeable output.
> **P5 — Scope discipline.** Touch only what the ticket asks (CLAUDE.md rule 7b / rule 27). The prompt forbids drive-by refactors — the #1 reviewer-reject reason captured by §5.

Each scaffold below is the layer-1 body. The renderer flattens it with the preset override (layer 2) and any user edit (layer 3), then appends the §5 few-shot block. **`{{chips}}`** are `promptTemplate` carry-over vars filled by the Conductor pre-spawn ([02 §4], [GOLDEN_PLAN_STAGE §5]); they are NOT part of the system prompt — shown here only where the role references them.

### 2.1 Refine (`roleKey: 'refine'`, `needsWorkspace: false`)

```text
You are the Refinement stage of an automated delivery pipeline. You take a raw ticket
(a title, a description, maybe a voice transcript) and turn it into an UNAMBIGUOUS,
implementable specification. You do not plan implementation steps and you NEVER edit
files or run commands.

Your job, in order:
1. Restate the ticket's INTENT in one paragraph — what outcome the user actually wants,
   not a paraphrase of the words.
2. List the EXPLICIT acceptance criteria (what "done" observably means).
3. Surface every AMBIGUITY as a structured question — do NOT resolve it by guessing.
   If the ticket is underspecified, call `request_input` with tappable choices
   (kind: 'choice') so a human decides. A confident wrong assumption here poisons
   every downstream stage. (P3)
4. Identify the likely affected area of the codebase from the loaded context only —
   never name a file you have not seen in the context. (P4)

You report EXCLUSIVELY through the structured channel. When the spec is unambiguous,
call `emit_carryover` with { summary, changedFiles[], openQuestions[], commitHash }.
If unresolved questions remain, they go in openQuestions[] AND you call `request_input`
before finishing — never silently defer them. (P1, P3)

Hard rules: read-only. No Edit/Write/Bash-mutation. (P2) Do not expand scope beyond the
ticket. (P5)
```

### 2.2 Plan (`roleKey: 'plan'`, `needsWorkspace: false`)

The [GOLDEN_PLAN_STAGE §1] fixture's `systemPromptTemplate` is this scaffold's one-line seed; here is the full quality-bearing body it should carry:

```text
You are the Planning stage of an automated delivery pipeline. You read the REFINED ticket
and the codebase context, then produce a precise, ORDERED implementation plan. You NEVER
edit files or run commands.

A good plan (the bar your output is scored against):
- Is a numbered sequence of concrete steps, each naming the specific file/symbol it touches
  (grounded in the context + the symbol/graph skills — never an invented path). (P4)
- States, per step, the OBSERVABLE change it produces (so Review and Test can verify it).
- Lists RISKS and a ROLLBACK note — what could break, how to undo.
- Does NOT touch anything the refined ticket did not ask for; if the plan reveals adjacent
  problems, it REPORTS them in openQuestions[], it does not fold them into the plan. (P5)
- Calls `request_input` when a design fork has no clearly-correct answer — present 2-4
  options, do not pick silently. (P3)

From Refined: {{summary}}
Known files: {{changedFiles}}

Finish by calling `emit_carryover` with the plan envelope. Optionally co-emit a
```ws-estimate``` block ({ tokenEstimate?, durationEstimate?, confidence? }) so the
orchestrator can size the Coding turn (D4/D27, [02b §E]). (P1)
```

### 2.3 Code (`roleKey: 'code'`, `needsWorkspace: true`)

The only role that writes — and the only one with an `ask`-tier permission set ([GOLDEN_PLAN_STAGE §2] note: code uses `ask` + the `Notification(permission_prompt)` escalation, not the read-only hard-deny).

```text
You are the Coding stage of an automated delivery pipeline. You implement the PLAN against
the ticket's git worktree at the frozen commit. You edit ONLY this worktree; you never push,
never open a merge request, never touch another ticket's branch. (P2)

Discipline (the bar):
- Implement EXACTLY the plan's steps. If a step is wrong or impossible, STOP and call
  `request_input` — do not improvise an alternative the plan never approved. (P3)
- Every changed line traces to the ticket. No drive-by refactors, no reformatting adjacent
  code, no "while I'm here" improvements. If you spot unrelated dead code or a bug, REPORT it
  in openQuestions[] — do not fix it. (P5 — this is the #1 reviewer-reject cause.)
- Reuse existing helpers/components from the context before writing new ones. (P4)
- Match the existing code style even where you would do it differently.
- Run the stage's allow-listed build/test/lint commands before finishing; a turn that ends
  with a broken build is a failed turn.

Project conventions and domain rules are in CLAUDE.md (your customInstructions); the plan and
refined spec are below. Finish by calling `emit_carryover` with { summary, changedFiles[],
openQuestions[], commitHash } — changedFiles[] MUST be the real set you edited (the diff is
the source of truth; a mismatch fails reconciliation). (P1)

From the Plan: {{summary}}
Plan touches: {{changedFiles}}
```

### 2.4 Review (`roleKey: 'code'`/`review` variant, `needsWorkspace: true`, read-mostly)

In `professional` the two reviewers are two `code`-role stages with *different review prompts* ([features/02 D1], Resolved q2 — Reviewer 1 → Reviewer 2 serial carry-over). The base review scaffold:

```text
You are a Code Review stage of an automated delivery pipeline. You review the diff the Coding
stage produced against the plan and the ticket. You read the worktree and run read-only checks;
you do NOT rewrite the code yourself — you report findings for a human or the Coding stage to act on.

Review for, in priority order:
1. CORRECTNESS — does the diff implement the plan, and does the plan satisfy the ticket?
   Trace each plan step to a change. A missing step is a blocking finding. (P4)
2. SCOPE — does the diff touch anything outside the ticket? Flag every drive-by change. (P5)
3. REGRESSION RISK — what existing behavior could this break? Name the call sites.
4. SECURITY — auth, input validation, secret handling (top priority unless the ticket says
   otherwise).
5. STYLE/CONVENTIONS — only after the above; never lead with nits.

Output findings as a structured list, each tagged blocking | non-blocking, each citing the
exact file:line. Do NOT approve-and-merge — you have no merge verb; the AI never merges (B-23).
If the diff is good, say so and let a human approve. (P2)

Finish with `emit_carryover` carrying your findings as the summary + structured artifact.
{{#if reviewer2}}Reviewer 1's findings are carried over below — do not repeat them; focus on
what they missed.{{/if}} (P1)
```

> **Forge-aware note ([FORGE_ABSTRACTION §7.2]):** Review is the stage whose output the **MR experience** renders. In built-in forge mode the findings become review-thread comments on the Workspaces-owned `MergeRequest`; in external mode they federate onto the GitLab MR / GitHub PR. Either way the agent only *proposes* findings (`emit_carryover` / `propose_suggestion`) — the human authors the actual MR comment/approval via [control-API] ([FORGE_ABSTRACTION §7.2]). The review *prompt* is forge-blind; only the rendering of its output differs. **No new verbs.**

### 2.5 Test (`roleKey: 'test'`/`code`, `needsWorkspace: true`)

```text
You are the Test stage of an automated delivery pipeline. You write and run tests that prove
the diff does what the ticket asked, and you turn the bug-or-not verdict into a concrete result.

The bar:
- Transform the acceptance criteria into VERIFIABLE assertions (CLAUDE.md rule 1a): "add
  validation" → a test for the invalid input exists and passes; "fix the bug" → a regression
  test exists and fails on the old code, passes on the new. (P4)
- Use the project's existing test layers (the framework's auto-sweep + per-route .tests.ts,
  or this repo's vitest) — do not invent a parallel harness.
- Run the tests. A turn that ends with un-run or failing tests (without an explanation) is a
  failed turn.
- Touch only test files + the minimum needed to make a test reachable. (P5, P2)

Report the pass/fail result + coverage gaps via `emit_carryover`. If the code is untestable as
written, REPORT it (openQuestions[]) rather than rewriting the implementation. (P1, P3)
```

**Render rules (so §2 is reproducible by the [GOLDEN_PLAN_STAGE] renderer):** each body above is the `AgentRole.systemPromptTemplate` CODE fixture; the renderer flattens it with the preset override + user edit ([features/02 D2]) into `PipelineStageCfg.systemPrompt`, materializes it as `stage-instructions.txt`, and appends it via `--append-system-prompt` ([GOLDEN_PLAN_STAGE §5/§6]). The §5 few-shot block (if any) is concatenated below. **No new verbs** — these are config the renderer consumes; the only exits the prompts name (`emit_carryover`, `request_input`) are existing worker verbs ([02b §A]).

---

## 3. The golden-tickets eval harness

> The regression test for *output merit* — the §0 gap. A fixture set of **known tickets with expected outcomes**, replayed against the pipeline so a prompt change, a preset change, or a Conductor change that *degrades output quality* fails CI **before** it reaches a real subscription turn.

### 3.1 What a golden ticket is

A golden ticket is a fixture: a frozen input + a frozen expected-outcome envelope + scored assertions. It lives under `_fixtures/golden-tickets/<id>/`:

```jsonc
// _fixtures/golden-tickets/GT-001-avatar-cachebust/ticket.json
{
  "id": "GT-001-avatar-cachebust",
  "title": "Avatar fallback flickers on ?v= cache-bust",
  "description": "When the avatar image URL changes its ?v= query param, the first-letter fallback flashes...",
  "preset": "professional",                 // which tier's prompts this exercises
  "stages": ["refine", "plan", "code", "review", "test"],
  "context": { "commitHash": "abc123", "fixtureRepo": "avatar-mini" },   // a tiny real repo snapshot
  "expected": {                              // the GOOD-output contract (§3.3 scoring targets these)
    "plan.changedFiles":  ["src/_components/Avatar.tsx", "src/_functions/avatar.ts"],
    "plan.mentionsRollback": true,
    "code.changedFiles":  ["src/_functions/avatar.ts"],       // the REAL fix is in the function, not the component
    "code.noScopeCreep":  true,                                 // P5 — must NOT touch unrelated files
    "review.catches":     ["fallback-key-stability"],          // Review must flag if Code missed the key fix
    "test.hasRegression": true
  }
}
```

The fixture repo (`avatar-mini`) is a **few-file real snapshot** at `commitHash` — small enough to live in the test tree, real enough that the symbol/graph/RAG skills return genuine results.

### 3.2 How it runs WITHOUT burning subscription turns (the fake-driver tie-in)

The harness rides the **`FakeEngineDriver`** / `ReplayEngineDriver` from [TESTING_STRATEGY §3] — the whole point of that seam. Two lanes:

| Lane | Driver | What it proves | Subscription cost |
|---|---|---|---|
| **Replay (default, CI)** | `ReplayEngineDriver` ([TESTING_STRATEGY §3.2]) | The pipeline + Conductor + renderer + carry-over enforcement drive the *recorded* good outcome end-to-end; a regression that breaks the *flow* (e.g. a prompt change that makes the agent skip `emit_carryover` → §B reconciliation, or a renderer change that drops a skill) fails. The recorded outcome is the §3.1 `expected` envelope. | **ZERO** — replays captured `[02 §3]` events + carry-over payloads; no CLI spawn. |
| **Live-scored (opt-in, gated)** | real `EngineDriver` | The actual *prompt content* (§2) produces a good outcome against a real model — the only lane that catches "the new prompt makes worse plans." Run **manually / nightly / pre-prompt-merge**, never in the ~1s unit sandbox. | Real turns — so it is **rate-limited, batched, and gated** (§3.4). |

The replay lane is what runs on every commit (it is deterministic and free); the live lane is the periodic "are the prompts actually good" check. This mirrors [TESTING_STRATEGY §6]'s spike-gates-then-seeds-fixtures pattern: a live-scored run that produces a *new* good outcome can be **promoted to a replay fixture** (record its events), so the expensive lane seeds the cheap one.

### 3.3 Scoring — how "good output" becomes a pass/fail

Output merit is scored by a **`GoldenScorer`** against the `expected` block — a layered scorer, cheapest checks first:

```
score(actualEnvelope, expected) →
  1. STRUCTURAL (free, deterministic):
     - emit_carryover present + schema-valid ([02b §B])           [P1]
     - changedFiles[] ⊆ expected ∪ allowed   AND   no file outside scope   [P5]
     - required files/symbols present in the plan/diff             [P4]
     - read-only role emitted no write event                       [P2 — reuses [02b §D] conformance]
  2. ASSERTION (deterministic, fixture-authored):
     - expected.review.catches ⊆ actual review findings
     - expected.test.hasRegression  (a regression test exists + the assertion shape)
  3. JUDGEMENT (live lane only, optional — Q-AIQ-LLM-JUDGE):
     - an LLM-as-judge scores plan quality / review thoroughness on a rubric, 0-5,
       for the dimensions structural checks can't reach (e.g. "is the rollback note sensible").
```

Tiers 1-2 are **free and deterministic** — they run in the replay lane on every commit. Tier 3 (LLM-as-judge) is **live-lane only**, optional, and itself a subscription cost — flagged `Q-AIQ-LLM-JUDGE`.

### 3.4 The live lane's guard rails (don't burn the subscription)

- **Gated, never in the unit run** — same discipline as the P0 spike ([TESTING_STRATEGY §6]): not a `vitest` file; a manual/nightly job (`npm run eval:golden --live`).
- **Batched + capped** — a configurable max-tickets-per-run + max-turns budget; a run that would exceed it stops with a partial report.
- **Pre-prompt-merge gate** — the live lane is the **required check before a `PromptVersion` is promoted to default** (§4): you do not ship a new prompt that scored worse on the golden set.
- **Quota-aware** — runs only when the subscription quota window allows; otherwise the replay lane (free) is the merge gate and the live run is deferred (`Q-AIQ-LIVE-CADENCE`).

### 3.5 What the golden set must cover (the fixture catalogue)

A small, high-leverage set — not exhaustive (CLAUDE.md rule 7b: minimum that earns its keep):

| Golden ticket | Targets | Principle stressed |
|---|---|---|
| `GT-001` clear bug-fix | the happy path: refine→plan→code→review→test all produce the expected envelope | P1, P4 |
| `GT-002` ambiguous ticket | Refine MUST `request_input`, not guess; scored on questions-raised | P3 |
| `GT-003` scope-creep trap | a ticket whose context contains tempting adjacent cleanups; Code MUST NOT touch them | P5 |
| `GT-004` hallucination trap | a ticket referencing a symbol that doesn't exist; Plan MUST flag it, not invent it | P4 |
| `GT-005` reviewer-catch | Code fixture deliberately misses a step; Reviewer MUST catch it | review quality |
| `GT-006` untestable-as-written | Test MUST report untestability, not rewrite the impl | P2, P3 |

Each is a regression anchor: a prompt edit that makes `GT-003` start touching the trap file fails CI loudly. **No new verbs** — the harness reads carry-over envelopes + the event log; it writes nothing through an agent.

---

## 4. Prompt versioning + per-workspace A/B

> A prompt is not config-you-edit-and-forget — it is a **versioned artifact** whose quality is measured. You must be able to ship prompt B, measure it against prompt A on a workspace's real tickets, and roll back if B is worse.

### 4.1 The `PromptVersion` row (immutable, content-hashed)

```prisma
// A versioned, immutable snapshot of a resolved system-prompt body for one roleKey
// (the §2 scaffold + preset override + the user edit baked in). DATA, tenant-scoped.
model PromptVersion {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId  String   @db.ObjectId               // tenant; runInTenant-scoped
  roleKey      String                               // 'refine'|'plan'|'code'|'review'|'test'|…
  stageId      String?  @db.ObjectId               // null = workspace-default for the role; set = per-stage override
  version      Int                                  // monotonic per (workspace, roleKey, stageId)
  body         String                               // the resolved layer-1→3 prompt text (pre few-shot)
  contentHash  String                               // sha256(body) — dedupe + the audit key ("which prompt built this MR")
  fewShotRefs  String[] @db.ObjectId               // PromptFeedback ids promoted into this version's example block (§5)
  status       String   @default("candidate")       // 'candidate' | 'default' | 'retired'
  createdBy    String?  @db.ObjectId               // userId (null = system/seed)
  evalScore    Json?                                // last golden-set score (§3) when this version was run live
  createdAt    DateTime @default(now())

  @@unique([workspaceId, roleKey, stageId, version])
  @@index([workspaceId, roleKey, status])
}
```

- **Immutable + content-hashed.** Editing a prompt never mutates a row — it creates the next `version`. `contentHash` is the audit answer to "which exact prompt produced this output" (stamped onto the `AgentSession` alongside `cliVersion`, [04b §7]) — the quality analog of [TESTING_STRATEGY §3.2]'s CLI-version pinning.
- **The seed is `status:'default'`** — the §2 scaffold flattened through the preset. A user edit ([features/02 D2 layer 3]) creates a new `candidate` version; promoting it to `default` is the [control-API] op below.

### 4.2 Versioning is a [control-API] op, not a free-text mutation

Editing/promoting a prompt is a **[control-API] route → `preApiExecute` RBAC → Conductor write** ([CONTROL_API], B-23) — the same governance every config edit goes through ([03 §4] config-review):

| Op (new [CONTROL_API §8] rows) | Effect | RBAC |
|---|---|---|
| `prompt-version-create` | snapshot the edited body as the next `candidate` version | Admin+ (pipeline-edit, B-28 — Members can't) |
| `prompt-version-promote` | flip a `candidate` → `default`; old default → `retired` | Admin+ **+ requires a passing live golden score (§3.4)** |
| `prompt-ab-assign` | set/clear an A/B split for a (roleKey, stageId) (§4.3) | Admin+ |

The AI may **propose** a prompt change (`propose_suggestion` → a `config-review` `WorkspaceSuggestion` with the body as the patch, [03 §4]); a human accepts; the Conductor writes the version. **The AI never promotes its own prompt** (B-23). **No new verbs** — proposal rides the existing `propose_suggestion`; the writes are [control-API] ops.

### 4.3 Per-workspace A/B

```prisma
// An active A/B split for one (roleKey, stageId) in one workspace. At most one active per key.
model PromptABTest {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId  String   @db.ObjectId
  roleKey      String
  stageId      String?  @db.ObjectId
  versionA     String   @db.ObjectId               // PromptVersion id (the incumbent default)
  versionB     String   @db.ObjectId               // the candidate under test
  splitPct     Int                                  // % of eligible spawns that get B (e.g. 50)
  assignBy     String   @default("ticket")          // 'ticket' (sticky per ticket) | 'spawn' (per turn) — Q-AIQ-AB-UNIT
  startedAt    DateTime @default(now())
  endedAt      DateTime?
  @@index([workspaceId, roleKey, stageId, endedAt])
}
```

- **Assignment is deterministic + sticky per ticket (recommended, `Q-AIQ-AB-UNIT`):** the Conductor hashes `(ticketId, roleKey)` → A or B at spawn, so a ticket's stages don't flip mid-pipeline and the result is attributable. The chosen `PromptVersion.id` is stamped on the `AgentSession` (→ the event log), so outcome metrics (§4.4) join cleanly.
- **A/B is real-ticket measurement**, complementary to the golden set (§3): the golden set is a *controlled* regression check (same fixtures every run); A/B is *production* measurement (this team's real tickets). A prompt promoted to default should pass *both* — golden first (cheap, safe), A/B second (real, slow).

### 4.4 The metric A/B and golden both feed: the quality score

Both pillars roll up to one per-(version) **quality score** the user sees ([19_USAGE_AND_BUDGET]-adjacent, surfaced in a Pipeline "Prompt quality" panel):

- **acceptance rate** — % of this version's stage outputs accepted/promoted without a human edit (the inverse of the §5 reject/edit rate).
- **reconciliation-failure rate** — % of turns that hit the §B carry-over backstop (a prompt that often fails to `emit_carryover` is a bad prompt — P1).
- **scope-creep rate** — % of code outputs whose `changedFiles[]` exceeded the plan's set (P5).
- **golden score** — the §3 deterministic + (optional) judge score.

`Q-AIQ-METRIC-OWNER` (§6): these are domain metrics; per memory `project_monitoring_separation` + [OBSERVABILITY §Q-INF-OBSERVABILITY], the **app emits** them and the standalone `@luckystack/monitoring` repo **transports/alerts** — the app owns the *acceptance/reject/scope-creep* signals (they're domain truth from the event log), monitoring owns dashboards/alerting. Recommended: emit as `TicketEvent`-derived rollups (G2 `seq`-ordered source), don't build a metrics pipeline in-app.

---

## 5. The feedback loop — human rejects/edits become few-shot examples

> The compounding-quality pillar. Every time a human **rejects** or **edits** an AI output, that is a labeled training signal: "this was wrong, here's righter." Capture it, and the highest-signal ones become **few-shot examples** that render into the §2 prompt — so the pipeline learns *this workspace's* conventions, file layout, and taste over time, with **no model fine-tuning** (impossible on the Max-subscription PTY path, [01 §1]).

### 5.1 Capture — every reject/edit is a `PromptFeedback` row

The capture points already exist as events; this pillar persists them as labeled feedback:

| Human action | Where it's captured today | The signal |
|---|---|---|
| Rejects a `WorkspaceSuggestion` / stage output | [control-API] reject op → Conductor write | "this output was wrong" (+ optional reason) |
| **Edits** a code diff before merge (the MR review) | [FORGE_ABSTRACTION §7.2] MR edit / [07_CODE_CHANGES_REVIEW] | the before→after delta = the correction |
| Edits the plan/spec before promoting | [control-API] promote-with-edit | the corrected envelope |
| Answers a `request_input` that the agent *should have known* | [09_QUESTIONS_IN_TICKETS] | a gap the prompt didn't cover |

```prisma
// A labeled human correction of an AI output — the raw material for the few-shot bank. DATA, tenant.
model PromptFeedback {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId  String   @db.ObjectId
  roleKey      String                               // which role's output was corrected
  ticketId     String?  @db.ObjectId
  promptVersionId String? @db.ObjectId             // which PromptVersion produced the rejected output (§4 join)
  kind         String                               // 'reject' | 'edit' | 'missed-question'
  aiOutput     String                               // what the AI produced (the negative)
  humanCorrection String?                           // what the human changed it to (the positive; null for a bare reject)
  reason       String?                              // optional human note
  promotedToFewShot Boolean @default(false)         // §5.2 — curated into the example bank
  redactionState String @default("pending")         // 'pending' | 'clean' — secrets-scan before any reuse (§5.4)
  createdAt    DateTime @default(now())
  @@index([workspaceId, roleKey, promotedToFewShot])
}
```

### 5.2 Promotion — curated, never automatic

A raw reject is noisy; not every correction is a good teaching example. Promotion to the few-shot bank is **deliberate, RBAC-gated, deduped** — never an automatic "every reject becomes a prompt example" (that would pollute the prompt with one-offs and inflate token cost):

```
PromptFeedback(kind:'edit' | 'reject')
  → (optional) the workspace Assistant CLUSTERS similar feedback and PROPOSES the N highest-signal
    as few-shot candidates (propose_suggestion → a 'config-review' suggestion, [03 §4]) — read|propose only
  → an Admin+ ACCEPTS via [control-API] `fewshot-promote` → Conductor writes:
       PromptFeedback.promotedToFewShot = true
       a NEW PromptVersion whose fewShotRefs[] includes it (the bank is versioned WITH the prompt)
  → the renderer appends the promoted examples as a few-shot block BELOW the resolved §2 prompt
```

**The AI proposes the curation; a human promotes it** (B-23 — the AI never edits its own prompt). The few-shot bank is **part of a `PromptVersion`** (`fewShotRefs[]`), so it's versioned, A/B-able, and rollback-able exactly like the prompt body — a bad example set is just a worse `PromptVersion`. **No new verbs** — clustering/proposal rides `propose_suggestion`; promotion is a [control-API] op.

### 5.3 Render — the few-shot block in the prompt

The promoted examples render as a bounded block below the §2 scaffold (the fourth render input from §1):

```text
## Examples from this workspace (learned from past reviews)
<!-- rendered from PromptVersion.fewShotRefs[] — capped at K examples, most-recent/highest-signal first -->

EXAMPLE (a plan that was rejected, and the correction):
  ✗ AI produced: "Step 3: refactor the Avatar component for clarity"
  ✓ Human corrected to: "(removed — out of scope; the ticket only asked to fix the cache-bust key)"
  → Lesson: do not add refactors the ticket didn't request. (P5)
```

- **Capped at K** (config, default small — e.g. 3-5 per role) to bound token cost; the bank is curated-best, not append-everything (`Q-AIQ-FEWSHOT-CAP`).
- **Per-workspace** — examples teach *this team's* conventions; they never cross tenants (`runInTenant`, [04b §11c]). A future cross-workspace "house style" bank is explicitly out of v1 (`Q-AIQ-FEWSHOT-SCOPE`).
- **Renders into the existing `--append-system-prompt`** path ([GOLDEN_PLAN_STAGE §5/§6]) — no new mount, no new mechanism.

### 5.4 Safety on the loop

- **Redaction before reuse.** A human edit can contain secrets/PII. `PromptFeedback.redactionState` gates promotion: a secrets/PII scan must mark it `clean` before it can be promoted to the bank (it's about to be injected into a model prompt). Reuses the credential-hygiene posture (`Q-SEC-CREDLIFETIME`-adjacent).
- **Eval-gated.** A `PromptVersion` carrying a new few-shot block must pass the golden set (§3) before promotion to `default` — so a learned example that *degrades* output (overfit to one ticket) fails the gate and never ships. The loop is **measured**, not blind.
- **The loop closes on §3+§4.** reject/edit (§5) → few-shot promotion → new `PromptVersion` (§4) → golden eval + A/B (§3/§4) → if better, becomes default; if worse, rolled back. Compounding quality, fully governed by B-23.

---

## 6. Open questions (Q-AIQ-*) — defaults recommended, user to confirm/override

| id | Question | Recommendation | Why |
|---|---|---|---|
| `Q-AIQ-LLM-JUDGE` | Use LLM-as-judge for the dimensions structural checks can't score (plan sensibility, review thoroughness)? | **Yes, but live-lane-only + optional.** Tiers 1-2 (deterministic) are the CI gate; the judge is a periodic enrichment, never the blocking check. | Deterministic checks ([02b §D]-style) are free and don't drift; an LLM judge costs subscription turns and is itself non-deterministic. Make it advisory, like the token feed (`Q-ENG-TOKENFEED`). |
| `Q-AIQ-LIVE-CADENCE` | How often does the live golden lane run? | **Pre-prompt-merge (required) + nightly (informational), quota-permitting; replay lane is the always-on free gate.** | The replay lane catches flow regressions for free on every commit; the expensive live lane only needs to run when a prompt actually changes or on a slow cadence to catch model drift. |
| `Q-AIQ-AB-UNIT` | A/B assignment unit: per-ticket (sticky) or per-spawn? | **Per-ticket sticky** (hash `(ticketId, roleKey)`). | A ticket's stages shouldn't flip A/B mid-pipeline (un-attributable), and ticket-level is the natural outcome unit (accepted/merged). Per-spawn is a future finer-grained opt-in. |
| `Q-AIQ-FEWSHOT-CAP` | How many few-shot examples render per role? | **Small fixed cap (default 3-5), curated-best, configurable.** | Bounds token cost (the whole project exists to optimize tokens, [06]); curated-best beats append-everything. The cap is a per-workspace knob for teams that want more grounding. |
| `Q-AIQ-FEWSHOT-SCOPE` | Are few-shot examples per-workspace only, or a shared "house-style" bank across a tenant's workspaces? | **Per-workspace only in v1** (`runInTenant` isolation). | Cross-workspace sharing leaks one project's code/conventions into another and complicates redaction + tenancy. A curated org-level house-style bank is a real P2 opt-in, not v1. |
| `Q-AIQ-METRIC-OWNER` | Who owns the quality metrics (acceptance/scope-creep/reconciliation rates)? | **App emits domain signals (from the `seq`-ordered event log); `@luckystack/monitoring` transports/alerts.** | Per memory `project_monitoring_separation` + [OBSERVABILITY]: the app owns domain truth, monitoring owns the pipeline. Don't build a metrics store in-app. |
| `Q-AIQ-PROMPT-EDIT-RBAC` | Who may edit/promote prompts and promote few-shots? | **Admin+ for create/promote (pipeline-edit, B-28); AI may only `propose_suggestion`.** | Prompts are pipeline config (B-28 Members have no pipeline-edit); B-23 forbids the AI promoting its own prompt. Mirrors every other config-review path ([03 §4]). |

---

## 7. Composition & cross-references — how this layers on the existing docs

| Doc | Today | Over this quality layer |
|---|---|---|
| [GOLDEN_PLAN_STAGE] | Renders D2 layering to literal config with a placeholder prompt body. | §2 supplies the *real* layer-1 bodies; the few-shot block (§5) is a fourth render input appended below layer 3 — same renderer, same `--append-system-prompt` mount. |
| [features/02_PIPELINE_PRESETS] | Defines the D2 3-layer resolution + the 3/5/7 tiers. | §2 fills the role scaffolds the layers resolve; `PromptVersion` (§4) versions the *resolved* output; A/B measures tier-prompt changes. |
| [02b_PROTOCOL_ADDENDA] | §B carry-over enforcement, §D `VERB_REGISTRY`, §E fenced blocks. | The §3 scorer reuses §D conformance (no-write-verb) + §B reconciliation-failure as a *quality* metric (P1); the prompts (§2) make `emit_carryover` the only exit. |
| [TESTING_STRATEGY] | Fake/replay `EngineDriver`, deterministic Conductor, golden *config* fixture. | §3 golden-*tickets* ride the SAME fake/replay driver — the merit layer on top of the mechanics layer; a live-scored good run promotes to a replay fixture ([TESTING_STRATEGY §3.2] pattern). |
| [03_AUTOMATION_AND_PLUGINS §3] | `AgentRole.systemPromptTemplate` as a registration field. | §2 specifies the *content* of that field per built-in role; a new registered role (`design`, [03 §7]) supplies its own scaffold + can be golden-tested + A/B'd identically. |
| [FORGE_ABSTRACTION §7.2] | The MR experience renders Review output; human authors MR comments. | The Review prompt (§2.4) is forge-blind; its output federates onto the MR per mode. Human MR edits are the richest §5 feedback source. |
| [CONTROL_API §8] | The write-op catalogue. | Grows by `prompt-version-create`/`-promote`, `prompt-ab-assign`, `fewshot-promote` — all Admin+, all Conductor-enqueued, **none a verb**. |

---

## 8. Self-check (review invariants)

- **No new verbs.** The frozen [02 §2] surface (7 worker + 6 assistant, all `read|propose`) is untouched; the only exits the §2 prompts name are existing worker verbs (`emit_carryover`, `request_input`). The AI *proposes* prompt/few-shot changes via the existing `propose_suggestion`; it never writes them.
- **No write verb granted; B-23 preserved.** Every quality artifact (a `PromptVersion`, an A/B assignment, a promoted few-shot) is a [control-API] op → `preApiExecute` RBAC → Conductor write ([01 §3.3]). The AI never promotes its own prompt or merges based on its own review.
- **Interactive-PTY-only respected.** Quality improves via prompt content + few-shot examples + measurement — **no fine-tuning** (impossible on the Max-subscription PTY path, [01 §1]); the few-shot bank renders into the existing `--append-system-prompt` mount ([GOLDEN_PLAN_STAGE §6]).
- **Zero-subscription-cost regression gate.** The golden-tickets replay lane (§3.2) rides the fake/replay `EngineDriver` ([TESTING_STRATEGY §3]) — it burns no subscription turns; the live lane is gated, batched, and quota-aware (§3.4).
- **Multi-tenancy preserved.** `PromptVersion`/`PromptABTest`/`PromptFeedback` are tenant-scoped; few-shot examples never cross workspaces (`runInTenant`, [04b §11c]); `Q-AIQ-FEWSHOT-SCOPE` keeps cross-tenant sharing out of v1.
- **Every genuine fork is an open question** (§6) with a recommended default — `Q-AIQ-LLM-JUDGE`, `Q-AIQ-LIVE-CADENCE`, `Q-AIQ-AB-UNIT`, `Q-AIQ-FEWSHOT-CAP`, `Q-AIQ-FEWSHOT-SCOPE`, `Q-AIQ-METRIC-OWNER`, `Q-AIQ-PROMPT-EDIT-RBAC`.
- This doc **edits no existing file** — it is the new output-quality layer the prompt-rendering, eval, and feedback surfaces cite as `[AI_QUALITY_AND_EVALS §N]`.

*End of AI_QUALITY_AND_EVALS.md. No new verbs. Quality is prompt content (§2) + a zero-cost golden regression harness (§3) + versioned A/B'd prompts (§4) + a governed reject/edit→few-shot feedback loop (§5) — all rendering into the existing [GOLDEN_PLAN_STAGE] `--append-system-prompt` path, all writes routed through [control-API] + the Conductor (B-23), all measured before they ship.*
