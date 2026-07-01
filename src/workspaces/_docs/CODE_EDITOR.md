# CODE_EDITOR — the V1 code editor: a real 1:1 VS Code in the browser, inside the ticket container

> **The marquee user-facing requirement, made concrete.** "A REAL, 1:1 VS Code experience in the browser — with account-linked VS Code extensions and multi-language LSP" is a hard V1 requirement ([V1_SCOPE §2 "Code editor"], §3.1). This doc is the build-grade design for it. It selects **openvscode-server running INSIDE the ticket container, exposed over a per-ticket Caddy subdomain** as the V1 target, demotes the prototype **ui-builder Monaco** to a documented reference + optional read-only fallback, and wires the editor into the changes-page review flow ([features/07]), the editor mount contract ([features/08]), and the per-stage edit-lock / pause / resume orchestration ([V1_SCOPE §3.2]). It is the build guide for **Lane D** ([V1_SCOPE §6]). Prereq read: [V1_SCOPE], [07b] (the container + Caddy proxy the editor lives in), [features/07], [features/08]. Codes resolve via [REFERENCE_CODES]. Last updated: 2026-06-04.
>
> **Authority.** [V1_SCOPE] is the source of truth for *what ships*; this doc supplies the *how* for the "Code editor" IN-row (V1_SCOPE §5.2). Where [features/08]'s "external UI-Builder mounted as a React component" framing (D3/D7, 08.q1) conflicts with the locked V1 decision, **V1_SCOPE wins**: the V1 editor is **server-side VS Code in the container**, not an in-repo Monaco component. The ui-builder Monaco is kept exactly as [V1_SCOPE §2] specifies — **reference + optional fallback**, NOT the target. This doc records that demotion explicitly (§2).
>
> **No new verbs.** This is a runtime/UI doc. It adds zero structured-channel verbs. Every write rides the frozen surface: file reads via `query_context` ([02 §2]); editor exposure / lock / pause / resume / complete-and-push are **Conductor actions behind [control-API]** ([CONTROL_API §8]); the agent never gets a write verb (B-23). VS Code local edits in V1 are **not** synced ([V1_SCOPE §3.1 step 3]) — they ride along only at the push-on-approval boundary (§5).

---

## §0. The editor, in one paragraph

When a ticket enters an `aiEnabled` stage it already has **one container** with its `DEV-####` branch cloned into a volume at the frozen `commitHash` ([07b §3/§4]). V1 runs **[openvscode-server]** (recommended; **[code-server]** is the documented alt) as a process **inside that same container**, serving a full browser VS Code over a **per-ticket Caddy route** `vscode-<ticketId>.<domain>` — the identical `@id`-route + dial-by-name-on-`workspaces-net` mechanism the `dev-`/`term-` subdomains already use ([07b §5]). Because VS Code runs *in* the container on the real cloned repo, the user gets — for free — **native git-diff / changed-file decorations** (real git, not a synthesized `TicketFile[]` list), **native multi-file editing + terminals**, **multi-language via LSP**, and **account-linked VS Code extension install**. The changes page ([features/07]) is this VS Code, opened on the worktree with the stage's changed files spotlit. The per-stage **edit-lock** makes it **read-only** ("stage active — changes disabled") with a **Pause-AI** button when the active stage forbids edits; on **resume** after the user edits, the orchestrator injects "you may proceed; the user made these changes: \<diff\>" into the agent's `--resume` ([V1_SCOPE §3.2]). On **complete** at the last stage the user's local edits are committed and pushed *with* the agent's commits, and GitLab returns the create-MR URL (§5). The **ui-builder Monaco** ([ui-builder/src/sandbox/...]) is kept as a reference for the React/TS-support + custom-theme plumbing and as an optional **read-only inline-diff fallback** when no VS Code session is up — it is **not** the V1 editor (§2).

---

## §1. The recommendation — server-side VS Code in the ticket container

### 1.1 Decision: openvscode-server (rec) / code-server (alt), in-container, Caddy-proxied

| Option | What it is | V1 verdict |
|---|---|---|
| **[openvscode-server]** (Gitpod) | The upstream VS Code server, the *same* server-half the Remote-SSH / Codespaces split uses, packaged to run standalone and serve the workbench over HTTP/WS. Closest to "real VS Code"; uses the **open-vsx** extension marketplace. | **RECOMMENDED.** Closest 1:1 to desktop VS Code (same workbench build), native git SCM decorations, native integrated terminal, LSP via extensions, account-linkable extension set. |
| **[code-server]** (Coder) | A repackaging of VS Code as a long-running server with its own auth/proxy conveniences. Mature, batteries-included reverse-proxy story. | **ALT / fallback.** Slightly further from upstream; pick it only if openvscode-server's build/extension story blocks in the spike (Q-EDITOR-SERVER). |
| **ui-builder Monaco** (in-repo prototype) | A single-file in-browser Monaco with hand-injected React type defs, hand-built TextMate themes, hand-built autocompletions. | **REFERENCE + optional read-only fallback only** (§2). Not the V1 target. |

Both server options run **as a process inside the L3 ticket container** (not a separate container, not on the host) — the container already holds the cloned repo at the frozen commit, the real `git`, the project toolchain (L1/L2 image, [07b §1]), and the env-file ([07b §6.3]). The editor's "filesystem" *is* the worktree the agent edits, so git decorations, terminals, and LSP all see exactly the agent's tree with zero sync layer.

### 1.2 How it is served — reuse the Caddy proxy, exactly like dev-/term-

The editor reuses the **per-container Caddy route lifecycle** already specified for `dev-<ticketId>` ([07b §5.3]) — no new mechanism:

- The orchestrator starts openvscode-server inside the container on a **fixed in-container port** (e.g. `:3000`, bound `127.0.0.1` inside the container's namespace, never host-published — [07b §7]).
- On editor-open it **POSTs a Caddy route with an explicit `@id route-vscode-<ticketId>`** → `reverse_proxy <containerName>:3000`, and **DELETEs by that id** on teardown. This is the same `@id`-keyed, crash-safe, boot-reconciled route pattern as `dev-`/`term-` ([07b §5.3]); it inherits the boot-time Caddy↔state reconcile under the Redis lease, so a crash mid-POST/DELETE self-heals.
- **`vscode-<ticketId>` is NEVER load-balanced** — it is a single upstream pinned to the one ticket container, exactly like `term-`/`dev-` (G16: terminal/preview/editor WS are point-to-point host-bound state; only `app.` is an LB pool, [07b §5.3 table]). The workbench's WebSocket (the workbench↔server channel) requires this pin.
- **TLS** comes for free from the existing two-track Caddy story ([07b §5.4]): DNS-01 wildcard `*.<domain>` (public) or internal-CA (LAN). No per-editor cert work.
- **Auth at the edge:** the route is reachable only behind the workspace's authenticated session; the editor URL is minted per (user, ticket) and the same RBAC that gates the ticket gates the editor (Q-EDITOR-EDGE-AUTH). openvscode-server's own connection-token is set by the orchestrator at launch and injected via the route, so a leaked subdomain alone is not an open editor.

> **Add one row to the [07b §5.3] subdomain table** (no mechanism change):
>
> | Subdomain | Upstream | LB? | When |
> |---|---|---|---|
> | `vscode-<ticketId>.<domain>` | the ticket container's openvscode-server **:3000** | **no** — single upstream | per-editor-open POST / per-teardown DELETE by `@id` |

### 1.3 The resource tradeoff, stated honestly

Server-side VS Code is **heavier** than the Monaco path — this is the real cost, recorded so the CapacityManager budget is correct:

- **Per-session memory:** a workbench server + its language servers (the TS server alone is ~200–500 MB on a large repo; add LSPs per language) lands roughly **+300–800 MB per active editor**, on top of the agent's own footprint. This draws from the **same shared CapacityManager budget** as worker/preview containers ([07b §8.2]) — it is **not** a free overlay. The editor server is **lazy**: started only on first editor-open for the ticket, idle-stopped after a no-attach window, restarted on next open (Q-EDITOR-LIFECYCLE; default: stop the editor server when no client has been attached for `EDITOR_IDLE_MIN` minutes, keep the container).
- **CPU:** LSP indexing on first open is bursty; it competes with the agent's turn for the container's `--cpus 2` ([07b §7]). The concurrency model (§7) makes one side read-only at a time, which bounds this.
- **Cold start:** first open pays workbench boot + LSP index (seconds to tens of seconds on a big repo). Subsequent opens within the idle window are warm.

**Why it's still the right V1 call:** the requirement is explicitly *real* VS Code with *account-linked extensions* and *multi-language LSP* ([V1_SCOPE §2]). Monaco gives none of those without re-implementing the workbench, the SCM/diff gutter, the extension host, and an LSP bridge by hand — the ui-builder reference (§2) shows exactly how much hand-plumbing even *basic* TS+theme support costs. The honest tradeoff is **RAM/CPU for a true editor**; V1 buys the editor and pays the RAM, gated by CapacityManager so the host never over-subscribes.

---

## §2. How the ui-builder Monaco work is REUSED (reference + optional fallback)

The ui-builder Monaco is **not deleted and not the target** — [V1_SCOPE §2] keeps it as (a) a *documented reference* for the hard parts of bootstrapping an in-browser editor, and (b) an *optional lightweight read-only inline-diff fallback*. Both roles are real; neither is the primary V1 editor.

### 2.1 As a REFERENCE — what it proves and where it lives

The reference is `ui-builder/src/sandbox/_components/editor/BaseCodeEditor.tsx` + `ui-builder/src/sandbox/_functions/codeEditor/*`. It is a **single-file, in-memory** `@monaco-editor/react` editor that had to **hand-build everything a real VS Code gives for free** — which is precisely why it is kept as the cautionary reference for "how hard the Monaco path is":

| Hard part the reference solves by hand | File | What a real VS Code gives for free |
|---|---|---|
| **React/TS language support** — inject React type defs as virtual libs (`addExtraLib` with `file:///node_modules/@types/react/...`), set TS compiler options (ESNext, `jsx: ReactJSX`, `isolatedModules`, …) | `_functions/codeEditor/compilerOptions.ts` | the real `@typescript/vscode` extension + the project's own `tsconfig` + installed `@types`, resolved from the worktree's `node_modules` |
| **Custom themes** — load VS Code TextMate `.tmLanguage`/theme JSON, tokenize via **onig.wasm** (oniguruma), map TextMate scopes → Monaco token rules, `defineTheme('trae-dark')` | `_functions/codeEditor/themes/themes.ts` + `themes/*.json` + `themes/onig.wasm` | native theme + TextMate grammar engine built into the workbench |
| **Autocompletions** (JSX, React hooks, user components) and **Tailwind** class suggestion + inline color icons | `_functions/codeEditor/autocompletions/*`, `_functions/codeEditor/tailwindcss/*` | real extensions (Tailwind CSS IntelliSense, etc.) installed account-linked (§6) |
| **Hover tooltips, click-to-traverse component** | `_functions/codeEditor/hoverTooltip.ts`, `traverseClickedComponent.ts` | LSP hover/definition for free |

**The lesson encoded for the builder:** reproducing even *single-language* TS+theme support in Monaco took an onig.wasm tokenizer, a TextMate→Monaco scope mapper, hand-maintained virtual `.d.ts` libs, and per-feature completion providers — none of which generalize to "multi-language LSP" or "account-linked extensions." That is the concrete justification for choosing server-side VS Code (§1) over growing the Monaco prototype. **Do NOT try to grow the Monaco prototype into the V1 editor** ([features/08] D7 anti-pattern, restated here for V1).

### 2.2 As an OPTIONAL read-only inline-diff FALLBACK

When **no VS Code session is up** (editor server not yet started, cold-start in progress, CapacityManager queued the editor, or the ticket has no live container), the changes page degrades to a **read-only inline-diff fallback** rather than a blank pane:

- The fallback is the existing read-only **`FileDiffViewer` / `DiffView`** ([features/07] §interim, [features/08] interim) — a GitLab-MR-style changed-files list + inline `correct`/`wrong`-wash diff rendered from **`Ticket.files: TicketFile[]`** (`path/add/del/diff`), at the frozen `commitHash` ([02 §4]). It needs **no container** and **no LSP** — it reads the diff the orchestrator already has from the `PostToolUse(Edit/Write)` → `file-change` `TicketEvent` stream ([02 §3]).
- It is **read-only by definition** — it is a viewer, not an editor; editing always requires the real VS Code session (§7). It carries the [features/07] stepper + baseline toggle host controls (whole-ticket vs stage-delta, D10) since those are host-side, not editor-internal.
- A small Monaco *inline-diff* widget (reusing `BaseCodeEditor` in `DiffEditor`/read-only mode) is an **acceptable richer fallback** than `FileDiffViewer` if the builder wants syntax-highlit diffs without a container — this is the *only* V1 use of the ui-builder Monaco code in shipping product, and it is **read-only** (Q-EDITOR-FALLBACK; default: `FileDiffViewer` is the floor, the Monaco read-only diff is an optional upgrade of the fallback, never an editor).

> **Net:** Monaco = reference (how the hard parts work) + an optional read-only diff fallback. openvscode-server = the editor. The two never both *edit*.

---

## §3. The changes-page integration — full codebase + changed-files highlighted, edit locally (not synced)

The **CHANGES page** ([features/07]) is the openvscode-server session opened on the ticket worktree, configured to spotlight the stage's changes. This is the [features/08] "full VS Code editor" surface ([features/08] D7) realized as the real thing.

1. **Full codebase, real tree.** The user sees the whole repo — the actual cloned worktree in the container — in the native VS Code explorer, with native search-in-tree / search-in-file, multi-tab, syntax highlight, all from the workbench. No host pagination, no synthesized tree ([features/08] 08.q5: tree virtualization is the editor's job; here it's VS Code's).
2. **Changed files highlighted via NATIVE git decorations.** Because the container has the real `git` and the `DEV-####` branch, VS Code's built-in **SCM / git decorations** color changed files in the explorer and show the gutter diff automatically — no `setChangedFiles(TicketFile[])` paint needed (that prop was the [features/08] contract for an *external* editor that couldn't see git; the in-container VS Code sees git directly). The host's only job is to **open the changes page already focused** on the changed set:
   - The host computes the changed-file list from the stage's `commitHash` (whole-ticket diff vs branch-base by default; the [features/07] **baseline toggle** flips to per-stage delta `prevStage.commitHash..thisStage.commitHash`, [features/07] 07.q1) and **deep-links VS Code** to the first changed file (open-file URL param / a tiny companion that calls the workbench's open-file API on launch). The [features/07] **prev/next stepper** walks the changed-file set by issuing successive open-file deep-links.
   - The **fallback** path (§2.2) is what paints `setChangedFiles(...)` from `Ticket.files` — that contract survives only for the no-container `FileDiffViewer` mode.
3. **The user edits locally — and edits are NOT synced in V1 (explicitly accepted).** The VS Code session is the user's own connection to the container; edits land directly on the worktree on disk. They are **not** broadcast through the realtime sync layer to other clients ([V1_SCOPE §3.1 step 3], [features/07]) — a deliberate V1 simplification. Two people opening the same ticket's editor each drive the *same* container worktree (it's one filesystem), but there is **no co-editing model, no presence-in-buffer, no operational-transform** ([features/08] 08-out: no collaborative cursors in v1). The realtime sync layer ([V1_SCOPE §3.5]) still carries board/ticket/status state by `seq`; the editor buffer is simply outside it.

> **Why no sync:** building CRDT/OT multi-user buffer sync is a large surface for a self-hosted small-group V1 (Rule 7b). The worktree is shared at the filesystem level (last-write-wins on disk); concurrent human editors are an accepted, documented rough edge for V1 (Q-EDITOR-MULTIUSER), bounded in practice because the *agent* is the other writer and §7 keeps one side read-only at a time.

---

## §4. The stage-active edit-lock — read-only + Pause-AI, resume-with-changes

Each `PipelineStageCfg` carries the per-stage toggle **`userMayEdit`** ("may the user edit while this stage is active") alongside the existing per-stage config (tools/info/model/skills/MCP/proceed-or-gate autonomy — [features/02], [GOLDEN_PLAN_STAGE], [features/03]). The editor orchestrates **around** the VS Code session — the lock is a host UI + control-API state, not an editor-internal mode:

| Active stage state | Changes-page editor | Controls shown |
|---|---|---|
| `userMayEdit = true` | **editable** — the VS Code session is read-write while the stage runs | normal |
| `userMayEdit = false`, stage **running** | **read-only** — banner **"stage active — changes disabled"** | a **Pause-AI** button |
| `userMayEdit = false`, stage **paused** (user paused) | **editable** — the user makes edits in the VS Code session | a **Resume-AI** button |

**Mechanism (all on the frozen surface):**

- **Enforcing read-only on a server-side VS Code.** The workbench can't be trusted to self-enforce read-only (the user owns their browser), so the lock is enforced where it's real: (a) the host renders the changes page with the editor framed read-only + the banner and **withholds the Pause-AI-gated write affordances**, and (b) authoritative enforcement is that **while a `userMayEdit=false` stage is `running`, the agent owns the worktree and the user's editor connection is opened in VS Code's read-only mode** (open the folder with the workbench's read-only setting, or mount the user's view at a read-only bind of the worktree). Definitive enforcement is the **filesystem-level**: a write the user smuggles in while the agent holds the worktree is a race the §7 concurrency model forbids — the only *sanctioned* user-write window is after `pause`. (Q-EDITOR-READONLY-ENFORCE — see §9.)
- **Pause** → a `pause` [control-API] op ([CONTROL_API §8], [features/24]): the Conductor parks the Stage-Agent PTY (container kept for `--resume`), `AgentSession` → `paused`. **Now** the user's VS Code session is switched to read-write and the agent is not touching the tree → the user edits safely.
- **Resume-with-changes** → a `resume` [control-API] op: before re-attaching the agent, the orchestrator **captures the diff of what the user edited while paused** (a `git diff` on the worktree against the pre-pause state) and **injects it into the agent's `--resume` prompt**: **"you may proceed; the user made these changes: \<the diff\>"**. This **reuses the existing reject-reopens-stage `--resume`-with-a-note machinery** ([features/07] 07.q3, [GIT_STRATEGY §4]) — the "note" is the user's diff. The agent continues aware of the human edits; `AgentSession` → `busy`; the editor returns to read-only ("stage active — changes disabled").

This is identical in shape to the reject loop ([features/07] 07.q3: a reject re-opens the stage and `--resume`s the same agent with the reject note) — the pause/edit/resume flow is "the note is a diff." The **proceed-or-gate autonomy** ([features/02]) is orthogonal: it decides whether a stage *promotes automatically* or *gates for approval*; the edit-lock decides whether the *user* may touch the tree while it runs. V1 ships both toggles; the auto-merge end of the [TRUST_SAFETY_UX] spectrum is deferred ([V1_SCOPE §4]).

---

## §5. How the user's edits ride along on the push-on-approval

V1 has **no built-in MR, no on-platform merge, no continuous push** ([V1_SCOPE §3.1]). The push happens **once, at completion of the last stage**, and the user's local VS Code edits go **with** it:

1. The user reviews on the changes page (§3) and, on the **last** stage, clicks **complete** — a [control-API] op the Conductor executes ([CONTROL_API §8], the §3.1 complete/push op).
2. Before push, the Conductor **commits any uncommitted user edits on the worktree** (the edits made in the VS Code session that aren't already committed) onto the `DEV-####` branch, **alongside** the agent's commits. So the pushed branch = agent commits **+** the user's local edits, as one branch tip ([V1_SCOPE §3.1 step 4]).
3. The Conductor runs `git push` of `DEV-####` to the GitLab remote (`forge.repoHosting.push()`, [FORGE_ABSTRACTION §3], GitLab adapter only).
4. GitLab's push response prints the **"create merge request" URL** (the standard `remote:` URL GitLab emits when you push a non-default branch). The platform surfaces that **clickable create-MR URL** to the user ([V1_SCOPE §3.1 step 5]).
5. The user opens/creates/merges the MR **on GitLab's own UI**. The platform produced only the URL; merge governance is GitLab's ([V1_SCOPE §3.1 step 6]). [BUILTIN_MR_REVIEW] is therefore mostly deferred ([V1_SCOPE §4]).

> **Why push-on-approval, not continuous:** the editor + diff + the user's edits are *ours*; the merge is GitLab's. The user's VS Code edits are not synced mid-flight (§3) precisely because they only need to exist on the branch at the **single push moment** — committing them at complete-time is the one place they leave the container.

---

## §6. Account-linked extensions + multi-language LSP — a first-class V1 feature

This is the requirement that most distinguishes the VS Code path from Monaco, and it is **IN for V1** ([V1_SCOPE §2 "account-linked VS Code extensions and multi-language support (LSP)"]).

### 6.1 Multi-language via LSP — free from the workbench

Because the editor is a real VS Code server in a container that has the project toolchain (L1 glibc base + per-project L2, [07b §1]), **LSP is what VS Code does natively**: install a language's extension and its language server runs in the workbench's extension host, indexing the worktree's real `node_modules` / `go.mod` / `.csproj`. No hand-injected `addExtraLib` virtual defs (the Monaco reference's approach, §2.1), no per-language completion providers to maintain. TS/JS, Python, Go, Rust, C#, etc. each work via their standard extension + the toolchain baked into L1/L2.

### 6.2 Account-linked extensions — how they attach per user account

The user requirement is that extensions are **linked to the user's account**, so the same extension set follows them across every ticket editor they open. The model:

- **Extension marketplace:** openvscode-server uses **[open-vsx]** (the open marketplace). The operator may also self-host an open-vsx mirror for air-gapped installs (Q-EDITOR-MARKETPLACE).
- **Per-user extension set, server-rendered into the session.** Each Workspaces user has an **`editorExtensions: string[]`** profile (a list of extension ids) stored on their account ([features/17 account] adjacent; persisted in the data layer, Lane B). When an editor session launches for `(user, ticket)`, the orchestrator **renders that user's extension set into the container's openvscode-server extensions dir** at launch (install-by-id from open-vsx into the per-session `--extensions-dir`, or projects a per-user extensions volume into the session). So a user who has "Tailwind IntelliSense + GitLens + Python" gets exactly those in *every* ticket editor, with **no per-ticket reconfiguration** — the extensions are linked to *them*, not the ticket.
- **Where the set is edited:** the user manages `editorExtensions` from their **account/editor-settings UI** (Lane C/D), or — V1 default — by **installing inside any live editor session and persisting the result back to their account** (on extension install in-session, the orchestrator captures the new id into `editorExtensions` so it survives to the next session). (Q-EDITOR-EXT-PERSIST — default: capture in-session installs back to the account so the linkage is automatic; an explicit settings list is the manual alternative.)
- **Isolation:** extensions run in the session's extension host inside the **hardened container** ([07b §7]) with the **egress proxy** allow-list ([07b §6]) — an extension cannot exfiltrate the projected subscription token any more than the agent can; the marketplace domain (open-vsx / mirror) is on the editor stage's allow-list, everything else denied.

> **The single load-bearing reason for the VS Code path:** §2.1 shows reproducing *one* language + *one* theme in Monaco took an onig.wasm tokenizer + hand-maintained `.d.ts` + custom providers. "Account-linked extensions across many languages" is **only** achievable with a real extension host — i.e. the server-side VS Code. This feature is why V1 pays the RAM cost (§1.3).

---

## §7. The concurrency model — agent and user on the same worktree

The Stage-Agent (`claude` in the container, [07b §3]) and the user's VS Code session operate on the **same worktree in the same container** ([07b §4]). The hazard is two writers on one filesystem. V1's rule: **exactly one side may write at a time, decided by stage state.** No locking primitive, no merge — the stage lifecycle *is* the lock.

| Stage state | Agent (claude PTY) | User (VS Code session) | Who writes |
|---|---|---|---|
| stage **running**, `userMayEdit = true` | read-write (doing the work) | **read-write** (user opted to allow concurrent edits) | **both** — accepted last-write-wins on disk; the user opted in via the toggle (the riskier mode, surfaced as the explicit `userMayEdit=true` choice) |
| stage **running**, `userMayEdit = false` | read-write (owns the tree) | **read-only** ("stage active — changes disabled") | **agent only** |
| stage **paused** (after Pause-AI) | parked, not touching the tree | **read-write** (the sanctioned user-edit window) | **user only** |
| stage **done** (awaiting promote / on the changes page) | PTY stopped for that stage | **read-only review** (edits require re-entering an editable state, i.e. the next stage's `userMayEdit` or a pause) | **neither** (review) |
| **no live container / editor cold-starting** | n/a | **read-only fallback** (`FileDiffViewer`, §2.2) | **neither** |

- **The safe default is `userMayEdit = false`** — agent owns the tree while it runs; the user edits only in the **paused** window, and those edits are fed back via the resume-with-changes diff (§4). This is the model V1 recommends as the per-stage default.
- **`userMayEdit = true` is the explicit opt-in to the concurrent-write mode** — last-write-wins on disk with no merge. It exists because some stages (e.g. a long review stage) genuinely want the human editing live; the toggle makes the risk a deliberate per-stage choice, not a surprise. (Q-EDITOR-CONCURRENT-WRITE.)
- **Why no real lock:** a filesystem advisory lock between a PTY process and a workbench server is brittle and out of V1 scope; the **stage state machine is the coordination primitive** (Rule 7b — the smallest correct model). The pause is a *real* PTY park ([CONTROL_API §8] `pause`), so the agent provably isn't writing during the user's window — that's the enforcement, not a lock file.
- **`runInTenant`** wraps the editor-session launch, the route POST/DELETE, and the resume-diff capture (every orchestrator-side path, [07b §12], [04b §11c]).

---

## §8. Build checklist — the V1 editor is correct when…

- [ ] **openvscode-server runs INSIDE the ticket container** (rec; code-server as alt), on a fixed in-container port, never host-published (§1.1, §1.2).
- [ ] **Served via a per-ticket `vscode-<ticketId>` Caddy route** with an explicit `@id`, POST-on-open / DELETE-on-teardown, **single upstream, never load-balanced**, boot-reconciled under the Redis lease — exactly the `dev-`/`term-` pattern ([07b §5.3], §1.2).
- [ ] **Edge auth + connection-token** gate the editor URL per (user, ticket) under the ticket's RBAC (§1.2, Q-EDITOR-EDGE-AUTH).
- [ ] **Editor server is lazy + idle-stopped**; its memory draws from the shared **CapacityManager budget** ([07b §8.2]); the +300–800 MB/session cost is budgeted, not free (§1.3, Q-EDITOR-LIFECYCLE).
- [ ] **Changed files shown via native git decorations** (real in-container git), host deep-links to the first changed file + drives the prev/next stepper + baseline toggle; **no `setChangedFiles` paint** on the live path (§3).
- [ ] **User edits land on the worktree and are NOT synced** to other clients in V1 (§3, [V1_SCOPE §3.1 step 3]).
- [ ] **Edit-lock honored:** `userMayEdit=false` running → read-only + Pause-AI; pause → editable; resume injects the **user-diff** into the agent's `--resume` ("you may proceed; the user made these changes: …"), reusing the reject-`--resume`-note machinery (§4).
- [ ] **User edits ride the push-on-approval:** on **complete** at the last stage the Conductor commits user edits with the agent's commits, pushes `DEV-####`, surfaces the **GitLab create-MR URL** (§5).
- [ ] **Account-linked extensions:** per-user `editorExtensions` set rendered into every session; in-session installs persist back to the account; open-vsx (or mirror) on the editor stage's egress allow-list (§6).
- [ ] **Multi-language LSP** works via standard extensions over the L1/L2 toolchain — no hand-injected virtual defs (§6.1).
- [ ] **Concurrency:** exactly one writer per stage state; `userMayEdit=false` (agent-owns) is the default; `userMayEdit=true` is the explicit concurrent-write opt-in; the pause is a real PTY park, not a lock file (§7).
- [ ] **ui-builder Monaco kept as reference + optional read-only diff fallback only** — never grown into the editor; the only shipping Monaco use is the no-container read-only fallback (§2).
- [ ] **No new verbs:** reads via `query_context`; expose/lock/pause/resume/complete-push are [control-API] Conductor actions; the agent gets no write verb (B-23). `runInTenant` on every orchestrator-side editor path (§7).

---

## §9. Open questions (Q-EDITOR-*)

> Defaults are recommended above; these flag genuine decisions a lane lead or the user should confirm. None block the §1 recommendation.

| Id | Question | Recommended default |
|---|---|---|
| **Q-EDITOR-SERVER** | openvscode-server vs code-server as the V1 server? | **openvscode-server** (closest to upstream VS Code, open-vsx). code-server is the documented fallback if the build/extension story blocks in the spike. |
| **Q-EDITOR-EDGE-AUTH** | How is the `vscode-<ticketId>` route authenticated at the edge so a leaked subdomain isn't an open editor? | Per-(user,ticket) minted URL behind the workspace session + openvscode-server connection-token injected by the orchestrator; same RBAC as the ticket. |
| **Q-EDITOR-LIFECYCLE** | When does the editor server start/stop relative to the container? | Lazy start on first editor-open; idle-stop after `EDITOR_IDLE_MIN` with no attached client; container untouched. |
| **Q-EDITOR-READONLY-ENFORCE** | How is "read-only while a `userMayEdit=false` stage runs" *enforced* on a server-side workbench the user's browser controls? | Open the user's session in VS Code read-only mode + withhold write affordances host-side; the **authoritative** guarantee is that the only sanctioned user-write window is post-`pause` (a real PTY park), so the agent provably isn't co-writing. A read-only bind of the worktree for the user view is the stronger option if needed. |
| **Q-EDITOR-CONCURRENT-WRITE** | When `userMayEdit=true`, agent and user both write the same worktree — acceptable? | Yes, accepted last-write-wins on disk; it's the explicit opt-in mode. Default stages to `userMayEdit=false` (agent-owns + pause-to-edit). |
| **Q-EDITOR-MULTIUSER** | Two users open the same ticket editor (one container, one filesystem) — co-editing? | No co-editing / no buffer sync in V1 (accepted, [V1_SCOPE §3.1]). Last-write-wins on disk; documented rough edge. |
| **Q-EDITOR-EXT-PERSIST** | How is the per-user extension set maintained? | Auto-capture in-session installs back to the account `editorExtensions`; an explicit account settings list is the manual alternative. |
| **Q-EDITOR-MARKETPLACE** | open-vsx public vs self-hosted mirror (air-gapped)? | open-vsx public by default; operator may point at a self-hosted mirror, added to the editor stage's egress allow-list. |
| **Q-EDITOR-FALLBACK** | What is the no-container fallback — `FileDiffViewer` or a Monaco read-only diff? | `FileDiffViewer` (`Ticket.files`) is the floor (no container, no LSP); a Monaco read-only inline-diff (reusing `BaseCodeEditor`) is an optional richer fallback — read-only either way. |

---

## §10. Cross-reference index

| This doc | Builds on / cited from |
|---|---|
| §1 server-side VS Code + Caddy route | [07b §5] (dial-by-name + `@id` routes + TLS), [07b §3/§4] (the container + worktree it runs in), [V1_SCOPE §2/§3.1] |
| §1.3 resource tradeoff | [07b §8] (CapacityManager shared budget), [07b §7] (limits) |
| §2 Monaco reference + fallback | `ui-builder/src/sandbox/_components/editor/BaseCodeEditor.tsx`, `ui-builder/src/sandbox/_functions/codeEditor/*`; [features/07] (interim `FileDiffViewer`), [features/08] D3/D7 (demoted for V1) |
| §3 changes-page integration | [features/07] (changed-files mode, stepper, baseline toggle, 07.q1), [features/08] (full-editor surface, contract), [02 §3/§4] (file-change events, frozen `commitHash`) |
| §4 edit-lock / pause / resume | [V1_SCOPE §3.2], [features/07] 07.q3 (reject-`--resume`-note machinery), [features/24] (pause/kill), [CONTROL_API §8] (`pause`/`resume`), [features/02]/[GOLDEN_PLAN_STAGE]/[features/03] (per-stage config) |
| §5 push-on-approval → create-MR URL | [V1_SCOPE §3.1], [FORGE_ABSTRACTION §3] (GitLab `push`), [CONTROL_API §8] (complete/push op), [BUILTIN_MR_REVIEW] (deferred) |
| §6 extensions + LSP | [V1_SCOPE §2], [07b §1] (toolchain image), [07b §6] (egress allow-list), [features/17] (account adjacency) |
| §7 concurrency model | [07b §3] (one PTY/stage), [07b §4] (worktree volume), [CONTROL_API §8] (`pause` as the coordination primitive), [04b §11c] (`runInTenant`) |

**Self-check:** No new verbs. No write verb granted to any LLM session — exposing/locking/pausing/resuming/completing-and-pushing the editor are all [control-API] Conductor actions (B-23). The subscription-billing + container-auth model is untouched (the editor is just another in-container process behind the same proxy). V1_SCOPE wins where [features/08]'s external-Monaco framing conflicts: the V1 editor is server-side VS Code in the container, Monaco is reference + optional read-only fallback. This doc edits no existing file.
