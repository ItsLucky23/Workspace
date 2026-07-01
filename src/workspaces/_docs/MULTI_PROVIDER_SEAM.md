# Multi-Provider AI Seam — documented-deferred

> **⚑ V1 SCOPE:** only the single-spawn wrapper is built; everything else parked — see [V1_SCOPE.md] §4.

> **Status: PARKED for v1 — build almost nothing.** Like the UI-Builder (D3), this is a *documented-deferred* surface: the engine targets **interactive Claude CLI in a PTY only**, on the Max subscription, load-bearing by design ([01 §1]). The user wants the engine to *eventually* abstract over other AI backends — Codex CLI, or raw provider APIs (DeepSeek, etc.) — but there is **no second provider to validate an abstraction against**, so building a driver interface / capability registry / `providerKey` field now would over-engineer a parked feature (Rule 7b). This doc says exactly **what to build NOW (one cheap insurance move)** and **what is parked (documentation only)**, names the **four Claude-isms**, the **three irreducible splits**, the **3-point conformance bar**, the **two hard forward-compat constraints**, the per-driver billing rule, and the **per-workspace-single-provider default** — plus the **report-only prose de-conflict edits** needed in 01/02/19. Resolves `Q-MP-SEAM`, `Q-MP-BILLING`, `Q-MP-GRANULARITY`, `Q-MP-CAPREG`. Cites architecture as `[01 §x]`…`[07 §x]`; codes via `REFERENCE_CODES.md`. **No new verbs** — this doc introduces no protocol surface; the seam it describes is a refactor of one callsite, not a new contract. Last updated: 2026-06-04.

---

## 0. The one-paragraph summary

v1 ships **one Claude implementation behind a single internal spawn function** so the future provider seam is a refactor-of-one-callsite, not a rewrite. Everything else — the driver interface, the per-provider capability registry, the `providerKey`/`modelKey` schema fields, the billing-mode split — is **parked**: documented here, built when (and only when) a real second backend lands. The frozen verb surface ([02 §2]), the carry-over envelope ([02 §4]), and the deterministic Conductor are **already provider-agnostic** and need no change. Two hard constraints are written into the seam *now* because they are cheap and high-value: any future adapter exposes **only the read/propose verbs as model tools** (B-23 becomes adapter conformance), and **env/secret injection is per-adapter and hard-gated** so a Claude turn can never be routed through a metered pool. **No `providerKey` in `types.ts`. No `periodWindow` pre-shaping around the parked abstraction.**

---

## 1. What is already provider-agnostic (need NO change)

The architecture's "stable waist" is **verb *semantics*, frozen; transport, swappable.** These surfaces are provider-neutral today and stay untouched by the eventual abstraction:

| Surface | Where | Why it's already neutral |
|---|---|---|
| **The frozen verb surface** — 7 worker + 6 assistant verbs | [02 §2], `features/INDEX` NO-NEW-VERBS | Pure semantic contract (`report_status`, `emit_carryover`, `query_context`, …). It says *what* a turn may signal, never *which model* signals it. A driver must expose these as tool calls — that's the conformance bar (§5), not a change. **No new verbs.** |
| **The carry-over envelope** — `{summary, changedFiles, openQuestions, commitHash}` | [02 §4], B-O2 | Pure JSON. State handed across a stage boundary is provider-independent by construction. |
| **`WorkspaceSignal` + serial Conductor consumption** | [02 §3], [01 §3.3], B-O6 | The Conductor is deterministic TypeScript with **no LLM** — it reconciles JSON, never reasons. Coordination is provider-blind. |
| **The app-level registries** — `AgentRole` / `ArtifactViewer` / `OrchestratorCommand` | [03 §3] | Keyed by `roleKey`/`needsWorkspace`/etc., not by provider. (These are *app* registries — distinct from the parked *provider-capability* registry of §6.) |
| **B-23 proposes-only** | [01 §3], [02 §1] | "AI proposes → user accepts → Conductor executes" is enforced structurally, independent of which model proposes. The no-write-verb property is the guarantee — and it must hold at the future adapter boundary too (§7, constraint A). |

The implication: an abstraction effort touches **only the launch/lifecycle/billing edge**, never the protocol core. That is what makes the v1 single-spawn wrapper (§4) a cheap insurance move rather than a deep refactor.

---

## 2. The four real Claude-isms (the verified coupling points)

These are the *only* places "Claude" is fused into the engine. The seam exists to localize them; v1 localizes the first; the rest are documented for the parked build.

1. **Provider fused into launch.** `cmd:'claude'` ([07 §A] launch step) and `SessionManager.spawnWorker` / `spawnAssistant` / `spawnReasoner` ([01 §4]) all assume a `claude` PTY. **→ this is the one v1 localizes** (§4).
2. **Lifecycle primitives woven through the core.** `--resume <claudeSessionId>` ([01 §4], [02 §1], `QuestionSet.sessionId`, [06]); `/clear` + `/compact` + `PreCompact` ([06]); the Claude `type:http` hook set ([02 §3]). These are *Claude's realization* of a lifecycle contract — see split (A).
3. **Capability vocabulary is a Claude literal union.** `types.ts` `StageModelTier = 'haiku'|'sonnet'|'opus'` and `StageEffort = 'low'|…|'max'`. The single biggest *schema* coupling — see split is none, but see `Q-MP-CAPREG` (§6) for the forward-pointer.
4. **Billing baked into topology.** [01 §1] (PTY = subscription), [01 §6] (budget *advisory*; quota is the real limit), `features/19`. See split (B).

---

## 3. The three irreducible splits (cannot be unified)

These are the costs the parked build will pay. They are **not** refactor friction — they are genuine differences between a subscription-PTY backend and a metered-API backend that no abstraction erases. Naming them now stops a future builder from under-scoping the work to "register a driver."

- **(A) Lifecycle / hooks.** [02 §3] makes Claude `type:http` hooks **the event backbone** (`SessionStart`/`PostToolUse`/`Stop`/needs-input/`PreCompact`, POSTed to an orchestrator endpoint). An API backend **has no hooks** and must *synthesize* the entire normalized event set ([02 §3]'s lifecycle contract) from a raw token + tool-call stream — **including a hand-rolled tool-call loop** to expose the verbs as tools. This is the deepest hidden cost: weeks, not a registration. The Stop-hook forced-reconciliation loop ([02 §3.x], `Q-ENG-CARRYOVER-ENFORCE`) and Stop-hook turn-end detection (`Q-ENG-TURNEND`) are Claude-hook-derived signals that an API driver must reproduce by other means.
- **(B) Billing.** [01 §1] + [01 §6] "*advisory; quota is the real limit*" are **invariants of the Claude subscription path** — not universal truths. A metered backend **inverts both**: cost becomes exact and authoritative, and the cap becomes a **hard pre-flight gate**, not advisory. `features/19` D81/D82 hard-code "advisory" + auto-pause — they **cannot coexist as one accounting model** with a metered driver. Per-driver billing mode is the resolution (§8).
- **(C) PTY-vs-API transport.** PTY drivers (Claude CLI today, later Codex CLI) are the **only ones eligible for subscription billing** — that is the economic premise the whole architecture exists to protect. A metered-API driver is a clean, separable transport **if and only if** the billing guard is a hard gate (constraint B, §7). Mixing them safely is exactly what the two hard constraints protect.

---

## 4. v1 — build ONLY the single-spawn wrapper

**One cheap insurance move, and nothing else.** Wrap the literal `cmd:'claude'` spawn ([07 §A]) **and** the three `SessionManager` spawn methods (`spawnWorker`/`spawnAssistant`/`spawnReasoner`, [01 §4]) behind **one internal function with a single Claude implementation**, so the future seam is a refactor of *one* callsite (`Q-MP-SEAM`).

Concretely:

- Introduce an internal `launchEngineSession(spec)` (name illustrative) in the orchestrator that owns the **only** `cmd:'claude'` + flags assembly. `spawnWorker`/`spawnAssistant`/`spawnReasoner` call it instead of constructing the PTY invocation inline. **One implementation. One provider. Zero indirection beyond the function boundary.**
- The function is **internal plumbing**, not a public interface: no `EngineDriver` type, no driver registry, no capability table, no `providerKey` parameter. If you find yourself typing `interface EngineDriver`, stop — that's the parked build (§5/§6), not v1.
- The Claude-isms of §2.2 (`--resume`, `/clear`/`/compact`, hooks) **stay where they are** for v1 — they are not lifted into the wrapper. The wrapper localizes only §2.1 (the spawn). Localizing the rest is the parked build's job.

This satisfies Rule 7b (consumer-side: minimum code, nothing speculative): one function, one impl, refactor-of-one-callsite later. It does **not** build the abstraction — it makes building it cheap.

> **Do NOT in v1:** add a driver interface · add a capability registry · add `providerKey` / `modelKey` to `types.ts` · pre-shape `WorkspaceBudget.periodWindow` ([19], D82) around the parked meter · add a "provider" column anywhere · branch any code path on a provider value. All of these are §5/§6 parked work.

---

## 5. The 3-point conformance bar (documentation only — the parked driver contract)

When a second backend is eventually built, **any** engine driver MUST satisfy these three points. They are the minimal contract that lets the deterministic Conductor stay provider-blind. Documented now so the bar is fixed before the first adapter exists (it is the spec a future adapter is tested against — see Testing, `Q-INF-TESTING`, fake `EngineDriver`).

A conforming driver MUST:

1. **Run a turn in the work context.** Execute one agent turn against the ticket's worktree / work context (container for code roles per [01 §3.1]/[01 §5]; host-side for reasoning roles) — i.e. it can *do the work* a Claude PTY does.
2. **Emit the normalized event set.** Produce the [02 §3] lifecycle events (`SessionStart`/`PostToolUse`/`Stop`/needs-input/`PreCompact`-equivalents) the Conductor consumes — natively (hooks, like Claude) **or synthesized** from a raw stream (split A). The Conductor must not be able to tell which.
3. **Honor the carry-over JSON contract + expose the verbs as tool calls.** Read/write the [02 §4] envelope unchanged, and expose the frozen verb surface ([02 §2]) as model tools — **read/propose verbs only** (constraint A, §7). **No new verbs**, no write verb, ever.

A driver that meets all three drops into the Conductor with no coordination change — that is the payoff of the already-agnostic core (§1).

---

## 6. Parked (documentation only — do NOT build in v1)

Everything below is the *deferred* build. It is listed so the parked scope is explicit and so no v1 lane half-builds it.

- **The driver interface itself** — the `EngineDriver`/adapter abstraction the §4 wrapper is the seam for. Built only against a real second backend.
- **The per-provider capability registry** — models, effort levels, custom commands/skills, feature flags, declared per backend (so a new provider feature — e.g. Claude's ultracode/Workflow — is ingested fast). This is what eventually **replaces the `StageModelTier`/`StageEffort` literal unions** of §2.3.
  - **`Q-MP-CAPREG` forward-pointer (report-only, no code change):** leave a one-line comment next to `StageModelTier`/`StageEffort` in `types.ts` — *"provider-specific Claude vocabulary; a future per-provider capability registry replaces these (see MULTI_PROVIDER_SEAM §6)."* Note `StageEffort` may not even be cross-provider. **No refactor to `providerKey`/`modelKey` now** — premature.
- **The billing-mode split in schema** — the per-driver advisory-vs-hard-gate distinction (§8) becomes a real field only when a metered driver exists. **Do not** pre-shape `WorkspaceBudget.periodWindow` ([19], D82) for it now; default `'calendar-month'` (workspace tz, D55) is the v1 shape and stands ([19] INDEX delta).
- **`providerKey` / per-workspace or per-stage provider selection** (§9) — the selection model is decided (§9) but **not persisted** in v1; `types.ts` gets **no** `providerKey` field (`Q-MP-GRANULARITY`).

---

## 7. The two hard forward-compat constraints (build into the seam NOW)

These two are the exception to "build nothing" — they are **cheap and high-value**, so the v1 seam (§4) and the conformance bar (§5) bake them in even though no second provider exists. They are the things that are expensive to retrofit and dangerous to omit.

- **Constraint A — adapters expose ONLY read/propose verbs as model tools (never a write tool).** B-23 ("AI proposes → user accepts → Conductor executes") becomes an **adapter-conformance property**: any future driver's tool-call surface is a subset of the frozen read/propose verb set ([02 §2]) — `report_status`, `emit_event`, `request_input`, `emit_carryover`, `emit_signal`, `emit_handoff`, `query_context` (worker) + `get_ticket`, `list_tickets`, `read_pipeline`, `propose_suggestion`, `draft_questionset`, `refresh_docs` (assistant). **No write verb is ever exposed to any model on any provider.** This is enforced by the same `VERB_REGISTRY` conformance test that guards the Claude path (`Q-ENG-VERB-CONFORMANCE`): every driver's tool set ⊆ the registry, and the registry contains no write verb. **No new verbs.**
- **Constraint B — per-adapter env/secret policy, HARD-gated so a Claude turn can never route through a metered pool.** Env/secret injection is **per-adapter policy**, not global. The Claude adapter spawns with a **clean env** so it uses the host `/login` subscription — if `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `apiKeyHelper` are present they take precedence and silently charge API credits ([01 §1] caveat). The seam therefore **hard-gates** provider selection against billing mode: a session tagged as the Claude/subscription path **must** spawn clean, and a metered-API adapter's credentials are injected **only** for sessions explicitly bound to that adapter. A Claude turn routing through a metered pool is a *guarded-impossible* state, not a runtime accident. (This guard is the §8 billing mode made structural.)

These two cost almost nothing today (one is a registry test that already exists for Claude; the other is "spawn Claude with a clean env," which [01 §1] already mandates) and are very expensive to retrofit after a metered driver is mixed in.

---

## 8. Per-driver billing mode + the Claude-scoped headless rule

Resolves `Q-MP-BILLING`. Billing mode is **per-driver**, not global:

| Driver class | Billing mode | Cap semantics | Source of truth |
|---|---|---|---|
| **Subscription-PTY** (Claude CLI today; later Codex CLI on a subscription) | **Advisory** + auto-pause | budget is advisory; the **real** limit is the plan **quota** ([01 §6], D81/D82) | per-turn usage from hook payloads if present, else a labeled char-count estimate (`Q-ENG-TOKENFEED`) — explicitly an estimate |
| **Metered-API** (future; raw provider APIs) | **Hard pre-flight gate** | cap becomes a `blockTurn` gate *before* a turn runs (extends D81) | exact, authoritative per-call cost |

**The no-headless / no-Agent-SDK rule is re-scoped to the *Claude billing path only*** (`Q-MP-BILLING`, ERRATA E1). On the Claude subscription path, interactive PTY is the only mode — `claude -p` / Agent SDK meter a separate credit pool ([01 §1]) and headless survives only as a **P4 optional burst path**. It is **not** a universal architectural ban: a future **metered-API backend may legitimately be headless**, because metered backends bill per call regardless of PTY-vs-API transport (split C). The ban protects the *subscription economics*, not "headless" as a category.

**Document now, no schema:** the parked metered intent (`features/19` D82's configurable `periodWindow`, memory `project_workspace_multi_provider_ai`) **directly contradicts** [01 §6]'s "advisory" invariant — that contradiction is *expected* and resolved by per-driver mode, not by changing v1's advisory shape. No billing-mode field ships in v1.

---

## 9. The deferred default — per-workspace single provider

Resolves `Q-MP-GRANULARITY`. When the abstraction is eventually built, the selection default is **per-WORKSPACE single-provider**, with per-stage selection as an **explicit advanced opt-in**:

- **Per-workspace single-provider (default).** One backend per workspace. Sidesteps two real hazards: (1) **mixed-provider carry-over quality** — a [02 §4] envelope written by one model and consumed by another may degrade; and (2) **model-ladder incomparability** — `simple`=Sonnet/medium … `professional`=Opus/high (D1) is a Claude ladder that doesn't map cleanly across providers.
- **Per-stage opt-in (advanced).** A workspace may *opt in* to per-stage provider selection (e.g. a metered DeepSeek for a cheap Refine stage, subscription Claude for Coding) — but only deliberately, accepting the carry-over-quality and ladder-comparison risk.

**Not built / not persisted in v1.** No `providerKey` field on `Workspace` or `PipelineStageCfg` in `types.ts` now (§6). The default is recorded here so the parked build starts from a decided shape, not a fresh debate.

---

## 10. Report-only prose de-conflict edits (for the maintainers — do NOT auto-fix)

These are **flagged, not applied** (Report-Without-Auto-Fixing). They make the existing prose consistent with per-driver billing + the Claude-scoped headless rule. Each is a one-line wording change; none touches a schema or a verb. A maintainer applies them when those docs are next revised.

| Doc / section | Current prose | Suggested de-conflict edit |
|---|---|---|
| **[01 §1]** (billing constraint) | "interactive PTY only; `claude -p`/Agent SDK rejected (meters credits)" stated as a flat architectural rule | Re-word as a **Claude-billing-path** rule: "*On the Claude subscription path,* interactive PTY is the only mode; headless meters a separate Claude pool. A future metered-API backend (parked, MULTI_PROVIDER_SEAM) may be headless — the ban protects subscription economics, not headless as a category." |
| **[02 §3]** (hooks = the event backbone) | "Claude `type:http` hooks POST to an orchestrator endpoint … the lifecycle/event backbone" | Add one line: "*This is the **Claude realization** of a provider-neutral lifecycle contract (MULTI_PROVIDER_SEAM §3 split A); an API backend must **synthesize** the same normalized event set from a raw stream.*" |
| **[01 §6]** (budget advisory) | "Budget … is *advisory* on the subscription (the real limit is quota)" | Add one line: "*Advisory is the **subscription-PTU mode**; a future metered driver inverts this to a hard pre-flight cap (MULTI_PROVIDER_SEAM §8, §3 split B).*" |
| **`features/19`** (D81/D82) | "Advisory — runs on the Max subscription; the hard limit is plan quota"; `periodWindow` default `'calendar-month'` | Add a footnote: "*Advisory + auto-pause is the subscription billing mode; `periodWindow` can already express provider-native windows (e.g. Claude's 5h quota), but a **meter UNIT** is required before D82 can enforce a metered cap — parked (MULTI_PROVIDER_SEAM §6/§8).*" Do **not** pre-shape the field for the meter now. |

**No new verbs** are introduced by any edit above; all are wording-only.

---

## 11. Companion docs & references

- `00_SPEC_RECONCILIATION.md` — ERRATA **E1** (headless rejected → re-scoped to the Claude billing path), the precedence carve-out.
- `01_ARCHITECTURE.md` §1 (billing), §4 (`SessionManager` spawn methods — the §4 wrapper target), §6 (advisory budget).
- `02_PROTOCOL_AND_FLOW.md` §2 (frozen verb surface), §3 (hooks = lifecycle backbone), §4 (carry-over envelope).
- `features/19_USAGE_AND_BUDGET.md` (D81/D82, `WorkspaceBudget.enforcement`/`periodWindow`), `features/INDEX.md` "Parked for later".
- `REFERENCE_CODES.md` — B-23 (proposes-only), B-O2 (carry-over envelope), B-O6 (signal transport).
- Memory: `project_workspace_multi_provider_ai` (the parked-topic tracker this doc operationalizes).
