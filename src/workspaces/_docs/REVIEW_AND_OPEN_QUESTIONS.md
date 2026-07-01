# Workspaces — Deep Review, Proposals & Open Questions

> Produced 2026-06-04 by a 26-agent ultracode review of the WHOLE project: every `handoff/` spec + all `src/workspaces/_docs` + the prototype code. Purpose: surface gaps, things to (re)consider, and **68 concrete open questions** (each with a recommendation) so we can lock decisions and then write the extensive build-documentation set. **Container architecture and the parked multi-provider topic are treated in depth** per the user's request.
>
> **How to use this doc:** read the TL;DR → the deep-dives → answer the questions (grouped by area; each has an id `Q-…`, a recommendation, options, and a `**→ Keuze:**` line you can fill in across devices). When the answers are in, we write the build docs per the **Documentation plan** at the bottom. Nothing here is committed; no code/docs were changed except the creation of this file.

---

## TL;DR — project health

Three artifact layers exist with **real drift** between them:
1. **Spec layer** (`handoff/`, "deprecated but 2 days old") — IDEE_SPEC, BESLISSINGEN (B-01…B-O8), DATAMODEL, CLAUDE_SETTINGS_MAP, FRAMEWORK_GAPS/CAPABILITIES/USAGE, DESIGN_BRIEF + designs/. (`VRAGEN.md`/`FRAMEWORK_REMEDIATION.md` referenced by the spec live in `sparring/`, not `handoff/` — a path issue, not a lost file.)
2. **Docs layer** (`src/workspaces/_docs/`, 01–07 + SETUP + INDEX + 24 feature docs, decisions D1–D87) — has substantially **evolved and on the load-bearing axis deliberately OVERRIDES** the spec (engine = interactive Claude CLI PTY only, no headless `-p`, no Agent SDK).
3. **Prototype** (`src/workspaces/`) — UI-only dummy data; the **one real backend piece** is the dev-gated host-shell terminal bridge (`server/hooks/workspacesTerminal.ts` + `XtermTerminal.tsx`).

The docs are unusually disciplined (frozen verb surface, B-23 propose→accept→Conductor-executes, consistent cross-citation) and the high-traffic spine (07_ORCHESTRATOR, event-log, RAG, GitLab-SoT, Caddy) is sound. **Five structural hazards** stand out:
- **(a) Precedence inversion.** README's "specs win on conflict" rule, read literally, re-instates the rejected headless path — on the single highest-impact decision. → `Q-INF-SPECWIN`
- **(b) Lost machine contract.** The PTY pivot traded headless `--json-schema`'s guaranteed structured-exit + token stream for prompt-discipline, with no deterministic backstop and no documented per-turn token feed. → `Q-ENG-CARRYOVER-ENFORCE`, `Q-ENG-TOKENFEED`, `Q-ENG-SPIKE`
- **(c) Data-model drift.** `types.ts` claims "1:1" parity it no longer has (~8 doc-only model families, 3 conflicting `AgentSession` definitions, a fixed 7-literal `StageId` union vs the dynamic preset model); docs 16–24 cite `DATAMODEL §6–§11` that **don't exist** in `04`. → `Q-DATA-*`
- **(d) Container layer named-everywhere-specified-nowhere.** Provisioning, the `~/.claude` auth mount, and egress enforcement are asserted but not build-grade. → the whole **Container deep-dive** + `Q-CT-*`/`Q-NET-*`.
- **(e) "control-API" undefined.** The most-reused WRITE mechanism across all 24 feature docs has no transport/auth/shape. → `Q-ENG-CONTROL-API`

Also: `FRAMEWORK_GAPS.md` is **stale** — G6/G7/G9/G24 + the leader-election lease already ship in `packages/` (a builder reading it writes redundant code). And the framework is **now published** (npm org live, 14 packages at 0.1.0) — the real build can start once these decisions land.

---

## Top recommendations (prioritized)

**HIGH**
1. **Gate the build on a P0 "CLI behavior spike."** Verify (against the running 2026 CLI) interactive-PTY subscription billing, `type:http` hook delivery in interactive mode, `/clear` vs `/compact` session-id preservation, a per-turn usage feed, and `--resume` after crash. Commit a pass/fail table; block P1 lanes until green. If billing/PTY fails → escalate, don't route to headless. (`Q-ENG-SPIKE`)
2. **Specify the container layer to build-grade** — auth (managed token projection), per-ticket container + per-stage PTY, clone-into-volume worktree, host egress proxy, a concrete hardening table, a CapacityManager admission gate. (Container deep-dive; `Q-CT-*`)
3. **Define "control-API"** as one concrete `_api` route family (→ `preApiExecute` RBAC → enqueue a Conductor action; never a direct writer; distinct from the AI-only hook verbs) and cite it as a token everywhere. (`Q-ENG-CONTROL-API`)
4. **Add an ERRATA/reconciliation doc** and invert "specs win" for the superseded areas. (`Q-INF-SPECWIN`, `Q-INF-CLAUDESETTINGSMAP`)
5. **Data-model cohesion pass** — extend `04` with §6–§11, canonicalize `AgentSession`, sweep Resolved-decision fields, backfill `types.ts`. (`Q-DATA-*`)
6. **Stop-hook forced-reconciliation loop** as the deterministic backstop that forces `emit_carryover`/`emit_handoff` (retry → escalate to `needs-input`). (`Q-ENG-CARRYOVER-ENFORCE`)
7. **Resolve CLI-first vs MCP-first integrations** before the base-image build. (`Q-INT-MECHANISM`)
8. **Make the egress proxy a first-class P2 component + get security sign-off** on mounting subscription creds into lightly-isolated containers and on D80 full-body push. (`Q-CT-EGRESS`, `Q-SEC-CLAUDEMOUNT`, `Q-SEC-NOTIF-PUSH`)

**MEDIUM**
9. Executable conformance tests for the no-write-verb / frozen-verb invariants (a `VERB_REGISTRY` the helper is generated from + a `types.ts↔DATAMODEL` drift script). (`Q-ENG-VERB-CONFORMANCE`)
10. Write the missing operational subsystems: DR runbook, deployment topology, observability, testing strategy. (`Q-INF-DR/DEPLOY/OBSERVABILITY/TESTING`)
11. Reconcile `FRAMEWORK_GAPS.md` against shipped reality + a B-decision→owning-doc coverage matrix. (`Q-INF-GAPS-RECONCILE`)
12. Leave the **minimal** multi-provider seam (single-spawn wrapper + documented conformance bar + two hard constraints) — build nothing else. (Multi-provider deep-dive; `Q-MP-*`)
13. One fully-worked **golden stage render** + add `QuestionSet` to the prototype. (`Q-PROD-GOLDEN`, `Q-PROD-QUESTIONSET`)

---

## Anti-recommendations (things NOT to do / to consciously avoid)

- **Do NOT re-instate headless `claude -p` / Agent SDK** to "comply" with the spec — it meters a separate credit pool the architecture exists to avoid. If the P0 spike fails, escalate. (Metered burst stays a P4-only, config-flagged option.)
- **Do NOT add new structured-channel verbs** to close a feature gap — re-express via existing verbs + `WorkspaceTrigger` + `run-command` + MCP skills. Collapse the stray `emit_output` (doc 03) into `emit_carryover`.
- **Do NOT give any LLM session a write verb** to simplify a flow — B-23 is structural; the no-write-verb property is the guarantee (and must hold at the future adapter boundary too).
- **Do NOT delete/clean up `handoff/`** while `_docs` cite its G#/B# codes — treat "deprecated" as "frozen, not for new edits". Inline codes into `REFERENCE_CODES.md` first.
- **Do NOT remove the AgentRole/ArtifactViewer/OrchestratorCommand registries** to satisfy the spec's "no registry" claim — that claim is scoped to the *framework*; these are *app* code.
- **Do NOT build the multi-provider abstraction** (driver interface, capability registry, `providerKey` field) in v1 — parked, no second provider to validate, violates Rule 7b. Build only the single-spawn wrapper.
- **Do NOT collapse the per-user Assistant** back into one shared brain to match spec prose — the per-user model is a deliberate improvement.
- **Do NOT lift the prototype React mock or the host-shell terminal backend** into the real build — the host shell is a prod RCE if its env flag is ever set; keep only the `ws-term:*` protocol + `XtermTerminal` client as the reusable seam.
- **Do NOT blindly stringify `StageId`** (loses exhaustiveness) or "fix" the INDEX delta count in isolation.
- **Do NOT auto-fix flagged drive-bys** (Usage.tsx monetary-budget vestige, MCP-default seed, thin needsInput) — report, the user decides (Report-Without-Auto-Fixing).
- **Do NOT route PTY bytes through `syncRequest`/`broadcastStream`** (fire-and-forget, throttled) — use a dedicated `/pty` namespace with binary payloads. **Do NOT reuse devkit's dev-only supervisor** as the prod orchestrator process manager.
- **Do NOT use `@luckystack/router` for the subdomain edge** (no TLS — G3; Caddy admin-API is the tool) and **do NOT hand-roll** already-shipped framework helpers (`registerOriginExemptPath`, `getPrismaClientFor`, `registerRedisKeyFormatter`, `acquireLease`).

---

## Container architecture — build-grade deep-dive

The container layer is the marquee runtime and is 100% greenfield (the only real backend code, `server/hooks/workspacesTerminal.ts`, spawns a HOST shell with full host env — the opposite of the product design). It is named across `01 §7`, `07 §A`, `SETUP §1–2`, `B-12/B-26/B-31`, `04_INTEGRATION_TOOLS`, but no single build-grade model exists and several fragments contradict each other. This assembles one.

### 1. Image & toolchain — a three-layer model
Drop the "devcontainer" framing (B-12/`01 §7` use "per-project image/devcontainer" interchangeably — different mechanisms; pick the Dockerfile path → `Q-CT-IMG`).
- **L1 BASE `workspaces/base:<semver>`** — `FROM node:22-bookworm-slim` (glibc, NOT Alpine — node-pty native builds + glibc DB clients). Bakes: `build-essential`+`python3` (node-gyp), `git`, `gh`, `curl`, DB clients `psql`/`mysql`/`mongosh`/`redis-cli` (D24), a non-root `agent` user, and the Claude CLI **pinned to an exact version** (never `@latest`). node-pty MUST build in L1 (the per-container pty-agent B-31 runs container-side). → `Q-CT-NODEPTY`, `Q-CT-CLIPIN`
- **L2 PER-PROJECT `workspaces/proj-<id>:<contentHash>`** — `FROM base` + project toolchain (.NET/Go/…) via a per-project Dockerfile stored as a repo file (`.workspaces/Dockerfile`), built by the orchestrator via the Docker API, content-hash-tagged. Add `Project.baseImageRef` (+ optional `dockerfilePath`) to `04`. **P2** concern (P1 PoC is chat-only). → `Q-CT-IMAGESEL`, `Q-CT-DOCKERFILE-TRUST`
- **L3 PER-TICKET CONTAINER (runtime)** — `docker run` of L2, worktree, env injected at boot, resource limits, rendered `.claude/settings.json`+`.mcp.json`+`CLAUDE.md`. The disposable unit.

### 2. Auth — the load-bearing, currently-incorrect part (CRITICAL)
Every doc says "mount `~/.claude`" as self-evident. It is incomplete/partly wrong, and the whole subscription-billing premise rests on it. Three concrete failures: **(a)** on macOS the OAuth token lives in the Keychain (service `claude-code`), NOT `~/.claude` — a bind-mount captures nothing (in-scope since `01 §7` promises host-OS-agnosticism); **(b)** the access token is short-lived and the CLI rewrites `.credentials.json` on refresh — N concurrent containers (~20) sharing one writable file **race and corrupt** it (fleet-wide outage); **(c)** mounting the whole dir leaks `projects/*.jsonl` session history and `--resume` reads those JSONLs → concurrent writers corrupt resume state.
**Required model — managed token projection:** orchestrator runs `claude login` ONCE, normalizes the token to a file it owns (exporting from Keychain on macOS); mounts ONLY a read-only projected `.credentials.json` + minimal `.claude.json`; each container gets its own `CLAUDE_CONFIG_DIR` seeded read-only; ONE host-side refresh loop re-projects the refreshed token into live containers so no container ever refreshes. **Verify against the running CLI before any P2 container work.** → `Q-CT-AUTH` (critical, hard P2 prerequisite)

### 3. Isolation unit — per-ticket container, per-stage PTY
`01 §3.1` (per-stage, torn down at stage end), `01 §4` (containers survive), and DH5 (one frozen commitHash per ticket) contradict. Resolve to **ONE container per ticketId** bound to its persistent `DEV-####` worktree; a stage transition is a NEW `claude` PTY process in the SAME container with freshly-rendered `.claude` config (which IS the settings boundary `01 §3.1` wants, without recreation). Reword `01 §3.1` to "the PTY process is killed at stage end; the container is removed only at ticket teardown." Disallow concurrent stages per ticket in v1. → `Q-CT-UNIT`

### 4. Worktree-into-container — the silent footgun
`07 §A` creates the worktree on the HOST (`git worktree add`) but runs `claude` INSIDE the container at that path. Git worktrees use a gitdir pointer back to the main repo's `.git/worktrees/<name>` — a naive bind-mount of just the worktree dir breaks git on first real run. Choose `git clone --branch DEV-#### --single-branch` into a clean container volume. → `Q-CT-WORKTREE`

### 5. Networking, Caddy & preview
`07 §B` dials `${container.ip}:5173` with no network-mode — on Docker Desktop/WSL2 (the user's Windows 11 box) the bridge subnet is NOT routed to the host, so this fails on the one known platform. **Fix:** run the orchestrator itself as a container on a single user-defined bridge (`workspaces-net`) every ticket container joins; Caddy dials by container DNS NAME on the fixed in-container port — no host publishing, identical Linux/WSL2. Host-process fallback: host-published ephemeral ports + a Redis-leased allocator into `PreviewDeployment.port`. DEV uses 2 ports (Caddy → Vite :5173, per G14); PROD preview single-port (B-13). Caddy routes via admin-API with explicit `@id route-dev-<ticketId>` (currently POSTed without id but DELETEd by id — can remove the wrong route) + a boot-time Caddy↔state reconcile under the Redis lease. TLS two tracks: PUBLIC = Caddy + ACME **DNS-01** wildcard (operator supplies the DNS record + scoped token); LAN/air-gapped = internal CA. `term.`/`dev-` single-upstream (never LB, G16); only `app.` is an LB pool. → `Q-NET-DOCKER`, `Q-NET-TLS`, `Q-NET-CADDY`

### 6. Egress & security hardening (CRITICAL)
The promised per-stage egress allow-list (B-26, `StageNetworkCfg`) has **NO implementation** — Docker has no native domain allow-list, and the only named mechanism (Claude-CLI `sandbox.network.allowedDomains`) is a headless-mode feature the PTY pivot may invalidate. **Add a host-level forward-proxy** (squid/mitmproxy) on `workspaces-net`; containers get `HTTP(S)_PROXY` + no direct route; the proxy enforces each stage's domain allow-list. Treat the CLI sandbox as defense-in-depth only. Enumerate "reasonable hygiene" (B-26 names it, never lists it): `--cap-drop ALL` + minimal add-back, `--security-opt no-new-privileges`, non-root user, `--pids-limit 512`, `--memory ~3g`/`--cpus ~2`, a disk quota on the worktree mount, `--restart` policy, rootless/userns-remap. **NEVER `docker run` without explicit limits.** The mounted subscription token + light isolation means a compromised dependency (the accepted B-26 risk) can exfiltrate auth — **get explicit user sign-off**. Host-side reasoning roles (Refine/Plan, `needsWorkspace=false`) run OUTSIDE any container with full host access and bypass the whole container story → containerize them minimally or document DB-only access. → `Q-CT-EGRESS`, `Q-CT-LIMITS`, `Q-SEC-CLAUDEMOUNT`, `Q-CT-HOSTROLES`

### 7. Resources & scaling — admission control
`01 §6` caps only concurrent ACTIVE TURNS (~4) — there is NO cap on RESIDENT containers, and the preview cap (~20, D86) is independent, so worst case ~40 heavy containers on one box with no host sizing. `07 §A` is non-transactional past `docker run` (a partial-launch OOM orphans worktree+route). **Add a CapacityManager admission gate**: over `MAX_RESIDENT` or under a RAM watermark, reclaim the oldest paused/idle container (D87) then admit, else enqueue. Make launch idempotent/rollback-safe. Make `previewConcurrencyCap` a SUB-limit inside one shared budget. Fix a reference host (e.g. 8 vCPU/32 GB/NVMe → ~8 active or ~12–16 mostly-paused). node_modules: prefer a pre-warmed dependency layer baked into L2 over per-container `npm ci`. → `Q-CT-CAPACITY`, `Q-CT-HOSTSPEC`, `Q-CT-NODEMODULES`

### 8. pty-agent & ring-buffer durability
B-31 wants a per-container pty-agent surviving orchestrator restart, but `01 §4` puts the ring-buffer in the in-memory `ManagedSession` — which can't survive a crash, contradicting the "ring-buffer reseeds the browser view" resume promise. Make the **pty-agent a process INSIDE each container** owning node-pty + durable scrollback, on a `127.0.0.1`-published port the orchestrator reads via `docker inspect` and relays over the existing `/pty` namespace (reuse `ws-term:*` so `XtermTerminal` stays byte-identical). The orchestrator ring-buffer becomes a cache rebuilt by replay on reconnect; `resumeAll()` reconnects to surviving pty-agents. Persist `containerId` + `worktreePath` on the AgentSession row; `--restart unless-stopped`. → `Q-CT-PTYAGENT`, `Q-CT-RESUME`

### 9. Image lifecycle & reproducibility
Semver the base, content-hash the per-project, pin the CLI, and stamp the resolved base tag + CLI version onto each AgentSession/TicketEvent (B-36 makes the event-log the audit priority — you must answer "which CLI built this MR"). Provide an `images rebuild` control + a B-34 notification on Dockerfile change. → `Q-CT-IMGLIFECYCLE`

---

## Multi-provider AI abstraction — parked, with a minimal seam

**Status: PARKED for v1** (INDEX "Parked for later"; memory `project_workspace_multi_provider_ai`). v1 is Claude-CLI-PTY-only, load-bearing-by-design. The deep-dives' diagnosis is sound but a full `EngineDriver` interface / capability registry / `providerKey` field now would **over-engineer a parked feature** (Rule 7b). **Build almost nothing; document the seam, the irreducible splits, and reserve one cheap refactor point.**

### The four real Claude-isms (verified coupling points)
1. **Provider fused into launch:** `cmd:'claude'` (`07 §A` step 7); `SessionManager.spawnWorker/spawnAssistant/spawnReasoner` (`01 §4`) all assume a `claude` PTY.
2. **Lifecycle primitives woven through the core:** `--resume <claudeSessionId>` (`01 §4`, `02 §1`, `QuestionSet.sessionId`, `06`); `/clear`+`/compact`+`PreCompact` (`06`); the Claude `type:http` hook set (`02 §3`).
3. **Capability vocabulary is a Claude literal union:** `types.ts:256-257` `StageModelTier='haiku'|'sonnet'|'opus'`, `StageEffort='low'|…|'max'`. The single biggest schema coupling.
4. **Billing baked into topology:** `01 §1` (PTY = subscription), `01 §6` (budget advisory; quota is the real limit), `19`.

### Already provider-agnostic (need NO change)
The frozen verb surface (`02 §2`), the carry-over envelope (pure JSON), `WorkspaceSignal`/serial Conductor consumption, the registries (`03 §3`), and B-23 proposes-only. The "stable waist" = verb SEMANTICS frozen; TRANSPORT is explicitly swappable.

### Three irreducible splits (cannot be unified)
- **(A) Lifecycle/hooks.** `02 §3` makes Claude `type:http` hooks THE event backbone. An API backend has no hooks and must SYNTHESIZE SessionStart/PostToolUse/Stop/needs-input/PreCompact from a raw token+tool-call stream, INCLUDING a hand-rolled tool-call loop to expose the verbs. The deepest hidden cost — weeks, not a registration.
- **(B) Billing.** `01 §1`+`01 §6` "advisory; quota is the real limit" are INVARIANTS. A metered backend inverts both (exact authoritative cost; cap = a hard pre-flight gate). `19` D81/D82 hard-code "advisory" — directly contradicting the parked metered intent. They cannot coexist as one accounting model.
- **(C) PTY-vs-API transport.** PTY drivers (Claude CLI, later Codex CLI) are the ONLY ones eligible for subscription billing — the economic premise. Clean split IF the billing guard is a hard gate.

### v1 vs parked
- **v1 (build now):** ONE cheap insurance move — wrap the literal `cmd:'claude'` spawn + the 3 `SessionManager` spawn methods behind a single internal function with one Claude implementation, so the future seam is a refactor-of-one-callsite. → `Q-MP-SEAM`
- **Parked (document only):** the driver interface, capability registry, `providerKey` field, billing-mode split. Do NOT add `providerKey` to `types.ts`; do NOT pre-shape `periodWindow` around the parked abstraction.

### The minimal seam to leave now (documentation, not code)
1. **A 3-point conformance bar** (a driver MUST: run a turn in the worktree/work context; emit the normalized `03 §1.1` event set; honor the carry-over JSON contract + expose the verbs as tool calls).
2. **Two hard forward-compat constraints** (cheapest, highest-value): (a) any future adapter exposes ONLY the frozen read/propose verb set as model tools — never a write tool (B-23 becomes adapter conformance); (b) secret/env injection is per-adapter policy, HARD-gated so a metered-API adapter can never route a Claude turn through a metered pool.
3. **De-conflict the prose now (report-only, no schema change):** re-word `01 §1` no-headless/no-SDK as a CLAUDE-PATH billing rule; re-word `02 §3` as "the Claude realization of a lifecycle contract"; flag in `01 §6` that metered backends invert "advisory"; note in `19` that D82's `periodWindow` needs a meter UNIT before it can enforce. → `Q-MP-BILLING`, `Q-MP-CAPREG`

### Recommended deferred default
When eventually built: default to **per-WORKSPACE single-provider** (sidesteps mixed-provider carry-over quality + model-ladder incomparability), per-stage as an explicit advanced opt-in. → `Q-MP-GRANULARITY`

---

## OPEN QUESTIONS (68) — answer inline

> Each: the question, why it matters, my recommendation, options, and a `**→ Keuze:**` line. Grouped by area. Default to the **recommendation** unless your `→ Keuze` says otherwise.
>
> **RESOLUTION STATUS (2026-06-04):** the user **accepted all recommendations** ("accepteer-alle, ik vlag uitzonderingen"). Every `→ Keuze` is the recommendation, EXCEPT three explicitly decided in a popup round: **Q-SEC-CLAUDEMOUNT** = minimal RO mount + egress-proxy (signed off); **Q-SEC-NOTIF-PUSH** = redacted push + in-app body (⚠️ **reverses D80**); **Q-INF-BUDGET-SCOPE** = multi-cap NOW (D81/D82 stand, review's single-cap rec overruled). Plus **Q-MP-GRANULARITY** = per-workspace default + per-stage opt-in (= rec). The user will scan this doc and flag any exception; until then these are LOCKED and drive the build-doc writing phase.

### A. Containers (21)

**Q-CT-AUTH** — How is the containerized `claude` authenticated against the Max subscription; is a bind-mount of `~/.claude` actually correct?
*Why:* the single load-bearing, never-specified claim. macOS Keychain (nothing to mount), token-refresh races corrupting a shared file, session-JSONL leak breaking `--resume`. If wrong the engine silently fails/corrupts.
*Aanbeveling:* **Managed token projection** (orchestrator logs in once, mounts only a RO `.credentials.json` + minimal `.claude.json`, per-container `CLAUDE_CONFIG_DIR`, one host refresh loop). Verify against the live CLI before P2.
*Opties:* 1) Managed projection (rec) · 2) bind-mount whole `~/.claude` (reject) · 3) re-login per container (needs interactive OAuth — reject) · 4) host auth-broker (heavy, research).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-UNIT** — Per-ticket container with per-stage PTYs, or a fresh container per stage?
*Why:* `01 §3.1`/`01 §4`/DH5 contradict; the whole isolation unit depends on it.
*Aanbeveling:* **Per-ticket container + per-stage PTY** (new PTY + re-rendered `.claude` per stage; container removed only at ticket teardown; no concurrent stages per ticket in v1).
*Opties:* 1) Per-ticket + per-stage PTY (rec) · 2) Fresh container per stage (clean but pays setup each promotion).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-IMAGESEL** — How does the orchestrator select the image per project, and when do per-project images become required?
*Aanbeveling:* add `Project.baseImageRef` (+ optional `dockerfilePath`) to `04 §3`; default to the framework base; per-project images build FROM it; make them **P2** (correct lane F's P1 scope to "base image + provisioning skeleton").
*Opties:* 1) `baseImageRef` + per-project Dockerfile (rec) · 2) single fat base (huge, can't cover bespoke stacks) · 3) devcontainer.json (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-IMG** — Per-project image vs devcontainer — which mechanism (used interchangeably in B-12/`01 §7`)?
*Aanbeveling:* **plain per-project Dockerfile FROM base**, built by the orchestrator via the Docker API, content-hash-tagged; drop "devcontainer" wording.
*Opties:* 1) Dockerfile (rec) · 2) devcontainer CLI · 3) conflate both (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-DOCKERFILE-TRUST** — Who authors/stores/trusts the per-project Dockerfile, and where does the orchestrator build/cache?
*Why:* arbitrary `FROM`/`RUN` is a supply-chain surface whose blast radius is the daemon holding the projected subscription token.
*Aanbeveling:* **repo file `.workspaces/Dockerfile`**, local Docker-API build, content-hash-tag; local-daemon-only v1 (registry → P4); **Admin-gated** authoring (B-08), not B-26's blanket acceptance.
*Opties:* 1) Repo file + local build + Admin-gated (rec) · 2) UI-field Dockerfile · 3) operator out-of-band · 4) registry multi-host (P4).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-WORKTREE** — How does the host worktree become a valid checkout INSIDE the container (gitdir-pointer footgun)?
*Aanbeveling:* `git clone --branch DEV-#### --single-branch` into a clean container volume (self-contained, matches disposable model).
*Opties:* 1) clone --single-branch (rec) · 2) bind-mount whole mirror incl `.git` · 3) bind-mount worktree dir only (breaks git — reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-EGRESS** — Where is per-stage network egress allow-listing actually enforced (Docker has none; the CLI sandbox may not apply in PTY mode)?
*Aanbeveling:* **host forward-proxy** (squid/mitmproxy) on `workspaces-net` + `HTTP(S)_PROXY` + no direct route; CLI sandbox = defense-in-depth only. Name it a **P2 prerequisite**.
*Opties:* 1) Host proxy (rec) · 2) CLI sandbox only (insufficient) · 3) iptables per-container · 4) no filtering (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-LIMITS** — Concrete Docker hardening defaults (network, cap-drop, seccomp/AppArmor, userns, CPU/mem/PID/disk)?
*Aanbeveling:* a SETUP/`07 §E` **hardening table** with concrete numbers (cap-drop ALL + minimal add-back, no-new-privileges, non-root, `--pids-limit 512`, `--memory ~3g`/`--cpus ~2`, worktree disk quota, restart policy, rootless/userns). Never `docker run` without limits.
*Opties:* 1) Full table w/ numbers (rec) · 2) CPU/mem/PID only · 3) minimal + rootless.
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-CAPACITY** — On host contention, does activation queue, reclaim a paused container, or hard-reject?
*Aanbeveling:* **CapacityManager** admission gate: over `MAX_RESIDENT` / under a RAM watermark → reclaim oldest paused/idle (D87) then admit, else enqueue; idempotent/rollback-safe launch; `previewConcurrencyCap` a sub-limit in one shared budget.
*Opties:* 1) Reclaim-then-admit-else-queue (rec) · 2) hard-reject · 3) independent caps per type (over-subscribes — reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-HOSTSPEC** — Target reference host spec + real per-box container ceiling?
*Aanbeveling:* fix **8 vCPU/32 GB/NVMe** → ~8 active or ~12–16 mostly-paused; publish three separate caps (open/generating/resident); stop overloading "20".
*Opties:* 1) 8 vCPU/32 GB + three caps (rec) · 2) bigger box/higher caps · 3) operator-tunable only.
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-NODEMODULES** — Per-container `npm ci`, or shared/symlinked host node_modules?
*Aanbeveling:* **pre-warmed dependency layer baked into the per-project image** (fast + isolated; rebuild on lockfile change via content-hash) + a small warm-pool LRU'd against the resident cap.
*Opties:* 1) Baked layer (rec) · 2) per-container `npm ci` · 3) shared symlink (arch/libc coupling).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-NODEPTY** — Base distro + Node version; is node-pty built into the base (pty-agent runs container-side)?
*Aanbeveling:* **`node:22-bookworm-slim`** (glibc), bake `build-essential`+`python3`, install the pty-agent's node-pty at base-build time.
*Opties:* 1) bookworm-slim (rec) · 2) Alpine/musl (footgun) · 3) fat ubuntu.
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-CLIPIN** — Pin the Claude CLI exactly, or `@latest`?
*Aanbeveling:* **exact pin** + record the version on each AgentSession/TicketEvent; gate upgrades behind a base-image semver bump + a hook/`--resume` smoke test.
*Opties:* 1) Exact pin + stamping (rec) · 2) `@latest` (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-PTYAGENT** — Is the pty-agent (B-31) inside the container or a host sidecar, and where does the ring-buffer live to survive a crash?
*Aanbeveling:* **in-container pty-agent + durable scrollback** on a `127.0.0.1` port relayed over `/pty` (reuse `ws-term:*`); orchestrator ring-buffer = a cache rebuilt by replay.
*Opties:* 1) In-container + durable scrollback (rec) · 2) host-side docker-exec wrapped in node-pty (doesn't survive restart).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-RESUME** — After an orchestrator crash, how does `resumeAll()` re-associate a session with its surviving container/worktree; what restart policy?
*Aanbeveling:* **persist `containerId`+`worktreePath` on the AgentSession row**, `--restart unless-stopped`, re-attach by stored id.
*Opties:* 1) Persist + reconnect (rec) · 2) re-launch from scratch · 3) in-memory only (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-HOSTROLES** — Isolation posture of host-side reasoning roles (Refine/Plan) that run outside any container?
*Aanbeveling:* run them in a **minimal read-only container** (no worktree, no integration creds, egress to Anthropic only); else document DB-only access.
*Opties:* 1) Minimal RO container (rec) · 2) host-side DB-only (documented) · 3) host-side unrestricted (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-CT-IMGLIFECYCLE** — Image versioning, rebuild triggers, per-session reproducibility?
*Aanbeveling:* **semver base + content-hash project + pinned CLI + version-stamp** on each session/event; `images rebuild` control + B-34 notification on Dockerfile change.
*Opties:* 1) Semver+hash+stamp (rec) · 2) manual rebuild only · 3) no versioning (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-NET-DOCKER** — Orchestrator containerized on a shared Docker network, or a host process driving the socket?
*Why:* `07 §B` dials `container.ip:5173` — not reachable from a host-process Caddy on Docker Desktop/WSL2 (the user's box).
*Aanbeveling:* **containerized orchestrator on one `workspaces-net` bridge, Caddy dials by container DNS name**; host-published ports + Redis allocator only as fallback.
*Opties:* 1) Containerized + dial-by-name (rec) · 2) host process + published ports · 3) `host.docker.internal` (fragile).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-NET-TLS** — Wildcard `*.<domain>` TLS on a self-hosted box; what does the operator provide?
*Aanbeveling:* **two tracks** — PUBLIC = Caddy + ACME DNS-01 wildcard (operator supplies the DNS record + scoped token); LAN/air-gapped = Caddy internal CA + local DNS. Document both in SETUP §5.
*Opties:* 1) DNS-01 wildcard + internal-CA fallback (rec) · 2) on-demand HTTP-01 (rate limits) · 3) self-signed only.
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-NET-CADDY** — Crash-safe Caddy routes; how do `term.`/`dev-` bypass the LB while `app.` is balanced?
*Aanbeveling:* **POST with explicit `@id route-dev-<ticketId>`** + a boot-time Caddy↔state reconcile under the Redis lease; `term.`/`dev-` single-upstream, only `app.` an LB pool.
*Opties:* 1) `@id` routes + boot reconcile (rec) · 2) DELETE-by-id without POST-id (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-PREVIEW-COST** — Is the ~20 preview cap realistic for full PROD app-stack containers; what backs each preview; build step/timeout?
*Aanbeveling:* preview-up = same base image, reuse worktree at frozen commitHash, build then run in background; building→live on PROD `/readyz` 200; timeout → notification. **Re-derive the cap from measured per-PROD cost** (likely well below 20); ~20 = hard ceiling only; shared CapacityManager budget.
*Opties:* 1) Measured cost + shared budget (rec) · 2) independent ~20 cap · 3) no cap.
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### B. Multi-provider (4)

**Q-MP-SEAM** — Introduce a provider-neutral engine-adapter seam NOW (single Claude impl) even though build is parked?
*Aanbeveling:* build **only a single-spawn wrapper** (wrap `cmd:'claude'` + the 3 `SessionManager` spawns behind one internal fn, one impl) + document the 3-point conformance bar + two hard constraints. No driver interface / registry / `providerKey` field in v1.
*Opties:* 1) Single-spawn wrapper + documented bar (rec) · 2) full EngineDriver now (over-engineered) · 3) nothing (Claude-isms calcify).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-MP-BILLING** — For a metered backend, does the cap become a HARD pre-flight gate (inverting `01 §6` advisory)? Is no-headless a Claude-billing rule or a hard architectural rule?
*Aanbeveling:* **per-driver** — subscription-window stays advisory+auto-pause; metered gets a HARD `blockTurn` gate (extends D81). Re-scope no-headless/no-SDK to the **Claude billing path only**. Document now (one line in `01 §6`); no schema fields for a parked feature.
*Opties:* 1) Per-driver mode + scoped headless rule (rec) · 2) advisory everywhere (breaks metered) · 3) hard gate everywhere (breaks subscription).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-MP-GRANULARITY** — Provider granularity: per-stage (mixed within a ticket) or per-workspace (one backend)?
*Aanbeveling:* **per-WORKSPACE single-provider default**, per-stage as an explicit advanced opt-in (sidesteps mixed carry-over quality + model-ladder incomparability). Don't reserve `providerKey` in `types.ts` now.
*Opties:* 1) Per-workspace default + per-stage opt-in (rec) · 2) per-stage first (carry-over-quality risk) · 3) per-workspace only.
**→ Keuze:** ✅ Per-workspace default + per-stage opt-in (aanbeveling). _2026-06-04._

**Q-MP-CAPREG** — Flag `StageModelTier`/`StageEffort` literal unions now as a known multi-provider refactor?
*Aanbeveling:* **one-line forward-pointer** next to these types ("provider-specific; a future capability registry replaces these"). No code change. Note `StageEffort` may not even be cross-provider.
*Opties:* 1) Forward-pointer (rec) · 2) refactor to `providerKey`/`modelKey` now (premature) · 3) leave unflagged (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### C. Engine / Protocol (11)

**Q-ENG-SPIKE** — Gate the build on a P0 "CLI behavior spike" (subscription billing of interactive PTY, `/clear` vs `/compact` id, `type:http` hook delivery, per-turn usage, `--resume` after crash)?
*Aanbeveling:* insert **P0.5 — gating CLI spike** with an assumption→test→verdict table + a committed `SPIKE_RESULTS.md`; block P1 lanes B/C/F until green; pin the CLI version; if billing/PTY fails → escalate, don't route around.
*Opties:* 1) Gated P0.5 spike (rec) · 2) spike in parallel with P1 (risky) · 3) no spike (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-CARRYOVER-ENFORCE** — What deterministically forces a free-running PTY agent to emit `emit_carryover`, and what if it never does?
*Aanbeveling:* **Stop-hook forced reconciliation** — on Stop, check for schema-valid output; if absent, `--resume` the SAME session with a hard templated demand; after N failures → Conductor marks stuck→needs-input with a system-authored question; + a schema-reject→retry loop. Add a `02 §3.x`.
*Opties:* 1) Stop-hook loop + retry (rec) · 2) prompt discipline only (reject) · 3) fall back to headless (reject — billing).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-TOKENFEED** — In interactive PTY mode, what is the authoritative per-turn token/usage source for `tokenEstimate`/`SpendRecord`/the `06` budget trigger?
*Aanbeveling:* run the P0 spike; likely **parse usage from hook payloads if present**, else a coarse char-count heuristic explicitly labeled estimate (budget purely advisory). Stop treating `tokenEstimate` as precise.
*Opties:* 1) Hook-payload usage (rec, spike-dependent) · 2) char→token heuristic (advisory) · 3) assume headless stream (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-CLEAR** — Does `/clear` preserve the `claudeSessionId` (so `--resume` works); how is `Handoff.body` re-injected?
*Aanbeveling:* **spike before the token-opt lane**; if `/clear` rotates the id default to `/compact` (keeps session) or capture+update the new id; render `Handoff.body` through a small template, not raw JSON.
*Opties:* 1) Verify `/clear`, fall back to `/compact` (rec) · 2) assume `/clear` preserves id (reject — unverified).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-TURNEND** — How does the concurrency FIFO know a PTY turn ended to release a slot (no headless stream)?
*Aanbeveling:* derive turn-end from the **Stop hook** (same signal as carry-over enforcement); release the slot on Stop; part of the P0 spike.
*Opties:* 1) Stop-hook turn-end (rec) · 2) idle-timeout heuristic · 3) assume stream-json deltas (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-VERB-EMITOUTPUT** — Is `emit_output` (used in `03 §3.4/§7`) a real verb, an alias, or an editing error?
*Aanbeveling:* treat **`emit_carryover` as the single canonical final-output verb** and replace all `emit_output` references; if a richer artifact output is truly needed, add it to the `02 §2` table explicitly.
*Opties:* 1) Replace `emit_output`→`emit_carryover` (rec) · 2) add `emit_output` to the frozen table · 3) leave undefined (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-TOKEN-LIFECYCLE** — Full lifecycle (issue/scope/TTL/refresh/revoke) of the per-session structured-channel token across suspend→`--resume` and crash-resume?
*Aanbeveling:* token bound to **SessionKey** at spawn, store its id (not secret) on the row, **re-mint on every spawn/resume** (incl. `resumeAll`), revoke on kill; hooks use a separate per-session `WS_HOOK_TOKEN` with the same lifecycle. Specify in `02 §2`.
*Opties:* 1) SessionKey-bound, re-minted (rec) · 2) single long-lived token · 3) unspecified (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-VERB-CONFORMANCE** — Enforce the no-write-verb / B-23 guarantee by an executable test, not prose?
*Aanbeveling:* a single **`VERB_REGISTRY`** (7+6 verbs, each tagged read|propose, none write) the MCP/CLI helper is generated FROM + a unit test asserting no write verb and every AgentRole's tool set ⊆ registry + a `types.ts↔DATAMODEL` drift script. Add to P1 lane-C.
*Opties:* 1) Registry + conformance test + drift script (rec) · 2) prose freeze only (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-OFFLINE-NORMALIZE** — When `request_input` fires with NO user connected, who normalizes raw questions into mobile cards (since `draft_questionset` needs a connected Assistant)?
*Aanbeveling:* make the **Stage-Agent self-phrase fully-structured `Question[]`** directly in `request_input` (it's an LLM, alive at ask-time); treat `draft_questionset` as optional polish only.
*Opties:* 1) Stage-Agent self-structures (rec) · 2) deterministic banner (degraded UX) · 3) require connected Assistant (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-CONTROL-API** — What is "control-API" concretely (transport, auth, vs the structured-channel verbs)?
*Why:* the most-reused write mechanism across all 24 feature docs, never defined → guaranteed divergence across parallel lanes.
*Aanbeveling:* define in `07` (or `01 §3.3`) as an authenticated LuckyStack **`_api` route family** the web-app calls, RBAC via `preApiExecute`, whose handler **ENQUEUES a Conductor action** (never mutates board/git/status directly), distinct from the Claude-hook verbs. All docs cite `[control-API]`.
*Opties:* 1) `_api` → `preApiExecute` → enqueue Conductor action (rec) · 2) socket-event family · 3) leave each lane to interpret (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-ENG-REASONER** — Is the one-shot reasoner truly P5-optional, or a hidden P3 dependency (invoke-workspace-ai, offline signal consumption)?
*Aanbeveling:* either **build a minimal one-shot reasoner in P3**, or explicitly mark those P3 automation features as degrading to deterministic-only when no user is online; list which spec §8/§9 capabilities are deferred.
*Opties:* 1) Minimal reasoner in P3 (rec if away-time is core) · 2) degrade-to-deterministic + documented gap · 3) leave mislabeled (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### D. Data model (9)

**Q-DATA-DATAMODEL-SECTIONS** — Where do the cited `DATAMODEL §6–§11` live (04 has only §1–§5)?
*Why:* docs 16–24 cite §6–§11 dozens of times for the exact persisted shapes they render — every citation is dangling. **#1 pre-build data fix.**
*Aanbeveling:* **extend `04` with §6–§11 bodies** (TicketEvent w/ seq, AgentSession runtime, SpendRecord/WorkspaceBudget, Notification/PushSubscription, append-only + framework-global rules, delete cascade).
*Opties:* 1) Extend 04 (rec) · 2) re-number citations · 3) leave dangling (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-DATA-AGENTSESSION** — Three `AgentSession` definitions (DATAMODEL §5, 04 §2, +INDEX) — which is canonical?
*Aanbeveling:* **DATAMODEL §5 single source** (merge in `kind/userId/claudeSessionId/tokenEstimate/durationEstimate` + the ready/busy status set); 04 §2 cites it.
*Opties:* 1) Canonicalize in DATAMODEL §5 (rec) · 2) in 04 §2 · 3) leave three (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-DATA-TYPES-BACKFILL** — `types.ts` no longer mirrors DATAMODEL for Workspace-AI/automation/token-opt models — backfill or freeze as UI-only?
*Aanbeveling:* **backfill `types.ts`** (types-only) with the 04 §5/INDEX-delta additions in one pass (else fix the header to stop claiming parity).
*Opties:* 1) Backfill (rec) · 2) fix header + enumerate doc-only models · 3) leave as-is (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-DATA-STAGEID** — Fixed 7-literal `StageId` union vs the dynamic 3/5/7 preset model + free-string `PipelineStageCfg.id`?
*Aanbeveling:* introduce a typed **`StageKind`** the preset instantiates (or a prominent "prototype-only fixed set" note + audit the seed/screens that switch on it FIRST). Don't blind-replace with `string`.
*Opties:* 1) Typed `StageKind` (rec) · 2) documented prototype-only note + audit · 3) blind string (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-DATA-ASSIGNMENT** — Where do creator/assignee, MR url, issue url live (types.ts has them; DATAMODEL doesn't)?
*Aanbeveling:* treat them as **GitLab-derived cached nullable columns** (B-29 GitLab=SoT), reconciled by the webhook, ui-optional; add a delta row.
*Opties:* 1) GitLab-derived cached (rec) · 2) Workspaces-owned columns · 3) leave unreconciled (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-DATA-STATUS** — Canonical base ticket/stage status set; does v1 honor B-O5 per-stage custom statuses?
*Aanbeveling:* keep a **closed universal enum** (`idle|needs-input|busy|done|paused|stuck`) as the AI-owned lifecycle status; re-scope `StageStatusCfg` to a non-lifecycle label concept OR formally defer B-O5; document the three distinct state machines.
*Opties:* 1) Closed enum + defer/re-scope (rec) · 2) build custom statuses v1 (ripples) · 3) leave ambiguous (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-DATA-FIELDSWEEP** — Where do fields minted by Resolved decisions live (`Workspace.timezone`, `Ticket.archived`, Sprint DateTime, `lastActivityAt`, PRICING, ro/rw creds, multi-cap WorkspaceBudget)?
*Aanbeveling:* run a **"Resolved-decision field sweep"** across all 24 docs before the cohesion pass; add every minted field to `04`; recompute the delta count.
*Opties:* 1) Field sweep + add to 04 (rec) · 2) ad-hoc as discovered (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-DATA-SUGGESTION-ENUM** — `WorkspaceSuggestion.type` differs (DATAMODEL 4 / 04 adds `automation` / types.ts 4) — canonical?
*Aanbeveling:* adopt the **5-value set** (`link-tickets|create-epic|config-review|maintenance|automation`), update DATAMODEL §7 + types.ts together, add `WorkspaceSuggestion.patch Json?`.
*Opties:* 1) 5-value (rec) · 2) keep 4 · 3) leave divergent (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-DATA-CARRYOVER-HANDOFF** — Exact relationship between `Ticket.carryOver` (string), the `CarryOver` envelope, and `Handoff`; how are estimate/review fenced blocks parsed from `summary`?
*Aanbeveling:* a single **fenced-block convention** (e.g. ` ```ws-estimate ` / ` ```ws-carryover `) with parse-failure fallback + max-one rule, documented once in `02 §4` (Conductor-side parsing, NOT an envelope schema change). Clarify: carryOver-string = human one-liner; envelope = machine; Handoff = within-session superset.
*Opties:* 1) Fenced-block parsing contract in 02 §4 (rec) · 2) extend the envelope schema (ripples — avoid) · 3) leave overloaded (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### E. Security / RBAC (6)

**Q-SEC-CLAUDEMOUNT** — Does mounting subscription creds into every lightly-isolated container expose crown-jewel auth to a compromised dep; acceptable under B-26? **(needs sign-off)**
*Aanbeveling:* **explicit user sign-off**; mitigate with a minimal RO `.credentials.json`, denyRead from Bash, egress-proxy blocking exfil domains; document the residual risk. Bundle with `Q-SEC-NOTIF-PUSH` for one security decision.
*Opties:* 1) Minimal RO mount + proxy + documented residual (rec) · 2) full `~/.claude` mount (reject) · 3) auth-broker (research).
**→ Keuze:** ✅ Minimal RO mount + egress-proxy + documented residual (aanbeveling). _Sign-off gegeven 2026-06-04._

**Q-SEC-CREDLIFETIME** — Long-lived per-tier ro/rw DB users (SETUP §6) or short-lived scoped tokens injected at spawn (01 §8/07)? They contradict.
*Aanbeveling:* **long-lived ro/rw DB users stored ENCRYPTED, decrypted→injected only at boot via a tmpfs env-file** (never `--env`, never baked, denyRead from Bash); GitLab PAT in a server-side MCP tool; reserve "short-lived scoped token" language for the orchestrator's own API/webhook tokens; defer real minting to P4.
*Opties:* 1) Encrypted ro/rw via tmpfs + MCP-held PAT (rec) · 2) build a minting service now · 3) leave contradictory (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-SEC-RBAC-ROLES** — How are custom `PermRole`s (D76) persisted, given `WorkspaceMember.role` is a fixed enum?
*Aanbeveling:* add a tenant-scoped **`WorkspaceRole`** model (`{workspaceId,key,label,perms}`); `WorkspaceMember.role` references it (built-ins seeded); enforce single-Owner in the membership `preApiExecute` check, not by locking rows.
*Opties:* 1) `WorkspaceRole` model (rec) · 2) keep fixed enum (can't express D76) · 3) hard-code (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-SEC-NOTIF-PUSH** — Full notification body in the web-push payload (D80) — acceptable lockscreen posture? **(needs sign-off)**
*Aanbeveling:* **sign-off**; default to a **redacted push** (title + "open to view"), full body fetched in-app behind auth; full-body push opt-in. (This reconsiders the earlier D80 given rule 19.)
*Opties:* 1) Redacted + in-app body (rec) · 2) full-body push (current — needs sign-off) · 3) push disabled by default.
**→ Keuze:** ✅ Redacted push + in-app body (aanbeveling). ⚠️ **REVERSES D80** (was full-body) → update `features/18_NOTIFICATIONS.md` + INDEX D80 to "redacted push default; full-body opt-in". _2026-06-04._

**Q-SEC-RUNINTENANT** — Who makes `runInTenant` mandatory for sync-handlers AND every background worker (indexer, pty-agent, Conductor, signal-consumer, cron)?
*Aanbeveling:* promote to a **tracked P1 prerequisite** owned by a named doc + a checklist that every non-`/api` path wraps its work; make the `$extends` where-injection isolation a first-class section; state the failure mode (`currentWorkspaceId()` throws).
*Opties:* 1) Tracked P1 prerequisite + checklist (rec) · 2) leave as an open flag (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-SEC-SECRETS-PKG** — Is `@luckystack/secrets` in-scope for v1 secret storage, or deferred?
*Aanbeveling:* **deferral is fine** (matches the fail-open exception): document an app-owned encrypted-at-rest approach for per-workspace GitLab tokens + graded DB creds; `@luckystack/secrets` as a P4 upgrade; drop "short-lived scoped token" language implying a non-existent minting service.
*Opties:* 1) App-owned encryption v1, pkg P4 (rec) · 2) adopt the pkg now · 3) leave undecided (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### F. Build / Infra (12)

**Q-INT-MECHANISM** — v1 integration reach: CLI-client-first (doc 04) or MCP-first (seed.ts + 03 §5)? They contradict.
*Aanbeveling:* **CLI-client-first canonical** (per the explicit decision); MCP = exception escape-hatch; add a real allow-pattern fixture + optional `IntegrationTool.command` (amends 04's "no new persistence"); reconcile type-keys into one `{catalogKey,cliBin,tierClientKey}`. No new verbs.
*Opties:* 1) CLI-first + MCP exception (rec) · 2) MCP-first (matches seed, contradicts decision) · 3) leave contradictory (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-SPECWIN** — README says "specs win on conflict" but `01 §1` overrides the spec — which governs?
*Aanbeveling:* **carve out the rule** — for engine/billing, role-topology, verb-surface the **_docs win** and IDEE_SPEC is explicitly superseded; "specs win" survives only for un-revisited feature/domain details. Add a **`00_SPEC_RECONCILIATION.md` ERRATA** table.
*Opties:* 1) Carve-out + ERRATA (rec) · 2) keep blanket "specs win" (reject) · 3) drop the rule.
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-CLAUDESETTINGSMAP** — Revise `handoff/CLAUDE_SETTINGS_MAP.md` for PTY-only (mark headless flags superseded)?
*Aanbeveling:* **inline-supersede** the headless sections + add an interactive-mode equivalent per row; re-state B-38 as "stage-config → the interactive `.claude` surface; JSON via the structured channel, not `--json-schema`". Keep headless as a P4 optional burst path.
*Opties:* 1) Inline-supersede + equivalents (rec) · 2) full rewrite · 3) leave stale (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-REFCODES** — Do the deprecated `handoff/` G#/B# codes stay the binding citation source; inline them first?
*Aanbeveling:* keep `handoff/` immutable until codes are inlined; produce **`REFERENCE_CODES.md`** (inlined definitions + a B-xx→owning-doc coverage map) and rewrite citations; treat "deprecated" as "frozen, not safe to delete".
*Opties:* 1) Inline into REFERENCE_CODES.md (rec) · 2) pin handoff/ immutable, no inlining · 3) delete handoff/ (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-GAPS-RECONCILE** — Rewrite `FRAMEWORK_GAPS.md` to mark G6/G7/G9/G24 + the lease RESOLVED (already shipped), USAGE.md canonical?
*Aanbeveling:* **rewrite in place** with a Status column (RESOLVED-FW / APP-BUILD / EXTERNAL-INFRA) + a proof-path per gap; demote the Framework-PR table to a shipped changelog; GAPS defers to USAGE.md.
*Opties:* 1) Rewrite w/ Status + proof-path (rec) · 2) keep GAPS historical + a new reconciliation doc · 3) leave stale (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-DR** — Where does B-36 (Backup/DR) actually live (forward-pointed to P4 but P4 has none of it)?
*Aanbeveling:* add a **DR section to SETUP** (mongodump cron, Redis RDB/AOF, TicketEvent/RagEntry/WorkspaceSignal append-only + event-log restore-priority-1, target RPO/RTO, acceptable loss) + an explicit P4 task.
*Opties:* 1) DR in SETUP + P4 task (rec) · 2) fold into the monitoring repo · 3) leave dropped (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-DEPLOY** — How are the web-app tier + the single-instance orchestrator themselves deployed/kept running?
*Aanbeveling:* a **`08_DEPLOYMENT.md`** — web-app run model (process manager, N replicas, `/healthz`, behind the `app.` Caddy pool); orchestrator run model (single supervised process — systemd unit or `restart:unless-stopped` container — acquiring `lease:orchestrator` on boot + running `resumeAll()`); boot-order/health graph; explicit SPOF statement. (Do NOT reuse devkit's dev supervisor.)
*Opties:* 1) 08_DEPLOYMENT.md (rec) · 2) fold into SETUP · 3) leave undocumented (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-OBSERVABILITY** — Observability/logging/metrics/alerting for the orchestrator + engine?
*Aanbeveling:* an **Observability section** — structured-logging contract (SessionKey/ticket/stage), a minimal metrics set (active/queued turns, resident containers, lease state, indexer/reconcile lag, watchdog fires, CLI/token usage), per-loop liveness, an alerting baseline; decide: fold into `@luckystack/monitoring` or ship a thin app adapter.
*Opties:* 1) App-owned section + thin monitoring adapter (rec) · 2) defer to the monitoring repo · 3) none (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-MIGRATION** — Fresh repo (installing published `@luckystack/*`) or in-place prototype migration; concrete procedure?
*Aanbeveling:* **fresh `@luckystack`-consuming repo** + a **`MIGRATION.md`**: the `types.ts`→Prisma step list, flag doc-only models, reconcile AgentSession + StageId FIRST, a single `useWorkspaceData()`/tenant-scoped data seam as the biggest refactor, first-run bootstrapping. Correct the "mechanical/1:1" wording until done.
*Opties:* 1) Fresh repo + migration doc + data seam (rec) · 2) in-place migration · 3) leave "mechanical" unqualified (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-TESTING** — Testing strategy for the orchestrator/engine/Conductor/event-log (not API routes)?
*Aanbeveling:* a **Testing section in 05** — deterministic-Conductor unit tests (no live LLM); a fake/record-replay `EngineDriver` (test engine logic without burning subscription turns); a regression test pinning the event-log subscribe-before-fetch ordering as the FIRST vertical slice; the P0 spike as a gate.
*Opties:* 1) Conductor unit tests + fake EngineDriver + event-log race test (rec) · 2) API-sweep only (reject — misses the hard code).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-PRESETS** — Is the 3-tier preset system an intentional override of B-O4 ("no multiple built-in templates in v1")?
*Aanbeveling:* **amend B-O4 to "three tiers + clone"** if the (small, additive) growth is intended; else demote simple/advanced to documented-but-deferred and ship professional + clone for v1. Don't leave the contradiction implicit.
*Opties:* 1) Amend B-O4 to three tiers (rec if intended) · 2) ship professional + clone only · 3) leave implicit (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-INF-BUDGET-SCOPE** — Single-cap or multi-cap WorkspaceBudget for v1 (D81); is `periodWindow` pre-shaped for the parked multi-provider?
*Aanbeveling:* **scope v1 to a SINGLE cap + enforcement mode; PARK the second cap and provider-native `periodWindow`** until multi-provider lands (avoids the double-build the Parked note warns about). Don't ship a Data section contradicting the doc's single-bar mockup. *(Note: this revisits D81/D82 — pulling them toward "single cap v1, multi-cap parked".)*
*Opties:* 1) Single cap v1, multi-cap parked (rec) · 2) full multi-cap UI now · 3) leave Data/mockup contradictory (reject).
**→ Keuze:** ▶ **Multi-cap NOW in v1 (D81/D82 stand; review's single-cap rec overruled).** Consequence: fully spec the caps-list editor + per-cap bar + "which cap fired" modal, and fix doc-19's single-bar mockup. The `periodWindow`↔multi-provider entanglement is accepted. _2026-06-04._

### G. Product / UX (5)

**Q-PROD-WORKSPACE-AI** — Is the standing "Workspace-AI" brain (IDEE_SPEC §8) fully replaced by Conductor + per-user Assistant + optional reasoner, or is a residual always-on role expected in v1?
*Aanbeveling:* **confirm the demotion** and make the v1 gap explicit (reasoning-heavy proactive work happens only with a connected user's Assistant or deterministic Conductor rules; the away-time reasoner is P5); document which spec §8/§9 capabilities are deferred; disambiguate the overloaded "Workspace-AI" term.
*Opties:* 1) Confirm demotion + document gap + disambiguate (rec) · 2) build a minimal always-on reasoner v1 · 3) leave spec prose standing (reject — over-promises).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-PROD-TERMINAL** — Does the dev terminal bridge survive into the product, or is it replaced by the container pty-agent; how is the prod RCE surface guarded?
*Aanbeveling:* keep the **`ws-term:*` protocol + `XtermTerminal` client** as the reusable seam; **delete/replace the host-shell backend** with a container-scoped, SSH-gated, sessionId→container-resolved pty-agent bridge; add a hard **prod boot-guard** that crashes if the flag is set without the container backend; document the host bridge as dev-only.
*Opties:* 1) Reuse protocol/client, replace backend + boot-guard (rec) · 2) keep host bridge env-gated (reject — RCE).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-PROD-GOLDEN** — Include ONE fully-worked "golden stage render" (the Plan stage: exact `.claude/settings.json` + `.mcp.json` + `CLAUDE.md` + instructions + launch command + hook wiring) as the canonical reference?
*Aanbeveling:* add a **"Worked example: the Plan stage rendered"** appendix (or a `_data/` fixture) with the literal rendered files + launch command + hook wiring; make it the renderer's first regression test (surfaces the unverified flags concretely).
*Opties:* 1) Golden Plan-stage fixture + first regression test (rec) · 2) abstract table only (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-PROD-QUESTIONSET** — Add `QuestionSet`/`Question` to `types.ts` now so the prototype demos the phone-from-the-beach Q/A loop?
*Aanbeveling:* **add the types + a minimal NeedsInput UI** (cheap; de-risks the core flow) — or at minimum document `QuestionSet` as a required new type in the data-model delta.
*Opties:* 1) Add types + minimal UI (rec) · 2) document as required type only · 3) defer entirely (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

**Q-PROD-TICKET-CREATE** — Is ticket CREATION a direct RBAC-gated user write or a Conductor-mediated proposal? Docs 06 and 12 disagree.
*Aanbeveling:* **user-initiated creation = a direct RBAC-gated control-API write**; only AI-DRAFTED creation routes as a proposal. Make docs 06 and 12 agree.
*Opties:* 1) User-direct + AI-drafted-as-proposal (rec) · 2) all creation Conductor-mediated · 3) leave inconsistent (reject).
**→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

---

## Documentation plan (what we write after the answers land)

> Every doc below cross-references `handoff/` codes via `REFERENCE_CODES.md`, carries each open decision's `Q-*` id, and is self-contained enough for an independent build lane.

**A. Reconciliation & reference (write FIRST — unblocks everything)**
1. `00_SPEC_RECONCILIATION.md` — the ERRATA table (each superseded spec section → its overriding _docs section) + the carved-out "specs win only for un-revisited details" rule.
2. `REFERENCE_CODES.md` — inlined binding G#/B# definitions + a B-xx→owning-doc coverage matrix; add "SUPERSEDED" headers to `CLAUDE_SETTINGS_MAP.md`.
3. Extend `04_DATA_MODEL.md` with §6–§11 bodies, ONE canonical `AgentSession`, the Resolved-decision-swept fields, `WorkspaceRole`, GitLab-derived caches; recompute the delta table; backfill `types.ts`.

**B. Engine & protocol (deepest)**
4. `07b_CONTAINER_RUNTIME.md` (or `07 §E`) — the build-grade container spec (three-layer image, managed-token-projection auth, per-ticket-container/per-stage-PTY, clone-into-volume worktree, in-container pty-agent + durable scrollback, host egress proxy, hardening table, CapacityManager, reference host, image lifecycle).
5. `P0_CLI_SPIKE.md` — the gating spike: assumption→test→expected→verdict→CLI-version table + a committed `SPIKE_RESULTS.md`.
6. Extend `02_PROTOCOL_AND_FLOW.md` — carry-over enforcement loop, per-session token lifecycle, the `VERB_REGISTRY` conformance contract, the fenced-block parsing contract, `emit_output`→`emit_carryover`.
7. `CONTROL_API.md` (section in 07 / `01 §3.3`) — the formal definition; docs 13–24 cite `[control-API]`.
8. `GOLDEN_PLAN_STAGE.md` (or a fixture) — one fully-rendered stage as the renderer's first regression test.

**C. Operability (currently missing)**
9. `08_DEPLOYMENT.md` — web-app + orchestrator run models, boot lease + `resumeAll`, SPOF statement.
10. DR section in `SETUP_AND_PREREQUISITES.md` + the two-track TLS steps + the egress-proxy + secret-lifecycle reconciliation.
11. `OBSERVABILITY.md` — logging contract, metrics, liveness, alerting.
12. Testing section in `05_BUILD_PLAN.md` — deterministic-Conductor tests, fake EngineDriver, event-log race test; fold in the P0 spike; correct lane F; reclassify the reasoner.

**D. Migration & multi-provider**
13. `MIGRATION.md` — fresh-repo target, `types.ts`→Prisma step list, the tenant-scoped data seam, `runInTenant`-for-background-workers checklist, first-run bootstrapping.
14. `MULTI_PROVIDER_SEAM.md` (documented-deferred like UI-Builder) — the single-spawn wrapper, the 3-point conformance bar, the two hard constraints, the de-conflicted billing prose, the per-workspace-default decision.
