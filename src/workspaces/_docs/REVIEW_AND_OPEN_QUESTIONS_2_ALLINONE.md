# Workspaces — All-in-One Round: Review & Open Questions (50)

> Produced 2026-06-04 by a 10-agent ultracode round covering the areas the first review didn't: the **pluggable forge seam** (external GitLab/GitHub + **built-in** MR/CI), **built-in MR review**, **built-in CI on the container orchestrator**, **git strategy**, **AI prompt/eval quality**, **phone/PWA client**, **self-host installer**, **trust/safety UX**, **product analytics**. 9 new build-grade docs were written; this file is the answerable decision log.
>
> **Cohesion verdict: coherent & publish-ready.** The 9 docs are self-consistent over the locked architecture, **introduce NO new structured-channel verbs** (every write routes through `[control-API]` → `preApiExecute` → Conductor), and the `ForgeProvider` seam is used identically everywhere. 12 new models surfaced (fold into `04b` at build time).
>
> **How to use:** answer the **5 decide-first forks** below; the other 45 follow the "accept the recommendation unless you flag it" model (same as the first review). Each has `→ Keuze:`.

---

## The 9 new docs

| Doc | Covers |
|---|---|
| `FORGE_ABSTRACTION.md` | the backbone: a `ForgeProvider` seam (6 capabilities) with GitLabForge (today, SoT) / GitHubForge (design-now) / BuiltinForge (Workspaces owns repo+MR+CI) |
| `BUILTIN_MR_REVIEW.md` | the per-ticket changes page → full MR experience (diff, threads, approvals, merge); built-in owns it, external federates |
| `BUILTIN_CI_PIPELINES.md` | lightweight CI = container jobs on the existing orchestrator, pluggable `PipelineRunner` (built-in / forge-native / external engine) |
| `GIT_STRATEGY.md` | branch/merge/rebase/conflict/rollback across parallel tickets, per forge mode |
| `AI_QUALITY_AND_EVALS.md` | the actual per-role prompts + a golden-tickets eval harness + prompt versioning + the human-reject→few-shot feedback loop |
| `CLIENT_AND_PUSH.md` | PWA-first phone client + web-push infra (VAPID, service worker, redacted-payload-then-in-app per the D80 reversal) |
| `SELF_HOST_INSTALLER.md` | one-command docker-compose stack + bootstrap (minimal external-forge profile vs full built-in profile) |
| `TRUST_SAFETY_UX.md` | shadow/gate-every-stage mode, forward-revert rollback, immutable AuditEntry, per-workspace autonomy levels |
| `PRODUCT_ANALYTICS.md` | cycle-time/throughput/stuck-detection/cost-per-type from the event log (≠ operator OBSERVABILITY) |

---

## DECIDE-FIRST — the 5 big forks (everything else hangs off these)

**F1 · Q-FORGE-GITHOST — Built-in git hosting now or later?** Does Workspaces host git itself in v1, or stay external-forge-only?
*REC:* **bare `git init --bare` repos on the orchestrator host**, served by the orchestrator (zero new long-running service; reuses lease+backup+runInTenant). Full compose profile only.
*Opties:* A bare-repos-on-host (rec) · B lightweight git-server container (Gitea/Soft Serve, P2) · C embedded JS git server.
**→ Keuze:** ▶ **B — lightweight git-server container (Gitea-core / Soft Serve)** (deviates from rec A). Built-in mode runs a real git-server service with a browseable UI; `FORGE_ABSTRACTION §7` + `SELF_HOST_INSTALLER` full-profile updated to include it (Q-INSTALL-GITHOST follows). _2026-06-04._

**F2 · Q-FORGE-CI-RUNNER — What runs built-in CI?**
*REC:* a **`PipelineRunner` interface**; built-in mode defaults to the **container runner on the orchestrator** (`[07]`/`[07b]`, one shared budget); GitLab/GitHub modes default to the forge's native CI; an external engine (Woodpecker/Drone/Dagger) is the pluggable alt.
*Opties:* builtin-container default (rec) · forge-native for external modes · external-engine pluggable · embed a CI lib (reject).
**→ Keuze:** ✅ Container-runner on the orchestrator (aanbeveling). _2026-06-04._

**F3 · Q-FORGE-GITHUB — Build the GitHub adapter now or design-only?**
*REC:* **design-now / build-later** — ship the `ForgeProvider` interface + `ForgeConnection` + the HMAC webhook seam now (cheap insurance, partly shipped via G7); build the adapter when a GitHub team needs it.
*Opties:* design-now/build-later (rec) · full GitHub adapter in v1 · defer entirely (risks expensive retrofit).
**→ Keuze:** ✅ Design-now / build-later (aanbeveling). _2026-06-04._

**F4 · Q-FORGE-MR-FLOOR — MR built-in vs federated; does the full MR view replace the `[07]` changes tab?**
*REC:* **backbone owns the `mergeRequests` capability + minimal shape; the MR doc owns the full schema + UX**. **Expand the `[07]` tab INTO the MR view (one surface).** Reads always federate; writes federate where the forge API supports it, else a built-in record + "open on \<forge\>" deep-link.
*Opties:* split backbone/surface + expand `[07]` + read-always/write-where-supported (rec) · full schema in backbone (bloats) · built-in-only mirror / full bidirectional write-federation required.
**→ Keuze:** ✅ Split backbone/surface + expand `[07]` into the MR view + read-always/write-where-supported federation (aanbeveling). _2026-06-04._

**F5 · Q-CLIENT-SHELL — PWA-first or native client?**
*REC:* **PWA-first** (one codebase = the existing SPA + a service worker); no native in v1 (a thin native wrapper is a P3 iOS-push escape hatch only).
*Opties:* PWA-first (rec) · PWA + thin native wrapper later (Capacitor/TWA) for iOS push · full native (reject).
**→ Keuze:** ✅ PWA-first, **no native at all** — you just open the website on your phone (installable PWA). _2026-06-04._

### Secondary-but-load-bearing (decide alongside the five; all have clear recs)
- **Q-FORGE-SOT-MODE-SWITCH** — single forge mode per workspace, immutable after setup (future Admin+ `forge-migrate`). *REC: yes/immutable.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-TRUST-AUTONOMY** — ▶ **DEVIATES from the rec (user wants full configurability incl. auto-merge in v1).** The autonomy model is a **fully-configurable spectrum**, per-workspace default + per-ticket override + **per-stage approval toggles**, spanning **gate-every-stage** (approve literally every stage) → **gate-key-stages** → **full-auto incl. auto-merge** (the "100% vibe-coded site, lightning fast" path). **Auto-merge IS a first-class v1 option** (reverses "no auto-merge in v1"), gated by the CI-merge-gate (Q-CI-MERGE-GATE) and a per-workspace `autoMerge` setting. Safe default stays **gate-key-stages**; RBAC: loosening autonomy/enabling auto-merge = Admin+, tightening = any worker. **Requires updating `TRUST_SAFETY_UX.md` (autonomy spectrum + auto-merge), `BUILTIN_MR_REVIEW.md` + `GIT_STRATEGY.md` (auto-merge path).** _2026-06-04._
- **Q-CI-MERGE-GATE** — a red required CI run **blocks** the `mr-merge` op, with a per-workspace `allowMergeOnRedCI` Admin+ override. *REC: gate+override.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-GIT-MERGE-CONCURRENCY** — **serial** Conductor-only merges under the lease (no parallel-merge engine in v1). *REC: serial.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-TRUST-ROLLBACK** — **forward `git revert -m 1` → a new MR + tracking ticket**, via an `mr-revert` `[control-API]` op, Admin+; never `reset --hard`/force-push. *REC as stated.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-INSTALL-ORCH / Q-INSTALL-PROFILE-DEFAULT** — **docker compose**; **minimal (external GitLab) profile is the default**, full (built-in) is the opt-in all-in-one. *REC as stated.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

---

## All consolidated questions (50) — grouped; answer or accept the REC

> Defaults apply unless a `→ Keuze` overrides. The 11 above are repeated here by id only.

### Forge (6)
- **Q-FORGE-GITHOST** *(F1 above)* · **Q-FORGE-CI-RUNNER** *(F2)* · **Q-FORGE-GITHUB** *(F3)* · **Q-FORGE-MR-FLOOR** *(F4)* · **Q-FORGE-SOT-MODE-SWITCH** *(secondary)*
- **Q-FORGE-DATAMODEL** — generalize live GitLab columns or add `ForgeConnection` alongside? *REC: add `ForgeConnection` alongside, keep GitLab columns (zero migration; GitLabForge prefers the generalized row).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### Merge requests (7)
- **Q-MR-APPROVAL-RESET** — approvals on a new head commit? *REC: stale-invalidate (approved→open; mark `Approval.stale`, never delete).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-MR-MIN-APPROVALS** — default min approvals? *REC: 1, `excludeAuthor:true`.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-MR-MERGE-CAP** — RBAC to merge to default? *REC: `work-on-tickets` (same as stage promote).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-MR-DEFAULT-STRATEGY** — default merge strategy? *REC: squash (FF/merge-commit offered per-merge).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-MR-CONFLICT-RESOLVE** — conflict resolution v1? *REC: rebase-back-to-the-agent via `--resume`, escalate to needs-input; no in-UI 3-way editor (P2 over `[08]`).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-MR-REANCHOR** — review thread when its line moves? *REC: best-effort re-anchor by hunk; else "outdated" + pin to file (never drop).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-MR-INTERIM** — comment gutters before UI-Builder? *REC: flat per-file comment list over `FileDiffViewer`; inline gutters land with UI-Builder.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### CI (6)
- **Q-CI-MERGE-GATE** *(secondary above)* · 
- **Q-CI-PUSH-TRIGGER** — which events fire CI? *REC: add `mr.updated` to `TriggerEventKind` (pre-merge) + `ticket.merged` + manual; defer `repo.pushed`.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-CI-BUDGET** — shared budget or CI reservation? *REC: one shared budget, CI jobs = preferred reclaim victims; add a soft cap only if measured starvation.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-CI-SPEC** — native `ci.yml` or GitLab-compatible? *REC: lean native `.workspaces/ci.yml`; a best-effort `.gitlab-ci.yml` importer as a P3 migration aid.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-CI-DB-CREDS** — DB creds in CI jobs? *REC: no by default; a job must declare a test-DB need (explicit allow-list + tmpfs test-tier cred); never auto-inherit the stage's B-O8 tier.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-CI-CACHE-RETENTION** — cache/artifacts location + retention? *REC: host-volume cache + run-attached artifacts; keep last N runs/pipeline + all artifacts of an open MR's latest run; object-store is a P3 multi-host upgrade.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### Git strategy (4)
- **Q-GIT-MERGE-CONCURRENCY** *(secondary)* · **Q-TRUST-ROLLBACK** *(secondary, Git/Trust)*
- **Q-GIT-REBASE-POLICY** — rebase or merge default into `DEV-####` before merging? *REC: rebase (linear), per-workspace merge fallback. (Final merge-into-default = squash, Q-MR-DEFAULT-STRATEGY.)* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-GIT-BRANCHNAME** — branch naming on re-activation? *REC: `DEV-<ticketNumber>` reused (one durable branch per ticket; collision-safe suffix only if a forge requires it).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-GIT-BASE-STALENESS** — ticket baseline far behind default? *REC: advisory "N commits behind" on the MR; human re-activates or proceeds (merge-time rebase reconciles); no auto-re-baseline (would break DH5).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### AI quality & evals (6)
- **Q-AIQ-LLM-JUDGE** — LLM-as-judge for un-scriptable dimensions? *REC: yes but live-lane-only + advisory (deterministic tiers 1-2 are the CI gate; the judge never blocks).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-AIQ-LIVE-CADENCE** — how often the real-CLI golden lane runs? *REC: pre-prompt-merge (required) + nightly (informational), quota-permitting; the free replay lane is always-on.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-AIQ-AB-UNIT** — A/B assignment unit? *REC: per-ticket sticky (hash `(ticketId,roleKey)`; stamp the chosen `PromptVersion` on `AgentSession`).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-AIQ-FEWSHOT** — few-shot cap + scope? *REC: small fixed cap (3–5), curated-best, per-workspace only (runInTenant isolation); shared org bank is P2 opt-in.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-AIQ-PROMPT-EDIT-RBAC** — who edits/promotes prompts? *REC: Admin+ create/promote; AI may only `propose_suggestion`; promote-to-default needs a passing live golden score.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-AIQ-METRIC-OWNER** — who owns the quality metrics? *REC: the app emits domain signals from the event log; `@luckystack/monitoring` transports/alerts (don't build an in-app metrics store).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### Client & push (4)
- **Q-CLIENT-SHELL** *(F5 above)*
- **Q-CLIENT-NOTIF-ACTIONS** — one-tap background approve? *REC: deep-link + pre-armed approve (full body shown in-app; one-tap-on-redacted would approve unseen secret-bearing input — rule 19).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-CLIENT-BGSYNC** — offline mechanism? *REC: reuse `postSocketReconnect` catch-up (B-22) on reconnect; Background Sync API only for retrying a failed body-fetch (a write-replay queue = a second writer, forbidden).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-CLIENT-PUSH-OPS** — SW update / logout-unsub / VAPID scope / coalescing / quiet-hours / SW build. *REC: prompt-to-refresh toast; unsubscribe+delete row on logout; one VAPID keypair per deployment; per-(user,type) debounce+count-summary (needs-input exempt); quiet-hours deferred (OS DND); build the SW with the Vite PWA plugin.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### Installer (6)
- **Q-INSTALL-ORCH** *(secondary)* · **Q-INSTALL-PROFILE-DEFAULT** *(secondary)*
- **Q-INSTALL-BOOTSTRAP-SPLIT** — compose vs once-only bootstrap line? *REC: once-per-install state (Claude login, VAPID, first owner) in bootstrap; whenever-running state in compose; the orchestrator's boot sequence is image code compose only supervises.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-INSTALL-AUTH-LOGIN** — how bootstrap establishes the host Claude login? *REC: interactive `claude login` in bootstrap, API-key-guard asserted, normalized into the orchestrator-owned auth dir (Keychain export on macOS).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-INSTALL-DNS-PROMPT** — public DNS-01 wildcard vs LAN internal-CA? *REC: prompt once; default public DNS-01 when a domain+token are supplied, LAN internal-CA otherwise.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-INSTALL-UPGRADE-COORD** — version coordination across upgrade? *REC: pin every service to an explicit tag, bump as a set per release; web-app rolling then orchestrator recreate→reconcile.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### Trust & safety (4)
- **Q-TRUST-AUTONOMY** *(secondary above)*
- **Q-TRUST-DRYRUN** — shadow mode = a new concept or just gate-every-stage? *REC: purely the gate-every-stage autonomy level + a SHADOW render marker; no separate `Ticket.dryRun` field or parallel path (the architecture is already propose-only).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-TRUST-ROLLBACK** *(secondary, above)*
- **Q-TRUST-AUDIT** — audit trail shape? *REC: a dedicated append-only `AuditEntry` the Conductor writes for decision-bearing ops only (approve/promote, merge, revert, kill, pause-all, raise-cap, set-autonomy, role/member changes, accept-suggestion); Admin+ readable (not a coalesced TicketEvent filter).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

### Analytics (7)
- **Q-ANALYTICS-DONE-DEF** — what anchors "completed"? *REC: `merge mr` in forge modes; final-stage `done` in built-in/no-merge modes (forge-aware).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-ANALYTICS-PERCENTILE** — default cycle-time stat? *REC: p85 (mean + p50/p95 behind a toggle).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-ANALYTICS-AUTOGRADE** — automated AI grader? *REC: no for v1; fold only human approve/reject/rework verdicts.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-ANALYTICS-POSTMERGE** — track post-merge re-opens? *REC: yes, optional + event-gated (only if the forge emits a reopen event).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-ANALYTICS-CACHE** — on-request fold vs Redis rollup? *REC: on-request fold over the bounded window for v1; a seq-watermark Redis rollup is P2.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-ANALYTICS-COST-RBAC** — cost member-visible or Admin-gated? *REC: member-visible (same as feature 19's advisory budget bar).* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).
- **Q-ANALYTICS-XWS** — cross-workspace benchmarking? *REC: out of v1 (crosses runInTenant isolation); anonymized benchmark is P3.* **→ Keuze:** ✅ Aanbeveling geaccepteerd (user koos "accepteer-alle, ik vlag uitzonderingen", 2026-06-04).

---

## RESOLUTION STATUS — RESOLVED 2026-06-04

All 50 questions are decided. The user accepted all recommendations EXCEPT two deviations + confirmed the forks:
- **F1 Q-FORGE-GITHOST → ⚑ option B** (lightweight git-server container, Gitea-core/Soft Serve — NOT bare-repos). → patch `FORGE_ABSTRACTION §7` + `SELF_HOST_INSTALLER` full-profile.
- **F2 Q-FORGE-CI-RUNNER → container-runner** (rec). **F3 Q-FORGE-GITHUB → design-now/build-later** (rec). **F4 Q-FORGE-MR-FLOOR → split + expand [07] + read/write-federation** (rec). **F5 Q-CLIENT-SHELL → PWA-first, no native** (rec).
- **Q-TRUST-AUTONOMY → ⚑ DEVIATES**: fully-configurable autonomy spectrum incl. **auto-merge as a first-class v1 option** (per-workspace default + per-ticket override + per-stage approval toggles; gate-every-stage ↔ full-auto-auto-merge; safe default gate-key-stages; loosen/enable-auto-merge = Admin+). → patch `TRUST_SAFETY_UX` + `BUILTIN_MR_REVIEW` + `GIT_STRATEGY`.
- All other secondary + the remaining 44 = accepted on recommendation; user will flag exceptions.

**Doc patches applied for the two deviations** (see those docs' "DECISION 2026-06-04" notes). 12 new models still to fold into `04b` at build time.
