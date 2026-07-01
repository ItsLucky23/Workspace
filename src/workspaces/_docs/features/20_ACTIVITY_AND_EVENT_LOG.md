# 20 — Activity & event log

> The workspace-wide and per-ticket event feed: a live, append-only stream of `TicketEvent`s (commands, file-changes, AI messages, status/stage moves, MRs, comments), with deep-links, reconnect catch-up, and a rewind scrubber. Extends [02 §3] (hooks are the event source) and [02 §6] (the append-only log). Builds on the existing `Activity.tsx` screen + the `TicketDetail` Activity tab.

This doc turns the existing Activity screen into the real append-only event-log view. Every event is a `TicketEvent` the **Conductor** appended (from a hook or a verb) — the client never writes the log, it subscribes. It documents the actor/type chips, the LIVE badge + reconnect catch-up (B-22 subscribe-first → snapshot → merge-on-seq), deep-linking from an event to its ticket (D65), click-to-expand (reusing `FileDiffViewer` for file events), and the **rewind scrubber** that replays events against the carry-over `commitHash` snapshots (D64 — no new storage).

---

## Scope

**In**
- The **workspace-wide** chronological feed (`Activity.tsx`) and the **per-ticket** feed (`TicketDetail` Activity tab) over the same `TicketEvent` stream.
- **Actor + type chips**: actor (member / `ai` / `mr`) with avatar/badge; type (`command` / `file-change` / `ai-message` / `status-change` / `mr` / `comment`) with its tint.
- **Deep-link** (D65): clicking a ticket id / event navigates in-app via `navigate({ view, ticketId?, tab?, terminalId? })`; documents the future real URL routes.
- The **LIVE badge** + **reconnect / catch-up banner** (B-22): subscribe-first → snapshot via `_api` → merge-on-`seq`.
- The **REWIND scrubber** (D64): event-replay between carry-over `commitHash` snapshots — show the frozen file-set at each stage commit, replay the events in between. **No new storage.**
- **Event click-to-expand**: a `file-change` event expands to its diff (reuse `FileDiffViewer` / `DiffView`); other types expand to their full text/payload.
- **Filters**: by actor (All / AI / People / Merges) and by type.

**Out**
- *Producing* the events — that's the hooks ([02 §3]) + verbs ([02 §2]) the Conductor turns into `TicketEvent`s; this screen never writes.
- The notification feed (`needs-input` / merge / ai-suggestion / container-failure) — that's the notifications surface; Activity is the raw event log, not the alert inbox.
- The terminal live output (doc 14) — Activity shows the *narrated* `command` / `file-change` events from `PostToolUse`, not raw PTY bytes.

**Deferred**
- Saved filter presets / per-actor saved views.
- Cross-workspace activity (one workspace at a time in v1).
- Exporting the log (the durable `TicketEvent` rows are the audit; export is later).

---

## User flow

1. **Open Activity.** The workspace-wide feed renders newest-first as a timeline (avatar/actor badge + connector line). A **LIVE** badge (pulsing dot) sits by the title; new events stream in at the top via the `workspace-<wsId>` room ([01 §5]).
2. **Read an event.** Each row shows the **actor name** (member / "Workspace agent" for `ai` / "GitLab" for `mr`), a **type chip** (`command` / `file` / `ai` / `status` / `merge` / `comment` with its tint), the **ticket id** (clickable), and the relative `time`.
3. **Filter.** A `Segmented` toggles **All / AI / People / Merges** (the existing `matches()` predicate); a secondary type filter narrows to one event type. Filters are client-side over the loaded window.
4. **Click to expand.** Clicking a row expands it in place: a **`file-change`** event reveals its diff via **`FileDiffViewer`** (the file's `TicketFile.diff`); a `command` shows full stdout/stderr; an `ai-message` shows the full message; `mr`/`status-change`/`comment` show their payload. Collapsed by default to keep the timeline scannable.
5. **Deep-link to the ticket (D65).** Clicking the ticket id (or "open") calls **`navigate({ view:'ticket', ticketId, tab:'activity' })`** — the in-app router jumps to that ticket's Activity tab. The same `navigate({...})` shape backs Notifications, ⌘K, and search (doc-level cross-cutting). Real URL routes (e.g. `/ws/:id/ticket/:tid?tab=activity`) are documented as a **future extension** layered on the same call.
6. **Reconnect / catch-up (B-22).** On a socket drop (mobile background, Wi-Fi flap) the LIVE badge flips to a **"reconnecting… catching up"** banner. On reconnect the client **subscribes first**, fetches a **snapshot** via `_api`, then **merges on `seq`** — no gaps, no dupes — and the banner clears. The `seq` is the Redis-`INCR` per-ticket sequence ([01 §5]).
7. **Rewind (D64).** A **scrubber** at the top of a ticket's feed lets the user scrub back through the ticket's life. It is **event-replay over carry-over `commitHash` snapshots**: at each stage boundary the carry-over envelope froze a `commitHash` ([02 §4]) — the scrubber shows the **frozen file-set at that commit** (via `FileDiffViewer`/the snapshot) and **replays the `TicketEvent`s between** consecutive commits. Because both the `TicketEvent` log and the `CarryOver.commitHash` snapshots already persist, rewind needs **no new storage** — only a client-side **cursor** into the existing ordered log.

**Desktop:** the workspace feed is a centered `max-w-3xl` timeline; the per-ticket feed is the compact `ActivityTab` list. The rewind scrubber pins above the per-ticket feed.

**Mobile:** identical timeline, full-width; the `Segmented` filter wraps; expanded diffs use the `FileDiffViewer` mobile layout (the file-list sidebar is `hidden md:block`, so mobile shows the diffs stacked). Reconnect catch-up is the common "look from the beach" path — a backgrounded phone re-syncs the feed on resume.

```
┌ Activity                        ● live      [ All | AI | People | Merges ] ┐
│ ⟲ reconnecting… catching up (merging on seq)                              │  ← B-22 catch-up
├────────────────────────────────────────────────────────────────────────────┤
│ 🤖 Workspace agent  [command]  DEV-1240 · 14:32                            │
│    `npm test` → 2 failing                                       ▸ expand    │
│ 🤖 Workspace agent  [file]     DEV-1240 · 14:31                            │
│    edited src/_components/Avatar.tsx (+12 −4)        ▾  ┌ diff via FileDiff ┐│
│ S  Sanne            [status]   DEV-1241 · 14:29  → needs input              │
│ 🔀 GitLab           [merge]    DEV-1246 · 14:18  merged !88 into main       │
└────────────────────────────────────────────────────────────────────────────┘
 Rewind ◀━━━━━━●━━━━▶  (replay events between commit snapshots — D64)
```

---

## Data

No new persisted model. The screen renders the existing **`ActivityEvent`** (`{ time, actor, ticketId, type:'command'|'file-change'|'ai-message'|'status-change'|'mr'|'comment', text }`) from `_data/types.ts` — the UI projection of the append-only **`TicketEvent`** (DATAMODEL §6: per-ticket, `seq`-ordered, `type`, `payload`). The real model carries the `seq` the catch-up merge keys on (DATAMODEL §6); the UI stub's render order stands in for it in the prototype.

- **Actor / type tints** are the existing `EVENT_TINT` / `EVENT_LABEL` maps in `Activity.tsx` (and the parallel `EVENT_TINT` in `TicketDetail.tsx`).
- **File-change expansion** reuses the existing **`TicketFile`** (`{ path, add, del, diff?: DiffLine[] }`) already on `Ticket.files` and rendered by `FileDiffViewer` — the diff is *already there*, the screen just links the event to it.
- **Deep-link navigate args** — the in-app `navigate({ view, ticketId?, tab?, terminalId? })` is the existing `WorkspacesContext` navigation surface (D65); not a persisted field.
- **Rewind cursor** — a **ui-only** client cursor `{ ticketId, seq | commitHash }` into the existing ordered `TicketEvent` log + the `CarryOver.commitHash` snapshots. Not persisted (D64: no new storage).

**INDEX delta:** (none — reuses `ActivityEvent` / `TicketEvent`, `TicketFile`; the rewind cursor is derived UI-only)

---

## Verbs / Events / Hooks

**No new verbs.**

- **Source = hooks → Conductor append (no client writes).** Events originate from Claude **`type:http` hooks** ([02 §3]): `PostToolUse(Bash/Edit/Write/mcp__*)` → `command`/`file-change` `TicketEvent`; `PostToolUseFailure` → error event; `UserPromptSubmit` → user-input event; `Stop` → status/done transitions. Narrated milestones come from the worker's **`emit_event`** verb ([02 §2]). In every case the **Conductor** is the only writer ([01 §3.3], [02 §6]) — the Activity screen **subscribes**, never appends (B-23).
- **Live + catch-up (B-21/B-22):** events fan out to the `workspace-<wsId>` room via the Redis socket adapter ([01 §5]); the client uses **subscribe-first → snapshot → merge-on-`seq`** (B-22) on reconnect, deduping/ordering on the per-ticket `seq` (B-21).
- **Deep-link** is pure client navigation (`navigate({...})`, D65) — no verb, no server write.
- **Rewind** is read-only replay over the existing `TicketEvent` log + `CarryOver` snapshots — no verb, no new storage (D64).
- **Hooks:** none **new** here; this screen is the *consumer* of the [02 §3] hook-sourced log, not a producer of hooks.

---

## UI

**Reused (real names):**
- `Activity.tsx` — the workspace-wide timeline: `EVENT_TINT`, `EVENT_LABEL`, `matches()` filter, `ActorBadge`, `actorName()`, the `Segmented` actor filter, and the existing **● live** badge.
- `TicketDetail.tsx` **Activity** tab (`ActivityTab`) — the per-ticket compact feed (already filters `EVENTS` by `ticketId`); the rewind scrubber mounts above it.
- `FileDiffViewer` + `DiffView` — the **file-change expansion** (the `08`-interim viewer; reused read-only) and the rewind snapshot file-set.
- `WorkspacesContext` — `openTicket` / `navigate` (the deep-link target, D65); `AvatarBubble`, `MEMBERS`.
- Primitives: `Segmented`, `EmptyState`, `Icon`, `AvatarBubble`.

**New (small):**
- A **type filter** control (alongside the existing actor `Segmented`) — a compact chip row over the loaded events.
- An **expand/collapse** affordance on each row (the row already renders `text`; this adds the in-place expansion that mounts `FileDiffViewer` for `file-change`).
- A **catch-up banner** state on the LIVE badge ("reconnecting… catching up") driven by the socket lifecycle (B-22).
- The **rewind scrubber** — a slider over the ticket's `seq`/`commitHash` cursor that swaps the feed between "replay" and "live" (no new persistence; a client cursor).

**Mobile parity:** the timeline is full-width; the actor filter `Segmented` + the new type filter wrap; expanded diffs stack (the `FileDiffViewer` file-list is `hidden md:block`). Reconnect catch-up is the expected mobile resume path.

---

## Extends

- "[02 §3] Hooks — the lifecycle/event backbone" — `PostToolUse`/`PostToolUseFailure`/`UserPromptSubmit`/`Stop` are the event **source**; this screen renders what they append. The hooks fire in interactive sessions too, so the live feed reflects real agent activity.
- "[02 §6] Signals / Suggestions / Notes / Notifications" — the append-only, `seq`-ordered, Conductor-consumed log is exactly the durable `TicketEvent` stream Activity projects; no client write path (B-23).
- "[01 §5] Real-time multi-client + contention" — fan-out via the Redis socket adapter to `workspace-<wsId>`; the **subscribe-first → snapshot → merge-on-`seq`** catch-up that handles mobile drop-offs.
- "[02 §4] Carry-over envelope" — the `commitHash` frozen at each stage boundary is the snapshot the **rewind** scrubber pins to; replay walks the `TicketEvent`s between consecutive commits (D64).
- **DATAMODEL §6** — the append-only `TicketEvent` model (per-ticket, `seq`, `type`, `payload`) the `ActivityEvent` stub projects; `seq` is the merge/dedupe key.
- **B-21 / B-22** — per-ticket `seq` ordering; subscribe-first → snapshot → merge-on-seq reconnect.
- **D64** (rewind = event-replay + carry-over `commitHash` snapshots, no new storage) and **D65** (in-app `navigate({view,ticketId?,tab?,terminalId?})` now + documented URL routes later).

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D83)

1. **20.q1 — Workspace-feed catch-up window → D83:** catch-up snapshots a **bounded recent window** (e.g. last N hours / M events) and **lazy-loads older**; per-ticket `seq` dedupes within a ticket.
