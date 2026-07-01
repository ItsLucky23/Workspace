# Workspaces UI — Feature-completion spec for Claude Design

> Paste this into Claude Design to add every missing screen, surface, menu, popover, sheet and state. Continues the existing UI kit — keep all foundations.

## Foundations (keep exactly as-is)
One responsive app: **desktop + mobile, light + dark**. FontAwesome solid icons. **Friendly/airy** style: rounded-2xl cards, generous whitespace, soft borders, light-first. Same theme tokens: `background`, `container1/2` (+hover/border), `title/common/muted/disabled`, `primary/secondary` (+hover/border), `correct/warning/wrong`, `overlay/focus-ring/divider`. Same seed data: workspace **YouComm Core**, project **youcomm-app**, 7-stage pipeline (Unrefined→Refined→Plan→Implementatie→Test→Review→Final), 12 tickets (DEV-1240…DEV-1251), 5 members (Mathijs=Owner, Sanne=Admin, Tom/Lina/Daan=Member), 3 live terminals. Reuse components: Avatar, Dropdown, MultiSelect, the slide-in stack-modal (MenuHandler, 200ms from the right on desktop / bottom-sheet on mobile), ConfirmMenu with optional type-to-confirm, Navbar, Tabs, StatusPill, KanbanCard. **Every overlay** uses that slide-in (desktop) / bottom-sheet (mobile) model. **Provide desktop AND mobile for every new surface (~99% phone parity).**

---

## PART 1 — Missing whole screens & flows

**A. Auth & onboarding** (plain layout, no app chrome)
- A1 **Login**: centered airy card, logo + "Welcome to Workspaces", OAuth buttons (GitLab primary, GitHub secondary), states idle / connecting ("Connecting…"). Footer "Self-hosted · your code stays yours".
- A2 **Link SSH key** (after first login): card "Link an SSH key to open terminals", friendly 2-line explainer ("your private key stays on your device; we only store the public half, like GitLab"), textarea to paste the public key + a name, a **Verify** step (challenge spinner), a list of linked keys (name · type · fingerprint · added · last used · remove), badge "Terminal access: enabled/disabled". Warning banner "Terminals locked" until a key is linked.
- A3 **Accept invite** (`/invite/:token`): card "Sanne invited you to **YouComm Core** as **Admin**", workspace avatar + role badge, Accept / Decline.

**B. Onboarding wizard** (first run / create workspace)
- Step 1: name + auto-slug. Step 2: connect GitLab (base URL + token, "Verify connection" → ✓/✗). Step 3: select project(s) from GitLab. Step 4: **first index** — progress bar with ETA ("Indexing 4,210 / 12,400 files · ~3 min left"), per-source rows (summary / RAG / graph) with their own status; note "You can use the board while indexing." Empty → indexing → done states.

---

## PART 2 — New feature surfaces (not in the kit yet — add them)

**Notifications** (NEW)
- Topbar **bell** with unread badge → **Notification center** (desktop: dropdown panel; mobile: full sheet). Grouped list with type color: **needs-input** (yellow), **merge** (blue), **AI-suggestion** (purple/bot), **container-failure** (red). Each row: icon, title, body, ticket-chip, time, read/unread, deeplink. Controls: "Mark all read", filter by type. Notification → deeplinks to ticket/terminal/AI-panel.
- **Web-push permission** inline banner ("Enable push so you're pinged when an AI needs your input" → Enable / Not now) + a "push enabled" state in Account. Mobile: notification toast + bell/AI badge in the bottom bar.

**Spend & budget** (NEW)
- A **Usage** view (own nav item or under Workspace settings): per-workspace **budget bar** (spent / cap, % with alert color ≥80%), a simple spend-over-time chart, and a breakdown table (ticket · tokens in/out · cost · time). 
- **Per-ticket cost**: a "€0.42 · 12m" chip on the ticket-detail header and on card hover.
- **Budget settings**: monthly cap (cost), alert-at-%, auto-pause toggle.
- **"Budget cap reached"** modal/banner: "Agents auto-paused" + Raise cap / Resume.

**Runaway / stuck** (NEW states)
- A **"stuck"** status pill (orange) + idle indicator on terminals/cards; banner "Agent looks stuck — escalated to needs-input".

**Sprints** (NEW, with duration)
- **Sprint manager**: list (name · start–end dates · active badge · ticket count). **Create/edit sprint** modal (name, start date, end date via a DatePicker). Sprint picker on board/backlog shows the **date range + days left**; active-sprint highlight.

**Pause / kill controls** (NEW)
- Per-ticket **Pause/Resume** (card context-menu + ticket header) → "paused" status. Workspace-level **"Pause all agents"** control (topbar overflow or Usage view) → confirm → all-sessions-paused state.

**Per-ticket preview deployment** (NEW)
- On the ticket-detail header + card: an **"Open preview"** link/badge (the PROD-mode container subdomain) with status building / live / down.

---

## PART 3 — Complete the existing screens

**Pipeline-editor — add the MISSING config tabs** (currently only 6; map 1-to-1 to real Claude Code config):
- **Prompt-injection / Carry-over** tab: template textarea with chips `{{summary}}` `{{changedFiles}}` `{{openQuestions}}` `{{commitHash}}`; a "Structured output (JSON schema)" toggle showing the expected `{summary, changedFiles[], openQuestions[], commitHash}` shape; a live preview of the injected start-prompt.
- **Model & effort** tab: model dropdown (Haiku/Sonnet/Opus), effort segmented (low/med/high/xhigh/max), "extended thinking" toggle, **max-turns** + **max-budget-usd** inputs (runaway + budget caps).
- **Sandbox / egress** tab: "enable sandbox" toggle, **allowed-domains** list (add/remove: gitlab.internal, registry.npmjs.org…), denied-domains, a CPU/mem resource-limit hint.
- **Hooks** tab (mostly read-only/preconfigured): show which hooks fire (PostToolUse → activity-log, Notification → needs-input, Stop → done) with on/off toggles + note "these power the live activity + status".
- In **General**: editable **status chips** — base (needs-input/busy/done, locked) + "add custom".
- Stage-flow: drag-reorder visual state, "+ Stage" insert-between, **delete-stage** confirm, **"Validate with AI"** results shown inline as warning banners on the affected stages, save/saved state.

**Board — add**
- Drag states: card drag-handle on hover, drop-zone highlight (primary/10), WIP-over-limit column header (warning).
- **Ticket quickview** sheet (single click; or open-as-tab): title, status dropdown, stage-move, Open terminal, Open in GitLab, assignee, cost chip, Pause.
- **Card context-menu** (right-click / ⋯): Move to stage ▸, Set status ▸, Open terminal, Link ticket…, Add reference…, Pause/Resume, Open preview, Open in GitLab, Copy DEV-ID, Archive (confirm).
- **Create/Edit ticket** modal: title, description, stage (default Unrefined), labels (multiselect), sprint, assignee.
- **Filter popover** (multiselect): labels, assignee, status, sprint, "has running terminal", "needs input".

**Ticket-detail — add**
- **Reference picker** (used by Files&refs + Links): sheet with search + tabs **Files / Tickets / MRs / Sources**, file-tree/fuzzy-search with code-preview, relation-type select for tickets (relates/blocks/duplicates), gives chips back to the ticket.
- **"Promote to next stage"** preview sheet: shows the structured carry-over that will be injected, confirm.
- **Teardown container** confirm (type-to-confirm `DEV-####`).
- Richer tab states: Terminal-tab = embedded full terminal incl. SSH-unlock; Activity-tab = with the rewind control; Stage-history = timeline with per-stage carry-over expandable.

**Terminals — add**
- **SSH-unlock overlay**: "Unlock terminals with your SSH key" + Unlock (challenge spinner) → live.
- **Terminal ⋯ menu**: Restart, Kill (confirm), Pop out to tab, Copy buffer, Clear, Split, Rename.
- States: connecting (skeleton "Attaching to dev-1240…"), live, disconnected ("Reattaching…"), exited (exit-code badge), locked (overlay), empty ("No terminals running").
- Mobile: full-screen per terminal, segmented switch between terminals, bottom input bar with special-key chips (Tab/Ctrl/Esc/↑↓) + keyboard toggle.

**Sources — add**
- **Source preview** modal (read-only code/markdown viewer). **Reindex progress** (inline "indexing delta for commit def456…"). **Upload-spec** sheet (drag-drop + name). **Skill/MCP detail** popover (what it does · which stages use it · frozen/live · last index). States: stale ("RAG behind main by 3 commits"), error, no-Atlas info.

**Workspace-AI — add**
- **Suggestion detail** sheet: full explanation, **Accept** (with a preview of what it does, e.g. "creates epic + links DEV-1241, DEV-1249"), **Dismiss** (optional reason), **Snooze** dropdown (1h / tomorrow). Config-review "Go to pipeline" deeplink highlights the offending stage. Empty "All caught up ✨" + thinking indicator.

**Backlog — add**
- **Bulk-select** mode: checkboxes + sticky bottom action bar (Move ▸, Set status ▸, Assign ▸, Add to sprint, Archive). Column **sort** (stage, status, last activity, cost). Mobile "Select" mode.

**Activity — add**
- **Rewind scrubber**: per-ticket timeline you drag back to see state at time T; "Live" button to return. **Event detail / diff-expand**: click a file/command event → inline code/diff viewer or output. **Reconnect/catch-up** indicator: banner "Reconnecting… will catch up" + "caught up" toast (mobile "on the water" case).

**Account — add**
- **Add-SSH-key** sheet (paste + name + verify). **Revoke-session** confirm + "Revoke all others". **Data export** ("Download my data") + push-enabled state.

**Org/Workspace — add**
- **Invite** modal (multi-email + role). **Role-change** confirm ("Make Tom an Admin?"). **Transfer-ownership** (heavy type-to-confirm). **Delete-workspace** (purge note) type-to-confirm. The **Permissions matrix** must reflect: everyone uses terminals + works tickets; Member can't edit pipeline/config; Admin = everything **except** managing admins + ownership/delete; Owner = everything (promote/downgrade/remove admins, transfer, delete).

---

## PART 4 — Exhaustive overlay / menu catalog (make sure ALL of these exist, desktop + mobile)
1. Confirm dialog (+ optional type-to-confirm) · 2. Workspace-switcher menu (+ Create workspace, Manage members) · 3. Project-switcher menu · 4. Avatar menu (Account, Theme light/dark/system, Language en/nl/de/fr, Sign out) · 5. ⌘K command palette (Jump to / Tickets / People / Sources / Actions) · 6. Quick-open "+" popover (Open ticket / New terminal / New ticket) · 7. Notification center + web-push prompt · 8. Ticket quickview sheet · 9. Card/row context-menu · 10. Create/Edit ticket modal · 11. Board filter popover · 12. Sprint picker + Create/Edit sprint modal · 13. Reference picker (Files/Tickets/MRs/Sources) · 14. Promote-to-next-stage preview · 15. Teardown-container confirm · 16. Terminal ⋯ menu · 17. SSH-unlock overlay · 18. Terminal layout switcher (Grid/Tabs/Split) · 19. Open-terminal picker · 20. Add-stage sheet · 21. Delete-stage confirm · 22. Skill/MCP detail popover · 23. Reindex confirm + progress · 24. Upload-spec sheet · 25. Source preview modal · 26. Invite-members modal · 27. Role-change confirm · 28. Remove-member confirm · 29. Transfer-ownership confirm · 30. Create-workspace modal · 31. Add-SSH-key sheet · 32. Revoke-session confirm · 33. Suggestion-detail sheet (Accept-preview / Dismiss-reason / Snooze) · 34. Budget settings + cap-reached modal · 35. Pause/kill-workspace confirm · 36. Voice-capture sheet (mobile) · 37. Tabs-overflow sheet (mobile) · 38. Presence hover tooltip ("who's viewing") · 39. Onboarding wizard · 40. Data-export confirm.

---

## PART 5 — State completeness (give every screen these)
**Empty · Loading (skeletons) · Error**, plus contextual: **drag-over · reconnecting/offline · paused · stuck · budget-capped · indexing · locked (SSH) · needs-input**. Show each at least once across the kit.

## PART 6 — Global rules
Reuse the existing components + tokens (no arbitrary hex). Every overlay = slide-in panel (desktop) / bottom-sheet (mobile). Desktop + mobile for everything (~99% phone parity; complex actions can be driven via the Workspace-AI on mobile). Keep the seed data consistent across screens. Light + dark for every surface. Friendly/airy throughout; terminals stay dark-surface even in light mode.
