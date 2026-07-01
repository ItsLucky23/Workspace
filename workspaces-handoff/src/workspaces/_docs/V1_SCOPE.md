# V1_SCOPE — the definitive source of truth for what Workspaces V1 *is*

> **Read this FIRST, before any other `_docs` file, when you are building V1.** The broader doc set (01–08, 04b, the all-in-one layer, the 24 feature docs) describes a **bigger system than V1 ships** — a pluggable multi-forge, multi-provider, built-in-MR/CI, preview-deploy, analytics platform. That is the *design horizon*, not the build. **V1 is the deliberate subset locked by the user on 2026-06-04**, captured here. Where any other doc over-describes beyond this file, **V1_SCOPE wins** (§5). This doc adds no new design — it *selects* from the decided scope ([REVIEW_AND_OPEN_QUESTIONS], [REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE]) and cites the owning build-docs for each included piece. Codes resolve via [REFERENCE_CODES]. Last updated: 2026-06-04.
>
> **No new verbs. No new scope.** This file introduces zero structured-channel verbs and zero new entities. It is a *scoping* document over the frozen 7+6 verb surface ([02 §2], all `read|propose`, none write), the single-writer Conductor ([01 §3.3]), the FROZEN [CONTROL_API] verb-free write path, `runInTenant` multi-tenancy ([04b §11c]), and the LuckyStack file-based `_api`/`_sync` + function-injection conventions (root `CLAUDE.md`).

---

## 0. The product, in one paragraph (unchanged from [README])

Workspaces is a **self-hosted, AI-driven dev-orchestration app**: a user writes simple tickets; a configurable **pipeline of stages** (refine → plan → implement → test → review) drives each ticket forward; the human is a **man-in-the-middle** who only **approves and answers questions** — ideally from a phone. Three roles ([README]): the **Assistant** (one interactive `claude` PTY per active user, the chat that proposes/relays), the **Stage-Agent** (one interactive `claude` PTY per *(ticket, stage)*, doing the work in a container), and the **Conductor** (deterministic Node in the single-instance orchestrator — *the only writer of board/git/status*). V1 is the **smallest end-to-end slice** of that vision that actually ships and runs.

---

## 0b. Addendum — the 2026-06-11 additions round

This file remains the authority on the **founding** V1 scope below. A later **interview-mode round (2026-06-11)** added a set of **net-new** capabilities on top, vetted so none re-opens a decision locked here. They are catalogued in **[`additions/00_INDEX.md`](./additions/00_INDEX.md)** and each is tagged **V1** (extends what V1 ships) or **HORIZON** (designed, deferred). Where an addition needs a schema/contract change it is a *delta to reconcile* ([additions/00_DECISIONS_LEDGER.md §5](./additions/00_DECISIONS_LEDGER.md)), not a silent edit to the frozen models. The precedence rule (§5) is unchanged: this file wins on the founding scope; the additions index governs the new items' V1-vs-HORIZON tagging. The keystone V1 addition (**#9 per-stage commit** — commit-per-stage-internally then squash-on-push) preserves §3.1's push-on-approval → create-MR-URL flow and every invariant in §2.

---

## 1. The V1 build target, in one paragraph (the locked goal)

**Ship ONE working setup ASAP, then build part-by-part:** Claude CLI (interactive node-pty PTY, Max subscription) + **GitLab only** + **one self-hosted server**. The entire `src/workspaces/` folder is drag-and-dropped into a fresh repo that runs the `@luckystack` install commands; an AI is pointed at **this** master doc, reads the doc set, and asks where to start. A **single self-hosted host** runs the orchestrator + web-app + Mongo + Redis + the per-ticket containers; SSH to that host reaches a ticket-container terminal (per-open SSH-key gate, [07b §9]). The **P0.5 CLI billing spike** ([P0_CLI_SPIKE]) is the FIRST task and **GATES the build** — it must prove an interactive PTY bills the subscription, `type:http` hooks fire interactively, `/clear` vs `/compact` + `--resume` behave, and managed-token-projection auth works, before lanes B/C/F start. The code editor is a **full browser VS Code** ([openvscode-server], recommended; [code-server] alt) running *inside* the ticket container, exposed via the Caddy proxy like the term/preview subdomains. No built-in MR entity, no on-platform merge, no built-in CI, no multi-provider, no GitHub, no built-in git-server, no preview-deploy, no analytics in V1 — those are designed (cited below) and deferred (§4).

---

## 2. IN / OUT — the crisp scope table

> **IN** = built in V1. **OUT (designed-but-deferred)** = the design lives in the cited doc; the seam may stay as code, but the V1 build does not implement it. Every IN row cites its owning build-doc; every OUT row cites where its design lives + the one-line why (full list with where-it-lives in §4).

| Area | V1 — IN (build this) | OUT — designed-but-deferred (don't build; design lives in…) |
|---|---|---|
| **AI engine** | Interactive `claude` in a **node-pty PTY only**, on the Max subscription ([01 §1], [README]). The single-spawn wrapper ([MULTI_PROVIDER_SEAM §v1]) wraps `cmd:'claude'` + the 3 `SessionManager` spawns behind one internal fn — *one Claude impl*. | **Multi-provider** (driver interface, capability registry, `providerKey`, metered billing) — [MULTI_PROVIDER_SEAM] (parked; no 2nd provider to validate, Rule 7b). |
| **Forge** | **GitLab ONLY** — `GitLabForge` is the only adapter implemented. The [FORGE_ABSTRACTION] `ForgeProvider` seam stays as design, `forgeMode='gitlab'` is the only value. Board = projection of GitLab issues, GitLab = SoT (B-29). | **GitHub adapter** ([FORGE_ABSTRACTION §9], design-now/build-later); **built-in git-server container** ([FORGE_ABSTRACTION §7.1], `Q-FORGE-GITHOST`); **forge-mode switching** ([FORGE_ABSTRACTION §6], `Q-FORGE-MODE-SWITCH`). |
| **Merge / changes flow** | **No built-in MR entity, no on-platform merge, no auto-merge.** The changes page shows the full codebase in the editor with **changed files highlighted (a real diff)** ([features/07], [features/08]); on **complete**, the user's push happens (incl. their edits) → GitLab returns the **create-MR URL** → the user creates/merges the MR **on GitLab** (§3.1). | **Built-in `MergeRequest` entity / on-platform merge / approvals / auto-merge** — [BUILTIN_MR_REVIEW], [FORGE_ABSTRACTION §7.2], [GIT_STRATEGY] (mostly deferred; V1 push-on-approval + GitLab create-MR-URL replaces it). |
| **Per-stage config** | Per-stage **edit-lock toggle** ("may the user edit while this stage is active") → read-only changes editor + Pause-AI button when off; resume-with-changes message to the AI (§3.2). Plus per-stage tools/info/model/skills/MCP/autonomy (proceed-or-gate) ([features/02], [GOLDEN_PLAN_STAGE], [features/03]). | The **fully-configurable autonomy spectrum incl. auto-merge** ([TRUST_SAFETY_UX], `Q-TRUST-AUTONOMY`) — V1 ships the proceed-or-gate per-stage toggle + the edit-lock; the *auto-merge* end of the spectrum is deferred with the MR entity. |
| **Workspace-AI (Assistant)** | The per-user Assistant drives **all workspace-relevant actions via natural language**: instruction = consent → maps to a [control-API] action that **EXECUTES directly**, EXCEPT important/destructive actions (delete workspace, remove member, kill, push/merge-trigger) which require an **explicit confirm**. Scoped to a workspace-action whitelist; never host/system-level (§3.3). | Nothing deferred in the model itself; the **one-shot background reasoner** ([README], [02 §2] background-reasoning) — the proactive away-time brain — stays an optional future ephemeral session, **not standing in V1**. |
| **Containers + SSH** | Working containerization on a **single host**: orchestrator + web-app + Mongo + Redis + per-ticket containers all on that box; the in-container **pty-agent REPLACES the dev host-shell**; SSH to the host reaches a ticket-container terminal behind a **per-open SSH-key gate** ([07b], B-05). Managed-token-projection auth, clone-into-volume, dial-by-name net, egress proxy, hardening, CapacityManager (§3.4). | None of the container *design* is deferred — V1 builds the [07b] runtime. (The old `ui-builder` repo has **no** containers — this is greenfield; [07b] is the build guide.) |
| **Real-time sync** | **Multi-user real-time sync across people on the site** — the proven raw-Node + Socket.io rooms/broadcaster pattern, now shipped in `@luckystack`; subscribe-first → snapshot → merge-on-`seq` catch-up (B-22), `ws-ai:*` per-user chat (§3.5). | — (fully in V1). |
| **Notifications + push** | **Notifications + push-to-phone IN** — the phone approve loop; **redacted** push (D80 reversed, `Q-SEC-NOTIF-PUSH`) with the **full body fetched in-app behind auth**; PWA-first install ([CLIENT_AND_PUSH], [features/18], [features/09]) (§3.6). | **Preview-deployments** ([features/23], [07b §11]) and **product-analytics** ([PRODUCT_ANALYTICS]) — both OUT for V1 (later). |
| **CI** | **None on our side in V1.** GitLab's own CI runs on GitLab's side if the project has it; **we do not build or trigger CI** (§3.7). | **Built-in container CI** ([BUILTIN_CI_PIPELINES], [FORGE_ABSTRACTION §8], `Q-FORGE-CI-RUNNER`) — deferred with the MR entity. |
| **Code editor** | **A full browser VS Code** ([openvscode-server] rec / [code-server] alt) running **inside the ticket container** (which already holds the cloned codebase), exposed via Caddy like the term/preview subdomains → native git-diff/changed-file decorations, native editing, container terminals, **multi-language via LSP**, **account-linked VS Code extensions** (§3.1). The changes-page stage-lock + pause/resume-with-changes flow orchestrate *around* the VS Code session. | The **ui-builder Monaco** ([ui-builder/src/sandbox/...]) is kept as a **documented reference** (how Monaco + React/TS + custom themes were made to work) + a possible **lightweight read-only inline-diff fallback** (the interim `FileDiffViewer`, [features/07]). It is NOT the V1 editor target. |
| **Data / tenancy** | Prisma schema incl. [04b] §6–§11 (TicketEvent+`seq`, AgentSession runtime, SpendRecord/WorkspaceBudget, Notification/PushSubscription), `runInTenant` row-isolation, the seq/merge-on-seq event-log + sync backend, migration/bootstrap, seed ([04], [04b], [MIGRATION]). | — (fully in V1). |
| **Operability** | The two-system run model ([08]: N web-app replicas + 1 leased orchestrator running `resumeAll()`), structured logging + minimal metrics ([OBSERVABILITY]), DR backup/restore ([DR_RUNBOOK]), the test tiers the auto-sweep can't reach ([TESTING_STRATEGY]). | **Voice input** ([features/06], D5); **semantic-search / command-palette beyond client-side filter** ([features/21]) deferred to its richer form; **graphify call-graph integration** ([GRAPHIFY_INTEGRATION]) as an opt-in upgrade. |

**The invariants every IN row keeps** (non-negotiable, [REVIEW_2 §RESOLUTION]): **B-23** (AI proposes → user accepts → Conductor executes — the *only* writer); the **FROZEN 7+6 verb surface** (NO new verbs — every write via [control-API] → `preApiExecute` → enqueue → Conductor); **single-instance orchestrator** under `lease:orchestrator`; **`runInTenant`** on every sync-handler AND every background worker; LuckyStack conventions (file-based `_api`/`_sync` routing, function-injection — root `CLAUDE.md` Rule 21).

---

## 3. The V1 FLOWS — end-to-end and concrete

Each flow is written so an independent build lane can implement it without re-reading the whole doc set. Citations point at the owning build-doc for the deep mechanics.

### 3.1 The changes / push-on-approval → GitLab create-MR-URL flow

**This is V1's replacement for a built-in MR.** There is **no `MergeRequest` entity, no on-platform merge, no auto-merge** in V1 ([REVIEW_2 §F4 context overridden by the locked scope]). The flow:

1. **The editor is the ticket container's full browser VS Code.** A ticket on its `DEV-<ticketNumber>` branch ([GIT_STRATEGY §1]) has a clone-into-volume checkout ([07b §4]) at the frozen `commitHash` (DH5). [openvscode-server] runs **inside that container** and is exposed at a `vscode-<ticketId>.<domain>` (or reuse the `dev-`/`term-` pattern) Caddy route — same `@id`-route + dial-by-name mechanism as the preview/term subdomains ([07b §5]). This gives **native git-diff / changed-file decorations, native editing, container terminals, multi-language LSP, and account-linked extension install** — the 1:1 VS Code experience the user requires.
2. **The CHANGES page shows the full codebase with changed files highlighted (a real diff).** On the ticket's changes page the user sees the whole repo in the editor; the stage's changed files are decorated (native git decorations from the in-container git, *or* the interim read-only `FileDiffViewer` highlight from `Ticket.files: TicketFile[]` if the VS Code session isn't up — [features/07]). The user can **edit locally** in the VS Code session.
3. **Local edits are NOT synced to other clients in V1 (explicitly accepted).** The VS Code session is the user's own; edits in it are not broadcast through the realtime sync layer ([features/07] "edit locally — these edits are NOT synced in V1"). This is a deliberate V1 simplification.
4. **On "complete" at the LAST stage, the push happens THEN — by the user, INCLUDING their edits.** Completing the final stage is a [control-API] op the Conductor executes ([CONTROL_API §7]); it runs `git push` of the `DEV-####` branch (the agent's commits **plus** the user's local edits, committed) to the GitLab remote (`forge.repoHosting.push()`, [FORGE_ABSTRACTION §3], GitLab adapter only). **Push = on approval, from the last stage** — not continuously.
5. **GitLab returns the create-MR URL.** Pushing a non-default branch to GitLab makes the server print a **"create merge request" URL** (the standard `remote:` URL GitLab emits on push). The platform surfaces that **clickable create-MR URL** to the user.
6. **The user opens/creates/merges the MR ON GitLab.** The platform produces only the URL; the actual MR creation, review, and merge happen **on GitLab's own UI**. [BUILTIN_MR_REVIEW] (built-in diff/threads/approvals/merge) is therefore **mostly deferred** — V1 hands off to GitLab at the push boundary.

> **Why this shape:** it ships the smallest correct merge story (Rule 7b) — the editor + diff + push are ours; the merge governance is GitLab's. The [GIT_STRATEGY] serial-merge / rebase / conflict / revert machinery is **design horizon** for the future built-in mode; V1's "merge" is a `git push` + a GitLab link.

### 3.2 The per-stage edit-lock + pause + resume-with-changes-message flow

Each `PipelineStageCfg` carries a per-stage toggle **"may the user edit while this stage is active"** (in addition to the existing per-stage config: which tools/info the AI may use, model, skills/MCP, and the proceed-or-gate autonomy — [features/02], [GOLDEN_PLAN_STAGE], [features/03]).

- **Toggle ON** → the changes-page editor is editable while the stage runs.
- **Toggle OFF** → the changes-page editor is **read-only** ("stage active — changes disabled") **+ a Pause-the-AI button** is shown. The user cannot edit until they pause the AI.
- **Pause the AI** → a `pause` [control-API] op ([CONTROL_API §8], [features/24]); the Conductor parks the Stage-Agent PTY (container kept for `--resume`), status → `paused`. The editor unlocks for the user to make their edits in the VS Code session.
- **Resume-with-changes message** → when the user re-enables the AI (a `resume` [control-API] op), the system sends the Stage-Agent (via the `--resume` prompt, [07b §3]) a message: **"you may proceed; the user made these changes: \<the changes\>"** — the diff of what the user edited while paused is injected so the agent continues with awareness of the human edits. This reuses the existing reject-reopens-stage `--resume`-with-a-note machinery ([features/07] 07.q3, [GIT_STRATEGY §4]) — the "changes" are the note.

This stage-lock + pause/resume orchestrates **around** the in-container VS Code session (§3.1): the lock is a UI+control-API state, the pause is a real PTY park, the resume injects the human delta. The proceed-or-gate autonomy ([features/02]) decides whether a stage *promotes automatically* or *gates for human approval* — V1 ships that per-stage toggle; the auto-merge end of the [TRUST_SAFETY_UX] spectrum is deferred (§4).

### 3.3 The Workspace-AI instruction = consent + confirm-on-important model (scoped whitelist)

The per-user **Assistant** can drive **all workspace-relevant actions via natural language**. This **expands** feature 11's propose-only panel ([features/11]): in V1 the **user instruction itself = consent**, so the Assistant maps the instruction to a [control-API] action that **EXECUTES directly** — no separate accept step for ordinary actions — **EXCEPT** important/destructive actions, which still require an **explicit confirm**.

- **Mechanism (unchanged invariant):** the Assistant has **no write verb** (B-23 is structural, [01 §3.2]). "Execute directly" means the Assistant's interpretation produces a **[control-API] request** (the user's instruction is the authorization), which goes `preApiExecute` RBAC → enqueue → **Conductor writes** ([CONTROL_API §4 proposal bridge]). The Assistant never writes; the user's natural-language instruction stands in for the explicit Accept that feature 11 required.
- **The scoped whitelist** = the [CONTROL_API §8] operation catalogue, restricted to **workspace actions**: pause/resume, bulk move/status/assign/sprint/archive, quick-add, sprint create/edit, mark-read, raise-cap/edit-budget, skill-toggle, GitLab settings/verify/resync, role/member edits, the §3.1 complete/push. The Assistant is **scoped to this whitelist** and **NEVER host/system-level or out-of-workspace** — it cannot "delete system32", cannot reach the host shell, cannot touch another workspace (every orchestrator action runs under `runInTenant`, [04b §11c]).
- **Confirm-on-important (the exception to instruction=consent):** **delete workspace, remove member, kill (teardown a container), push / merge-trigger** require an **explicit confirm** before the [control-API] op is enqueued — a `menuHandler.confirm` (type-to-confirm for the destructive ones, mirroring [features/24] kill + [features/11] Resolved 2). RBAC still gates everything at `preApiExecute` ([CONTROL_API §5], D69: kill/pause-all/role/member = Admin+).

> **Net:** ordinary workspace actions = say it, it happens (instruction = consent). Destructive/irreversible actions = say it, then confirm. Out-of-workspace / host-level = impossible by scope.

### 3.4 The containers + SSH model (single host)

A **single self-hosted server** hosts everything: the orchestrator (containerized, on the `workspaces-net` bridge), the web-app replicas, Mongo, Redis, and the **per-ticket containers** ([07b §0/§5]). Per-ticket runtime ([07b]):

- **One container per ticket** ([07b §3], `Q-CT-UNIT`), a stage transition = a NEW `claude` PTY in the SAME container with freshly-rendered `.claude` config; container removed only at ticket teardown.
- **Managed-token-projection auth** ([07b §2], `Q-CT-AUTH`): `claude login` once on the host, a **read-only** `.credentials.json` + minimal `.claude.json` mounted per-container `CLAUDE_CONFIG_DIR`, ONE host refresh loop — never a whole-`~/.claude` bind-mount. **This is the load-bearing P0.5 spike prerequisite** ([P0_CLI_SPIKE §5b]).
- **Clone-into-volume** ([07b §4]) at the frozen `commitHash`; **dial-by-name networking** + `@id` Caddy routes ([07b §5]); **host forward-proxy egress** per-stage allow-list ([07b §6]); the **hardening table** ([07b §7], never `docker run` without limits); the **CapacityManager** admission gate ([07b §8]).
- **The in-container pty-agent REPLACES the dev host-shell** ([07b §9], `Q-PROD-TERMINAL`): it owns node-pty + durable scrollback, relayed over the existing `/pty` namespace reusing `ws-term:*` so `XtermTerminal.tsx` stays byte-identical. The old `ui-builder` repo has **no containers** — this is greenfield; the dev host-shell bridge (`server/hooks/workspacesTerminal.ts`) is the **seam to reuse**, its host-shell backend **replaced** (a hard prod boot-guard crashes if the dev host-shell flag is set without the container backend).
- **SSH to the host reaches a ticket-container terminal behind a per-open SSH-key gate** ([07b §9], B-05) — SSH lands on the host, the gate resolves a session to a *container* (not a host shell). The browser VS Code (§3.1) is exposed via Caddy; SSH is the lower-level escape hatch.

### 3.5 Real-time multi-user sync

Multiple people on the site see live state via the **proven raw-Node + Socket.io rooms/broadcaster pattern now shipped in `@luckystack`**:

- **Per-workspace room** (`workspace-<wsId>`) fan-out of Conductor-written state; **subscribe-first → snapshot → merge-on-`seq`** catch-up (B-22) on connect/reconnect so no event is lost in the subscribe gap ([CONTROL_API §6.3], [TESTING_STRATEGY] race test).
- **`ws-ai:*` per-user chat** ([features/11], [05 P1]): `chat`/`attach`/`detach`/`reply`/`control` client→server; `stream`/`status`/`event`/`needs-input`/`suggestion`/`notification`/`exit` server→client. The Assistant is per-user, suspended on disconnect.
- **The `/pty` namespace** ([07b §9]) relays terminal bytes (point-to-point, `term.`/`dev-` never load-balanced, G16).
- Every realtime *write* is still a Conductor write behind [control-API]; the client merges by `seq` and never locally mutates authoritative state ([CONTROL_API §6.3], B-30). Note the §3.1 exception: **VS Code local edits are NOT synced** in V1.

### 3.6 Push notifications (the phone approve loop)

**PWA-first, no native** ([CLIENT_AND_PUSH], `Q-CLIENT-SHELL`):

- The web-app is an **installable PWA** (manifest + service worker); offline = read-only cached board/tickets/notifications (no offline writes — that would be a second writer).
- **Web-push pipeline:** operator generates a **VAPID** keypair once ([08]); each device registers a `PushSubscription` via a `push-subscribe` [control-API] op (B-34, [04b §10]). When the Conductor writes a `Notification`, it fans out a **redacted** push (title + "open to view" — **D80 reversed**, `Q-SEC-NOTIF-PUSH`).
- **The service worker renders the redacted payload; the full body is fetched IN-APP behind auth** on tap ([CLIENT_AND_PUSH §5.5]) — the OS notification store never sees secret-bearing `needs-input` bodies (Rule 19).
- **Answer / approve from the lock screen:** a `needs-input`/promote push deep-links into the PWA where the [features/09] one-question-per-screen cards render; **Approve == Promote** ([features/07], [features/09]). Notification actions are **deep-link + pre-armed approve** (one more tap, full body shown), not a blind background approve (`Q-CLIENT-NOTIF-ACTIONS`).
- Only high-signal classes push (`needs-input` always, `container-failure` loud); per-(user,type) debounce kills storm-buzzing ([CLIENT_AND_PUSH §8]). **Preview-deploys + analytics are OUT** of V1 (§4).

### 3.7 CI (none on our side in V1)

**Workspaces builds and triggers no CI in V1.** If the GitLab project has its own CI, GitLab runs it **on GitLab's side** when the user pushes (§3.1) / creates the MR — entirely outside our platform. We do **not** implement the [BUILTIN_CI_PIPELINES] container-job runner, the `PipelineRunner` interface, or the [GIT_STRATEGY §5] CI-merge-gate. The only CI a V1 user sees is GitLab's own, on GitLab.

---

## 4. The explicit DEFERRED list (designed-but-not-built in V1)

Each item: **why deferred** + **where its design lives** (so a future lane can pick it up without re-deriving).

| Deferred | Why deferred (one line) | Design lives in |
|---|---|---|
| **Multi-provider AI** (driver interface, capability registry, `providerKey`, metered billing) | Parked — no 2nd provider to validate the abstraction; would over-engineer a parked feature (Rule 7b). V1 builds only the single-spawn wrapper. | [MULTI_PROVIDER_SEAM]; `Q-MP-*` in [REVIEW_AND_OPEN_QUESTIONS §B] |
| **GitHub forge** | GitLab is the only V1 path; GitHub is the 2nd `forge`-SoT impl that *validates* the seam but isn't needed until a GitHub team is. | [FORGE_ABSTRACTION §9] (design-now/build-later, `Q-FORGE-GITHUB`) |
| **Built-in git-server container** | V1 runs *on top of* external GitLab; hosting git ourselves is the all-in-one mode, not the first setup. | [FORGE_ABSTRACTION §7.1] (`Q-FORGE-GITHOST` → git-server container chosen for the *future* built-in mode) |
| **Forge-mode switching** | One forge (GitLab) per workspace, immutable in V1; switching is a heavy migration. | [FORGE_ABSTRACTION §6] (`Q-FORGE-MODE-SWITCH`) |
| **Built-in MR entity / on-platform merge / approvals / auto-merge** | V1 = push-on-approval → GitLab create-MR-URL; merge governance is GitLab's (§3.1). Auto-merge is the far end of the autonomy spectrum, deferred with the MR entity. | [BUILTIN_MR_REVIEW], [FORGE_ABSTRACTION §7.2], [GIT_STRATEGY] (serial merge/rebase/conflict/revert), [TRUST_SAFETY_UX] (`Q-TRUST-AUTONOMY` auto-merge) |
| **Built-in CI** | None on our side in V1; GitLab runs its own CI (§3.7). | [BUILTIN_CI_PIPELINES], [FORGE_ABSTRACTION §8], [GIT_STRATEGY §5] (`Q-FORGE-CI-RUNNER`, `Q-CI-*`) |
| **Preview-deployments** | Live `dev-<ticketId>` PROD app stacks add heavy per-ticket cost; V1 ships the editor/diff, not a running preview. | [features/23], [07b §11] (`Q-PREVIEW-COST`) |
| **Product-analytics** | Cycle-time/throughput/cost dashboards are post-MVP insight; the event log they fold over ships in V1, the analytics surface does not. | [PRODUCT_ANALYTICS]; `Q-ANALYTICS-*` in [REVIEW_2] |
| **Voice input** | A convenience over the existing text composer; the composer is the documented fallback. | [features/06] (D5, build deferred); [features/11 Deferred] |
| **Semantic-search / rich command-palette** | V1 uses client-side filter over the user's tickets/signals/suggestions; the indexed semantic surface is later. | [features/21]; [GRAPHIFY_INTEGRATION] (the call-graph/MCP upgrade path) |

The **single-spawn wrapper** ([MULTI_PROVIDER_SEAM §v1]) and the **`ForgeProvider` seam shape** ([FORGE_ABSTRACTION §3]) are the two cheap "design-now" insurances V1 *does* build (one Claude impl / one GitLab impl behind a one-callsite seam) — everything else in this table is documentation only until its lane is opened.

---

## 5. How to read the docs as V1 (V1_SCOPE wins on conflict)

The doc set was written at the **design horizon** — it deliberately over-describes a bigger system so the future build has a spec. When you build V1:

1. **V1_SCOPE (this file) is the authority on *what ships*.** If [FORGE_ABSTRACTION] describes three forges, [BUILTIN_MR_REVIEW] describes an on-platform merge, [BUILTIN_CI_PIPELINES] describes a CI runner, [TRUST_SAFETY_UX] describes auto-merge, [PRODUCT_ANALYTICS]/[features/23]/[features/06] describe analytics/preview/voice — and this file marks them **OUT** (§4) — **they are OUT.** Build only the IN column (§2) + the §3 flows.
2. **The other docs remain the authority on *how* the IN pieces work.** For an included piece, this file points at its owning build-doc and that doc's mechanics govern: [07b] for containers, [CONTROL_API] for writes, [04b] for persistence, [GOLDEN_PLAN_STAGE] for the config renderer, [P0_CLI_SPIKE] for the gate, [CLIENT_AND_PUSH] for push, [MIGRATION] for the prototype→real port. V1_SCOPE selects the *what*; those docs supply the *how*.
3. **The two overrides where V1 deviates even from the all-in-one decisions:**
   - The all-in-one round ([REVIEW_2 §F4], `Q-TRUST-AUTONOMY`) *expanded* the MR into a built-in surface with auto-merge. **The locked V1 scope overrides that**: no built-in MR, no on-platform merge, no auto-merge — V1 is push-on-approval → GitLab create-MR-URL (§3.1). The all-in-one MR/CI/auto-merge design is the future built-in mode, not V1.
   - Feature 11's Assistant is **propose-only** (accept-then-execute). **V1's Workspace-AI is instruction=consent** (execute-directly, confirm-on-important) (§3.3) — still verb-free / Conductor-only-writer, but the user's instruction replaces the separate Accept for ordinary actions.
4. **When in doubt, the precedence is:** locked V1 scope (this file's §2/§3/§4) → [REVIEW_AND_OPEN_QUESTIONS] + [REVIEW_2] decided answers → the build-docs' mechanics → [00_SPEC_RECONCILIATION] for any `handoff/`-vs-`_docs` conflict. Never re-instate a deferred surface to "complete" a feature (Rule 22 / [P0_CLI_SPIKE] anti-recommendation: don't route around a gate).

---

## 6. The four build lanes (non-overlapping) + Phase 0

V1 is built as **4 non-overlapping lanes** (4 separate AI sessions, each may use ultracode, must NOT overlap files), preceded by a **Phase 0**. Non-overlap is enforced by **B publishing the schema/types first** + **A the control-API contracts**, then A/C/D build against those contracts in distinct directories.

| Phase / Lane | Owns | Key docs |
|---|---|---|
| **Phase 0** | The **P0.5 CLI billing spike** ([P0_CLI_SPIKE], GATES the build) + the shared types/contracts/scaffolding. | [P0_CLI_SPIKE], [05], [CONTROL_API], [04b] |
| **A — Engine & Orchestrator** | Server orchestrator + engine + PTY + containers/pty-agent/SSH + control-API **write-handlers** + GitLab push/create-MR-URL + the P0 spike. | [01], [07], [07b], [CONTROL_API], [FORGE_ABSTRACTION] (GitLab only), [MULTI_PROVIDER_SEAM §v1] |
| **B — Data, tenancy & sync-backend** | Prisma schema incl. [04b] §6–§11, `runInTenant`, the seq/merge-on-seq event-log + sync backend, migration/bootstrap, seed. | [04], [04b], [MIGRATION], [TESTING_STRATEGY] |
| **C — Frontend app & realtime-client** | The board/tickets/pipeline UI (reusing the prototype screens), the Assistant chat, realtime sync client, PWA+push, notifications, account/auth UI. | [features/11/12/13/17/18], [CLIENT_AND_PUSH], [05 P1] |
| **D — Code-editor & changes/config** | The [openvscode-server] integration + the changes page (diff/highlight/edit) + stage-lock/pause/resume + per-stage config UI + the [GOLDEN_PLAN_STAGE] renderer + prompts. | [features/07/08/02], [GOLDEN_PLAN_STAGE], [features/03] |

**Lane gating:** Phase 0's P0.5 spike must be GREEN (or GREEN-WITH-WORKAROUND) before the container-touching work starts — **the spike gates Lane A2–A9 + D3+** ([P0_CLI_SPIKE §7], [BUILD_ORDER §6.1]); **Lanes B and C and A1 and D1–D2 are NOT spike-gated** and proceed against frozen *contracts* (the control-API shapes, the schema, the `ws-ai:*` contract) once B publishes the schema/types and A the control-API contracts.

---

## 7. Self-check (V1 invariants)

- **No new verbs** — this file scopes over the frozen 7+6 surface ([02 §2]); it adds none.
- **No new entities / no new scope** — every IN row reuses an existing build-doc's models; every OUT row cites where its design already lives.
- **B-23 preserved** — AI proposes / instruction=consent maps to [control-API]; the **Conductor is still the only writer** ([01 §3.3], [CONTROL_API §7]). The Workspace-AI's "execute directly" is a [control-API] request, never a write verb (§3.3).
- **Single forge (GitLab), single provider (Claude PTY), single host, single-instance orchestrator** — every multi-* surface is OUT (§4) and cited.
- **`runInTenant` on every orchestrator-side path** — the Assistant is scoped to its workspace; never host/system/out-of-workspace (§3.3).
- **The P0.5 spike gates the build** — billing/PTY/auth must be proven before the container lanes spend effort (§1, [P0_CLI_SPIKE]); a billing/PTY RED escalates, never routes to headless.
- **V1_SCOPE wins on conflict** with any doc that over-describes beyond V1 (§5); the build-docs still govern the *how* of every IN piece.
- This doc **edits no existing file** — it is the new single-source-of-truth master doc the AI is pointed at first.
