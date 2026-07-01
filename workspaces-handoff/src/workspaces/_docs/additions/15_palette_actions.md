# Addition 15 — Command-palette as action surface

> **Tier:** V1 (light) · **Lane:** C · **Status:** NEW (2026-06-11).
> **Pitch:** Extend the ⌘K palette from *find + navigate* to *find + navigate + **act*** — pause all, promote DEV-1240, raise the cap, archive — by routing chosen actions through the **same propose→Conductor [control-API] path** the Assistant already uses, with **zero new verbs** and **zero backend change** beyond what [CONTROL_API §8] already exposes.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #15 (create the ledger row when this lands).

---

## 1. The gap this closes

Today the ⌘K palette ([features/21]) is **read-only typeahead**. `SearchPalette.tsx` filters `TICKETS` + `DOCS`, lists quick-actions, and Enter-opens the first ticket — every action it exposes is *navigation* (`go(view)`, `openTicket(id)`, `toggleAi()`) or a single quick-**create** stub (the `New ticket` action whose `run` is just `onClose`, `SearchPalette.tsx:56`). The doc's own scope line is explicit: "search only *finds + navigates*" ([features/21 §Scope/Out]); "No `WorkspaceTrigger`/hook — search is a read surface; nothing fires on a query" ([features/21 §Verbs]).

Meanwhile **every workspace write already has a transport**: the [CONTROL_API §8] op catalogue (`pause`, `resume`, `kill`, `pause-all`, `bulk-*`, `archive`, `raise-cap`, `change-role`, `preview-up`, …) is the verb-free [control-API] write path, and [V1_SCOPE §3.3] already lets the per-user **Assistant** drive *all* of those by natural language (instruction = consent, confirm-on-important). So a user on a phone can *say* "pause all" to the Assistant and it happens — but the **fastest keyboard surface on every screen** (⌘K) can't do the same. The intent is identical (map a phrase to a [control-API] op); only the input modality differs.

The gap: the palette is the cheapest path to an action from anywhere — no mouse, no screen-hunting for the right button — and it currently dead-ends at navigation. Addition 15 makes ⌘K an **action surface** by intersecting the [CONTROL_API §8] catalogue with the caller's RBAC and routing the chosen op through the **exact same** instruction=consent / confirm-on-important machinery [V1_SCOPE §3.3] defines for the Assistant. It is **purely a new front-end on the existing control-API** — no new op, no new verb, no new server route.

---

## 2. Locked decision (reuse Assistant consent model; confirm-on-important)

**LOCKED — Reuse the Assistant consent model verbatim.** Palette actions follow [V1_SCOPE §3.3] **instruction = consent / confirm-on-important** with no new policy:

- **Ordinary actions fire directly.** Selecting an action in the palette (e.g. `pause`, `resume`, `bulk-archive`, `raise-cap`, `mark-read`, `skill-toggle`) **is the consent** — it enqueues the [control-API] op immediately (`apiRequest({ name, version, data })` → `preApiExecute` RBAC → enqueue → **Conductor writes**, [CONTROL_API §3/§7]). No separate Accept step, exactly as the Assistant's "say it, it happens" ([V1_SCOPE §3.3], Net line). The palette closes on enqueue and the result lands later over `ws-ai:*` / the per-workspace room, merged on `seq` ([CONTROL_API §6.3], [V1_SCOPE §3.5]).
- **Important / destructive actions require an explicit confirm.** The [V1_SCOPE §3.3] confirm-on-important whitelist — **delete workspace, remove member, kill (teardown a container), push / merge-trigger** — interrupts the fire with a `menuHandler.confirm(...)` before the op is enqueued. **Type-to-confirm** (the `input` field, §3.2) is used for the worst (delete-workspace, transfer-ownership), mirroring [features/24 §3] kill (type `DEV-####`) and [features/16 §Danger] (type the workspace slug).
- **The Conductor is still the only writer (B-23).** The palette has **no write verb and no direct mutation**. "Fires directly" means it produces a [control-API] *request*; the Conductor drains the signal and writes ([CONTROL_API §4 proposal bridge], [01 §3.3]). The palette is just another *human/web-app* caller of the [control-API], identical in kind to a board button or the Assistant's instruction-mapped request.

**Why reuse, not invent:** [V1_SCOPE §3.3] already locked the consent model AND its exact confirm-on-important whitelist for the Assistant. The palette is a *second input modality for the same actions*; giving it a *different* consent policy would be two contradictory rules over one op catalogue. Reusing §3.3 means the palette and the Assistant are provably consistent — the same op, the same RBAC gate, the same confirm gate, the same Conductor write.

---

## 3. Build-ready mechanics

### 3.1 Action list = control-API ops ∩ RBAC (cite [CONTROL_API §8], [features/16])

The palette's **Actions** group is the [CONTROL_API §8] op catalogue **intersected with the caller's RBAC**:

- **Source of truth = [CONTROL_API §8].** Each palette action is a thin descriptor over one catalogue `op`: `{ op, label, target-shape, RBAC capability, important? }`. No action exists that isn't already a [CONTROL_API §8] row. Scope is the [V1_SCOPE §3.3] whitelist (workspace actions only — pause/resume, bulk move/status/assign/sprint/archive, quick-add, sprint create/edit, mark-read, raise-cap/edit-budget, skill-toggle, GitLab settings/verify/resync, role/member edits, the §3.1 complete/push). **Never** host/system-level, never out-of-workspace — every enqueued op runs under `runInTenant` ([CONTROL_API §7], [04b §11c]).
- **RBAC intersection (client-side hint).** Each action declares the [CONTROL_API §5] capability its op requires, resolved against the caller's `WorkspaceMember.role` via the same `RBAC_CAPABILITIES` matrix [features/16] surfaces (`permRoles`/`PermCell`, D69). Actions the caller may not run are **hidden or greyed with a tooltip** (the [features/24 §UI] "disabled-with-tooltip for users below the required tier, D69" pattern). Examples ([CONTROL_API §8] RBAC column): `pause`/`resume`/`archive`/`bulk-*` → work-on-tickets (Owner/Admin/Member); `kill`/`pause-all`/`change-role`/`remove-member`/`gitlab-settings` → **Admin+**; `raise-cap`/`skill-toggle`/`edit-pipeline` → config (D30); `transfer-ownership`/`delete-workspace` → Owner (+ single-Owner guard).
- **Double-enforced (the load-bearing rule).** The client greying is a **hint, not the gate**. RBAC is re-checked server-side in `preApiExecute` ([CONTROL_API §5], [features/16 §Data] "no client-trusted flag; the matrix is the source the subscriber reads"). A spoofed palette request from an under-privileged caller returns a denied `ControlAck` (`{ status:'error', reason:'rbac' }`, [CONTROL_API §6.2]) and **enqueues nothing**. Custom roles ([features/16] D76 — fully configurable, including admin rows) are honored because the descriptor reads the *capability*, not a hard-coded tier.

Two action shapes render: **target-bound** (a `pause`/`promote`/`archive`/`raise-cap` action that names a specific ticket the user typed, e.g. `promote DEV-1240` — `target:{ticketId}`) and **workspace-scoped** (`pause-all`, `resume-all`, `delete-workspace` — `target:{workspaceId}`). Target-bound actions surface contextually when the query matches a ticket id (§3.3).

### 3.2 Consent + confirm-on-important (cite [V1_SCOPE §3.3], [features/24]; `menuHandler.confirm`)

The fire path branches on the descriptor's `important` flag (the [V1_SCOPE §3.3] whitelist):

- **Ordinary (`important:false`).** On activate → build the typed `ControlRequest` ([CONTROL_API §6.1]: `{ workspaceId, op, target, payload, clientRequestId }`) → `apiRequest({ name:'workspaces/<op>', version:'v1', data })` (generated types, no `as any`, [CONTROL_API §3]) → close palette → optimistic "requested…" affordance, merge-on-`seq` when the Conductor confirms ([CONTROL_API §6.3]). This is [V1_SCOPE §3.3] "say it, it happens".
- **Important (`important:true` — the §3.3 whitelist: delete workspace, remove member, kill, push/merge-trigger; plus transfer-ownership).** On activate → `await functions...` no — this is consumer client code, so: `const ok = await menuHandler.confirm({ title, content?, input? })` (`src/_functions/menuHandler.confirm`, returns `Promise<boolean>`; `ConfirmMenuProps` = `{ title, content?, input? }`). Only on `ok === true` is the [control-API] op enqueued.
  - **Plain confirm** (`content` only) for `kill`, `remove-member`, `push`/`merge-trigger`: "Kill DEV-1240's container? The branch + audit are retained." ([features/24 §3] kill copy).
  - **Type-to-confirm** (`input` set) for the worst — `delete-workspace` (`input: activeWorkspace.slug`, [features/16 §Danger]) and `kill` from the destructive surface (`input: 'DEV-1240'`, [features/24 §3]). The confirm button stays disabled until the exact string is typed (ConfirmMenu `input` contract).
- **RBAC still independent of confirm.** Confirm is a *destructiveness* gate, not an *authorization* gate. Even after a user confirms, `preApiExecute` re-checks RBAC ([CONTROL_API §5]); the two gates compose (a Member never even sees `kill`; an Admin sees it but must still type-to-confirm).

This is byte-for-byte the [V1_SCOPE §3.3] "Confirm-on-important" exception and the [features/24]/[features/16] `menuHandler.confirm` patterns — no new confirm machinery.

### 3.3 Inline arguments via palette sub-prompts (cite `SearchPalette.tsx`)

Ops with a `payload`/`target` ([CONTROL_API §6.1]) need arguments the bare query doesn't carry (`raise-cap` needs *which budget* + *new amount*; `bulk-archive` needs *which tickets*; `change-role` needs *which member* + *which role*). The palette collects these via **sub-prompts** — a second step inside the same `SearchPalette` shell, reusing its existing input + result-list:

- **Pattern.** Selecting an arg-taking action pushes a lightweight palette "mode" (a `pendingAction` state alongside the current `q`/`setQ` in `SearchPalette.tsx:35`). The input placeholder switches to the prompt ("Raise cap to… (€)", "Promote which ticket?"), and the result list renders candidate values (tickets from the existing `TICKETS` filter, members from `MEMBERS`, roles from `permRoles`) using the existing `TicketRow`/row renderers (`SearchPalette.tsx:23-31, 112-117`). Arrow/Enter selection ([features/21] D66) fills the arg; Esc backs out one level (not closing the whole palette).
- **Ticket-id inline shortcut.** When the live query already matches a ticket (`tickets[0]`, `SearchPalette.tsx:48`), target-bound actions for that ticket render directly in the Actions group ("Promote DEV-1240", "Pause DEV-1240", "Raise cap for DEV-1240") — no sub-prompt needed; the id is the argument. This reuses the existing fuzzy `id`+`title` match.
- **Validation before fire.** Numeric/enum args validate client-side (a non-numeric cap, an empty selection) before building the request; the server still rejects `invalid` payloads at enqueue ([CONTROL_API §6.2/§7 step 2]). The `clientRequestId` idempotency key ([CONTROL_API §6.4]) is minted per fire so a double-Enter doesn't double-enqueue.
- **Mobile.** The sub-prompt is the same full-screen `Sheet` variant [features/21 §UI] already specifies; arg selection is full-width tap rows. The "from the beach" heavy path still falls to the Assistant chat ([features/11]) — the palette stays the keyboard/typeahead surface.

The footer ("Semantic search across the whole board — coming soon", `SearchPalette.tsx:123`) is untouched; actions are a *new group*, not a replacement of the search tiers.

---

## 4. Invariants honored (no new verb; double-enforced RBAC)

- **No new verb (FROZEN surface).** Every palette action is a [CONTROL_API §8] **op**, which "is NOT a structured-channel verb and adds none" ([CONTROL_API §intro/§3]). The frozen 7+6 `read|propose` surface ([02 §2]) is untouched; `VERB_REGISTRY` conformance is unaffected. The palette is the *same web-app→orchestrator [control-API] request transport* the Assistant uses ([V1_SCOPE §3.3], [CONTROL_API §4]) — a new front-end, not a new path.
- **Conductor-only-writer (B-23).** The palette never mutates `Ticket.status`, git, the board, a container, or membership. It enqueues a `WorkspaceSignal`; the single-instance Conductor drains it and writes ([CONTROL_API §7], [01 §3.3]). Optimistic UI is a hint; merge-on-`seq` is authoritative ([CONTROL_API §6.3], B-30).
- **Double-enforced RBAC.** Client greying ([features/24] D69 pattern) is a UX hint; `preApiExecute` is the gate ([CONTROL_API §5], [features/16 §Data]). Owner-affecting ops keep the single-Owner guard ([CONTROL_API §5.3], [features/16] D77).
- **`runInTenant` + scope.** Every enqueued op runs under `runInTenant(workspaceId, …)`; the action list is the [V1_SCOPE §3.3] workspace whitelist — never host/system, never cross-workspace.
- **PTY-billing untouched.** Palette actions are deterministic [control-API] ops — they enqueue Conductor work, they **do not** spawn a `claude` PTY turn (unlike the Assistant's instruction-mapping, which costs one interactive turn). The palette is *cheaper* than the equivalent Assistant instruction precisely because it skips the LLM interpretation step.
- **LuckyStack conventions.** Generated `apiRequest` types, no `as any` ([CONTROL_API §3]); `menuHandler.confirm` from `src/_functions/menuHandler`; i18n on all new labels (`useTranslator`); Tailwind tokens only; reuse `SearchPalette`/`TicketRow`/`StatusPill`/`Section` ([features/21 §UI]). **V1_SCOPE wins** on any conflict.

---

## 5. Open sub-decisions (DEFAULTs — flag if wrong)

| # | Sub-decision | DEFAULT |
|---|---|---|
| 15.d1 | **Action-list membership** | The action list = the [CONTROL_API §8] catalogue ∩ [V1_SCOPE §3.3] whitelist ∩ caller RBAC. Unauthorized actions are **hidden** when the gap is large (a Member never sees Admin-only `delete-workspace`) and **greyed-with-tooltip** when contextually relevant (an Admin sees Owner-only rows greyed). Server re-enforces regardless. |
| 15.d2 | **Arg collection** | Inline palette sub-prompts (§3.3), reusing the existing `SearchPalette` input + result list — **not** a separate modal. Esc backs out one sub-prompt level before closing the palette. |
| 15.d3 | **Confirm scope** | Exactly the [V1_SCOPE §3.3] whitelist (delete workspace, remove member, kill, push/merge-trigger) + transfer-ownership; **type-to-confirm** for delete-workspace / transfer-ownership / kill-from-destructive-surface, plain confirm for the rest. No palette-specific additions to the whitelist. |
| 15.d4 | **Result placement** | A new **Actions** group in the palette, ranked after Tickets + Sources ([features/21] D84 group order is preserved; Actions stays an additive group, not an interleave). Target-bound actions for a matched ticket id surface in that group inline. |
| 15.d5 | **Optimistic affordance** | Reuse [CONTROL_API §6.3] "requested…" + merge-on-`seq`; the palette closes on enqueue (it is not a status surface). No new optimistic machinery. |
| 15.d6 | **Backend delta** | **None.** Zero new [control-API] op, zero new route, zero new verb. If a desired palette action lacks a [CONTROL_API §8] op, that op is added to the catalogue *there* (as a [control-API] op, per [CONTROL_API §8] "New feature docs add rows here, never new verbs") — not invented in the palette. |

---

## 6. Build checklist (per-lane + verification)

**Lane C (frontend) — `SearchPalette.tsx` + a small action-descriptor module:**

- [ ] Add an `ACTIONS` descriptor list: `{ op, label(i18n), targetShape, rbacCapability, important }` rows, one per in-scope [CONTROL_API §8] op (§3.1). **Verify:** every row's `op` exists in [CONTROL_API §8]; no row outside the [V1_SCOPE §3.3] whitelist.
- [ ] RBAC filter: resolve each descriptor's capability against the caller's role (`permRoles`/matrix, [features/16]); hide/grey unauthorized (D69). **Verify:** a Member sees no Admin-only actions; an Admin sees Owner-only rows greyed with a tooltip.
- [ ] Render an **Actions** group (after Tickets/Sources, [features/21] D84); inline target-bound actions when `tickets[0]` matches (§3.3). **Verify:** typing `DEV-1240` surfaces "Promote/Pause/Raise-cap DEV-1240".
- [ ] Sub-prompt mode (`pendingAction` state) reusing the input + result list for arg-taking ops; Esc backs out one level (§3.3). **Verify:** `raise-cap` prompts for budget + amount; Esc returns to the action list, not a closed palette.
- [ ] Fire path: ordinary → `apiRequest` directly (generated types, no `as any`); important → `await menuHandler.confirm({ title, content?, input? })` first, type-to-confirm for the worst (§3.2). **Verify:** `pause-all` fires immediately; `delete-workspace` requires typing the slug; `kill` requires typing `DEV-####`.
- [ ] Client-side arg validation + `clientRequestId` per fire ([CONTROL_API §6.4]). **Verify:** double-Enter enqueues once; a non-numeric cap is blocked before send.
- [ ] Optimistic "requested…" + merge-on-`seq` ([CONTROL_API §6.3]); palette closes on enqueue. **Verify:** the real state arrives over the per-workspace room, not synchronously.
- [ ] Mobile `Sheet` parity for the action group + sub-prompts ([features/21 §UI]).
- [ ] i18n all labels/prompts (`useTranslator`); Tailwind tokens only; lint + build clean.

**Lane backend — none (verification only):**

- [ ] Confirm the [CONTROL_API §8] ops the palette fires already exist + are RBAC-gated in `preApiExecute` ([CONTROL_API §5]). **Verify:** a forged under-privileged `apiRequest` returns `ControlAck{ status:'error', reason:'rbac' }` and enqueues nothing (the auto-sweep RBAC/contract test, [TESTING_STRATEGY]). **If any desired action lacks an op → add the op in [CONTROL_API §8], not in the palette (15.d6).**

**Cross-cutting verification:**

- [ ] No new verb introduced (`VERB_REGISTRY` conformance unchanged); the only new code is a front-end descriptor + fire branch.
- [ ] Every fire is a [control-API] enqueue → Conductor write; no direct client mutation (grep the diff for any local `Ticket.status`/membership write — there must be none).
- [ ] Palette action and the equivalent Assistant instruction ([V1_SCOPE §3.3]) hit the **same** op + RBAC + confirm gate (consistency check).

---

## 7. Citations

| Cited | Used for |
|---|---|
| [features/21 §Scope/§Verbs/§UI] (`21_SEARCH_AND_COMMAND_PALETTE.md`) | Today's ⌘K = find+navigate only; quick-actions; D84 group order; D66 arrow+Enter; mobile `Sheet`; the dead `New ticket` stub. |
| [CONTROL_API §3/§4/§5/§6/§7/§8] (`CONTROL_API.md`) | The op catalogue (§8), `apiRequest` transport (§3), AI-vs-human edges + proposal bridge (§4), `preApiExecute` RBAC + single-Owner guard (§5), `ControlRequest`/`ControlAck`/merge-on-`seq`/idempotency (§6), enqueue-not-write (§7). |
| [V1_SCOPE §3.3] (`V1_SCOPE.md`) | instruction=consent / confirm-on-important; the destructive whitelist; the workspace-scoped action whitelist; `runInTenant`; Conductor-only-writer mapping. |
| [features/24 §3/§UI] (`24_PAUSE_AND_KILL_CONTROLS.md`) | Kill type-to-confirm + pause-all `menuHandler.confirm`; D69 disabled-with-tooltip RBAC gating; the "requested…" optimistic pattern. |
| [features/16 §Data/§Danger] (`16_MEMBERS_AND_RBAC.md`) | `RBAC_CAPABILITIES` matrix + `permRoles`; D69 / D76 (custom roles) / D77 (single-Owner); `preApiExecute` enforcement; slug type-to-confirm. |
| `_components/SearchPalette.tsx` | The host component: `q`/`setQ`, `TICKETS`/`DOCS` filter (`:48-49`), `actions` list (`:55-64`), `TicketRow` (`:23-31`), the footer (`:123`) — the surfaces this addition extends. |
| `_functions/menuHandler.confirm` (`ConfirmMenu.tsx`) | `confirm({ title, content?, input? }): Promise<boolean>`; `input` = type-to-confirm string. |
| [01 §3.3], [02 §1/§2], B-23, B-30 | Conductor-only-writer; AI-owned status + the three levers; frozen verb surface; merge-on-`seq`. |
