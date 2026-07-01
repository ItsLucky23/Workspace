# Forge Abstraction — the pluggable `ForgeProvider` seam (board / repo / MR / CI / webhooks / auth)

> **⚑ V1 SCOPE:** only GitLabForge is built (forgeMode=gitlab); GitHub, the built-in git-server, and forge-mode-switching are OUT for V1 — see [V1_SCOPE.md] §4. Read [V1_SCOPE.md] first.

> The backbone the MR, CI, and git-strategy docs cite. Where [MULTI_PROVIDER_SEAM] localizes the *AI engine* behind one spawn function, this doc localizes the **git FORGE** — the thing that owns the repo, the issues/board source-of-truth, merge requests, CI, and webhooks — behind one **capability interface** with **three implementations**: `GitLabForge` (today, forge = SoT, B-29), `GitHubForge` (future, designed-for-now), and `BuiltinForge` (Workspaces hosts the repo + MR + CI itself; Workspaces = SoT, no external forge required). Forge mode is **OPTIONAL and per-workspace**: running Workspaces *on top of* an existing GitLab/GitHub project stays fully first-class. Mirrors the seam philosophy of [MULTI_PROVIDER_SEAM] (verb semantics frozen; transport swappable) and resolves the all-in-one "no external forge needed" vision without touching the locked core. Cites architecture as `[01 §x]`…`[07 §x]`, `[07b]`, `[CONTROL_API]`, `[04b §N]`; codes via [REFERENCE_CODES]. Last updated: 2026-06-04.
>
> **No new verbs.** This doc introduces **zero** structured-channel verbs. The frozen 7+6 surface ([02 §2], all `read|propose`, none write) is untouched. Every forge write — clone, branch, push, open/merge an MR, run a pipeline, reconcile the board — is a **[control-API] route → `preApiExecute` RBAC → enqueue a Conductor action**, drained serially by the single-instance Conductor (the only writer, [01 §3.3]). The seam swaps *which forge backend the Conductor calls*; it never adds a write path around the Conductor.

---

## 0. One-paragraph summary

Today, "the forge" is fused into the codebase as **GitLab, everywhere**: the board is a projection of GitLab issues ([22]), the webhook ingest + serial reconcile is GitLab-shaped ([07 §C]), git writes assume `git push` to a GitLab remote ([07 §A]), and the MR is a GitLab MR the review surface federates with ([07_CODE_CHANGES_REVIEW]). This doc lifts those four couplings behind a single internal **`ForgeProvider`** interface exposing six capabilities — **boardSync, repoHosting, mergeRequests, ci, webhooks, auth** — selected **per-workspace** by `Workspace.forgeMode` and configured by a `ForgeConnection` row. `GitLabForge` is the existing [22]/[07 §C] design **verbatim** (no regression, forge = SoT, B-29). `BuiltinForge` flips the source-of-truth to **Workspaces itself**, hosting the repo (recommended: **bare repos on the orchestrator host**, served by the orchestrator) + owning the MR entity + running CI as a **sequence of container jobs on the orchestrator Workspaces already has** ([07]/[07b]). `GitHubForge` is **designed-now-built-later** — the interface is shaped so a GitHub adapter is a registration, not a rewrite. The Conductor, the [control-API] catalogue, the verbs, and `runInTenant` multi-tenancy are **identical** across all three modes — only the adapter the Conductor calls changes.

---

## 1. What stays IDENTICAL across all three forge modes (need NO change)

The architecture's stable waist for the forge is: **"Workspaces owns the *workflow*; the forge owns the *git-and-collaboration substrate*."** These surfaces are forge-neutral by construction and are untouched by the seam:

| Surface | Where | Why it's already neutral |
|---|---|---|
| **The frozen verb surface** — 7 worker + 6 assistant verbs | [02 §2], `features/INDEX` NO-NEW-VERBS | Pure semantic contract. A worker `emit_carryover`s; the Assistant `get_ticket`s — neither names a forge. **No new verbs**, no write verb, on any forge. |
| **The Conductor = the only writer** | [01 §3.3], [CONTROL_API §7] | The Conductor reconciles JSON and drives deterministic actions; it calls a forge *adapter* to perform a git/MR/CI write, but the *decision* to write is forge-blind. Swapping the adapter swaps the callee, never the writer. |
| **`[control-API]`** — the human/web-app write transport | [CONTROL_API] | Every forge write (open-MR, merge, run-pipeline, resync) is a [control-API] op → `preApiExecute` RBAC → one `WorkspaceSignal` → Conductor. The catalogue §8 grows by forge ops; the **mechanism** is unchanged, and **none is a verb**. |
| **`TicketEvent` append-only log + merge-on-`seq`** | [04b §6], B-22 | The board/MR/CI surfaces are projections rendered from `seq`-ordered events. Whether an event was sourced from a GitLab webhook, a GitHub webhook, or a built-in git hook, it lands as a Conductor-written `TicketEvent` — the client never sees the difference. |
| **`runInTenant` isolation** | [04b §11c], B-O8 | Every forge call from the orchestrator (webhook reconcile, CI worker, git write) runs under `runInTenant(workspaceId, …)`. Forge mode is a per-tenant setting; tenant isolation is mode-blind. |
| **The single-instance orchestrator + Redis lease** | [07 §A], G8/G16 | All forge writers (reconcile, CI jobs, git push, bare-repo writes) run under `lease:orchestrator`. Built-in mode adds *more* leased work (the git server, the CI runner); it does not add a second writer. |

**Implication:** the seam touches **only the forge edge** — the four couplings of §2 — never the protocol core, the control-API mechanism, or the Conductor's writer monopoly. That is what makes a `BuiltinForge`/`GitHubForge` an *adapter*, not a fork of the architecture.

---

## 2. The four real forge couplings (the points GitLab is fused in)

These are the *only* places "GitLab" is wired into the engine. The seam exists to localize them. Each maps onto a `ForgeProvider` capability (§3).

1. **Board source-of-truth + sync.** [22] makes the board a **projection of GitLab issues** (B-29, GitLab wins on conflict). The `Ticket` row mirrors `gitlabIssueId`/`gitlabIssueIid`/`labels[]` ([04b §13], `Q-DATA-ASSIGNMENT`). → capability **`boardSync`** + the **SoT flip** (§4).
2. **Webhook ingest + serial reconcile.** [07 §C] is a GitLab-shaped `pre-params`/origin-exempt route that verifies the **`X-Gitlab-Token`** header (G6/G7) and enqueues a serial reconcile job. → capability **`webhooks`**.
3. **Repo hosting + git writes.** [07 §A] assumes a GitLab remote: `git pull origin <default>` from a project mirror, `git worktree add` on `DEV-####`, the worker "**opens an MR**" against GitLab. → capabilities **`repoHosting`** + **`mergeRequests`**.
4. **CI / pipelines + merge events.** Today CI is **whatever GitLab runs**; the merge that triggers teardown + the RAG delta-index ([07 §A]/[07 §D]) arrives as a GitLab `Merge Request Hook`. → capability **`ci`** (+ `webhooks` for the merge event).

Auth (the per-workspace `gitlabTokenEnc`, B-07) threads through all four → capability **`auth`**. These five+one couplings are exactly the six capabilities of the `ForgeProvider` interface (§3).

---

## 3. The `ForgeProvider` capability interface

A `ForgeProvider` is the single internal seam every forge-touching callsite goes through. It is **six capability sub-interfaces** behind one provider, selected per-workspace (§6). This mirrors [MULTI_PROVIDER_SEAM §5]'s conformance bar: the interface is the contract a forge adapter is *tested against*, so the Conductor stays forge-blind.

```ts
// Internal orchestrator seam — NOT a structured-channel verb surface, NOT a public API.
// Every method is called by the CONDUCTOR (the only writer, [01 §3.3]); the web-app
// reaches these only via [control-API] → preApiExecute → enqueue → Conductor → adapter.
interface ForgeProvider {
  readonly mode: 'gitlab' | 'github' | 'builtin';   // = Workspace.forgeMode (§6)
  readonly sourceOfTruth: 'forge' | 'workspaces';   // gitlab|github ⇒ 'forge' (B-29); builtin ⇒ 'workspaces'

  readonly boardSync: BoardSyncCapability;      // §2.1 — issues ⇄ tickets, SoT-flip aware
  readonly repoHosting: RepoHostingCapability;  // §2.3 — where the git lives + clone/pull/worktree/push
  readonly mergeRequests: MergeRequestCapability; // §2.3 — open / list / diff / comment / approve / merge
  readonly ci: CiCapability;                     // §2.4 — run a pipeline; report status back
  readonly webhooks: WebhookCapability;          // §2.2 — verify + normalize an inbound event
  readonly auth: ForgeAuthCapability;            // §2 — resolve the per-workspace credential
}
```

The six capabilities, and the contract each adapter implements:

| Capability | Contract (what every adapter MUST provide) | GitLab today | Built-in | GitHub (future) |
|---|---|---|---|---|
| **`boardSync`** | `fetchAuthoritativeIssues()`, `mapIssueToTicket(issue)`, `writeBackBoardChange(change)` — feeds the Conductor's board reconcile. **Honors `sourceOfTruth`** (§4): when `forge`, forge wins on conflict; when `workspaces`, the local board is authoritative and write-back is a no-op. | GitLab issues + labels ([22]) | `Ticket` rows ARE the board (no external issues) | GitHub issues + labels |
| **`repoHosting`** | `cloneOrMirror()`, `pull(default)`, `revParse(ref)`, `worktreeAdd(branch, commit)`, `push(branch)` — the [07 §A] git substrate. | `git pull origin` from a GitLab remote | **bare repos on the orchestrator host**, served by the orchestrator ([§5], `Q-FORGE-GITHOST`) | git push to GitHub remote |
| **`mergeRequests`** | `open(branch, base, meta)`, `list(filter)`, `diff(mrId, baseline)`, `comment/thread(mrId, …)`, `approve(mrId, userId)`, `merge(mrId, strategy)`, `conflictState(mrId)` — the full MR experience the expanded review doc owns. | GitLab MR (federated) | **Workspaces-owned `MergeRequest` entity** (§7) | GitHub PR (federated) |
| **`ci`** | `runPipeline(spec, commit)`, `pipelineStatus(id)`, `cancel(id)` — a pipeline = a sequence of container jobs. **Pluggable runner** ([§8], `Q-FORGE-CI-RUNNER`). | GitLab CI (external engine) | **container jobs on [07]/[07b]** via the orchestrator | GitHub Actions (external) |
| **`webhooks`** | `verify(req)`, `normalizeEvent(req) → ForgeEvent` — the [07 §C] ingest, made forge-agnostic. The normalized `ForgeEvent` is what the Conductor reconciles. | `X-Gitlab-Token` header (G6/G7) | **in-process** git hooks (no HTTP webhook needed) | `X-Hub-Signature-256` HMAC ([07 §C] PRE_PARAMS body-HMAC seam, G7) |
| **`auth`** | `resolveCredential(workspaceId)` — the per-workspace secret (B-07), encrypted, never client-visible. | `gitlabTokenEnc` (B-07) | **n/a** (Workspaces owns the repo; local identity) | `githubTokenEnc` / GitHub App installation token |

**Conformance bar (the test a forge adapter passes — mirrors [MULTI_PROVIDER_SEAM §5]):** a conforming `ForgeProvider` MUST (1) feed the Conductor a normalized `ForgeEvent` set the board/MR/CI reconcilers consume — natively (GitLab/GitHub webhooks) or synthesized (built-in git hooks); (2) implement every method as a thing the **Conductor calls** — never a thing that writes `Ticket.status`/`TicketEvent`/the board directly (those stay Conductor writes, [01 §3.3]); (3) declare its `sourceOfTruth` so the board reconciler knows who wins on conflict (§4). An adapter meeting these three drops into the Conductor with no coordination change — the payoff of the already-neutral core (§1).

**No new verbs.** The interface is an internal orchestrator seam the Conductor calls; the agent-facing verb surface is untouched.

---

## 4. Source-of-Truth flips per mode — and what it means for board / tickets / git writes

The single biggest semantic difference between the three modes is **who owns the truth**. The seam makes this a one-field declaration (`ForgeProvider.sourceOfTruth`) that the board reconciler, the ticket projection, and the Conductor's git writes all branch on.

| Mode | `sourceOfTruth` | Board / tickets | Conductor git writes | Conflict policy |
|---|---|---|---|---|
| **GitLab** (today) | **`forge`** (B-29) | Board is a **projection** of GitLab issues ([22]); `Ticket` mirrors the issue (cached `labels[]`, `mrUrl`, `issueUrl`). | Worker pushes `DEV-####` to the GitLab remote, opens a GitLab MR ([07 §A]). | **GitLab wins** (B-29); reconcile-cron overwrites the local projection on drift. |
| **GitHub** (future) | **`forge`** | Board is a projection of **GitHub issues**; `Ticket` mirrors the GitHub issue/PR. | Push to GitHub remote, open a **GitHub PR**. | **GitHub wins** (same B-29 posture, different forge). |
| **Built-in** | **`workspaces`** | The `Ticket`/`MergeRequest` rows **ARE** the truth — there is no external issue to reconcile against. The board is *authoritative*, not a projection. | Push to the **orchestrator-hosted bare repo** ([§5]); open a **Workspaces `MergeRequest`** (§7). | **Workspaces wins** — there is no external authority; the local row is final. |

**What the SoT flip changes (and what it does NOT):**

- **Board reconcile direction reverses.** In `forge` mode the reconcile job *fetches authoritative issues and overwrites local* ([07 §C], GitLab wins). In `workspaces` mode there is no inbound authoritative fetch — board mutations are **direct Conductor writes** (a [control-API] `bulk-move`/`quick-add` materializes the `Ticket` row as final, exactly like [CONTROL_API §9]'s user-direct creation). `boardSync.writeBackBoardChange` becomes a **no-op** (nothing external to write back to). Stage state stays board-local in *all* modes ([22] D85 — no `stage::*` labels pushed even to GitLab), so this flip touches issue-state/labels only.
- **Tickets are unaffected in shape.** `Ticket` keeps `creatorId`/`assigneeId`/`mrUrl`/`issueUrl` ([04b §13]); in built-in mode those point at Workspaces-owned entities (the built-in `MergeRequest.url` is `app.<domain>/…/mr/<id>` instead of a GitLab URL). No schema fork — the columns are forge-derived caches that the built-in forge fills from its own rows.
- **The Conductor stays the only writer.** In every mode, the board write is a Conductor action ([01 §3.3]); only the *adapter it calls to perform the git/MR side-effect* differs. The SoT flip changes whether there's an inbound authority to defer to — it never grants any other actor write access.

**`Q-FORGE-SOT-MIXED` (open question, §10):** can a workspace run **mixed** SoT — e.g. board = built-in but repo = external GitLab? **Recommended default: NO — `forgeMode` is one value covering all six capabilities for a workspace** (single-forge-per-workspace, mirroring [MULTI_PROVIDER_SEAM §9]'s per-workspace-single-provider). Mixed mode is the analog of per-stage provider selection: a real future opt-in, but it multiplies the SoT-conflict surface and is **not** built in v1.

---

## 5. `GitLabForge` — the existing design, lifted WITHOUT regression

`GitLabForge` is **not new code** — it is the existing [22] + [07 §C] + [07 §A]-GitLab behavior, re-homed behind the `ForgeProvider` interface with **zero behavioral change**. The lift is mechanical: each of the four couplings (§2) becomes one capability method, and the existing checklist items become the GitLab adapter's conformance.

| [07 §C]/[22] mechanic (today) | Becomes (GitLabForge method) | Regression guard |
|---|---|---|
| `pre-params`/origin-exempt `/hooks/gitlab`, `X-Gitlab-Token` check (G6/G7) | `webhooks.verify()` + `webhooks.normalizeEvent()` | The route, the header check, and the 200-ack-fast path are **unchanged** — only the handler now calls `forge.webhooks.*` instead of inline GitLab parsing. The [07 §C] checklist (origin-exempt, header-not-HMAC, enqueue-fast, GitLab-wins, reconcile-cron) is the GitLabForge test. |
| `gitlab.fetchAuthoritative(job.data)` → `conductor.reconcileBoard(remote)` | `boardSync.fetchAuthoritativeIssues()` + `boardSync.mapIssueToTicket()` | `sourceOfTruth = 'forge'` ⇒ GitLab-wins reconcile is **identical** (B-29). The Conductor reconcile loop is byte-for-byte the same; it just reads through the adapter. |
| `git pull origin` from the GitLab mirror; worker opens a GitLab MR ([07 §A]) | `repoHosting.pull()` + `mergeRequests.open()` | The 7-step launch ([07 §A]) is unchanged; steps 2/5 call `forge.repoHosting.*`. The mounted-subscription-auth PTY, the frozen `commitHash` (DH5), the Caddy route — all untouched. |
| `gitlab-settings`/`gitlab-verify`/`gitlab-resync` ([CONTROL_API §8]) | `auth.resolveCredential()` + the same control-API ops | The Admin+ RBAC, the encrypted `gitlabTokenEnc` (B-07), Verify-as-read — unchanged; the ops now resolve through the adapter. |
| GitLab CI (whatever the GitLab project runs) | `ci` = **external runner** (the GitLab pipeline is used as-is) | In GitLab mode, CI is GitLab's — `ci.runPipeline` delegates to GitLab CI or is a no-op if the project drives its own. **No built-in CI is forced on a GitLab-SoT workspace.** |

**The regression contract:** a workspace with `forgeMode='gitlab'` behaves *exactly* as [22]/[07 §C] describe today — same webhook path, same GitLab-wins conflict, same board projection, same MR federation, same encrypted per-workspace token. The seam is a **refactor of the callsites, not a change of behavior** ([MULTI_PROVIDER_SEAM §4]'s "refactor of one callsite" applied to the forge edge). The [07 §C] and [22] checklists are re-used verbatim as the GitLabForge conformance suite.

**No new verbs.** The lift moves inline GitLab calls behind an interface; it adds no protocol surface.

---

## 6. The per-workspace mode selector + data-model additions

Forge mode is **per-workspace** and **optional** — a workspace may use Workspaces *on top of* an external forge (GitLab today, GitHub later) or let Workspaces *be* the forge (built-in). Two data-model additions carry this; both are additive, tenant-scoped, and fold into the [04b §13] field sweep.

```prisma
// Addition to Workspace (tenant root). One value covers all six capabilities for the workspace (§4 Q-FORGE-SOT-MIXED default).
// Workspace.forgeMode: 'gitlab' | 'github' | 'builtin'   @default("gitlab")
//   - 'gitlab'  → GitLabForge, sourceOfTruth='forge' (today's default; B-29 unchanged)
//   - 'github'  → GitHubForge, sourceOfTruth='forge' (designed-now-built-later, §9)
//   - 'builtin' → BuiltinForge, sourceOfTruth='workspaces' (Workspaces owns repo+MR+CI, §5/§7)

model ForgeConnection {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId               // tenant; one active connection per workspace
  mode          String                               // mirrors Workspace.forgeMode (denormalized for the connection's own validation)
  baseUrl       String?                              // external forge base URL (gitlab.com / github.com / self-hosted); null for builtin
  repoPath      String?                              // "youcomm/app" (external) — supersedes the per-mode Project.gitlabPath/gitUrl
  tokenEnc      String?                              // encrypted per-workspace credential (B-07 generalized): GitLab PAT | GitHub PAT/App token | null (builtin)
  webhookSecret String?                              // server-side; the header/HMAC secret ([07 §C]); null (builtin uses in-process hooks)
  ciRunner      Json?                                // CI runner selection (§8): { kind: 'builtin-container' | 'external', endpoint?, … }; null ⇒ default per mode
  builtinRepoRef String?                             // builtin only: the orchestrator-hosted bare-repo path/id ([§5]); null (external)
  status        String   @default("disconnected")    // 'connected' | 'disconnected' | 'error' — the Verify/sync-health state ([22] SyncHealth chip)
  createdAt     DateTime @default(now())

  @@unique([workspaceId])                            // one forge connection per workspace (single-forge default, §4)
  @@index([workspaceId, status])
}
```

- **`ForgeConnection` generalizes the existing GitLab fields.** `Workspace.gitlabBaseUrl`/`gitlabTokenEnc` ([22] Data) and `Project.gitlabPath`/`gitUrl`/`gitlabProjectId` ([04b §13]) are the **GitLab-mode realization** of `baseUrl`/`tokenEnc`/`repoPath`. The recommendation (§10 `Q-FORGE-DATAMODEL`) is to **keep the GitLab columns as-is for GitLab mode (zero migration / zero regression)** and add `ForgeConnection` as the *generalized* row the other modes populate — GitLabForge reads either, preferring `ForgeConnection` when present. This avoids a risky rename of live GitLab fields.
- **The settings surface generalizes the [22] GitLab tab.** The `WorkspaceSettings` "GitLab" tab becomes a **"Forge"** tab with a **mode selector** (GitLab / GitHub / Built-in), then the mode-specific fields (external: base URL + token + Verify + the [22] `SyncHealth` chip; built-in: repo name + "Workspaces hosts this repo" copy + a clone-URL to add the remote). RBAC: forge/integration edits are **Admin+** ([CONTROL_API §8] `gitlab-settings` row, generalized to `forge-settings`/`forge-verify`/`forge-resync`).
- **Mode switching is a deliberate, Admin+ [control-API] op, not a silent toggle.** Switching `forgeMode` mid-workspace is a heavy migration (re-home the repo, re-map issues, re-point webhooks) — recommended **out of v1** (`Q-FORGE-MODE-SWITCH`, §10): mode is chosen at setup ([01_WORKSPACE_SETUP]) and is effectively immutable for v1; a future `forge-migrate` op handles the re-home.

**INDEX delta:** `Workspace.forgeMode`, `ForgeConnection` (net-new persisted), plus the built-in-mode `MergeRequest`/CI rows owned by the MR/CI docs (§7/§8) that cite this doc.

**No new verbs.** Mode selection + Verify + resync are [control-API] ops ([CONTROL_API §8], generalized GitLab rows); nothing here is a structured-channel verb.

---

## 7. Built-in mode — how Workspaces stores/serves git + owns the MR

`BuiltinForge` is the all-in-one mode: **no external forge required**. It must answer two questions — *where does the git live* and *who owns the merge request* — without breaking the locked single-instance / Conductor-only-writer model.

### 7.1 Where the git lives (~~bare repos on the orchestrator host~~ → git-server container, see DECISION)

> **DECISION 2026-06-04 (user — `Q-FORGE-GITHOST` → option B, overrides the "bare repos" recommendation in this §7.1 and the §3/§4 tables):** built-in git hosting = a **lightweight git-server container** in the stack (e.g. **Gitea-core** or **Soft Serve**), NOT bare repos served by the orchestrator. The user wants a real, browseable git server. Consequences: the `repoHosting` adapter targets the git-server container's remote over `workspaces-net`; the **full** compose profile runs the `git-server` service ([SELF_HOST_INSTALLER §3/§4]); the orchestrator still holds `lease:orchestrator` so merges stay serial ([GIT_STRATEGY]); [DR_RUNBOOK] adds the git-server's volume to backup. Wherever this doc (or its §3/§4 tables) says "bare repos on the orchestrator host", read "the git-server container".

**Original recommendation (now superseded by the DECISION above) (`Q-FORGE-GITHOST`, §10): bare repos on the orchestrator host, served by the orchestrator.** The orchestrator already (a) is the single-instance host of all git worktrees ([07 §A]), (b) holds `lease:orchestrator` so all git writes are already serialized (G8/G16), and (c) drives the container runtime ([07b]). Adding **`git init --bare`** repos under an orchestrator-managed volume and serving them over the orchestrator's existing `term.<domain>` edge (git-over-HTTPS, or git-over-SSH reusing the [B-05] `/pty`-namespace SSH-key capability-gate) is the **smallest possible** addition (Rule 7b: minimum consumer-side code). The 7-step launch ([07 §A]) changes only its *remote*: `repoHosting.pull()` pulls from the local bare repo instead of a GitLab remote; `worktreeAdd` and the frozen `commitHash` (DH5) are **unchanged**.

- **Options weighed (§10):** (A) bare repos on the host **[recommended]** — zero new service, reuses the lease + edge; (B) a lightweight git server container in the stack (e.g. a minimal `git-http-backend` / Soft Serve / Gitea-core) — cleaner protocol surface + a browseable UI, but a whole new service to operate, secure, and back up (DR_RUNBOOK + OBSERVABILITY both grow); (C) embed an in-process JS git server — least operational weight but the thinnest battle-tested surface for hostile pushes. Default = **(A)**: it is the only one that adds **no new long-running service** and inherits the existing single-instance lease, backup ([08_DEPLOYMENT]/[DR_RUNBOOK]), and `runInTenant` posture. (B) is the natural P2 upgrade if a web git-browser is wanted beyond the [08_CODEBASE_VIEWER] editor.
- **Backup / DR:** the bare repos join the orchestrator's host-state backup set ([DR_RUNBOOK]) alongside worktrees and the event log; the append-only `TicketEvent` log ([04b §11a]) remains the restore-priority truth, with the bare repo restored from the host volume snapshot.

### 7.2 Who owns the MR (a Workspaces-owned `MergeRequest` entity)

In built-in mode there is **no external MR to federate with** — Workspaces owns it. The MR becomes a first-class tenant entity (the MR/CI doc that cites this one owns its full schema; this doc pins only the seam-relevant shape):

```prisma
// Built-in-mode MR. In external modes this row is a CACHE/PROJECTION of the forge MR/PR
// (mrUrl points at GitLab/GitHub); in built-in mode it is AUTHORITATIVE (sourceOfTruth='workspaces').
model MergeRequest {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId  String   @db.ObjectId               // tenant
  ticketId     String?  @db.ObjectId               // the DEV-#### ticket this MR belongs to
  sourceBranch String                               // 'DEV-####'
  targetBranch String                               // the project default
  baseCommit   String                               // frozen baseline ([07 §A] DH5)
  headCommit   String
  state        String                               // 'open' | 'merged' | 'closed' | 'conflict'
  approvals    String[] @db.ObjectId               // userIds who approved (built-in approvals; §3 mergeRequests.approve)
  url          String?                              // builtin: app.<domain>/.../mr/<id>; external: the forge MR/PR url (= Ticket.mrUrl)
  createdAt    DateTime @default(now())
  // review threads/comments + rich-diff are the MR doc's models; CI status links via the CI doc's pipeline row.
}
```

- **The expanded MR experience composes over the seam.** The vision's "full MR experience" (rich diff, review threads/comments, approvals, merge, conflict handling) is the **MR doc's** surface; it reads `mergeRequests.diff/comment/approve/merge/conflictState`. In **built-in** mode those operate on the `MergeRequest` row + the orchestrator-hosted bare repo (Workspaces owns the merge). In **external** mode they **federate**: `diff` and threads mirror the forge MR/PR where the API allows, `merge` delegates to the forge's merge, and the row is a cache ([04b §13] `mrUrl`). The existing per-ticket [07_CODE_CHANGES_REVIEW] changed-files review is the **floor**; the MR doc expands it into the full experience over this capability — the [07_CODE_CHANGES_REVIEW] `query_context` diff path and the UI-Builder editor contract ([08_CODEBASE_VIEWER]) are reused unchanged.
- **Every MR write is a Conductor action.** `open`/`approve`/`merge`/`comment` are [control-API] ops (`mr-open`/`mr-approve`/`mr-merge`/`mr-comment`, new catalogue rows in [CONTROL_API §8]) → `preApiExecute` RBAC → enqueue → Conductor → `forge.mergeRequests.*`. The AI **never** merges (B-23); it may `propose_suggestion` ("ready to merge") which a human accepts. **No new verbs** — review comments authored by a *human* are [control-API] writes; an *agent* never writes an MR.
- **Merge → teardown + RAG delta still fire.** In external mode the merge arrives as a forge webhook ([07 §C]); in built-in mode the merge is a Conductor action that **synthesizes** the same normalized `ForgeEvent` (a built-in git hook on the bare repo), so the [07 §A] teardown + [07 §D] RAG delta-index run **identically** — the Conductor can't tell which forge produced the merge event (§3 conformance bar point 1).

---

## 8. Built-in CI — a pipeline is a sequence of container jobs on the orchestrator

The vision's lightweight self-hostable CI reuses the infra Workspaces **already has**: the container orchestrator ([07]/[07b]). A **pipeline = an ordered sequence of container jobs** (build / test / lint), each job a container started exactly like a ticket-stage container ([07 §A] step 6, [07b §container-runtime]) under the same lease, the same resource-limit hygiene (B-26), and the same `runInTenant` isolation. No new orchestration substrate — CI is the orchestrator running short-lived job containers instead of a long-lived PTY container.

- **Pluggable runner (`Q-FORGE-CI-RUNNER`, §10).** `ci` is a **`PipelineRunner` interface** with two implementations behind `ForgeConnection.ciRunner`: (1) **built-in container runner [recommended default for built-in mode]** — jobs run as orchestrator-driven containers on [07b]; (2) **external runner** — a self-hosted engine (Woodpecker / Drone / Dagger / etc.) the workspace points at, OR the forge's native CI (GitLab CI in GitLab mode, GitHub Actions in GitHub mode). The interface is `runPipeline(spec, commit) → pipelineId`, `pipelineStatus(id)`, `cancel(id)`; the built-in runner maps each job to a container exec, the external runner delegates. **Recommendation: built-in mode defaults to the container runner; GitLab/GitHub modes default to the forge's native CI** (don't force built-in CI on a workspace that already has a forge pipeline).
- **A pipeline is data, runs as containers, reports as events.** The pipeline spec (stages × jobs) is a tenant row (the CI doc owns its schema); each job's status is a Conductor-written `TicketEvent` (`type:'ci'` or a CI-specific type the CI doc adds) so the board/MR surfaces render CI status from the same `seq`-ordered log ([04b §6]) every other surface uses. Triggering a pipeline (`ci-run`/`ci-cancel`) is a [control-API] op → Conductor → `forge.ci.runPipeline`. **No agent runs CI** — CI is Conductor-driven infra, not an LLM verb.
- **Why reuse the orchestrator (not a second CI service):** the orchestrator already owns the lease, the container API ([07b]), the Caddy edge, the per-ticket worktree/commit, the resource limits (B-26), backup ([DR_RUNBOOK]), and observability ([OBSERVABILITY]). A built-in CI that *is* "the orchestrator runs job containers" inherits all of it for free (Rule 7b). A separate CI engine is the **external-runner** path for teams that want one — exactly the pluggable seam the vision asks for.

**No new verbs.** `ci-run`/`ci-cancel` are [control-API] ops; pipeline status is Conductor-written events. The frozen verb surface is untouched.

---

## 9. `GitHubForge` — designed-now, built-later

GitHub mode is the **second `forge='forge'` implementation** — the one that proves the seam is real (an abstraction with one impl is theatre; the GitHub shape is what keeps `GitLabForge` honest). It is **designed now, built later** (`Q-FORGE-GITHUB`, §10 — recommended: ship the interface + the `ForgeConnection` shape now; build the adapter when a GitHub-hosted team needs it).

The three irreducible GitHub differences the interface already accommodates (so a future builder doesn't under-scope it to "register an adapter"):

- **Webhook auth differs.** GitHub uses **`X-Hub-Signature-256` HMAC-over-body**, not GitLab's plaintext header token. This is exactly the [07 §C] **PRE_PARAMS body-HMAC seam** (G7) that GitLab mode doesn't need but that *already ships* — `webhooks.verify()` for GitHubForge reads the raw body via the PRE_PARAMS custom-route and verifies the HMAC. The seam was built for precisely this case.
- **MR = PR, with GitHub's review/approval model.** GitHub PRs, review threads, required-reviewer approvals, and merge strategies (merge/squash/rebase) map onto `mergeRequests.*` but with different field names + a different approval semantics — the capability interface is the same; the adapter translates. The federated MR experience (§7.2) renders GitHub PR threads where the API allows.
- **Auth = GitHub App or PAT.** `auth.resolveCredential` resolves a GitHub App **installation token** (preferred — fine-grained, rotatable) or a PAT, stored encrypted in `ForgeConnection.tokenEnc` (B-07 generalized). The GitHub App install flow is a future setup step ([01_WORKSPACE_SETUP] extension); the `ForgeConnection` row already has the columns.

Built now (cheap insurance, mirroring [MULTI_PROVIDER_SEAM §7]): the `ForgeProvider` interface + `ForgeConnection.mode='github'` + the generalized webhook seam. Built later: the adapter methods themselves. **No `GitHubForge` adapter code in v1** — only the shape it slots into.

---

## 10. Open questions (Q-FORGE-*) — defaults recommended, user to confirm/override

Each is a genuine design fork; the doc states a recommended default (so it is coherent) and records the fork for the user.

| id | Question | Recommendation | Why |
|---|---|---|---|
| `Q-FORGE-GITHOST` | How does built-in mode store/serve git? | **Bare repos on the orchestrator host, served by the orchestrator (option A).** | Zero new long-running service; reuses the single-instance lease (G8/G16), the Caddy/`term.` edge, host-volume backup ([DR_RUNBOOK]), and `runInTenant`. A git-server container (B) is the natural P2 upgrade if a web git-browser is wanted; embedded JS git server (C) is thinnest-tested. |
| `Q-FORGE-CI-RUNNER` | What runs built-in CI? | **A `PipelineRunner` interface; built-in mode defaults to the container runner on [07]/[07b]; external runner (Woodpecker/Drone/Dagger or the forge's native CI) is the pluggable alt; GitLab/GitHub modes default to the forge's native CI.** | Reuses the orchestrator Workspaces already has (Rule 7b) — a pipeline = a sequence of container jobs under the existing lease + limits (B-26). The pluggable interface satisfies the "self-hostable external engine can slot in" steer without forcing built-in CI on a forge-SoT workspace. |
| `Q-FORGE-SOT-MIXED` | Can a workspace mix SoT (e.g. board built-in, repo external GitLab)? | **No — `forgeMode` is one value for all six capabilities (single-forge-per-workspace).** | Mirrors [MULTI_PROVIDER_SEAM §9] per-workspace-single-provider. Mixed mode multiplies the SoT-conflict surface (which authority wins per capability?) and is the analog of per-stage provider opt-in — a real future advanced opt-in, not v1. |
| `Q-FORGE-GITHUB` | Build the GitHub adapter now or design-only? | **Design-now, build-later: ship the `ForgeProvider` interface + `ForgeConnection` shape + the generalized webhook (HMAC) seam now; build the adapter when a GitHub-hosted team needs it.** | A second `forge`-SoT impl is what validates the abstraction (one impl = theatre). The expensive-to-retrofit parts (interface shape, body-HMAC seam) are cheap now and already partly shipped (G7); the adapter methods are deferrable. |
| `Q-FORGE-DATAMODEL` | Generalize the live GitLab columns or add `ForgeConnection` alongside? | **Add `ForgeConnection` as the generalized row the new modes populate; keep `Workspace.gitlabBaseUrl`/`gitlabTokenEnc` + `Project.gitlabPath` as-is for GitLab mode (GitLabForge reads either, prefers `ForgeConnection`).** | Zero migration / zero regression for the live GitLab path ([22] unchanged); the generalization is additive. A later cleanup can collapse the GitLab columns into `ForgeConnection` once GitLab mode also reads only the generalized row. |
| `Q-FORGE-MODE-SWITCH` | Can `forgeMode` change after setup? | **No for v1 — mode is chosen at workspace setup and is effectively immutable; a future Admin+ `forge-migrate` [control-API] op handles re-homing.** | Switching mode mid-workspace is a heavy migration (re-home repo, re-map issues, re-point webhooks/CI). Out of v1 scope; the seam makes the *future* migration an adapter-to-adapter copy, not a rewrite. |
| `Q-FORGE-MR-EXPANSION-OWNER` | Where does the full MR experience (threads/approvals/conflict) live? | **A dedicated MR feature doc that cites this seam owns the `MergeRequest` schema + review-thread models + the rich-diff UI; this doc owns only the seam-relevant `mergeRequests` capability + the minimal `MergeRequest` shape.** | Keeps this doc the backbone (capability contract) and the MR doc the surface (UI + full schema), matching how [22] owns the board surface over the [07 §C] engine. Prevents this doc from absorbing the entire MR feature. |

---

## 11. Composition — how 22 / 07 / 23 compose over the seam

The existing forge-touching docs compose over `ForgeProvider` with **no behavioral change in GitLab mode** and a clean generalization for the other two:

| Doc | Today (GitLab-fused) | Over the seam |
|---|---|---|
| **[22] board sync** | Board = projection of GitLab issues; GitLab wins (B-29). | Becomes `boardSync` driven by `sourceOfTruth`: GitLab/GitHub ⇒ projection + forge-wins reconcile (unchanged for GitLab); built-in ⇒ board is authoritative, write-back no-op (§4). The [22] `SyncHealth` chip + the GitLab tab generalize to the Forge tab (§6). |
| **[07 §C] webhook ingest** | `pre-params`/origin-exempt `/hooks/gitlab`, `X-Gitlab-Token`. | Becomes `webhooks.verify()`/`normalizeEvent()`: GitLab header (today), GitHub HMAC (the G7 PRE_PARAMS seam), built-in in-process git hooks. The serial leased reconcile worker + GitLab-wins logic are unchanged; they read normalized `ForgeEvent`s (§5). |
| **[07 §A] launch + git writes** | `git pull origin` from a GitLab remote; worker opens a GitLab MR. | Becomes `repoHosting.pull()`/`worktreeAdd()` + `mergeRequests.open()`: GitLab/GitHub remote (external) or the orchestrator-hosted bare repo (built-in, §7.1). The 7-step sequence, frozen `commitHash` (DH5), mounted-auth PTY, and Caddy route are **untouched**. |
| **[07 §D] RAG delta** | Triggered by a GitLab `Merge Request Hook` merge. | Triggered by a **normalized merge `ForgeEvent`** from any forge (GitLab webhook / GitHub webhook / built-in git hook) — the delta-indexer is forge-blind (§7.2). |
| **[23] preview deployment** | `dev-<ticketId>.<domain>` PROD container from the ticket worktree; merge → teardown. | **Fully forge-agnostic already** — preview builds from the *worktree* ([07 §A]), not from any forge. The only forge touch is the merge event that can trigger teardown, which is now a normalized `ForgeEvent`. **No change.** Built-in CI (§8) and preview share the same container orchestrator ([07b]). |

---

## 12. Self-check (review invariants)

- **No new verbs** introduced anywhere. The frozen `[02 §2]` surface (7 worker + 6 assistant, all `read|propose`) is untouched; `VERB_REGISTRY` conformance (`Q-ENG-VERB-CONFORMANCE`) is unaffected.
- **No write verb granted to any LLM session.** Every forge write — clone, branch, push, open/merge MR, run CI, reconcile board — is a Conductor action behind `[control-API]` (B-23, [01 §3.3]). The AI proposes (`propose_suggestion`); a human accepts; the Conductor writes via the adapter.
- **Single-instance + lease preserved.** All forge writers (reconcile, bare-repo writes, CI job containers) run under `lease:orchestrator` (G8/G16); built-in mode adds leased work, not a second writer.
- **Multi-tenancy preserved.** Every orchestrator-side forge call runs under `runInTenant(workspaceId, …)` ([04b §11c]); `forgeMode` is a per-tenant setting.
- **GitLab mode is non-regressive.** `forgeMode='gitlab'` reproduces [22]/[07 §C] behavior exactly (§5); the live GitLab columns are unmodified (`Q-FORGE-DATAMODEL` default).
- **Forge mode is optional + per-workspace.** Using Workspaces on top of an external GitLab/GitHub project stays first-class; built-in is the opt-in all-in-one mode (§6).
- **Every genuine fork is an open question** (§10) with a recommended default — `Q-FORGE-GITHOST`, `Q-FORGE-CI-RUNNER`, `Q-FORGE-SOT-MIXED`, `Q-FORGE-GITHUB`, `Q-FORGE-DATAMODEL`, `Q-FORGE-MODE-SWITCH`, `Q-FORGE-MR-EXPANSION-OWNER`.
- This doc **edits no existing file** — it is the new backbone the MR / CI / git-strategy docs cite as `[FORGE_ABSTRACTION §N]`.
