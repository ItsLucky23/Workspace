# 10 — Automations screen + stage Automation sub-tab

> The two authoring surfaces for `WorkspaceTrigger`. Extends `[03 §1]` (trigger/event engine) and `[05 P3]` (the Automation-UI lane). It is **pure UI + config** over the engine that `[03 §1.4]` already specs — no engine, scheduler, or verb change.

---

## Scope

**In**
- A **workspace-level Automation screen** (a new `WsView`, sibling of `pipeline`/`usage`) for cron + workspace-lifecycle triggers (`ticket.created`, `ticket.merged`, `suggestion.accepted`, `cron`).
- A **stage-scoped "Automation" sub-tab** inside the Pipeline editor, auto-filtered to the selected stage's `stage.*` triggers (`stage.on_enter`/`on_complete`/`on_signal`/`on_approval`).
- A guided **trigger builder**: event → matcher → action → params, with a mustache **template tester**, a `requiresApproval` toggle, a **cron WYSIWYG**, and a **recent-fires** list.
- A **dependency hint** when a `stage.*` event needs an upstream hook that is currently off (`[03 §1.6]`).

**Out (lives elsewhere)**
- The raw **Hooks tab** stays exactly as-is — it toggles *which raw signals fire* (`PipelineStageCfg.hooks`), the Automation surface decides *what to do with them* (`[03 §1.1]`). They are distinct tabs.
- The `OrchestratorCommandRegistry` allow-list itself (server-side; `[03 §2]`). This UI only *picks a registered command key*, never authors shell.
- Actually firing triggers / the leased cron tick (`[03 §1.4]`, P3 server lane).

**Deferred**
- Per-trigger run history beyond the last N fires (full audit lives in the event-log surface). Visual graph of trigger→trigger chains (e.g. `automation` suggestion accept → `suggestion.accepted` event). Import/export of trigger sets between workspaces (rides D9 copy-from-workspace later).

---

## User flow

### Workspace-level Automation screen
1. User opens **Automation** from the nav rail (new `NavDef`). Header mirrors `Pipeline.tsx`: title + `{activeWorkspace.name} · N automations` + an **Add automation** `WsButton`.
2. The body is a list of `WorkspaceTrigger` rows, each a card: a `Toggle` for `enabled`, the `name`, an **event chip** (`on`), a **matcher summary** (`match` stages/statuses/projects, "any" when empty), an **action chip** (`action`), a `requiresApproval` badge when set, and `lastFiredAt` ("fired 3h ago"). Cron rows additionally show the WYSIWYG sentence ("every day at 03:00") + the raw `cron` string in `font-mono`.
3. **Add / edit** opens the trigger builder in a `menuHandler` sheet (md size). The builder is a left-to-right wizard rendered as stacked sections:
   - **Event** — a `Segmented` or `Dropdown` over `TriggerEventKind`. On the workspace screen the `stage.*` kinds are hidden (those are authored per-stage); only `ticket.*`, `suggestion.accepted`, `cron` show.
   - **Matcher** — only when the event supports it: `MultiSelectDropdown` of stages / status chips / projects. Empty = "any" (`[03 §1.2]` `match` empty = any).
   - **Action** — `Segmented` over `TriggerActionKind` (`start-stage` | `invoke-workspace-ai` | `run-command` | `emit-signal` | `notify`).
   - **Params** — action-specific (below).
   - **Approval** — a `Toggle` for `requiresApproval` with the inline note: "On → fires a Suggestion you must Accept instead of running (B-23 governance, `[03 §1.5]`)".
4. **Save** → persists a `WorkspaceTrigger` row (P3 server lane). In the prototype it lives in `WorkspacesContext` like `permRoles`/`stages` do today.

### Stage Automation sub-tab
1. Inside `Pipeline.tsx`, add `{ id: 'automation', label: 'Automation', icon: 'wand-magic-sparkles' }` to `CONFIG_TABS` (distinct from the existing `hooks` entry).
2. The tab lists only triggers whose `on` starts `stage.` **and** whose `match.stageIds` includes the selected stage `s.id` (auto-scoped, `[03 §1.3]`). New triggers created here are pre-stamped with `match.stageIds:[s.id]` and the event dropdown is limited to the four `stage.*` kinds.
3. A **dependency hint** banner (reuse the `validate()` warning row styling) renders when the picked event needs a hook that is off, e.g. `stage.on_complete` requires the `Stop` hook — read `s.hooks['Stop']` and show "requires the `Stop` hook (currently off) — enable it in the Hooks tab" (`[03 §1.6]`).

### Params — per action
| Action | Param fields (from `WorkspaceTrigger.params`) |
|---|---|
| `start-stage` | `targetStageId` `Dropdown` over the workspace stages **+ a `'next'` sentinel** ("the next stage"). |
| `invoke-workspace-ai` | `template` `textarea` (mustache) + the **template tester** (below). |
| `run-command` | `command` `Dropdown` over the **registered command keys** (e.g. `ai:refresh-docs`) — never a free text box (`[03 §1.5]` "never raw shell"). |
| `emit-signal` | signal `type` `Dropdown` (the `WorkspaceSignal.type` enum, `[02 §6]`) + a small `payload` template. |
| `notify` | `notifyType` `Segmented` (`needs-input`/`merge`/`ai-suggestion`/`container-failure`) + `template` for the body. |

### Template tester (the `{{chip}}` previewer)
- A read-only preview pane under any `template` field. Above it, clickable chips for the available tokens — reuse the **exact `CARRY_VARS`** chips from `seed.ts` (`{{summary}} {{changedFiles}} {{openQuestions}} {{commitHash}}`) **plus** the trigger-context tokens `[03 §1.2]` lists (`{{ticketId}} {{stageName}} {{statusKey}} {{reason}}`).
- Clicking a chip inserts the token (same insert pattern as `CarryoverTab` in `Pipeline.tsx`). The preview renders the mustache against a sample carry-over so the user sees the resulting message before saving. Validation: warn on an unknown `{{token}}`.

### Cron WYSIWYG
- Shown only when `on === 'cron'`. A friendly builder (Every: minute/hour/day/week/month + time pickers) that **emits a 5-field crontab string** into `cron` (`[03 §1.2]` "required iff on==='cron'"). Below it, the raw string in an editable `font-mono` input for power users (two-way bound), plus a live English gloss ("at 03:00 every day"). Validation: reject malformed crontab; require non-empty when `on==='cron'`.

### Recent-fires list
- Per trigger, a collapsible showing the last few fires from `lastFiredAt` + (when available) the resulting event/suggestion id. Pure read projection; no new store.

### Desktop + mobile
- **Desktop:** workspace screen is a full route; the stage sub-tab sits in the existing `Tabs` strip in `Pipeline.tsx`.
- **Mobile:** the workspace Automation list is reachable via the settings/overflow nav (it is config, not a hot path — same posture as Pipeline today, which is desktop-leaning). Cards stack full-width; the builder opens as a full-height `menuHandler` sheet. The cron WYSIWYG and template tester are touch-friendly (chips are tap targets). No board/chat hot-path impact.

### Mockup hint (workspace screen)
```
Automation                          [+ Add automation]
youcomm · 3 automations

┌────────────────────────────────────────────────┐
│ ⏻  Nightly doc refresh        [cron]  [run-cmd] │
│    every day at 03:00 · 0 3 * * *               │
│    → ai:refresh-docs            fired 9h ago  ▸  │
├────────────────────────────────────────────────┤
│ ⏻  Auto-advance approved refines [stage.on_approval]│
│    match: Refined → [start-stage] next  ⚠ needs Stop hook │
└────────────────────────────────────────────────┘
```

---

## Data

All persistence already exists — `WorkspaceTrigger` (+ `TriggerEventKind` / `TriggerActionKind`) is defined in `[03 §1.2]` and listed in the INDEX delta table as already-in-04 (do not re-add). This doc introduces **no new persisted fields**; it is an editor over that model. The prototype holds the rows in `WorkspacesContext` (client-only, like `permRoles`), exactly as `STAGE_CONFIGS` is held in `Pipeline.tsx` today.

The only **ui-only** addition is a nav entry (`NavDef` for the workspace screen) and a `CONFIG_TABS` entry — neither is persisted.

**INDEX delta:** (none — this doc persists nothing new; it authors the existing `WorkspaceTrigger` model from `[03 §1.2]`)

---

## Verbs / Events / Hooks

**No new verbs.**

- **Triggers:** the entire feature is the authoring UI for `WorkspaceTrigger` (`when → then`, `[03 §1.2]`). Every "action" a user can build is one of the five existing `TriggerActionKind` values; `run-command` is constrained to **allow-listed `OrchestratorCommandRegistry` keys** (`[03 §1.5]`), never raw shell — that is the no-new-verbs guarantee for this surface.
- **Hooks:** read-only consumer of `PipelineStageCfg.hooks` (the `HOOK_CATALOG` toggles in `seed.ts`) to render the dependency hint (`[03 §1.6]`); it never edits the Hooks tab.
- **Verbs touched (only when an action references them):** a `run-command:ai:refresh-docs` action is the same path the `refresh_docs` Assistant verb hits (`[03 §2]`); an `invoke-workspace-ai` action renders into the one-shot reasoner, which reuses the existing read/propose verb surface (`[02 §2]`, background-reasoning row). The UI authors the rule; it calls nothing itself.
- **Governance:** `requiresApproval:true` routes through `WorkspaceSuggestion(type:'automation')` (`[03 §1.5]`), which Accept executes via the Conductor — the same B-23 proposes-only path as every other suggestion (`[02 §6]`).

---

## UI

**Reused (real components)**
- `Tabs`, `Segmented`, `Toggle`, `WsButton`, `IconButton`, `InfoDot`, `FieldLabel` — all from `_components/primitives` + `Pipeline.tsx`, the same kit the existing config tabs use.
- `Dropdown` / `MultiSelectDropdown` (`src/_components/`) — event/action/target/command/status pickers.
- `menuHandler.open` (`src/_functions/menuHandler`) — the builder sheet, as `CreateWorkspaceForm` uses today in `Shell.tsx`.
- The `CARRY_VARS` chip-insert interaction copied verbatim from `CarryoverTab` (`Pipeline.tsx`) for the template tester.
- The `AnimatePresence` warning-row styling from `Pipeline.tsx`'s `validate()` block for the dependency-hint banner.

**New (small, scoped) components**
- `AutomationScreen` (the workspace `WsView`).
- `TriggerBuilder` (the event→matcher→action→params wizard; shared by both surfaces, parametrized by which `TriggerEventKind`s are offered).
- `TemplateTester` (chips + mustache preview).
- `CronEditor` (WYSIWYG ↔ crontab string).
- `AutomationTab` (the stage sub-tab — a thin wrapper that pre-scopes `TriggerBuilder` to the selected stage).

**Mobile parity:** cards + the builder sheet are full-width/full-height; chips are tap targets; the cron builder uses native pickers. Config-screen posture (not a board hot path), consistent with how `Pipeline`/`Usage` behave on mobile today.

---

## Extends

- `[03 §1.1]` — the three planes (Inbound hooks → Events → Triggers); this surface owns the *Triggers* plane's authoring, leaving the *Hooks* tab as the raw-signal enabler.
- `[03 §1.2]` — the `WorkspaceTrigger` shape (`on`, `match`, `cron`, `action`, `params`, `requiresApproval`) — the exact model this UI edits.
- `[03 §1.3]` — "Two editing surfaces, one table" (stage sub-tab vs workspace screen).
- `[03 §1.5]` — `ActionExecutor` + governance (the `requiresApproval` → `automation` suggestion path; `run-command` allow-list).
- `[03 §1.6]` — "Relation to the existing Hooks tab" (the dependency-hint).
- `[03 §2]` — "Refresh generated docs … four entry points" (the `ai:refresh-docs` registered command a cron/on-complete trigger targets).
- `[02 §6]` — `WorkspaceSignal` / `WorkspaceSuggestion` / `Notification` types the `emit-signal` / `notify` / approval actions reference.
- `[05 P3]` — the **Automation UI** lane ("Pipeline 'Automation' sub-tab (stage-scoped) + workspace Automation screen").

---

## Resolved

1. **`'next'` resolution for cron/workspace-scope triggers.** The `'next'` target is **hidden for non-stage events**; for `stage.*` events it is **resolved at fire-time** against the firing stage.
2. **Per-trigger debounce/dedupe in the UI.** `dedupeKey` + `debounceMs` live in an **"Advanced" section** of the builder, **server-defaulted** (collapsed for the common case).
3. **Recent-fires depth.** Show the **last 5 fires inline**, with a **link out to the full event-log** surface.
4. **Cron timezone.** Cron triggers are anchored to a **workspace timezone**, stored on `Workspace` and **defaulting to the host timezone on create** (not the raw orchestrator host clock at fire-time).
