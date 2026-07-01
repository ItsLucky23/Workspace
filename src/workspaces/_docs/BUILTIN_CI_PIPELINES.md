# Built-in CI / Pipelines — a lightweight self-hosted CI that REUSES the container orchestrator

> **⚑ V1 SCOPE:** DEFERRED — GitLab runs its own CI; Workspaces builds/triggers none in V1 ([V1_SCOPE.md] §3.7). Design-horizon record. Read [V1_SCOPE.md] first.

> The CI surface behind the `ci` capability of the forge seam ([FORGE_ABSTRACTION §3], `Q-FORGE-CI-RUNNER`). The user's strong steer is explicit: **GitLab pipelines are bloated and slow; build a lightweight, self-hostable CI by REUSING the container orchestrator Workspaces already has** ([07]/[07b]). This doc takes that literally — **a pipeline is an ordered DAG of container JOBS** (build / test / lint / custom), each job a short-lived container started on the **same infra as a Stage-Agent PTY container** (same image stack, same `CapacityManager`, same egress proxy, same pty-agent log streaming). A `.workspaces/ci.yml` repo file is the job spec; triggers ride the existing `WorkspaceTrigger` engine; a **pluggable `PipelineRunner` interface** lets a self-hosted external engine (Woodpecker / Drone / Dagger) or the external forge's own CI (GitLab CI / GitHub Actions) slot in **per forge-mode**. Status reports back onto the MR ([FORGE_ABSTRACTION §7.2]) and the board ([22]). Cites architecture as `[01 §x]`…`[07 §x]`, `[07b §x]`, `[CONTROL_API]`, `[04b §N]`, `[FORGE_ABSTRACTION §N]`; codes via [REFERENCE_CODES]. Last updated: 2026-06-04.
>
> **No new verbs.** This doc introduces **zero** structured-channel verbs. The frozen 7+6 surface ([02 §2], all `read|propose`, none write) is untouched. Every CI write — define a pipeline, run it, cancel it, report a job result onto the MR/board — is a **[control-API] route → `preApiExecute` RBAC → enqueue a Conductor action**, drained serially by the single-instance Conductor (the only writer, [01 §3.3]). No agent runs CI: a pipeline is **Conductor-driven infra**, not an LLM verb (B-23). Where a write/protocol surface appears below, the **"No new verbs."** stamp restates this.

---

## 0. One-paragraph summary

CI in Workspaces is **not a second engine** — it is the orchestrator running **short-lived job containers** instead of (or alongside) a long-lived PTY container. A **pipeline** is a tenant-scoped row plus a `.workspaces/ci.yml` repo spec describing **stages × jobs**, each job declaring an image, a script, dependencies, and a stage's egress/resource posture. A **pipeline run** is triggered by a `WorkspaceTrigger` (`ticket.merged` / a new `mr.updated` matcher / `stage.on_complete` / manual via [control-API]) and executed by a **`PipelineRunner`** behind the forge seam's `ci` capability ([FORGE_ABSTRACTION §3]). The **default runner is the native container runner** — it maps each job to a `docker run` of the existing L1/L2 image stack ([07b §1]) on `workspaces-net`, admitted by the **same `CapacityManager` budget** as Stage-Agents ([07b §8]), egress-filtered by the **same forward-proxy** ([07b §6]), and streamed live by the **same pty-agent `ws-term:*` relay** ([07b §9]). Each job's result lands as a **Conductor-written `TicketEvent`** so the MR check-list and the board chip render from the same `seq`-ordered log ([04b §6]) every other surface uses. The runner is **pluggable per forge-mode**: built-in mode defaults to the container runner; GitLab/GitHub modes default to the forge's native CI; a self-hosted external engine (Woodpecker/Drone/Dagger) is the third slot — **all behind one `PipelineRunner` interface**, the Conductor blind to which. New data: `Pipeline`, `PipelineRun`, `PipelineJob` — additive, tenant-scoped, folding into the [04b §13] field sweep.

---

## 1. Design principle — a pipeline IS the orchestrator running job containers

The single load-bearing decision (`Q-CI-RUNNER`, §11): **do not build a second CI substrate.** The orchestrator already owns every primitive a CI engine needs, and a built-in CI that *is* "the orchestrator runs job containers" inherits all of it for free (Rule 7b — minimum code; reuse beats reinvention):

| CI needs… | The orchestrator already has… | Reused via |
|---|---|---|
| A place to run an isolated build/test job | The three-layer image stack + `docker run` of L2/L1 ([07b §1]) | the **same images** — a CI job uses the project's L2 image (deps pre-warmed, [07b §1.2]) so `npm test` needs no install on the critical path |
| Admission / not over-subscribing the host | The `CapacityManager` admission gate ([07b §8]) | CI jobs draw from the **one shared resident budget** (§7) — never a second independent ceiling |
| Network egress control | The host forward-proxy + per-stage allow-list ([07b §6]) | a CI job inherits a **`PipelineJobNetworkCfg`** allow-list (npm registry, the forge host) the same way a stage does |
| Resource hardening | The hardening table — cap-drop, non-root, pids/mem/cpu/disk ([07b §7]) | every CI job carries the **same table**; CI jobs are *more* disposable, not less hardened |
| Live log streaming to the browser | The in-container pty-agent + `ws-term:*` relay ([07b §9]) | a CI job's stdout/stderr streams over the **same `/pty` namespace** — the `XtermTerminal` client is byte-identical (§6) |
| Single-writer serialization | `lease:orchestrator` (G8/G16) | every CI launch/teardown/status-write runs **under the same lease** — no second writer |
| Multi-tenant isolation | `runInTenant(workspaceId, …)` ([04b §11c]) | every CI job + its status-write runs **inside the tenant scope** |
| An append-only result log | `TicketEvent` (`seq`-ordered, [04b §6]) | each job result is a **Conductor-written `TicketEvent`** the MR/board render |

**What's genuinely new is small:** a pipeline *spec parser* (`.workspaces/ci.yml` → a job DAG), a *scheduler* (topological-order the DAG, respect `needs:`), three persisted rows (§9), and the `PipelineRunner` interface (§5). Everything that's expensive — containers, capacity, egress, streaming, leasing, tenancy — is **borrowed, not built**. This is the entire weight of the "lightweight, self-hostable" steer: lightweight *because* it reuses, self-hostable *because* the orchestrator is already self-hosted.

**Why not GitLab CI for built-in workspaces.** GitLab CI/Runner is a heavy, separately-operated, slow-to-spin component; forcing it on a workspace that has *no external forge* ([FORGE_ABSTRACTION §7], built-in mode) would re-introduce exactly the external dependency built-in mode exists to remove. In **GitLab/GitHub** modes the forge's native CI is still the default (don't force built-in CI on a workspace that already has a pipeline, §5); the container runner is the answer **only** where Workspaces is the forge — and an opt-in alternative everywhere.

**No new verbs.** A pipeline is the orchestrator running containers it already knows how to run; the agent never sees a CI verb.

---

## 2. The `.workspaces/ci.yml` job spec

CI is configured by a **repo file** — versioned, reviewable, diff-able in the MR (the same trust posture as `.workspaces/Dockerfile`, [07b §1.2] `Q-CT-DOCKERFILE-TRUST`), never a UI free-text shell field. The orchestrator reads it at the frozen `commitHash` of the run (DH5, [07 §A] step 3) so a pipeline is reproducible for that commit.

```yaml
# .workspaces/ci.yml — read at the run's frozen commitHash. A pipeline = stages × jobs (a DAG).
version: 1
stages: [lint, test, build]          # ordered phases; jobs in a stage run in parallel (capacity permitting)

jobs:
  lint:
    stage: lint
    image: project                    # 'project' = the resolved L2 image ([07b §1.2]); 'base' = L1; or a pinned tag (Admin-gated, §10)
    script: ["npm run lint"]
    network: [npm]                     # allow-list keys → PipelineJobNetworkCfg ([07b §6]); default = forge host + npm only
  unit:
    stage: test
    image: project
    script: ["npm run build", "npm test"]
    needs: [lint]                      # DAG edge: 'unit' waits on 'lint' (topological scheduling, §4)
    cache: [node_modules, .vite]       # cache keys (§8); restored before script, saved after on success
    artifacts: [coverage/]             # paths persisted to the run (§8), surfaced on the MR
  build:
    stage: build
    image: project
    script: ["npm run build"]
    needs: [unit]
    resources: { cpu: 2, memory: 3g }  # optional per-job override; defaults = the [07b §7] table
    allowFailure: false                # a failing required job fails the run (§4 gating)
```

- **`image: project` is the reuse hinge.** The default job image is the project's **pre-warmed L2** ([07b §1.2]) — `npm ci`/`dotnet restore`/`go mod download` already ran at L2 build time, so a CI job does **no dependency install on the critical path** (the same win Stage-Agents get). `base` uses L1; a pinned external tag is Admin-gated (supply-chain surface, §10).
- **`network:` keys resolve to a `PipelineJobNetworkCfg` allow-list** enforced by the **same forward-proxy** as stages ([07b §6]) — a CI job that doesn't declare `npm` cannot reach the registry; everything off the list is denied + logged. Default = the forge host + the Anthropic API is **not** added (CI jobs are not agents; they run a script, not `claude`).
- **`needs:` defines the DAG**; jobs with no unmet `needs` and a free capacity slot start in parallel (§4). Absent `needs`, `stages[]` order is the implicit dependency (every `test` job needs every `lint` job).
- **The spec is deterministic config**, parsed into `PipelineJob` rows (§9) — not executable shell the orchestrator interprets loosely. `script[]` runs **inside** the hardened job container ([07b §7]), never on the host.

**`Q-CI-SPEC` (open, §11):** ship the lean `.workspaces/ci.yml` above, or adopt a GitLab-`.gitlab-ci.yml`-compatible subset for drop-in migration? **Recommended: ship the lean native spec; offer a `.gitlab-ci.yml` *importer* (best-effort translate to `ci.yml`) as a P3 migration aid** — not runtime compat. Native keeps the parser small and the semantics ours; an importer eases the GitLab→built-in move ([MIGRATION]) without coupling the engine to GitLab's schema.

**No new verbs.** The spec is a repo file the orchestrator parses; it is config emission, not a protocol surface.

---

## 3. Triggers — ride `WorkspaceTrigger`, no new verb

A pipeline run starts from one of four triggers, **all expressed on the existing `WorkspaceTrigger` engine** ([03 §1.2]) so CI adds **no new trigger mechanism** and **no new verb**:

| Trigger | `WorkspaceTrigger` shape | Notes |
|---|---|---|
| **On merge** | `{ on:'ticket.merged', action:'run-command', params.command:'ci:run' }` | the post-merge pipeline; `ticket.merged` already exists ([03 §1.2]). Fires the run at the merge commit. |
| **On MR update / push** | `{ on:'mr.updated', action:'run-command', params.command:'ci:run' }` | **`mr.updated` is a new `TriggerEventKind` matcher**, NOT a new verb — it is a `WorkspaceTrigger` event the Conductor synthesizes from a normalized merge/push `ForgeEvent` ([FORGE_ABSTRACTION §3] conformance bar). See `Q-CI-PUSH-TRIGGER` (§11). |
| **On stage complete** | `{ on:'stage.on_complete', action:'run-command', params.command:'ci:run' }` | pre-merge CI per stage (off by default), mirroring the [23] auto-preview trigger exactly. |
| **Manual** | a [control-API] `ci-run` op ([CONTROL_API §8], §8 below) | "Run pipeline" button on the MR / board — a human lever, RBAC-gated (§8). |

- **`ci:run` / `ci:cancel` are registered `OrchestratorCommandRegistry` keys** ([03 §1.5]), exactly like `ai:refresh-docs` and `preview-up` — never raw shell. A `run-command` trigger picks the key from the allow-list dropdown ([10 §builder]); it cannot author a script.
- **The trigger fires a Conductor action**, not a direct write: `WorkspaceTrigger` → (optional `requiresApproval` → `automation` suggestion, [03 §1.5]) → the Conductor enqueues a `ci-run` and drives `forge.ci.runPipeline(spec, commit)` ([FORGE_ABSTRACTION §3]). Identical governance to every other trigger action.
- **Why `mr.updated` is a matcher, not a verb:** the agent never *requests* a pipeline; a normalized forge event (push/MR-update from a GitLab webhook, a GitHub webhook, or a built-in git hook — [FORGE_ABSTRACTION §3]) lands as a Conductor-written event, and the trigger engine matches on it. This is the [02 §3] hook→event→trigger chain, not a new structured-channel verb.

**`Q-CI-PUSH-TRIGGER` (open, §11):** add `mr.updated` (and/or `repo.pushed`) to `TriggerEventKind`, or reuse only `ticket.merged` + manual for v1? **Recommended: add `mr.updated` (covers pre-merge CI, the killer-feature loop) and defer `repo.pushed`** (branch-push-without-MR CI is rarer and noisier). `ticket.merged` alone can't gate an MR *before* merge — and pre-merge gating is the whole point of MR CI.

**No new verbs.** Triggers reuse `WorkspaceTrigger` + the `ci:run`/`ci:cancel` allow-listed commands; `mr.updated` is a trigger event matcher, not a structured-channel verb.

---

## 4. The scheduler — a DAG of jobs on the shared budget

The Conductor drives the run; the scheduler is a deterministic, leased loop (G8/G16) — there is **no second writer**:

```ts
// Conductor-driven, under lease:orchestrator + runInTenant(workspaceId). NOT an agent loop.
async function runPipeline(pipelineRunId, spec, commit) {
  await withLease('lease:orchestrator', async () => {
    const jobs = toposort(spec.jobs);                  // DAG order from needs[] / stages[] (§2)
    while (!allTerminal(jobs)) {
      for (const job of readyJobs(jobs)) {             // deps satisfied AND not yet started
        if (!capacity.admit({ kind: 'ci-job', workspaceId })) { enqueueJob(job); continue; } // §7 shared budget
        const result = await runner.runJob(job, commit); // §5 PipelineRunner — container runner by default
        writeJobEvent(job, result);                    // Conductor writes a TicketEvent (§6); the only writer
        if (result.failed && !job.allowFailure) markDownstreamSkipped(job); // gating (§4.1)
      }
      await waitForAnyJobToFinishOrSlotToFree();
    }
    writeRunEvent(pipelineRunId, rollupStatus(jobs));  // success | failed | canceled → MR check + board chip (§6)
  });
}
```

### 4.1 Gating & rollup
- A **required** job (`allowFailure:false`, the default) that fails marks its downstream `needs:` consumers **skipped** and the **run `failed`**.
- An **`allowFailure:true`** job that fails is recorded but does not fail the run (advisory lint).
- The run's rollup status (`success` / `failed` / `canceled` / `running`) is the MR's merge-gate signal (§6) and the board chip (§6.2).
- **Cancellation** (`ci:cancel`, §8): the Conductor stops scheduling new jobs and kills running job containers ([07b §9] kill path); in-flight jobs go `canceled`, untriggered jobs `skipped`.

### 4.2 Frozen commit
A run is pinned to **one `commitHash`** (DH5, [07 §A] step 3) — captured at run start, frozen for the run's life. Every job clones `--single-branch` at that commit ([07b §4]), so CI is reproducible and a `main`-advance mid-run does not move the pipeline. This is the **same freeze** the Stage-Agent and the RAG snapshot share — CI rides it for free.

**No new verbs.** The scheduler is the Conductor executing a deterministic DAG; cancellation is a [control-API] op.

---

## 5. The `PipelineRunner` interface — pluggable per forge-mode

`ci` in [FORGE_ABSTRACTION §3] resolves to a **`PipelineRunner`**, selected by `ForgeConnection.ciRunner` ([FORGE_ABSTRACTION §6]). One interface, three implementations; the Conductor is runner-blind (mirrors [MULTI_PROVIDER_SEAM]'s spawn-function localization, applied to CI):

```ts
// Internal orchestrator seam — NOT a structured-channel verb surface. Called only by the CONDUCTOR.
interface PipelineRunner {
  readonly kind: 'builtin-container' | 'external-engine' | 'forge-native';
  runJob(job: PipelineJob, commit: string): Promise<JobResult>;   // start + await one job; stream logs (§6)
  runPipeline?(spec, commit): Promise<{ runId: string }>;          // delegate the WHOLE pipeline (forge-native/external)
  status(runIdOrJobId: string): Promise<RunStatus | JobStatus>;
  cancel(runIdOrJobId: string): Promise<void>;
  streamLogs(jobId: string): AsyncIterable<Bytes>;                 // → the /pty ws-term relay (§6), reused
}
```

| Runner | When it's the default | How it runs a job | Logs / status |
|---|---|---|---|
| **`builtin-container`** [recommended default for **built-in** forge mode] | `forgeMode='builtin'` (`Q-FORGE-CI-RUNNER` default) | maps each `PipelineJob` to a `docker run` of the L2/L1 image on `workspaces-net` ([07b §1/§5]), admitted by `CapacityManager` (§7), egress-filtered (§2/[07b §6]), hardened ([07b §7]) | pty-agent `ws-term:*` relay (§6); status from the job container's exit code → Conductor `TicketEvent` |
| **`forge-native`** [recommended default for **gitlab** / **github** modes] | `forgeMode='gitlab'`/`'github'` | delegates the whole pipeline to **GitLab CI** / **GitHub Actions** (`runPipeline` delegates; the forge runs it) | polled/`webhook`-fed status normalized to a `ForgeEvent` → Conductor `TicketEvent`; logs link out to the forge |
| **`external-engine`** [pluggable alt, any mode] | `ForgeConnection.ciRunner.kind='external'` points at a self-hosted engine | delegates to **Woodpecker / Drone / Dagger** (a self-hosted CI the team already runs) over that engine's API | engine status normalized → `TicketEvent`; logs link out or proxied |

**Recommendation (`Q-CI-RUNNER`, §11): built-in mode defaults to `builtin-container`; GitLab/GitHub modes default to `forge-native`; `external-engine` is the opt-in for teams running their own CI.** This satisfies the steer's two halves at once: (a) a *lightweight self-hostable* CI exists (the container runner) and (b) *a self-hosted external engine can slot in* (the `external-engine` runner) — without forcing built-in CI on a workspace that already has a forge pipeline ([FORGE_ABSTRACTION §5] "no built-in CI forced on a GitLab-SoT workspace").

**Survey of external engines (for `external-engine`, informational):**
| Engine | Fit as `external-engine` | Note |
|---|---|---|
| **Woodpecker** | strong | lightweight, container-native, self-hostable; closest philosophy to the built-in runner — natural "graduation" target |
| **Drone** | strong | container-native, mature; heavier than Woodpecker, license considerations |
| **Dagger** | strong (programmable) | pipelines-as-code in a container engine; powerful but a steeper concept than `ci.yml` |
| **native-container-reuse** | **the v1 default** | *no external engine* — the orchestrator IS the runner; zero new service (Rule 7b) |

The conformance bar (mirroring [FORGE_ABSTRACTION §3]): a conforming `PipelineRunner` MUST (1) return a `JobResult`/`RunStatus` the Conductor writes as a `TicketEvent` (never write status itself — the Conductor is the only writer, [01 §3.3]); (2) stream logs the `/pty` relay can render (or a link-out for delegated runners); (3) honor `cancel`. A runner meeting these drops in with no Conductor change.

**No new verbs.** The runner is an internal seam the Conductor calls; swapping it swaps the callee, never adds a write path.

---

## 6. Status reporting — onto the MR and the board, via the `seq`-ordered log

CI is only useful if its result is **visible where decisions are made**: the MR (merge gate) and the board (at-a-glance health). Both render from the **same `seq`-ordered `TicketEvent` log** ([04b §6]) as every other surface — CI introduces no parallel status channel.

### 6.1 On the MR (the killer-feature surface)
- Each job's result is a Conductor-written `TicketEvent` (`type:'ci'`, carrying `pipelineRunId` / `jobName` / `status` / `durationMs`). The expanded MR experience ([FORGE_ABSTRACTION §7.2], the dedicated MR doc) renders a **checks list** ("lint ✓ · unit ✗ · build ◐") from these events.
- The **run rollup gates merge**: a `failed` required run shows a **red merge gate** on the MR; the [control-API] `mr-merge` op ([FORGE_ABSTRACTION §7.2]) is RBAC-gated *and* CI-gated (a Conductor pre-check refuses merge while a required run is `failed`/`running`, unless an Admin force-merges — `Q-CI-MERGE-GATE`, §11).
- **In external mode** the MR check federates: GitLab/GitHub CI status arrives as a normalized `ForgeEvent` ([FORGE_ABSTRACTION §3]) and renders the *same* checks list — the MR surface can't tell which runner produced it (the conformance payoff).

### 6.2 On the board
- A compact **CI chip** on the ticket card/header (mirroring the [23] preview badge pattern: a `Record<RunStatus, tint>` map, reused styling vocabulary) shows `● passing · ◐ running · ✗ failing` for the ticket's latest run. Read-projection of the `TicketEvent` log; no new store.

### 6.3 Live logs — reuse the pty-agent relay
A running job's stdout/stderr streams over the **existing `/pty` namespace** using the **`ws-term:*` protocol** ([07b §9]) — the `XtermTerminal` client (`src/workspaces/_components/XtermTerminal.tsx`) renders a CI job's log **byte-identically** to a Stage-Agent terminal. A "Logs" tab on the MR/pipeline view attaches to the job's pty-agent stream; on completion the scrollback persists to the run (§8 artifacts) for later read. **No new streaming transport** — CI logs are just another `/pty` consumer.

**No new verbs.** Status is Conductor-written `TicketEvent`s; the MR/board render projections; logs reuse the `/pty` relay (a transport, not a verb).

---

## 7. Resource & concurrency sharing — ONE budget with Stage-Agents

The user's steer is explicit: **resource/concurrency sharing with stage-agents — one budget.** This is the `CapacityManager` ([07b §8]) extended by exactly one job-kind, **not** a second pool:

- **CI jobs draw from the SAME shared resident budget** as Stage-Agent containers and preview containers (`MAX_RESIDENT`, [07b §8.1]) — never an independent ceiling that could over-subscribe the host. A workspace running 8 active stage turns has *less* CI capacity, and vice-versa, by design (`Q-CI-BUDGET`, §11). This mirrors how `previewConcurrencyCap` is a **sub-limit inside one budget**, not a separate allocation ([07b §8.2]).
- **Admission is the same gate** (§4): `capacity.admit({ kind:'ci-job', … })` runs the [07b §8.2] logic — under `MAX_RESIDENT` + RAM watermark → launch; else **reclaim oldest paused/idle** (CI jobs are short-lived and *preferred reclaim victims* — `Q-CI-PRIORITY`, §11) → else **queue, never hard-reject**. A queued CI job surfaces "queued — N slots in use" on the MR, reusing the [23] preview-queue copy pattern.
- **Per-job limits are the [07b §7] hardening table** (cap-drop ALL, non-root, pids 512 / mem 3g / cpu 2 / disk quota), overridable per job via `resources:` (§2) within an Admin-set ceiling. CI jobs are *more* disposable than stage containers — `--restart no` (a failed CI job is re-triggered, not auto-restarted; it does NOT join `resumeAll`, distinguishing it from a stage container's `--restart unless-stopped`).
- **One new metric, on the existing OBSERVABILITY contract.** CI jobs fold into `ws_resident_containers` and add `ws_ci_jobs_active` (gauge) + `ws_ci_runs_total{status}` (counter) + `ws_ci_queue_depth` (gauge) to the [OBSERVABILITY §2] set — derived, no new persistence beyond the §9 rows; labeled `{workspaceId}` only (no `jobId`/`pipelineRunId` labels — cardinality, [OBSERVABILITY §2]). A wedged CI job is caught by the existing per-loop liveness probe ([OBSERVABILITY §3]) since the scheduler is a leased loop.

**`Q-CI-BUDGET` (open, §11):** one fully-shared budget, or a *soft reservation* (e.g. CI may use ≤ 30% of `MAX_RESIDENT` so heavy CI can't starve interactive stage turns)? **Recommended: one shared budget with CI jobs as preferred reclaim victims (short-lived) — add a soft cap only if measurement shows CI starving interactive turns.** Start simple (Rule 7b); the reclaim-victim preference already protects interactive work without a second knob.

**No new verbs.** Admission/reclaim/queue are [control-API]-driven Conductor actions ([07b §8]); the user sees a queue notification (B-34), not a protocol surface.

---

## 8. Artifacts & caching

- **Caching** (`cache:` keys, §2): a per-`(projectId, cacheKey)` named volume restored into the job before `script[]`, saved after on success — so `node_modules` / build caches survive across runs without a registry. Keyed by content where possible (lockfile hash, mirroring the L2 content-hash, [07b §1.2]); invalidated on lockfile change. Lives on the orchestrator host volume set, joining the [DR_RUNBOOK] backup posture alongside worktrees + bare repos ([FORGE_ABSTRACTION §7.1]). **`Q-CI-CACHE` (§11): host-volume cache for v1; an object-store (S3/MinIO) cache is a P3 upgrade** for multi-host — out of the single-instance v1.
- **Artifacts** (`artifacts:` paths, §2): files a job declares (coverage, build output) are copied out of the job container on success into the `PipelineRun` (§9), surfaced on the MR as downloadable links + (for known kinds like coverage) a rendered summary. Retention rides a [07b §8]-style cron (drop artifacts older than N runs / the run's TTL — `Q-CI-ARTIFACT-RETENTION`, §11; recommended default: keep the last N runs per pipeline + all artifacts of an *open* MR's latest run).
- **Both are disposable-by-default**, reproducible from the frozen `commitHash` — losing a cache slows a run, never corrupts it (consistent with the [07b] disposable-container model).

**No new verbs.** Cache/artifact handling is orchestrator-side container I/O.

---

## 9. Data-model additions — `Pipeline`, `PipelineRun`, `PipelineJob`

Three additive, tenant-scoped rows; they fold into the [04b §13] field sweep. The `.workspaces/ci.yml` spec is the *source*; these rows are the *materialized run state* the MR/board/logs render.

```prisma
// The pipeline DEFINITION for a project (derived from .workspaces/ci.yml at a commit; one active per project).
model Pipeline {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId               // tenant
  projectId   String   @db.ObjectId               // the project whose .workspaces/ci.yml this is
  specHash    String                               // content-hash of the parsed ci.yml (reuse/invalidate, mirrors L2 tagging)
  stages      String[]                             // ordered stage names from the spec
  enabled     Boolean  @default(true)              // workspace can disable CI without deleting the row
  runnerKind  String                               // mirrors ForgeConnection.ciRunner.kind (denormalized for the run)
  createdAt   DateTime @default(now())
  @@unique([workspaceId, projectId])
  @@index([workspaceId, projectId])
}

// One execution of a pipeline at a frozen commit.
model PipelineRun {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId             // tenant
  pipelineId    String   @db.ObjectId
  ticketId      String?  @db.ObjectId             // the DEV-#### ticket / MR this run gates (null for branch-only runs)
  mergeRequestId String? @db.ObjectId             // links to MergeRequest ([FORGE_ABSTRACTION §7.2]) for the MR check-list
  commitHash    String                             // frozen baseline (DH5) — reproducible
  trigger       String                             // 'merge' | 'mr-update' | 'stage-complete' | 'manual' (§3)
  status        String   @default("running")       // 'running' | 'success' | 'failed' | 'canceled'
  startedAt     DateTime @default(now())
  finishedAt    DateTime?
  artifacts     Json?                              // declared artifact paths + storage refs (§8)
  @@index([workspaceId, pipelineId, status])
  @@index([workspaceId, mergeRequestId])
}

// One job within a run (a container exec for the builtin-container runner).
model PipelineJob {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId  String   @db.ObjectId              // tenant
  pipelineRunId String  @db.ObjectId
  name         String                              // 'lint' | 'unit' | 'build' (from ci.yml)
  stage        String                              // the stage this job belongs to
  needs        String[]                            // DAG edges (§4 scheduling)
  imageRef     String                              // resolved L2/L1 tag (or external image) — audit, mirrors [07b §10]
  status       String   @default("pending")        // 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'canceled'
  allowFailure Boolean  @default(false)
  containerId  String?                             // builtin-container runner: the job container ([07b §3]); null for delegated runners
  exitCode     Int?
  startedAt    DateTime?
  finishedAt   DateTime?
  @@index([workspaceId, pipelineRunId, status])
}
```

- **Job results are NOT stored as the status truth — they are mirrored to `TicketEvent`.** The `PipelineJob.status` row is the run-state projection; the **`seq`-ordered `TicketEvent`** ([04b §6]) the Conductor writes per job is the surface-rendering truth (§6), consistent with every other Workspaces surface. The rows let the scheduler resume/audit; the events let the MR/board render.
- **`imageRef` + `cliVersion`-equivalent stamping** ([07b §10], B-36 audit): a builder can answer "which image ran this CI job for this MR" from the `PipelineJob` row, mirroring the `AgentSession` image-stamp.
- **Forge-mode neutrality:** in `forge-native`/`external-engine` modes, `PipelineJob.containerId` is null and the rows are a **cache/projection** of the delegated engine's run (the same projection posture as `MergeRequest` in external mode, [FORGE_ABSTRACTION §7.2]).

**INDEX delta:** `Pipeline`, `PipelineRun`, `PipelineJob` (net-new persisted); `TriggerEventKind += 'mr.updated'` ([03 §1.2], `Q-CI-PUSH-TRIGGER`); `OrchestratorCommandRegistry += 'ci:run' | 'ci:cancel'`; OBSERVABILITY metrics `ws_ci_jobs_active` / `ws_ci_runs_total` / `ws_ci_queue_depth` (derived, no persistence).

**No new verbs.** These are persisted run-state rows the Conductor writes; nothing here is a structured-channel verb.

---

## 10. Security posture — inherited, plus the CI-specific surface

CI inherits the full [07b] container security posture and adds one new surface (arbitrary `script[]` from a repo file):

- **`script[]` runs in a hardened, egress-filtered, non-root container** ([07b §6/§7]) — never on the host, never with the projected subscription `.credentials.json` mounted (a CI job is **not** an agent; it gets **no** `CLAUDE_CONFIG_DIR` auth mount, [07b §2]). The biggest blast-radius mitigation: CI containers can't bill the subscription or read the auth token because the token is never projected into them.
- **`.workspaces/ci.yml` is a repo file** — versioned, reviewable in the MR diff, the same trust model as `.workspaces/Dockerfile` ([07b §1.2] `Q-CT-DOCKERFILE-TRUST`). Changing it is part of the normal MR review; a CI-spec change that adds a job is visible in the diff before it runs.
- **External/pinned job images are Admin-gated** (§2 `image:` pinned-tag path) — same supply-chain posture as L2 ([07b §1.2]); the default `image: project` (L2) needs no extra gate.
- **Per-stage DB credentials are NOT auto-injected into CI jobs.** A CI job that needs a test DB declares it explicitly (a `network:` allow-list entry + a tmpfs-injected *test-tier* credential, [07b §6.3]) — CI does not silently inherit a stage's `mongo:rw` tier (B-O8). Recommended default: CI jobs get **no DB creds** unless the job declares a test-DB need (`Q-CI-DB-CREDS`, §11).
- **No agent authors CI.** A Stage-Agent may *edit* `.workspaces/ci.yml` as a code change (it's a repo file), which a human reviews + merges; the agent **never triggers or merges** a run (B-23). Running CI is a Conductor action behind [control-API]; merging past a red gate is an Admin force (§6.1).

**No new verbs.** CI security is `docker run` flags + repo-file review + [control-API] RBAC; no protocol surface.

---

## 11. Open questions (Q-CI-*) — defaults recommended, user to confirm/override

Each is a genuine design fork; the doc states a recommended default (so it is coherent) and records the fork for the user.

| id | Question | Recommendation | Why | Options |
|---|---|---|---|---|
| `Q-CI-RUNNER` | What runs built-in CI? | **A `PipelineRunner` interface; built-in mode defaults to `builtin-container` (jobs on [07]/[07b]); GitLab/GitHub modes default to `forge-native`; `external-engine` (Woodpecker/Drone/Dagger) is the pluggable alt.** | Reuses the orchestrator Workspaces already has (Rule 7b, the user's steer) under the existing lease + limits; the pluggable interface satisfies "self-hostable external engine can slot in" without forcing built-in CI on a forge-SoT workspace ([FORGE_ABSTRACTION §5]). | (A) native-container-reuse [rec default]; (B) forge-native only (no built-in CI); (C) mandate an external engine; (D) embed a CI lib |
| `Q-CI-SPEC` | Native `ci.yml` or GitLab-compatible? | **Lean native `.workspaces/ci.yml`; a best-effort `.gitlab-ci.yml` *importer* as a P3 migration aid (not runtime compat).** | Native keeps the parser small + semantics ours; an importer eases GitLab→built-in ([MIGRATION]) without coupling the engine to GitLab's schema. | (A) native + importer [rec]; (B) native only; (C) `.gitlab-ci.yml` subset at runtime; (D) GitHub-Actions-yaml subset |
| `Q-CI-PUSH-TRIGGER` | Which trigger events for CI? | **Add `mr.updated` to `TriggerEventKind` (pre-merge CI, the MR loop) + keep `ticket.merged` + manual; defer `repo.pushed`.** | `ticket.merged` alone can't gate an MR *before* merge — pre-merge gating is the point of MR CI; branch-push-without-MR CI is rarer/noisier. | (A) `mr.updated` + merged + manual [rec]; (B) add `repo.pushed` too; (C) merged + manual only; (D) manual only (v1 minimal) |
| `Q-CI-BUDGET` | Fully-shared budget or a CI reservation? | **One shared `CapacityManager` budget with CI jobs as preferred reclaim victims; add a soft cap only if CI is shown to starve interactive turns.** | The user's "one budget" steer ([07b §8.2]); short-lived CI jobs are safe reclaim victims, protecting interactive stage turns without a second knob (Rule 7b). | (A) shared, CI = reclaim-victim [rec]; (B) shared + soft ≤30% CI cap; (C) separate CI pool; (D) CI only when host idle |
| `Q-CI-MERGE-GATE` | Does a red run block merge? | **Yes — a `failed`/`running` required run blocks the [control-API] `mr-merge` op (Conductor pre-check); an Admin may force-merge with an explicit override.** | CI is only a killer feature if it actually gates merge; the Admin override prevents a wedged runner from hard-blocking a team. | (A) gate + Admin override [rec]; (B) gate, no override; (C) advisory only (no gate); (D) per-pipeline configurable |
| `Q-CI-DB-CREDS` | Do CI jobs get DB credentials? | **No by default; a job must declare a test-DB need (explicit `network:` + tmpfs test-tier cred), never auto-inherit a stage's B-O8 tier.** | Least-privilege ([07b §6.3], B-O8); most lint/unit/build jobs need no DB, and silent `mongo:rw` inheritance is a needless blast-radius. | (A) opt-in test-tier [rec]; (B) inherit the stage tier; (C) never (mock-only CI); (D) per-job explicit any tier |
| `Q-CI-CACHE` | Where does CI cache/artifacts live? | **Host-volume cache + run-attached artifacts for v1 (joins [DR_RUNBOOK] backup); object-store (S3/MinIO) cache is a P3 multi-host upgrade.** | Single-instance v1 has no second host to share an object store; host-volume reuses the existing backup posture (Rule 7b). | (A) host-volume [rec]; (B) object-store now; (C) no cache (always cold); (D) registry-layer cache |
| `Q-CI-ARTIFACT-RETENTION` | How long are artifacts/logs kept? | **Keep the last N runs per pipeline + all artifacts of an open MR's latest run; a cron drops the rest (mirrors [07b §8] retention).** | Bounds host disk without losing the artifacts a live review needs; reproducible-from-commit means old artifacts are regenerable. | (A) last-N + open-MR [rec]; (B) time-based TTL; (C) keep until MR merged/closed; (D) keep all (manual GC) |

---

## 12. Composition — how CI sits across the existing surfaces

| Surface | Relationship to CI |
|---|---|
| **[FORGE_ABSTRACTION §3] `ci` capability** | CI *is* the `ci` capability's implementation; `PipelineRunner` (§5) is what `forge.ci.runPipeline/pipelineStatus/cancel` resolve to, selected by `ForgeConnection.ciRunner` per forge-mode. |
| **[07]/[07b] orchestrator + container runtime** | CI jobs are short-lived containers on the **same** image stack ([07b §1]), `CapacityManager` ([07b §8]), egress proxy ([07b §6]), hardening ([07b §7]), pty-agent relay ([07b §9]), lease (G8/G16), and `runInTenant` ([04b §11c]). Reuse, not reinvention (§1). |
| **[FORGE_ABSTRACTION §7.2] MergeRequest** | CI rolls up into the MR's checks list + merge gate (§6.1); `PipelineRun.mergeRequestId` links them. The killer-feature MR loop = MR + diff + review + **CI gate** + merge. |
| **[22] board sync** | a CI chip on the card/header renders the latest run status from the `TicketEvent` log (§6.2) — same `seq`-ordered projection as the board itself. |
| **[23] preview deployment** | preview + CI **share the same container orchestrator + the one shared budget** ([07b §8.2]); a preview is a long-lived PROD container, a CI job is a short-lived script container — same infra, different lifetime. |
| **[03 §1]/[10] automations** | CI triggers are `WorkspaceTrigger` rows (§3); the `ci:run`/`ci:cancel` registered commands appear in the [10] trigger-builder `run-command` dropdown like `ai:refresh-docs`/`preview-up`. |
| **[CONTROL_API §8]** | `ci-run` / `ci-cancel` are new catalogue rows (manual run + cancel), `login:true` + `preApiExecute` RBAC → enqueue → Conductor → `forge.ci.*`. The MR merge op (`mr-merge`) gains a CI pre-check (§6.1). |
| **[OBSERVABILITY §2/§3]** | CI folds into `ws_resident_containers` + adds `ws_ci_*` metrics; the scheduler (a leased loop) is covered by the existing per-loop liveness probe. |
| **[04b §13]** | the three new rows (§9) fold into the data-model field sweep; forge-mode-neutral (projection in delegated-runner modes). |

---

## 13. Self-check (review invariants)

- **No new verbs** introduced anywhere. The frozen `[02 §2]` surface (7 worker + 6 assistant, all `read|propose`) is untouched; `mr.updated` is a `WorkspaceTrigger` event matcher, not a structured-channel verb; `ci:run`/`ci:cancel` are `OrchestratorCommandRegistry` keys behind [control-API].
- **No write verb granted to any LLM session.** Every CI write — define/run/cancel a pipeline, report a job result onto the MR/board — is a Conductor action behind [control-API] (B-23, [01 §3.3]). No agent runs CI; an agent may *edit* `.workspaces/ci.yml` as reviewable code, never trigger or merge.
- **Reuse over reinvention.** CI is the orchestrator running job containers on the existing image stack, `CapacityManager`, egress proxy, hardening, pty-agent relay, lease, and `runInTenant` (§1) — the "lightweight, self-hostable" steer realized as borrowed infra (Rule 7b).
- **One shared budget.** CI jobs draw from the same `CapacityManager` resident budget as Stage-Agents + previews ([07b §8.2]) — no second independent ceiling (§7).
- **Single-instance + lease preserved.** The scheduler + every job launch/teardown/status-write runs under `lease:orchestrator` (G8/G16); CI adds leased work, not a second writer.
- **Multi-tenancy preserved.** Every CI job + status-write runs under `runInTenant(workspaceId, …)` ([04b §11c]); `Pipeline`/`PipelineRun`/`PipelineJob` are tenant-scoped.
- **Pluggable per forge-mode.** `PipelineRunner` (§5) defaults to the container runner in built-in mode, the forge's native CI in GitLab/GitHub modes, and an external engine where configured — satisfying both halves of the steer (`Q-CI-RUNNER`).
- **Status renders from the `seq`-ordered `TicketEvent` log** (§6) — the same projection every Workspaces surface uses; no parallel CI status channel.
- **Every genuine fork is an open question** (§11) with a recommended default — `Q-CI-RUNNER`, `Q-CI-SPEC`, `Q-CI-PUSH-TRIGGER`, `Q-CI-BUDGET`, `Q-CI-MERGE-GATE`, `Q-CI-DB-CREDS`, `Q-CI-CACHE`, `Q-CI-ARTIFACT-RETENTION`.
- This doc **edits no existing file** — it is the CI surface that cites [FORGE_ABSTRACTION §3] as the seam and [07]/[07b] as the reused engine.
