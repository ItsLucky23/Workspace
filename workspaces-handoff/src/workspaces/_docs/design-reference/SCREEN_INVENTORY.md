# Screen inventory — Workspaces prototype

Every screen, overlay, and state in `prototype/`, with the source file and the key states to
reproduce. Use this as the checklist when building each page in Phase B.

The router lives in `App.jsx`: the left nav + the browser-style tab bar both drive a single
`view`. Ticket tabs use the `DEV-####` id as the view. Overlays are tracked in a `modal` state.

---

## Auth & onboarding — `Auth.jsx` (plain layout, no app chrome)
Reachable in the prototype via the kit toolbar **View** dropdown.
- **Login** — centered card, "Welcome to Workspaces", OAuth buttons (GitLab primary, GitHub
  secondary), idle/connecting states, footer "Self-hosted · your code stays yours".
- **Link SSH key** — paste public key + name, Verify (spinner → linked), linked-keys list,
  "Terminal access enabled/disabled" badge, "Terminals locked" warning until linked.
- **Accept invite** — "Sanne invited you to YouComm Core as Admin", workspace avatar + role badge,
  Accept / Decline.
- **Onboarding wizard** — 4 steps: name+slug → connect GitLab (verify ✓/✗) → select projects →
  first index (progress bar + per-source rows). States: empty → indexing → done.

## App shell — `Shell.jsx`
- **NavRail** — folds (56px) / expands (248px), tooltips when folded; items: Board, Backlog,
  Terminals, Activity, Sources, Pipeline, Usage; bottom: Workspace-AI (badge), Settings, avatar.
- **TopBar** — workspace switcher (menu: Create workspace / Manage members), project switcher,
  ⌘K search, presence AvatarStack, notification bell (unread badge), theme toggle, avatar menu
  (Account / Theme / Language / Sign out).
- **TabBar** — fixed Board tab + one tab per open ticket (live status dot, × to close), quick-open
  **+** menu (Open ticket / New terminal / New ticket), Workspace-AI toggle (suggestion count).
- **AIPanel** — right context panel (suggestions); collapsible.
- **MobileBottomBar** — Board / Terminals / Activity / AI + center FAB (→ voice); hamburger drawer.

## Board — `Board.jsx`  (view: `board`)
Kanban across the 7 stages. Card: id, title, status pill (busy pulses), labels, viewers/AvatarStack,
cost chip, live-terminal dot, drag-grip on hover, ⋯ context menu. Per-column "+ Add ticket" button.
- Column header: name, count, AI marker, WIP-over-limit warning (Plan).
- Header tools: Sprint dropdown (+ Manage sprints), Pause-all, Filter, + Ticket.
- States: normal, "no AI" columns (dimmed), needs-input/busy/done cards, empty column.
- Overlays: **Quick view** sheet, **card context-menu**, **Create ticket** modal, **Filter** sheet.

## Ticket detail — `TicketDetail.jsx`  (view: `DEV-####`)
Header: id, issue #, title, stage badge, sprint, branch, MR, labels, cost chip, preview-deploy chip,
status dropdown, viewers. Banners: needs-input (with reply), done (Promote to next stage).
Tabs: **Overview** (description, carry-over, stage config, actions: Open in GitLab / Open terminal /
Teardown), **Terminal** (embedded), **Files & refs** (diff list + Add reference), **Activity**
(filtered log), **Links** (related + AI-suggested), **Stage history** (timeline).
- Overlays: **Reference picker**, **Promote preview**, **Teardown** (type-to-confirm `DEV-####`).

## Terminals — `Terminals.jsx`  (view: `terminals`)
Multi-terminal workspace (dark surface always). Per terminal: ticket + stage + process, status
(busy / needs-input + reply box), process sub-tabs (server/client/claude), cwd/exit bar, ⋯ menu
(Restart / Kill / Pop out / Split / Rename / Copy / Clear).
- **SSH-unlock overlay** (Unlock → spinner → live). Layouts: grid / tabs / split.
- Mobile: full-screen terminal + special-key bar (Tab/Ctrl/Esc/↑↓).
- States: connecting, live, disconnected/reattaching, exited, locked, empty.

## Pipeline editor — `Pipeline.jsx`  (view: `pipeline`)
Horizontal stage flow (selectable, AI/no-AI badge, + Stage). Per-stage config tabs: **General**
(AI toggle, instructions, status chips), **Context & skills** (doc + skill toggles), **Commands**,
**Tool access** (Mongo/Redis ro↔rw + rw warning), **Visibility**, **Process** (terminals × cmds),
**Prompt-injection** (template + `{{chips}}` + live preview + JSON-schema toggle), **Model & effort**
(model, effort, extended-thinking, max-turns/budget), **Sandbox** (allowed/denied domains), **Hooks**.
- "Validate with AI" → inline warning banners. Delete-stage confirm.

## Backlog — `Backlog.jsx`  (view: `backlog`)
Table (desktop) / row-cards (mobile). Columns: checkbox, id, title, stage, status, AI/who, labels,
sprint, last. Working **search box**, quick-filter segments (All/Unrefined/Needs input/Done),
**Filter** sheet, **sortable** columns (stage/status/last), **bulk-select** mode + floating action
bar (Move / Set status / Assign / Add to sprint / Archive). Empty/filtered-empty states.

## Sources — `Sources.jsx`  (view: `sources`)
Index-health banner; tabs **Context docs** (project-summary, conventions, glossary, db-schema,
uploaded spec — preview / regenerate / frozen@commit) and **Skills/MCP** (RAG, graphify,
symbol-index, route-index, git-history, test-runner, deps-audit, cross-ticket — toggle, frozen/live
badge, index status, Details, Reindex). Overlays: **Source preview**, **Skill detail**, **Upload
spec**, **Reindex confirm**. States: healthy, indexing, stale, error.

## Workspace-AI — `AIScreen.jsx`  (view: `ai`)
Tabs: **Suggestions** (cards with Accept / Dismiss / Snooze / Details), **Notes**, **Config review**
(→ Go to pipeline), **Watch** (→ Reindex sources). Empty "All caught up ✨". Overlay: **Suggestion
detail** sheet (accept-with-preview). Also appears as the right-side AIPanel on board/ticket views.

## Activity — `Activity.jsx`  (view: `activity`)
Live event stream: time, actor (🤖 AI / member / merge), ticket chip, event-type badge
(command/file/message/status/mr), summary. Live/Paused, **Rewind** scrubber (+ Back to live),
event **diff/output expand**, reconnect banner, Live/Audit tabs.

## Settings — `Settings.jsx`  (view: `settings` = Account, `workspace` = org)
- **Account:** profile (avatar, name, email, theme, language), connections (GitLab/GitHub),
  SSH keys (+ Add key sheet), sessions (+ Revoke / Revoke all others), web-push, data export.
- **Workspace/org:** tabs Members (role chips + ⋯ menu → role change / remove confirms),
  **Permissions** matrix (Owner/Admin/Member × capabilities), Invites (+ Invite modal),
  Integrations (GitLab token + Verify), Danger (transfer / delete, type-to-confirm).

## Usage — `Usage.jsx`  (view: `usage`)
Budget bar (spent/cap, ≥80% alert), 7-day spend spark, breakdown table (ticket · tokens · cost ·
time), Budget settings, cap-reached modal ("agents auto-paused" → Raise cap / Resume).

## Overlays catalog — `Overlays.jsx` + `Overlays2.jsx`
Command palette (⌘K), Voice capture (mobile bottom-sheet), Create workspace, Create/Edit ticket,
Invite members, Confirm (+ optional type-to-confirm), Notification center, Sprint create/edit,
Sprints manager, Budget cap, Reference picker, Promote preview, Ticket quickview, Board filter,
Suggestion detail, Skill detail, Source preview, Upload spec, Add SSH key.

---

## Seed data — `data.js`
- **Workspaces:** YouComm Core (active), LuckyStack OSS. **Project:** youcomm-app.
- **Members:** Mathijs (Owner), Sanne (Admin), Tom/Lina/Daan (Member); pending invite joost@youcomm.nl.
- **Pipeline:** Unrefined (no AI) → Refined → Plan → Implementatie → Test → Review → Final.
- **Tickets:** 12 (DEV-1240…1251) across the stages with statuses + 3 live terminals.
- Plus: notifications, sprints (with dates), budget/usage rows, per-ticket cost, models, sources,
  skills, events, sessions, SSH keys. Keep this dataset consistent across pages.
