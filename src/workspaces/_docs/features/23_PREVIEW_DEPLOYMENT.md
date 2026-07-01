# 23 — Preview deployment ("Open preview")

> The per-ticket live-app preview: an **"Open preview"** badge on the ticket header/card with **building / live / down** states, served from a per-ticket PROD container on `dev-<ticketId>.<domain>` ([07 §B]). The build is **on-demand + non-blocking** (navigate away while it loads) with a **30-minute TTL that resets on every open** and **auto-teardown** on expiry/close (D67). Introduces the **`PreviewDeployment`** entity (D68). Extends `[01 §3.3]` (Conductor = the only writer of status/lifecycle), `[07 §A]` (launch/teardown sequence), `[07 §B]` (the Caddy subdomain proxy + the DEV/PROD port model, B-13), and feature 03 (the container/worktree the preview builds from).

---

## Scope

**In**
- An **"Open preview"** control on the ticket **header** (`TicketDetail.tsx`) and the board **card** (`Board.tsx`), reflecting one of three states — **building** / **live** / **down** — driven by a `PreviewDeployment` row (D68).
- **On-demand build**: clicking "Open preview" starts a per-ticket **PROD-mode** container (single port, B-13) and registers a Caddy route on `dev-<ticketId>.<domain>` ([07 §B]).
- **Non-blocking**: the build runs in the background; the user can navigate away (open another ticket, the board, the AI panel) while it builds and come back — the state chip tracks it live (D67).
- **30-minute TTL, reset-on-open**: `ttlExpiresAt = now + 30m`, **bumped on every open**; on expiry → **auto-teardown** (Caddy route DELETE + container remove, [07 §A]/[07 §B]). Closing the preview also tears it down (or lets the TTL lapse).
- **Auto-per-stage**: an *optional* `WorkspaceTrigger` (`stage.on_complete → run-command: preview-up`) that pre-warms a preview per stage; off by default (D67).

**Out**
- The DEV 2-port model + boot-time env injection (`DNS=https://dev-<ticketId>.<domain>`, CORS/OAuth derivation) — that is **[07 §B]/G14/G15**; this doc uses the **PROD** single-port variant of the same Caddy mechanism. Cited, not restated.
- The container base image + the launch sequence internals — **[07 §A]/B-12**.
- Promoting a preview into a permanent environment / staging deploys (this is an ephemeral per-ticket preview, not a deploy pipeline).

**Deferred**
- A shared/persistent preview that outlives the TTL (v1 is strictly ephemeral, reset-on-open).
- Preview of an arbitrary historical commit (v1 previews the ticket's current worktree at its frozen `commitHash`, DH5).

---

## User flow

1. **Idle state.** Before any build, the header/card shows **"Open preview"** (neutral). There is no preview container running — previews are on-demand, not auto-spun (D67).
2. **Click "Open preview" → building (non-blocking).** The Conductor (the only writer, `[01 §3.3]`) creates a `PreviewDeployment{status:'building'}`, starts a PROD-mode container from the ticket's worktree ([07 §A] step 6, PROD single-port per B-13), and registers the Caddy route `dev-<ticketId>.<domain>` ([07 §B]). The chip flips to **building…** with a spinner. **The user can navigate away immediately** — the build continues; the chip on the card/header reflects progress wherever it's shown (D67).
3. **Live.** When the container is healthy, `status:'live'` + `url` populate; the chip becomes **● live · Open ↗** and opens `https://dev-<ticketId>.<domain>` in a new tab. Re-clicking opens the same URL and **resets the 30-min TTL** (`ttlExpiresAt = now + 30m`, D67).
4. **TTL expiry / close → down + auto-teardown.** If 30 minutes elapse without a reopen, the Conductor tears it down ([07 §A] teardown: pty/route/container) and sets `status:'down'`; the chip returns to **"Open preview"**. Closing the preview tab does not by itself teardown immediately (the TTL governs), but an explicit "Close preview" tears down now.
5. **Failure.** If the build/container fails to start, the chip shows **down · failed** and a `container-failure` notification fires (feature 18); the ticket's Terminal tab carries the build scrollback. Retry re-runs the same fixed `preview-up` action.
6. **Auto-per-stage (optional).** If the workspace enables the `stage.on_complete → preview-up` `WorkspaceTrigger` (doc 10), a preview pre-warms when a stage completes — same `PreviewDeployment` lifecycle, just kicked by the trigger instead of a click (D67).

### Desktop + mobile + mockup

- **Desktop:** the existing header `MetaChip` ("Preview · live") in `TicketDetail.tsx` becomes the live state of this feature (currently hardcoded `tone="correct"`); the board card gets a compact preview dot. Clicking opens the new tab.
- **Mobile:** the chip is a full-width tap target on the ticket sheet; "Open preview" opens `dev-<ticketId>.<domain>` in the mobile browser. Building is non-blocking — back out to the board and the card dot tracks it.

```
DEV-1240  ·  #1240  ·  busy
 [⎇ DEV-1240] [⑃ !88] [€1.18·12m]  [↗ Preview · ● live]   ← click → opens dev-1240.<domain>
                                    states: ○ Open preview · ◐ building… · ● live · ✗ down
 TTL 30m (resets on open) · auto-teardown on expiry
```

---

## Data

A new ui-only/server entity (D68):

| Field | Type | Validation |
|---|---|---|
| `PreviewDeployment.ticketId` | `string` | the ticket this preview serves; one active preview per ticket. |
| `PreviewDeployment.url` | `string` | `https://dev-<ticketId>.<domain>` ([07 §B]); set when `live`. |
| `PreviewDeployment.status` | `'building' \| 'live' \| 'down'` | the three chip states (D68). |
| `PreviewDeployment.startedAt` | `string` (ISO / display) | when the build kicked off. |
| `PreviewDeployment.port` | `number` | the PROD single port (B-13) the container exposes; Caddy upstream target. |
| `PreviewDeployment.ttlExpiresAt` | `string` (ISO / display) | `startedAt + 30m`, **bumped to `now + 30m` on every open**; expiry triggers auto-teardown (D67). |

Validation: `status` ∈ the three values; `ttlExpiresAt > now` while live; `port` > 0. One active `PreviewDeployment` per `ticketId` (a new build reuses/replaces the row). The container/route lifecycle is [07 §A]/[07 §B]; this row is the projection the UI renders.

**INDEX delta:** `PreviewDeployment`, `Workspace.previewConcurrencyCap` (net-new persisted, from D86 — the queue/live-preview-manager cap; bounded by a hard cap ~20)

---

## Verbs / Events / Hooks

**No new verbs.**

- **Open / close preview** → a **control-API** request the Conductor executes (`[01 §3.3]`) — the browser requests `preview-up` / `preview-down`; it never chooses the container/binary ([01 §8]). Not a verb, not a direct client write (B-23).
- **`run-command` allow-list** ([03 §2] / `OrchestratorCommandRegistry`): the build + Caddy route registration is a **registered** `preview-up` command (and `preview-down` for teardown), never raw shell. The Conductor drives [07 §A] launch (PROD single-port, B-13) + [07 §B] Caddy route POST/DELETE.
- **`WorkspaceTrigger` ([03 §1])**: auto-per-stage is the optional `{ on:'stage.on_complete', action:'run-command', command:'preview-up' }` trigger (off by default, D67). TTL expiry is a Conductor-side timer that fires `preview-down` — a deterministic lifecycle action, not a verb.
- **Notifications**: a build failure surfaces as a `container-failure` `Notification` (feature 18) — read-projection, no verb.
- **Status is AI-owned/read-only** (`[01 §3.3]`): the user's lever is the open/close control-API request; the `PreviewDeployment.status` is written by the Conductor.

---

## UI

**Reused (real components)**
- `TicketDetail.tsx` `TicketHeader` — the existing **"Preview · live" `MetaChip`** is replaced by the stateful preview chip (building/live/down) wired to the `PreviewDeployment` row; the chip click opens the URL / kicks `preview-up`.
- `Board.tsx` `KanbanCard` — a compact preview dot next to the existing `hasTerminal` pulse indicator (same row, same styling vocabulary).
- `WsButton`, `Icon`, `MetaChip`, `StatusPill` (`_components/primitives`); `menuHandler.confirm` for an explicit "Close preview now" (reuses the existing teardown confirm pattern in `OverviewTab`).
- The `container-failure` path reuses feature 18's notification surface.

**New (small, scoped)**
- A `PreviewBadge` component (the building/live/down state machine chip) — header + card variants share it; reads the `PreviewDeployment` projection.
- A `PREVIEW_TINT: Record<PreviewDeployment['status'], string>` map (mirrors the `EVENT_TINT`/`SOURCE_TINT` pattern).

**Mobile parity:** the badge is a full-width tap target on the ticket sheet; opening launches `dev-<ticketId>.<domain>` in the mobile browser. Non-blocking building is tracked by the card dot when backed out to the board (D67).

---

## Extends

- "[01 §3.3] Conductor = the only writer of status/lifecycle" — `PreviewDeployment.status` and the container/route lifecycle are Conductor-driven; open/close are control-API requests (B-23).
- "[07 §A] Ticket launch & teardown sequence" — the preview reuses the launch (container from the ticket worktree) + teardown (Caddy route DELETE + container remove) steps; TTL expiry re-uses the teardown path.
- "[07 §B] Caddy subdomain proxy" — the preview is served on `dev-<ticketId>.<domain>` via a Caddy admin-API route POSTed on build, DELETEd on teardown; v1 preview uses the **PROD single-port** variant (B-13) of the [07 §B] model. The DEV 2-port/HMR detail (G14) does not apply to a preview build.
- "feature 03 (build phase)" — the worktree + frozen `commitHash` (DH5) the preview container builds from.
- "feature 18 (notifications)" — a preview build failure → `container-failure` notification.
- "doc 10 (automations)" — the optional auto-per-stage `preview-up` `WorkspaceTrigger`.
- "B-13 — 2-terminal DEV (Vite :5173 → Node :80); PROD-mode (1 port) for a separate preview stage" — the preview uses the PROD single-port mode this decision reserves.

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D86)

1. **23.q1 — concurrent preview cap → ⚑ D86 (expanded):** the concurrent-preview limit is a **workspace setting with a safe default** (`Workspace.previewConcurrencyCap`), bounded by a **hard cap (e.g. 20)** matching the orchestrator's PTY budget. When the cap is hit, new "Open preview" requests **queue** (the chip shows "queued — N previews live") rather than failing, with **explanatory copy** about why items queue when too many PROD environments are live. A **live-preview manager** surface lists every live preview container with a per-preview **stop (turn off) control** so the user can free a slot, plus an explanation of the queue. Reuses the orchestrator resource-limit posture (B-26).
