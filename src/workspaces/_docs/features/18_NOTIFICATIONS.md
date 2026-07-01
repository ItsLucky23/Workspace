# 18 — Notifications (topbar bell · center · web-push)

> The cross-surface alert layer: the `TopBar` bell + unread badge, a grouped notification center (desktop dropdown / mobile sheet), and the PWA web-push opt-in. Extends `[01 §3.3]` (Conductor = the only writer of status, so notifications are read-projections), `[02 §2]` (everything maps to existing verbs/hooks — no new ones), `[02 §6]` (`WorkspaceSignal`/`WorkspaceSuggestion`/`Notification` projections), and `[02 §2 hook-sourced events]`. Renders the `Notification` model (B-34, DATAMODEL §9) into the `NotificationItem` projection already in `types.ts`. Notification fan-out to a user rides the same subscribe-first → snapshot → merge-on-seq path as everything else (B-22). The chat home for the same alerts is feature 11 (the AI panel's Signals/Suggestions tabs); this doc is the *workspace-chrome* surface.

---

## Scope

**In**
- The `TopBar` **bell** (already in `_shell/Shell.tsx`) with an **unread badge** (count of `Notification.read === false`), and the **mobile bottom-bar badge** mirror.
- A **notification center**: a desktop **dropdown** (Popover) anchored to the bell; a full-screen **bottom sheet** on mobile.
- **Grouping by `type` then time** — the four `NotificationItem['type']` values: `needs-input`, `merge`, `ai-suggestion`, `container-failure` (B-34). Newest-first within each group.
- **Deep-link on tap** (D65): each notification navigates in-app to the right place — ticket / terminal / AI-panel — via the existing `navigate`/`openTicket`/`toggleAi` context API.
- **Mark-all-read** + a **per-type filter** (no per-ticket filter v1, per the accepted default).
- **Web-push opt-in**: an inline permission banner → Service-Worker subscribe → a `PushSubscription` row (B-34, DATAMODEL §9).

**Out**
- Email delivery (`@luckystack/email`) — that channel is server-side fan-out keyed off the same `Notification.channels` array; this doc is the in-app + push surface only (B-34).
- The Signals/Suggestions *chat* surfaces — those are feature 11 (the AI panel). A `ai-suggestion` notification deep-links **into** that panel; it does not re-render the suggestion here.
- Authoring which events notify — that is the `WorkspaceTrigger` editor (doc 10) + the orchestrator hook wiring (`[02 §2]`); this doc consumes the resulting `Notification` rows.

**Deferred**
- Per-ticket notification filtering and "snooze a notification" (suggestion-snooze already exists on `WorkspaceSuggestion`).
- Notification preferences UI (per-type channel matrix: which types go to push vs email) — reserved on `Notification.channels`, surfaced later.

---

## User flow

1. **A lifecycle event fires.** A worker emits the structured event (`request_input`/`emit_event`/the `Stop`/`Notification` hooks, `[02 §2]`); the **Conductor** (the only writer, `[01 §3.3]`) writes a `Notification` row and fans it out to the user(s) in scope over the `workspace-<wsId>` room (subscribe-first → snapshot → merge-on-seq, B-22). The four trigger classes map 1:1 to the type enum: `request_input`/stuck → `needs-input`; MR merge webhook ([07 §C]) → `merge`; `propose_suggestion` → `ai-suggestion`; a container start/teardown failure ([07 §A]) → `container-failure`.
2. **Badge updates live.** The bell badge (`unread`) increments without a reload; the mobile bottom-bar shows the same count as a dot on the active-row.
3. **Open the center.** Click the bell (desktop) → a Popover dropdown drops below it; tap the bell row (mobile) → a bottom sheet slides up. Rows are **grouped by type**, each group a labelled section (`Needs input` · `Merges` · `AI suggestions` · `Container failures`), newest time first inside.
4. **Filter.** A row of type chips at the top toggles a single-type view (tap `Needs input` → only those); a chip is highlighted when active, tap again to clear. **Mark all read** sits in the header.
5. **Tap a notification → deep-link (D65).** The `navigate({view, ticketId?, tab?, terminalId?})` shape resolves:
   - `needs-input` → open the ticket on the **Overview** tab (the needs-input banner is there) — `openTicket(ticketId)`.
   - `merge` → open the ticket on the **Files & refs** tab (the merged diff).
   - `ai-suggestion` → `toggleAi()` + focus the AI panel's **Suggestions** tab (feature 11).
   - `container-failure` → open the ticket's **Terminal** tab (or Terminals screen) so the failure scrollback is visible.
   The tapped row flips `read = true` (optimistic; the Conductor confirms).
6. **Web-push opt-in.** First visit (or after a `needs-input` while the tab is backgrounded), an **inline banner** appears at the top of the center: "Get notified when an agent needs you — even when this tab is closed. [Enable]". `[Enable]` triggers the SW `pushManager.subscribe()`; on grant, the resulting `PushSubscription{endpoint, keys{p256dh, auth}}` is persisted (B-34, DATAMODEL §9). Declining hides the banner (re-offered only after a future high-signal event, not nagging).

### Desktop + mobile + mockup

- **Desktop:** bell in the `TopBar` right cluster (already there); the center is a `Popover` (~`w-96`) with a scrollable grouped list. Filter chips pinned under the header.
- **Mobile:** the bell lives in the mobile header / bottom bar; the center is a full-screen `Sheet` (the same `Sheet` used in `Sources.tsx`). Type chips scroll horizontally. The bottom-bar carries the unread dot.

```
🔔 Notifications              [ Mark all read ]
[ All ][ Needs input 1 ][ Merges ][ AI 2 ][ Failures 1 ]
─ Needs input ──────────────────────────────
 ❓ DEV-1241 needs your input        2m  ●
    AI asks where the MS client secret should live
─ Container failures ───────────────────────
 ⚠ Container failed to start         14m ●
    DEV-1244 — OOM while installing deps
─ AI suggestions ───────────────────────────
 🤖 Merge DEV-1241 & DEV-1249 epic   31m ●
─ Merges ───────────────────────────────────
 🔀 MR !88 merged → main (abc123)    1h
┌──────────────────────────────────────────┐
│ 🔔 Get push alerts even when closed [Enable]│
└──────────────────────────────────────────┘
```

---

## Data

No new persisted models — the `Notification` and `PushSubscription` models already exist (B-34, DATAMODEL §9). The UI renders the existing `NotificationItem` projection in `types.ts` (`id`, `type`, `title`, `body`, `ticketId?`, `time`, `read`).

| Field | Type | Validation / note |
|---|---|---|
| `NotificationItem.type` | `'needs-input' \| 'merge' \| 'ai-suggestion' \| 'container-failure'` | already in `types.ts`; the grouping key. Matches `Notification.type` (DATAMODEL §9). |
| `Notification.link` | `string?` (server model) | the deep-link target the Conductor stamps; the UI resolves it through `navigate(...)` (D65). Already on the Prisma model (DATAMODEL §9). |
| `Notification.channels` | `string[]` (`'inapp'\|'email'\|'push'`) | already on the model; `'push'` fan-out reads `PushSubscription`. Not surfaced as UI yet. |
| `PushSubscription` | `{ endpoint, keys{p256dh,auth} }` | already in DATAMODEL §9; created on Enable, keyed per user. No UI field beyond the on/off banner state. |

UI-only state: the active type-filter and the push-banner dismissed flag (panel-local, not persisted — same posture as `AIPanel` holding `tab`/`draft` in `Shell.tsx`).

**INDEX delta:** (none)

---

## Verbs / Events / Hooks

**No new verbs.** Notifications are a **read-projection of existing surfaces** — the structured channel `[02 §2]` is untouched.

- **Sourced from existing worker verbs / hooks** (`[02 §2]`): `request_input` (+ the `Notification` hook) → `needs-input`; the `Stop`/runaway watcher → `needs-input`; `emit_event` + the GitLab merge webhook ([07 §C]) → `merge`; `propose_suggestion` → `ai-suggestion`; a container launch/teardown failure ([07 §A]) → `container-failure`. The **Conductor** writes the `Notification` row and pushes it (`[01 §3.3]`) — the AI never writes a notification.
- **`WorkspaceTrigger` (`when → then`, `[03 §1]`):** which events *also* trigger an email/push beyond in-app is expressed as triggers + the `Notification.channels` array, not a verb. (Authoring lives in doc 10.)
- **No control-API levers here.** The bell is read + mark-read only; mark-read is a control-API request the Conductor executes (status is AI-owned, `[01 §3.3]`), not a verb and not a direct client write.
- **Web-push** is a browser/PWA SW capability (B-34) — `pushManager.subscribe()` → persist `PushSubscription`. Server-side push send reuses the same `Notification` fan-out; no new channel verb.

---

## UI

**Reused (real components)**
- `TopBar` bell (`_shell/Shell.tsx`) — already renders the bell + `unread` badge from `NOTIFICATIONS`; this doc wires the dropdown to its `onNotifications` handler (currently a stub).
- `MobileBottomBar` (`_shell/Shell.tsx`) — carries the unread dot.
- `Popover` (`_components/motion`) for the desktop dropdown; `Sheet` (same component `Sources.tsx` uses) for the mobile center.
- `Icon`, `IconButton`, `WsButton`, `StatusPill` (`_components/primitives`); the per-type glyph mirrors the `EVENT_TINT`/`ACTOR_GLYPH` pattern in `TicketDetail.tsx`.
- `useWorkspaces` — `navigate`/`openTicket`/`toggleAi`/`unreadNotifications` (the context already exposes `unreadNotifications`).

**New (small, scoped)**
- `NotificationCenter` — the grouped list body (desktop Popover content + mobile Sheet content share it), with a `NOTIF_TINT: Record<NotificationItem['type'], string>` map (mirrors `EVENT_TINT` in `TicketDetail.tsx`).
- `NotifTypeFilter` — the horizontal type-chip row.
- `PushOptInBanner` — the inline SW-subscribe banner.

**Mobile parity:** the center is a full-screen `Sheet`; chips scroll horizontally; rows are full-width tap targets that deep-link. The push banner renders identically (PWA SW is the mobile path B-34 targets first).

---

## Extends

- "[01 §3.3] Conductor = the only writer of board/git/status" — notifications are written by the Conductor and read-projected here; the AI proposes (a `propose_suggestion` becomes an `ai-suggestion` notification) but never writes one (B-23).
- "[02 §2] frozen verb surface + hook-sourced events" — the four notification types are projections of `request_input` / `emit_event` / the merge webhook / a container failure; no new verb.
- "[02 §6] `WorkspaceSignal` / `WorkspaceSuggestion` / `Notification`" — the `Notification` model (B-34, DATAMODEL §9) is the row this UI renders; the `NotificationItem` stub in `types.ts` is its read-projection.
- "[07 §C] GitLab-webhook ingest" — a `Merge Request Hook` merge is the source of a `merge` notification.
- "[07 §A] Ticket launch & teardown" — a container start/teardown failure is the source of a `container-failure` notification.
- "feature 11 (Workspace-AI panel)" — an `ai-suggestion` notification deep-links into the panel's Suggestions tab; the chat surface and the bell are two views of the same `propose_suggestion` output.
- "B-34 — notifications in-app + email + web-push (PWA SW); triggers needs-input/merge/AI-suggestion/container-failure" — the locked decision this doc realizes.
- "DATAMODEL §9 — `Notification` + `PushSubscription`" — the persisted models (no new persistence introduced).

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D80)

1. **18.q1 — push payload privacy → D80 (REVISED 2026-06-04 via `../REVIEW_AND_OPEN_QUESTIONS.md` Q-SEC-NOTIF-PUSH):** the push payload is **redacted by default** — title + "open to view"; the full notification body is fetched **in-app behind auth** on open. Full-body push is a **per-user opt-in**. This reverses the earlier full-body default after the security review (rule 19: needs-input text routinely references secrets).
