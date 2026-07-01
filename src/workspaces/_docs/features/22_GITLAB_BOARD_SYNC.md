# 22 — GitLab board sync (board = a view on GitLab)

> The board is a **projection of GitLab**: tickets ⇄ GitLab issues, synced **bidirectionally**, with **GitLab winning on conflict** (B-29). The webhook ingest + serial reconcile mechanism lives in **[07 §C]** (cited, not restated here); this doc is the *feature* layer — what the user sees on the board, the per-workspace GitLab settings tab, and how a missed webhook self-heals. Extends `[01 §3.3]` (Conductor = the only writer of the board projection), `[02 §1]` (the stage/status state machine the projection drives), and `[07 §C]` (the ingest engine). Pairs with the setup/link flow (doc 01) which establishes the `Project.gitlabPath` + token (B-07).

---

## Scope

**In**
- The board as a **read-projection of GitLab issues** — `Ticket` rows mirror GitLab issues (`gitlabIssueId`/`gitlabIssueIid`, `labels[]` cached, DATAMODEL §4); `mr`/`branch`/`issue` chips already render on the card + header.
- **Bidirectional sync**: a GitLab-side change (issue created/edited/labelled/closed, MR opened/merged) reconciles into the board; a board-side change the Conductor makes (stage-move, status, link) reflects back to GitLab where it maps to a native concept (labels/state). The *mechanism* is [07 §C] — this doc is the surface + the user-visible reconciliation states.
- **Conflict resolution = GitLab WINS** (B-29). If a local projection and the authoritative GitLab state disagree, the reconcile job overwrites the local row; the user sees the board "snap" to GitLab and an event-log entry records it.
- A **reconcile-cron** that heals **missed webhooks** (B-29) — a periodic full re-fetch of authoritative GitLab state ([07 §C] cron).
- The **GitLab settings tab** (`WorkspaceSettings.tsx` `GitLabTab`): per-workspace base URL + **encrypted token** (`gitlabTokenEnc`, B-07) + a **Verify** action + a sync-health indicator.

**Out**
- The webhook endpoint, token-header auth, serial reconcile/delta queue, and the merge → RAG-delta hand-off — all **[07 §C]** (+ [07 §D]). This doc cites them; it does not restate the `pre-params`/origin-exempt seam, the `X-Gitlab-Token` check, or the bullmq worker.
- The first-time link/clone/seed flow — that is the build phase (feature 03) + setup (doc 01).
- Multi-repo / multiple GitLab projects per workspace (one `Project` = one repo in v1, per setup).

**Deferred**
- Syncing GitLab **comments/discussions** onto the ticket (v1 mirrors issue state + labels + MR status, not threaded discussion).
- A manual "force full re-sync now" button beyond the automatic cron (the cron + webhook cover it; a manual kick can be added as a control-API request later).

---

## User flow

1. **Connect GitLab (settings).** An Admin+ opens `WorkspaceSettings` → **GitLab** tab, sets the base URL + token, hits **Verify**. The token is stored **encrypted on the workspace row** (`gitlabTokenEnc`, B-07); Verify confirms the project (`gitlabPath`) is reachable. (RBAC: token/integration edits are Admin+, DATAMODEL §1 matrix.)
2. **Initial projection.** On connect (and via the build phase, feature 03), the Conductor fetches the authoritative issue set and materializes `Ticket` rows — the board fills with columns derived from the stage mapping ([02 §1]).
3. **GitLab → board (inbound).** Someone edits an issue / merges an MR in GitLab → a webhook hits the orchestrator → it enqueues a serial reconcile job ([07 §C]) → the Conductor (the only writer, `[01 §3.3]`) updates the projection → the change fans out live to the `workspace-<wsId>` room (subscribe-first → snapshot → merge-on-seq, B-22). The card animates to its new column (the board already wraps cards in a `LayoutGroup` with shared `layoutId` for exactly this, `Board.tsx`).
4. **Board → GitLab (outbound).** When the Conductor performs a board action that has a GitLab-native representation (move/close → labels/state), it writes through to GitLab via the same authoritative client. Status itself is AI-owned/read-only on the board (`[01 §3.3]`) — the user's levers are the three (answer / approve-promote / pause-resume), which the Conductor executes and then projects back.
5. **Conflict (GitLab wins).** If GitLab's authoritative state differs from the local projection on a reconcile, the job **overwrites local** (B-29). The board snaps to GitLab's state; a `stage-move`/`status-change` `TicketEvent` records "reconciled from GitLab" so the override is auditable.
6. **Missed-webhook heal.** A webhook drop (network blip) is healed by the **reconcile cron** ([07 §C]): the next full re-fetch detects the drift and applies it (GitLab wins). The GitLab tab shows a **sync-health** chip ("Synced · 2m ago" / "Reconciling…") so a stale board is never silent.

### Desktop + mobile + mockup

- **Desktop:** no new board chrome — the existing `Board.tsx` columns/cards are the projection; the GitLab tab gains the token/base-URL fields + Verify + a sync-health line. A reconcile shows as the existing card layout animation.
- **Mobile (D63):** the board is **read-only stage-segments + tap-to-open** (already in `BoardMobile`); inbound reconciles animate the same way. The GitLab settings tab is a single scrolling form.

```
WorkspaceSettings › GitLab
 GitLab is the source of truth for issues. Token stored encrypted.
 Base URL  [ https://gitlab.com ........... ]
 Token     [ •••••••••••••••• ]   [ Verify ]
 Project   youcomm/app
 ── Sync ────────────────────────────────────
 ● Synced · 2m ago    (cron heals missed webhooks)
 Conflict policy: GitLab wins (B-29)
```

---

## Data

No new persisted models — the GitLab linkage already exists on `Project` + `Ticket` (DATAMODEL §2 / §4):

| Field | Type | Note |
|---|---|---|
| `Project.gitlabPath` | `string` | `"youcomm/app"` — the linked repo (already in `types.ts` + DATAMODEL §2). |
| `Project.gitlabProjectId` | `string` (server) | GitLab numeric project id (DATAMODEL §2). |
| `Workspace.gitlabBaseUrl` | `string` (server) | self-hosted or gitlab.com (DATAMODEL §1). |
| `Workspace.gitlabTokenEnc` | `string?` (server, **encrypted**) | per-workspace token (B-07); never sent to the client. |
| `Ticket.gitlabIssueId` / `gitlabIssueIid` | `string` / `Int` (server) | the issue this ticket projects (DATAMODEL §4); UI shows `Ticket.issue`. |
| `Ticket.labels[]` | `string[]` | GitLab-native, **cached** (B-29); the board renders them as `LabelChip`. |

The webhook secret (`WS_GITLAB_HOOK_SECRET`) and the reconcile queue/cron are orchestrator infra ([07 §C]) — not persisted board data.

**INDEX delta:** (none)

---

## Verbs / Events / Hooks

**No new verbs.**

- **The Conductor is the only writer of the board projection** (`[01 §3.3]`) — inbound reconcile and outbound write-through are deterministic Conductor actions driven by the [07 §C] worker, not LLM verbs.
- **Webhook ingest + serial reconcile + missed-webhook cron** — all **[07 §C]** (the `pre-params`/origin-exempt route, the `X-Gitlab-Token` header check, the `concurrency:1` leased worker, the `node-cron` heal). Cited, not re-expressed.
- **GitLab settings (token/base-URL/Verify)** — a **control-API** request the Conductor executes (Admin+ RBAC); Verify is a read against GitLab. Not a verb.
- **Read verbs** (`[02 §2]`): the Assistant may `get_ticket`/`list_tickets` over the projection for chat queries — read only; it never writes to GitLab or the board (B-23).
- **`WorkspaceTrigger`:** an "on merge → promote / notify" automation is expressible as a trigger ([03 §1]) consuming the merge event; the merge event itself is sourced by [07 §C]. No new verb.

---

## UI

**Reused (real components)**
- `Board.tsx` — the board *is* the projection; `KanbanColumn`/`KanbanCard`, the `LayoutGroup` + shared `layoutId` animation (built for AI/reconcile-driven column moves), `LabelChip`, `StatusPill`, `BoardMobile` (the read-only mobile segments, D63). No board rewrite — sync just drives the data it already renders.
- `WorkspaceSettings.tsx` `GitLabTab` — already has the base-URL field + token + **Verify** button + the "GitLab is the source of truth" copy and `fieldCls` styling; this doc adds the **sync-health chip** under it.
- `TicketDetail.tsx` `TicketHeader` — the `issue`/`branch`/`mr` `MetaChip`s + the **GitLab** open-in button already render the projection.
- `Icon`, `WsButton`, `StatusPill` (`_components/primitives`).

**New (small, scoped)**
- A `SyncHealth` chip in `GitLabTab` (status dot + "Synced · Nm ago" / "Reconciling…", reads the [07 §C] reconcile heartbeat).
- A one-line "reconciled from GitLab" affordance in the Activity tab (reuses the existing `EVENT_TINT` `status-change` styling in `TicketDetail.tsx` — no new component).

**Mobile parity (D63):** board stays read-only stage-segments + tap-to-open; the GitLab tab collapses to a single scrolling form. Inbound reconciles animate identically.

---

## Extends

- "[01 §3.3] Conductor = the only writer of board/git/status" — every projection write (inbound + outbound) is a Conductor action; the AI reads only (B-23).
- "[02 §1] stage/status state machine" — the board columns the projection lands tickets into; GitLab issue state maps onto `(stageId, statusKey)`.
- "[07 §C] GitLab-webhook ingest + board sync mechanism" — the engine this feature surfaces: the `pre-params`/origin-exempt webhook route, header-token auth, the serial leased reconcile worker, GitLab-wins conflict resolution, and the missed-webhook cron. **Cited, not restated.**
- "[07 §A]/[07 §D]" — a `Merge Request Hook` merge triggers teardown ([07 §A]) and the RAG delta-index ([07 §D]); the board reflects the merged MR state.
- "doc 01 (workspace setup / link)" — establishes `Project.gitlabPath` + the per-workspace `gitlabTokenEnc` (B-07) this sync runs on.
- "B-29 — GitLab = source of truth; bidirectional; conflict → GitLab wins; reconcile-cron heals missed webhooks" — the locked decision this doc realizes.
- "B-07 — GitLab token per workspace, stored encrypted on the workspace row" — the auth the GitLab settings tab manages.

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D85)

1. **22.q1 — outbound mapping breadth → ⚑ D85 (deviates from the proposed label-encoding):** pipeline **stage state is NOT synced outbound** — it stays **board-local**. Outbound write-back is limited to GitLab-native concepts (issue open/close, ordinary labels); GitLab still wins on the fields it owns. **No `stage::*` labels are pushed.**
