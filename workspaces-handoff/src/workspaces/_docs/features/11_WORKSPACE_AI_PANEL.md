# 11 — Workspace-AI panel (the Assistant chat)

> Expands today's dummy `AIPanel` (Chat + Suggestions) in `_shell/Shell.tsx` into the real per-user **Assistant** surface. Extends `[01 §3.2]` (Assistant = per-user chat), `[02 §2]` (Assistant verbs), `[02 §3]` (hook-sourced events), `[01 §4]` (read/propose boundary), `[02 §6]` (signals/suggestions/notifications). Pure UI over the `ws-ai:*` socket contract (`[05 P1]`) — **no new persistence, no new verbs.**

---

## Scope

**In**
- The **per-user Assistant chat** — one Assistant per active user per workspace (`[01 §3.2]`), streaming replies into the existing `ChatBubble`/`useTypewriter`. Replaces dummy `sendChat`.
- An append-only **SIGNAL STREAM** tab: `WorkspaceSignal` rows rendered chronologically, **color-coded by `type`** (observation / stopped / dependency-hint / suggestion-input / config-observation / maintenance-hint, `[02 §6]`).
- **Live token/status per active session** — a compact telemetry strip surfacing `ws-ai:status` + the per-session token figure (the `[05_PER_SESSION_INFO]` projection of `AgentSession.tokenEstimate`).
- **RBAC-gated action buttons** that **PROPOSE** ticket controls (pause / resume / promote / stop) — they emit `ws-ai:control`; the **Conductor** executes (B-23, `[01 §4]`).
- A **ticket-context view** (the Assistant's `get_ticket` read model) and **search** across tickets/signals/suggestions.
- **Suggestion accept** → the Conductor runs it (existing `SuggestionCard`, wired real).
- Inline **question-card** rendering (a chat bubble with `ChatMessage.questionSetId` → render via doc 09's card).
- **Compact / Clear** session controls.

**Out**
- The board banner / mobile question cards themselves — that is **doc 09**; this panel only renders the in-chat free-text-fallback variant.
- The Conductor's execution of any control/accept — server-side (`[02 §7]`).
- Authoring triggers — **doc 10**.

**Deferred**
- Voice input into the chat composer — **doc 06** (D5, build deferred); the composer is the documented text path it falls back into.
- The optional one-shot background reasoner's own surfacing (it reuses these same read/propose verbs but has no chat thread; `[02 §2]` background-reasoning row).

---

## User flow

1. User opens the panel (nav rail `ai` item / `TabBar` toggle / mobile bottom bar — all already wired in `Shell.tsx`). On open, the client emits `ws-ai:attach` for that user's Assistant; on close/disconnect the Assistant is **suspended** (`[01 §3.2]`) — the panel shows a subtle "Assistant idle — resumes on your next message" footer rather than implying it's always running.
2. **Chat tab** (default): user types → `ws-ai:chat {wsId,userId,text}` routes to *their* Assistant (`[05 P1]`). Server streams `ws-ai:stream` chunks into a growing `ChatBubble` via the existing `useTypewriter`. The Assistant can:
   - answer reads ("how is DEV-1240 doing?") via `get_ticket`/`list_tickets`,
   - **propose** a control or config change — surfaced as an inline **proposal bubble** with Accept/Dismiss (Accept → `ws-ai:control` or suggestion-accept; the Conductor executes, `[02 §7]`),
   - render a **question card** when a bubble carries `questionSetId` (doc 09), and the user's free-text reply is interpreted by the Assistant back into the same answers (`[02 §5]` free-text fallback).
3. **Signal stream tab**: a read-only, append-only feed of `WorkspaceSignal` rows (newest at bottom), each a thin row: a left color bar by `type`, the signal text/payload one-liner, the source ticket chip, and time. A `stopped` signal is visually loud (warning/wrong tint) and deep-links to the ticket. Tapping a `suggestion-input`/`config-observation` row that produced a suggestion jumps to the Suggestions tab.
4. **Suggestions tab** (existing): real `WorkspaceSuggestion` rows via `ws-ai:suggestion`. **Accept** → the Conductor executes (RBAC-gated; a `config-review` Accept needs "edit pipeline/stages", `[02 §7]`); the button is disabled with a tooltip when the user's role can't accept.
5. **Telemetry strip** (panel header, under the title): for each active session this user can see, a chip: status dot (`ws-ai:status`) + live token count + a tiny cost gloss (the `[05_PER_SESSION_INFO]` projection). The user's own Assistant always shows; worker sessions show when a ticket is focused.
6. **Action buttons** (ticket-context view): when a ticket is open in chat context, a row of buttons — **Pause / Resume / Promote / Stop** — each gated by RBAC ("work on tickets"; Promote also). Pressing one **proposes** it (`ws-ai:control {ticketId, action}`); the UI reflects optimistic "requested…" until the Conductor's `ws-ai:status` confirms. These never write directly (B-23).
7. **Search**: a filter box over the user's tickets (`list_tickets` projection) + the signal stream + suggestions; client-side filter in the prototype.
8. **Compact / Clear**: two header controls. **Compact** runs the token-optimization self-handoff (doc 06 — `emit_handoff` → `/clear` → reload). It fires **two ways**: the orchestrator **auto-compacts at the context budget**, and the user can **manually force it early via an "Optimize now" button**. During either round-trip the header shows an **"optimizing context…" state** until the reloaded session reports back. **Clear** drops the visible chat (and signals the Assistant to `/clear`); both are the documented controls the `[05 P1-E]` lane lists ("Compact/Clear buttons").

### Desktop + mobile
- **Desktop:** the existing right-docked resizable `motion.aside` (`hidden lg:flex`) — keep the drag-resize, the tab strip, the typewriter stream. Add the telemetry strip + the signal-stream + search tabs.
- **Mobile:** the panel already toggles full-screen from the bottom bar. Tabs become a horizontal scroller; action buttons are full-width tap targets; question cards render inline (the phone-from-the-beach path, `[02 §5]`). The signal stream is the same list, scrollable.

### Mockup hint
```
🤖 Workspace-AI            [⤢ Compact] [⌫ Clear] [✕]
 ● your Assistant · 12.4k tok · €0.08
[ Chat ] [ Signals 3 ] [ Suggestions 2 ]
────────────────────────────────────────
 🤖 DEV-1240 finished Coding. Promote to Review?
    ┌──────────────────────────────────┐
    │ Promote DEV-1240 → Review?        │
    │       [ Approve ]  [ Reject ]     │   ← question card (doc 09)
    └──────────────────────────────────┘
 me  yes, promote it
 🤖 Proposing promote… (Conductor will execute)
────────────────────────────────────────
 ticket DEV-1240   [Pause][Resume][Promote][Stop]
 [ Ask the AI to do something…            ➤ ]
```

---

## Data

No new persisted entities. Everything renders existing models / projections:
- **Chat** uses the existing `ChatMessage{id,role,text}`, plus the already-declared optional **`ChatMessage.questionSetId`** (owned by doc 09 / `[02 §5]`) to render a question card in a bubble — surfaced here, not introduced here.
- **Signal stream** reads `WorkspaceSignal` (`[02 §6]`, already in 04). **Suggestions** read `WorkspaceSuggestion`; **notifications** read `Notification` — the UI `AiSuggestion` / `NotificationItem` stubs in `types.ts` are their read-projections (no change).
- **Telemetry** surfaces `AgentSession.tokenEstimate` + the per-stage `avgTokensPerTurn` — both **owned by doc 05**, merely displayed here.

The only **ui-only** state is panel-local (active tab, search string, optimistic "requested" flags on control buttons) — none persisted, matching how `AIPanel` holds `tab`/`draft`/`width` today in `Shell.tsx`.

**INDEX delta:** (none — reuses `ChatMessage` + `ChatMessage.questionSetId` (09), `WorkspaceSignal`/`WorkspaceSuggestion`/`Notification` (02 §6 / 04), `AgentSession.tokenEstimate` (05); introduces no new field)

---

## Verbs / Events / Hooks

**No new verbs.**

- **Assistant verbs** (`[02 §2]`), all read/propose: `get_ticket` + `list_tickets` (ticket-context view, search, "how is X doing?"), `read_pipeline` (config-review proposals from chat, `[03 §4]`), `propose_suggestion` (the inline proposal bubbles + Suggestions tab), `draft_questionset` (normalize a stuck-agent's raw questions into the cards shown in chat, `[02 §5]`), `refresh_docs` (a "refresh docs" chat ask → the allow-listed `ai:refresh-docs` command, `[03 §2]`).
- **Socket events** (`[05 P1]` `ws-ai:*` contract, the panel's wire surface): client→server `chat`, `attach`, `detach`, `reply {ticketId,answers}` (question-card submit), `control {ticketId,action:'pause'|'resume'|'stop'|'promote'}` (the RBAC action buttons — **propose** only). Server→client `stream`, `status`, `event`, `needs-input {questionSet}`, `suggestion`, `notification`, `exit`. These replace the dummy `sendChat`/`parseMove` (`[05 P1-E]`).
- **Hooks:** consumed indirectly — the `event` / `status` / `needs-input` streams are the orchestrator's projection of the lifecycle hooks (`[02 §3]`: `PostToolUse`→`event`, `Notification`→`needs-input`, `Stop`→done/promote-offer). The panel renders them; it neither defines nor toggles hooks.
- **Governance:** every action button and every Accept is **propose → Conductor executes**, RBAC-gated (`[01 §4]`, `[02 §7]`). The Assistant has **no write verb** (`[01 §3.2]`), so B-23 is structural, not UI discipline — the buttons can't bypass it even if mis-wired.

---

## UI

**Reused (real components)**
- `AIPanel`, `PanelTab`, `ChatBubble`, `useTypewriter`, `SuggestionCard` — all already in `_shell/Shell.tsx`; this doc expands them rather than replacing.
- The resizable `motion.aside` shell + drag handle + `PANEL_TRANSITION` (kept verbatim).
- `IconButton`, `WsButton`, `AvatarBubble` (`_components/primitives`); `Popover`/`SPRING_SOFT` (`_components/motion`).
- `useWorkspaces` context (extend with real `ws-ai:*` plumbing in place of `sendChat`).
- The question-card component from **doc 09** (rendered inline when `questionSetId` is set).

**New (small, scoped) components**
- `SignalStreamTab` (color-coded append-only list; a `SIGNAL_TINT: Record<WorkspaceSignal['type'], string>` map mirroring the `MODE_TINT` pattern in `Pipeline.tsx`).
- `SessionTelemetryStrip` (status dot + token/cost chip per visible session; reads the `[05]` projection).
- `TicketControlBar` (the Pause/Resume/Promote/Stop propose buttons, RBAC-disabled with tooltips).
- `PanelSearch` (filter box over tickets/signals/suggestions).
- A `ProposalBubble` variant of `ChatBubble` (Accept/Dismiss footer for an inline proposed control/config change).

**Mobile parity:** the panel is already full-screen on mobile; tabs scroll horizontally, control buttons are full-width, question cards render inline (the core mobile answer path, `[02 §5]`). The telemetry strip collapses to a single status+token chip on narrow widths.

---

## Extends

- `[01 §3.2]` — "Assistant (the per-user chat)": one PTY per active user per workspace, spawned on connect, **suspended on disconnect / idle TTL**, has **no write verbs**.
- `[01 §4]` (RBAC / proposes-only boundary, the `[02 §7]` table): "Promote A→B … user accept; the Conductor executes"; "no Assistant session has any write verb."
- `[02 §2]` — the Assistant verb surface (`get_ticket`, `list_tickets`, `read_pipeline`, `propose_suggestion`, `draft_questionset`, `refresh_docs`) + the background-reasoning note (same surface, no chat thread).
- `[02 §3]` — the hooks that source the `event`/`status`/`needs-input` streams this panel renders.
- `[02 §5]` — Question / approval flow: `ChatMessage.questionSetId`, the chat panel as the **free-text fallback** that interprets a reply into `answers`.
- `[02 §6]` — `WorkspaceSignal` (the stream, with its `type` enum) / `WorkspaceSuggestion` / `Notification` (the projections).
- `[03 §4]` — "Workspace-AI as a pipeline-authoring assistant": `read_pipeline` → `config-review` `WorkspaceSuggestion` with an appliable `patch`, surfaced as a chat proposal.
- `[05 P1]` — the `ws-ai:*` socket-event contract (client/server message list) + the **P1-E** lane ("replace dummy `sendChat`/`parseMove`/`moveTicket` with `ws-ai:*`; stream into existing `ChatBubble`/`useTypewriter`; … Compact/Clear buttons").

---

## Resolved

1. **Signal-stream volume.** The signal stream is **virtualized**, low-priority `observation` types are **collapsed by default**, and the feed is **scoped to the user's visible tickets** (RBAC read scope). All three apply together.
2. **Control-button confirmation.** `stop` (destructive — tears down a worker) requires a `menuHandler.confirm` before proposing; pause / resume / promote propose directly. All four remain propose → Conductor executes (never a direct write).
3. **Telemetry visibility scope.** For a non-admin Member the strip shows **their own Assistant + worker sessions on tickets they can see** (RBAC read scope) — nothing beyond that read scope.
4. **Compact UX.** Compact is **both**: **auto at the context budget** AND a **manual "Optimize now" button** to force it early. During either path the header shows an **"optimizing context…" state** for the duration of the round-trip.
5. **Optimistic control state.** A control button holds the "requested…" state then **times out at ~10s** if the Conductor never confirms via `ws-ai:status` (e.g. the workspace is `stopped` on a rate limit).
