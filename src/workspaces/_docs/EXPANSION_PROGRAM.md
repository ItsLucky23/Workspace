# Workspaces — Expansion Program (post-ADR-0034): Ship · Run · Maintain · Sharpen

> **Purpose.** The single source-of-truth for the next build round — the "ship, run & maintain" half of
> the lifecycle plus reasoning/knowledge sharpening. Written to drive a `/goal` run: work the items in
> order, one at a time, each committed + tested before the next. Mirrors the earlier 14-item `/goal`.
>
> **Status:** DRAFT — the four cross-cutting decisions in §2 must be signed off before the gated items run.
> Last updated 2026-07-06.

---

## 0. Where this sits

The full-codebase inventory (2026-07-06) found: the half that **builds & reviews** an idea is mature; the
half that **ships, runs & maintains** it is thin/missing. The gap is sharp right after Review. This program
closes it. The ADR 0034 tool-module↔pipeline coupling (design-system→agent · findings→ticket · artifact→ticket)
already landed and is the base.

**Precedence (unchanged): `V1_SCOPE.md` is the authority.** Most ship/run docs here are *already speced but
marked `⚑ DEFERRED / OUT of V1`*. This program consciously **un-defers** them (CLAUDE.md already records the
product is "EXPANDING past the old single-* V1"). For each item: *inherit the designed half, spec only the
named delta.* Never re-design a surface that has a doc — extend it. A real conflict with a locked invariant
(only #9 does this) gets its own ADR that explicitly supersedes the lock.

---

## 1. Standing invariants (a change violating one is wrong even if it works)

1. **B-23 single-writer** — AI proposes → human accepts → the **Conductor** executes. LLMs never write
   authoritative state (board/git/status/deploy). Destructive/irreversible actions need an explicit confirm.
2. **No new structured-channel verbs** — re-express via the frozen read|propose surface + `WorkspaceTrigger`
   + `run-command` + MCP.
3. **Every user write is a `[control-API]` op** through the Conductor; client merges by `seq`.
4. **`runInTenant` on every orchestrator + worker path** (row-isolation, loud-fail).
5. **Leader-elected orchestrator** — safe as N instances; exactly one leader runs the loops + authoritative writes.
6. **PTY-billing** — the code-writing agent is always interactive `claude` in a node-pty PTY; never `claude -p`
   / the Agent SDK. Other providers allowed for NON-coding tasks only (provider abstraction, ADR 0007).
7. **Rollback is forward-only** — `git revert -m 1` → new MR + tracking ticket; **never** reset/force-push
   (GIT_STRATEGY §6).
8. **Waterfall** — sequential, verified, committed phases. Schema/types first, then engine, then client, then editor/config.
9. **Cost = tokens, not €** — token-usage display only; hard-blocking on price stays PARKED (user, 2026-07-06;
   matches the parked G-19/G-QUOTA locks).

Every framework rule (file-based routing, function-injection, strict typing/no-casts, `tryCatch`, i18n,
Tailwind tokens, surgical changes, lint+build, branch-log, decision/lessons memory) still applies on top.

---

## 2. Cross-cutting decisions — SIGN OFF BEFORE THE GATED ITEMS

These four shape multiple items. Recommendation given; the ⛳ ones need the user. Once decided → each becomes an ADR.

### 2.1 ⛳ Multi-service shape (the tent-pole — item A1)
A workspace is **one project = one repo** today (locked D12 / features/01 / features/22). The user's real case:
a Java backend separate from an HTML frontend — *"2 repos together OR separate, and services instead of one
monorepo."* Options:
- **(a) Polyrepo** — a workspace holds N `Project`s, each its own repo/board/pipeline; a switcher up top.
- **(b) Monorepo-with-services** — one repo, N declared **`Service`s** (path + build + deploy unit), each
  independently buildable/deployable/previewable.
- **(c) Both** — N repos, each optionally holding N services. Most complete, most work.
> **Recommendation: (c), built incrementally — first (a) polyrepo (N projects/workspace, reverses D12), then
> layer (b) services onto a project.** Reason: the user described both; (a) is the smaller schema move and
> unblocks the "two separate repos" case immediately, (b) adds the service granularity deploy needs. Needs an
> **ADR reversing D12**.

### 2.2 ⛳ Deploy target / infra (items B1–B2)
Where do the user's apps actually run? 08_DEPLOYMENT already gives the substrate (Caddy pool, per-workspace
container supervision, `<slug>.<domain>` routing). Options:
- **(a) Same host, long-running containers behind the existing proxy** at `<env>-<service>.<workspace>.<domain>`
  (reuses imageBuild + proxy + egress; matches the memory's `workspace.keetlerop.nl` + wildcard-subdomain host).
- **(b) An external target** (a VPS/cloud/k8s the operator configures per workspace).
> **Recommendation: (a) for V1 of deploy** — a persistent per-environment container on the same host, promoted
> from the same image the pipeline already builds. (b) becomes a later `DeployTarget` provider seam (mirror the
> `ForgeProvider` pattern) so cloud targets slot in without reworking the flow.

### 2.3 ⛳ Forge scope (touches Wave C)
The `ForgeProvider` seam (6 caps × GitLab/GitHub/Builtin) is designed; only **GitLab is built**; GitHub is
design-now/build-later. The user will "really think about" whether both are needed once we deploy.
> **Recommendation: keep GitLab-only for this expansion; leave the seam.** Deploy/CD/AI-review are built
> forge-agnostically against the seam so un-deferring GitHubForge later is additive. (Note: multi-service #9
> stresses the one-repo-per-workspace forge model — A1's ADR must address how `ForgeConnection` maps to N
> projects.)

### 2.4 Environments set (item B1)
> **Recommendation (no user block needed unless you disagree): a small fixed ladder `dev → staging → prod`
> per service, with `prod` gated (approval + green CI + health check) and `dev` auto-deployed on merge.**
> Configurable count is a later refinement.

---

## 3. The program — waves & items

Order = dependency + value. Each item: **verdict** (un-defer speced / inherit+delta / greenfield) · scope ·
approach · decision · verify. Schema-first within each item (waterfall).

### Wave A — Tent-pole: multi-service data model  *(theme 9 · greenfield + reverses a lock)*

**A1 · Multi-project / multi-service model** — *greenfield; ADR reverses D12.*
- **Scope:** a workspace holds N projects (polyrepo); a project optionally declares N services (build+deploy unit).
- **Approach:** schema first — `Project` already exists; drop the "exactly one per workspace" assumption
  (`project.findFirst` → project-scoped everywhere: quick-add, preview, snapshot, board). Add a `Service`
  model (projectId, name, path, buildCmd, deployUnit) and a project/service switcher in the shell. `ForgeConnection`
  per project. `runInTenant` unchanged (workspace is still the tenant). Migration + backfill (existing single
  project → project #1).
- **Decision:** §2.1 (c)-incremental — polyrepo first, services second. ADR-A supersedes D12.
- **Verify:** two projects in one workspace, each own board/pipeline; a monorepo project with 2 services each
  buildable; unit tests on the project-scoping helpers; existing single-project workspaces still load (backfill test).

### Wave B — Ship: environments · deploy · rollback  *(themes 1,2,3)*

**B1 · Environments + persistent app server** — *greenfield.*
- **Scope:** a `Deployment`/`Environment` model (service × env dev/staging/prod → a long-running container +
  a stable route). The first thing that runs the user's app beyond an ephemeral preview.
- **Approach:** reuse `container/imageBuild` (the image the pipeline builds) + `proxy/*` (stable route
  `<env>-<service>.<ws>.<domain>`, not the 30-min preview TTL) + `runInTenant` + the leader (only the leader
  provisions). Model: `Environment { serviceId, kind, route, imageRef, status, healthUrl }`. Conductor is the
  only writer (deploy = a control-op).
- **Decision:** §2.2 (a) same-host containers; §2.4 dev/staging/prod ladder.
- **Verify:** deploy a built image to `dev` → reachable at its route → health-check green; teardown; a second
  env is isolated. Integration test on the Environment control-ops.

**B2 · Deploy / CD** — *greenfield (reuses B1 + CI).*
- **Scope:** build → deploy a service to an environment; **promote** dev→staging→prod (gated); health-gated rollout.
- **Approach:** a `deploy` / `promote` control-op (B-23: human clicks, Conductor executes). `prod` requires
  approval + green CI (Wave C) + a passing health check; `dev` auto-deploys on merge (via an existing
  `WorkspaceTrigger` matcher — no new verb). Emits `TicketEvent(type:'deploy')`. Later: a `DeployTarget` seam
  for external targets (§2.2 b).
- **Decision:** promotion ladder gated at prod; dev auto on merge.
- **Verify:** merge → dev auto-deploys; promote to staging (manual) → prod blocked until green CI + approval →
  approve → prod live; health-fail aborts + surfaces. e2e via the control-ops.

**B3 · AI-assisted rollback + auto-ticket** — *inherit GIT_STRATEGY §6 plumbing; AI-driver is the delta.*
- **Scope:** operator says "prod X is broken" → an AI root-cause pass finds the suspect merge(s) → **proposes**
  the safe forward-revert → auto-drafts a tracking ticket. Human confirms; Conductor executes.
- **Approach:** the revert MECHANISM already exists (`mr-revert`, forward `git revert -m 1` → new MR + ticket,
  invariant #7). NEW: a non-coding `root-cause` AgentRole (provider-abstraction) that, given a symptom +
  recent merges + (RAG-grounded) diffs + deploy/health events, ranks likely-culprit merges and explains why →
  a `WorkspaceSuggestion(type:'rollback')`. Accept → the existing revert plumbing + a `DEV-####` tracking ticket
  pre-filled from the analysis. AI never reverts directly (B-23).
- **Decision:** AI proposes + explains; human confirms; reuse forward-revert (never reset).
- **Verify:** seed a "bad merge" + symptom → the role names it with reasoning → accept → revert-MR + tracking
  ticket created. Unit test the ranking/prompt; e2e the accept→revert.

### Wave C — Gates: quality · security · AI-review  *(themes 5,6,7)*

**C1 · Quality gates (green/red blocking promotion)** — *un-defer BUILTIN_CI_PIPELINES + Q-CI-MERGE-GATE.*
- **Scope:** CI job DAG on the existing orchestrator; a red required job **blocks** merge/promote;
  `allowMergeOnRedCI` Admin override.
- **Approach:** follow BUILTIN_CI_PIPELINES exactly (`Pipeline`/`PipelineRun`/`PipelineJob`, `.workspaces/ci.yml`,
  container jobs — "borrowed, not built" from the orchestrator: images/capacity/egress/lease/tenancy). Job
  result = Conductor-written `TicketEvent(type:'ci')`. Wire the gate into B2's promote + the MR-merge op.
- **Decision:** green-required (G-CI-2 A); admin override flag.
- **Verify:** a red job blocks promote; override lets it through with an audit event; green passes. e2e.

**C2 · Security & dependency scanning** — *inherit CI slot; job types are the delta.*
- **Scope:** dedicated `dep-audit` / `sca` / `secret-scan` CI job types that gate promotion.
- **Approach:** define them as first-class CI job types (container jobs with parsed results → `TicketEvent`),
  not just freeform scripts. Fail policy per severity. Runs in the same DAG as C1.
- **Decision:** high-severity blocks prod promote; report-only on dev.
- **Verify:** a planted vulnerable dep / leaked secret fails the gate with a parsed finding; clean repo passes.

**C3 · AI MR-review pass** — *inherit the human MR surface; the AI reviewer is the delta (white space).*
- **Scope:** a new AI reviewer that reads an MR diff (RAG-grounded) and **posts review threads via
  propose→accept** — it never approves/merges (B-23; BUILTIN_MR_REVIEW bars AI writes).
- **Approach:** a non-coding `mr-reviewer` AgentRole (provider abstraction) triggered on `mr.updated`. Reads the
  diff via the existing `mr/diff.ts` + `retrieve()` (the shared RAG) → line-anchored findings → `WorkspaceSuggestion`s
  the human accepts to post as real `ReviewComment`s (`authorKind:'ai'`, which the schema already has). Scoped
  to the workspace, never approves. This also fixes RAG-fragmentation for MR-review (theme 11).
- **Decision:** AI reviews + proposes comments; human accepts to post; AI never approves/merges.
- **Verify:** an MR with an obvious bug → the reviewer proposes a line-anchored finding with reasoning → accept
  posts it → approvals still human-only. Unit the finding→comment mapping; e2e the propose→accept.

### Wave D — Database  *(theme 4 · greenfield)*

**D1 · User-app DB support + migrations** — *greenfield.*
- **Scope:** a light DB explorer (schema/table browse, read-only first) + migration management: schema-diff →
  migration gen (agent) → **gated apply per environment** (dry-run + rollback plan).
- **Approach:** per-service DB connection (encrypted env-var, reuse the secret path). Explorer via a read-only
  introspection job in the service container. Migrations authored by the coding agent, applied as a gated
  control-op per environment (B-23; prod apply = approval + backup/rollback plan). Ties to B1 environments.
- **Decision:** read-only explorer first; migrations gen-by-agent, apply-gated per env; prod needs approval + backup.
- **Verify:** introspect a test DB; generate a migration from a schema change; apply to dev, gate on prod. e2e the apply-gate.

### Wave E — Reasoning & knowledge  *(themes 10,11)*

**E1 · Reasoning first-class** — *inherit per-stage model/escalation; think-budget + plan-critique gate are the delta.*
- **Scope:** an explicit per-stage **think-budget** primitive (surface the existing `model/effort/maxTurns`/
  `autoEscalate` from GOLDEN_PLAN_STAGE into the UI) + a **plan-critique gate**: an adversarial pass that
  attacks the plan before implement ("what's missing / what breaks?") and shows the human a short diff.
- **Approach:** the reasoning trace already flows through the AI-activity feed (built). Add: (1) a reasoning-effort
  control per stage config; (2) a `plan-critique` step after the plan stage — a read-only role (provider
  abstraction) that critiques the CarryOver plan → a `WorkspaceSuggestion` the human can fold in before implement.
  Never a second AI window (all through the chat/feed).
- **Decision:** think-budget = surface existing config; plan-critique = optional gate per pipeline, propose-only.
- **Verify:** raise a stage's effort → reflected in the rendered config + trace; a weak plan gets a critique
  with concrete gaps. Unit the critique prompt; e2e the gate.

**E2 · RAG sharpen + wire into all AI surfaces** — *inherit per-stage RAG; consolidate + un-defer institutional memory.*
- **Scope:** one unified index used by EVERY AI surface + kept visible in Sources; sharper retrieval;
  index Handoff/CarryOver as memory.
- **Approach:** the index is already singular (verified) + chat is now grounded. Finish the wiring: Studio +
  docs-gen use `retrieve()` too; add incremental re-index on merge (not just manual "Reindex code"); un-defer
  `additions/03_institutional_memory` (index Handoff/CarryOver → auto-inject prior learnings). Keep every
  injected source an InfoSource so it stays visible in Sources (the design-system doc pattern). Optional:
  symbol/call-graph retrieval (graphify skill slot exists).
- **Decision:** unify consumption first (cheap, high-value); institutional memory + graph retrieval second.
- **Verify:** each AI surface's prompt contains repo context when relevant; re-index fires on merge; a prior
  lesson surfaces in a later related ticket. Tests per wiring.

### Wave F — Setup & scale front-end  *(theme 8 · inherit repo-onboarding; scaffolding + welcome are the delta)*

**F1 · Greenfield scaffolding + welcome flow** — *inherit additions/04; project-from-template + welcome UX are new.*
- **Scope:** "create a new project from a stack template" (repo + Dockerfile + pipeline-config scaffolded) +
  a guided welcome/first-run onboarding UX.
- **Approach:** additions/04 (repo-onboarding: health report + drafted context docs, LOCKED V1) covers an
  EXISTING repo. NEW: a template catalog (a few curated stacks) → generate a fresh repo/service (ties to A1's
  service model + the GENERATE-vs-LINK split in features/01) + a first-run wizard replacing the bare
  "name a workspace" onboarding.
- **Decision:** a small curated template set first; wizard on top of the existing setup steps.
- **Verify:** pick a template → a working scaffolded project appears + runs its first pipeline; the welcome
  wizard walks a new user to a first ticket.

### Wave G — Insight & ergonomics  *(themes 12,13 · un-defer)*

**G1 · Delivery analytics UI** — *un-defer PRODUCT_ANALYTICS.*
- **Scope:** cycle-time, throughput, stuck-points, cost(tokens)-per-type, agent-quality trend — folds over the
  append-only `TicketEvent` + `SpendRecord` log; a dashboard surface.
- **Approach:** exactly PRODUCT_ANALYTICS (on-request fold, p85 default, product≠observability boundary,
  completion anchor = merge/final-done). No new write path/model/verb. Cost shown in TOKENS (invariant #9).
- **Verify:** the dashboard shows real cycle-time/throughput from seeded events; folds match hand-computed values.

**G2 · Review ergonomics** — *un-defer additions/05 + 06 (both V1-tagged).*
- **Scope:** cross-ticket **answer-queue** (swipe/stack through pending questions) + **presence/claim**
  (who's viewing/typing/answering + soft-claim idempotency).
- **Approach:** follow additions/05 + 06 (build-ready). Presence extends the existing `_sync/presence`.
- **Verify:** two clients → presence + a claim prevents a double-answer; the queue drains across tickets.

---

## 4. Deprioritized / explicitly not now
- **€-cost hard-blocking** (theme "cost") — token-usage display suffices (invariant #9). PARKED.
- **GitHub forge build** — seam stays; build later (§2.3).
- **External deploy targets** — the `DeployTarget` seam is designed in B2 but only the same-host provider is built.
- **HORIZON additions** (`11_scheduling_priority`, `14_predictive_budget`) — not in this program.

## 5. Suggested execution order for `/goal`
`A1` → `B1` → `B2` → `C1` → `C2` → `C3` → `B3` → `D1` → `E1` → `E2` → `F1` → `G1` → `G2`.
(Ship substrate first; gates before the gated promote depends on them; rollback after deploy+CI exist; then DB,
reasoning/RAG, scaffolding, insight/ergonomics.) Each item = schema→engine→client→verify→commit, branch-logged.
