# 00 — Spec Reconciliation & ERRATA

> **Read this before any `handoff/` spec.** The Workspaces design exists in three artifact layers — the **spec layer** (`handoff/`: `IDEE_SPEC.md`, `BESLISSINGEN.md` `B-01…B-O8`, `DATAMODEL.md`, `CLAUDE_SETTINGS_MAP.md`, `FRAMEWORK_*`, `DESIGN_BRIEF` + `designs/`), the **docs layer** (`src/workspaces/_docs/` 01–07 + `SETUP` + the 24 `features/` docs), and the **prototype** (`src/workspaces/`). The spec layer is "deprecated but two days old" and the docs layer has **deliberately evolved past it on the load-bearing axis.** This doc carves out *which layer governs which class of decision* and lists every superseded section. It is the authoritative tie-breaker — `README.md`'s blanket "specs win on conflict" line is **superseded by the precedence rule below.** Resolves `Q-INF-SPECWIN`, `Q-INF-CLAUDESETTINGSMAP`, `Q-INF-PRESETS`, `Q-PROD-WORKSPACE-AI`. Cites architecture as `[01 §x]`…`[07 §x]` and `handoff/` codes via `REFERENCE_CODES.md`. **No new verbs** — this is a reconciliation doc; it introduces no protocol surface. Last updated: 2026-06-04.

---

## 1. The carved-out precedence rule

`README.md` (line ~100) says: *"Where these docs and the specs disagree, the specs win — flag it."* Read literally, that rule re-instates the **rejected headless path** — the single highest-impact decision the docs layer exists to override (`[01 §1]`: interactive PTY only; `claude -p` / Agent SDK meter a separate credit pool from 2026-06-15). That is a precedence **inversion** and is hereby corrected (`Q-INF-SPECWIN`).

**The rule, carved by decision class:**

| Decision class | Governing layer | Why |
|---|---|---|
| **Engine & billing** — PTY-vs-headless, subscription-vs-metered, structured-output transport, `CLAUDE_SETTINGS_MAP` headless flags | **`_docs` WIN.** `IDEE_SPEC` two-system §, `CLAUDE_SETTINGS_MAP` headless plan **explicitly SUPERSEDED.** | The 2026-06-15 billing split is newer than the spec; the whole architecture pivots on it (`[01 §1]`). The spec predates the pivot. |
| **Role topology** — standing "Workspace-AI" brain vs Conductor + per-user Assistant + optional reasoner | **`_docs` WIN.** `IDEE_SPEC §8` standing brain **SUPERSEDED** by `[01 §3]`. | The deterministic-Conductor + per-user-Assistant model is a deliberate improvement (no chat contention, per-user RBAC, leaner context); the spec's single always-on brain over-promises (`Q-PROD-WORKSPACE-AI`). |
| **Verb surface** — the structured channel | **`_docs` WIN.** The frozen 7-worker + 6-assistant verb set (`[02 §2]`, `features/INDEX` NO-NEW-VERBS) is canonical; `IDEE_SPEC`'s "no tool registry" prose is scoped to the **framework**, not the **app** (`AgentRole`/`ArtifactViewer`/`OrchestratorCommand` registries are app code and stay). | The docs froze a complete, conformance-tested surface (`VERB_REGISTRY`, `Q-ENG-VERB-CONFORMANCE`); the spec's looser language pre-dates the freeze. **No new verbs.** |
| **Un-revisited feature / domain detail** — anything the docs layer has NOT re-decided (specific UI affordances, domain rules, field semantics the docs don't touch) | **SPECS WIN** — this is the *only* surviving scope of the old "specs win" rule. | The spec remains the richest source for details the docs never revisited; defer to it there, and **flag** any conflict you find for promotion into `_docs`. |

**One-line operating rule:** *On engine/billing, role-topology, and verb-surface the `_docs` are authoritative and `IDEE_SPEC` is superseded; everywhere the `_docs` are silent, the `handoff/` specs still govern — and a conflict there is a flag, not a silent pick* (Rule 3a). When a builder hits a `handoff/` claim that contradicts an ERRATA row below, the `_docs` row wins; when it hits a spec detail with no ERRATA row and no `_docs` coverage, the spec governs and the builder reports the gap rather than inventing.

> **Why not just delete `handoff/`?** The `_docs` cite `handoff/` G#/B# codes throughout. `handoff/` is **frozen, not deleted** until those codes are inlined into `REFERENCE_CODES.md` (`Q-INF-REFCODES`). "Deprecated" here means "immutable, not safe to edit," not "ignore."

---

## 2. ERRATA — superseded spec/handoff sections

Each row: the superseded source → the overriding `_docs` section → a one-line reason. A builder reading the left column MUST follow the middle column. Codes resolve via `REFERENCE_CODES.md`.

| # | Superseded (`handoff/` / `README`) | Overriding `_docs` section | Class | Reason (one line) |
|---|---|---|---|---|
| E1 | `IDEE_SPEC` two-system §; `CLAUDE_SETTINGS_MAP` headless plan (`claude -p --output-format stream-json --json-schema`) | **`[01 §1]`** (PTY-only billing) | engine/billing | Headless `-p`/Agent SDK meter a separate credit pool (2026-06-15); only interactive PTY stays on the Max subscription. Headless survives as a **P4 optional burst path only** (`Q-MP-BILLING`: re-scoped to the *Claude billing path*; a future metered-API backend may be headless). |
| E2 | `IDEE_SPEC §8` standing **Workspace-AI brain** (one always-on per-workspace LLM) | **`[01 §3]`** (Conductor + per-user Assistant + optional future one-shot reasoner) | role-topology | Coordination is deterministic (no LLM needed); per-user Assistants remove chat contention + give per-user RBAC. **v1 away-time gap is explicit:** reasoning-heavy proactive work runs only via a connected user's Assistant or deterministic Conductor rules; the ephemeral away-time reasoner is **P5-optional** (`Q-PROD-WORKSPACE-AI`, `Q-ENG-REASONER`). **Term disambiguation:** "Workspace-AI" now = the *system* (Conductor + Assistants), NOT a single standing brain. |
| E3 | `IDEE_SPEC` "no tool registry" prose | **`[02 §2]` frozen verb surface + `[03 §3]` app-level registries** | verb-surface | The "no registry" claim is scoped to the **framework**; the **app** keeps `AgentRole`/`ArtifactViewer`/`OrchestratorCommand` registries + a `VERB_REGISTRY` the CLI/MCP helper is generated from (`Q-ENG-VERB-CONFORMANCE`). **No new verbs.** |
| E4 | `DATAMODEL`/spec thin **`needsInput: string`** as the question channel | **`[02 §5]` `QuestionSet`/`Question`** (`[04 §`questions`]`) | data-model | A single free-text string can't drive the phone-from-the-beach Q/A loop (choice/approve/free cards). `Ticket.needsInput` is demoted to the **denormalized board-banner one-liner** (= first open question); the full set lives in `QuestionSet`. `ChatMessage.questionSetId` renders a card inline (`Q-PROD-QUESTIONSET`). |
| E5 | `BESLISSINGEN` **B-O4** "one editable default pipeline; no multiple built-in templates in v1" | **`features/02_PIPELINE_PRESETS` (D1)** — three tiers + clone | feature (amended, not superseded-away) | B-O4 is **amended** to "**three tiers + clone**": `simple`(3)/`advanced`(5)/`professional`(7) are an additive, small growth of the single 7-stage default (professional = the B-O4 default generalized); save-as-template / marketplace stay **deferred** under B-O4 (`Q-INF-PRESETS`). |
| E6 | `BESLISSINGEN` **B-O5** per-stage **custom statuses** | **`[04 §`status`]` closed lifecycle enum** (`idle\|needs-input\|busy\|done\|paused\|stuck`) | feature (deferred) | The AI-owned lifecycle status is a **closed universal enum**; `StageStatusCfg` is re-scoped to a non-lifecycle *label* concept and **B-O5 is formally DEFERRED** for v1 (`Q-DATA-STATUS`). Three distinct state machines documented; no custom-status build in v1. |
| E7 | `CLAUDE_SETTINGS_MAP` **B-38** headless settings map (per-row headless flags) | **`GOLDEN_PLAN_STAGE` / `[02b]` interactive equivalents** (inline-supersede) | engine/billing | B-38 re-stated as "stage-config → the **interactive** `.claude` surface; structured JSON via the structured channel, **not** `--json-schema`." Each headless row is inline-superseded with an interactive-mode equivalent; headless flags survive only on the P4 burst path (`Q-INF-CLAUDESETTINGSMAP`). |
| E8 | `README.md` blanket **"specs win on conflict"** | **§1 of this doc** (carved precedence rule) | meta | Read literally it re-instates the rejected headless path; carved so `_docs` win on engine/billing/role-topology/verb-surface, specs win only on un-revisited details. |

> **ERRATA carve-out for the specs-win survivors:** rows E1–E8 are the *closed* set of load-bearing reversals. They do **not** license a builder to treat the whole `handoff/` layer as void — outside these rows (and the `_docs` they point to) the spec still governs (§1, class 4). When a new conflict surfaces that no row covers, it is reported for a new ERRATA row, never silently resolved (Rule 3a / Report-Without-Auto-Fixing).

---

## 3. How a builder applies this

1. **Hit a `handoff/` claim?** Check the ERRATA table. If a row matches → follow the `_docs` section, treat the spec text as historical. If no row matches and `_docs` are silent → the spec governs; if it *contradicts* a `_docs` section with no ERRATA row, **flag it** (don't pick silently).
2. **Engine / billing / roles / verbs are settled** — never re-open them to "comply" with the spec. Do **not** re-instate headless to satisfy `CLAUDE_SETTINGS_MAP`; do **not** collapse per-user Assistants into one brain; do **not** add a verb to close a feature gap (re-express via existing verbs + `WorkspaceTrigger` + `run-command` + MCP). **No new verbs anywhere.**
3. **Codes** (`B-23`, `B-O2`, `B-O4`, `B-38`, `G6`…) resolve through `REFERENCE_CODES.md` — the inlined, binding definitions + the B-xx→owning-doc coverage matrix. `handoff/` stays frozen-not-deleted until that inlining lands (`Q-INF-REFCODES`).
4. **This doc is written FIRST** in the build-doc set (the reconciliation layer) precisely because it unblocks every other lane: once a lane knows engine/billing/roles/verbs are `_docs`-governed, it can build cold against `[01]`–`[07]` without re-litigating the spec.

---

## 4. Companion docs

- `REFERENCE_CODES.md` — inlined G#/B# definitions + B-xx→owning-doc coverage matrix; adds "SUPERSEDED" headers to `CLAUDE_SETTINGS_MAP.md` (the E1/E7 mechanism).
- `04_DATA_MODEL.md` (extended §6–§11) — the canonical `AgentSession`, the `QuestionSet`/`Question` shapes E4 points at, the closed status enum E6 fixes.
- `GOLDEN_PLAN_STAGE.md` / `02b` — the interactive-equivalent settings render that supersedes B-38's headless rows (E7).
- `features/02_PIPELINE_PRESETS.md` — the three-tiers-+-clone amendment to B-O4 (E5).
