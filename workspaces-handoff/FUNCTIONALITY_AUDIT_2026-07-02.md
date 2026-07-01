# Workspaces — Functionality Audit (2026-07-02)

> Per-page audit of what WORKS vs what's stub/missing, functionality-first (not UI polish).
> Method: 11 parallel agents, each traced a screen's actions against the Provider
> (`WorkspacesProvider.tsx`) + Conductor ops. "Persists" = calls `control(op)` → Mongo.

## Verdict in één zin

**De read-laag is solide** (elke pagina toont live snapshot-data uit Mongo). **De write-laag is grotendeels niet bedraad** — alleen WorkspaceSettings heeft echte persistente mutaties. Overal elders zijn acties stub/dood/no-op. Eén bug-klasse domineert.

---

## 🔴 De 3 dominante patronen (belangrijker dan losse bugs)

### 1. De `menuHandler.confirm()` void-discard bug (~10 flows)
Overal wordt een confirm-dialoog geopend maar de `Promise<boolean>` weggegooid (`void menuHandler.confirm(...)`), dus **bevestigen doet niets**. Het lijkt bedraad, maar is inert. En het ergste: de Conductor-ops bestaan al — alleen het resultaat checken + `control()` aanroepen ontbreekt.
- **Board:** archive, pause-all
- **Backlog:** archive (bulk)
- **TicketDetail:** promote-to-next-stage, teardown-container
- **Terminals:** kill
- **WorkspaceSettings:** remove-member, transfer-ownership, delete-workspace
- **AccountSettings:** revoke-all-sessions

### 2. Dode knoppen (geen `onClick`)
- **Board:** "New ticket", "Filter"
- **Backlog bulk-bar:** Move / Status / Assign / Sprint (4 dode knoppen; alleen Archive heeft de kapotte confirm)
- **Sources:** Upload spec, Reindex ×2, Regenerate
- **WorkspaceSettings:** Invite members, Revoke invite, GitLab Verify (+ GitLab base-url/token zijn `defaultValue`-only, geen state)
- **AccountSettings:** Edit profile, GitHub Connect, Export data, per-session Revoke
- **Shell:** notificatie-bel, mobile FAB, suggestie-Snooze, avatar-menu Language, **Sign-out**, search "New ticket"

### 3. Primaire user-levers die input stil weggooien
- **TicketDetail "Send" (needs-input reply)** → wist alleen het veld, verstuurt niets. Dit is dé man-in-the-middle-interactie (het hele app-premisse) en doet niets.
- **AI-chat** → hardcoded fake reply (Fase-2, verwacht).
- **Suggestie "Accept" === "Dismiss"** → beide alleen lokaal dismissen; Accept doet niets extra.

---

## Per-pagina matrix

| Pagina | Data | Werkt (persist) | Stub / dood / kapot | Ontbreekt |
|---|---|---|---|---|
| **Board** | ✅ live (tickets/stages/sprints/members) | — (niets) | archive (confirm-void), pause-all (confirm-void), add-reference (stub), pause/resume (stub) | New-ticket (`quick-add` bestaat!), Filter, sprint-dropdown filtert niet |
| **Backlog** | ✅ live | — | bulk-bar 4 dode knoppen + archive (confirm-void) | alle bulk-ops (`bulk-*` bestaan!), per-row acties. "Last activity" = **fake** (index-lookup) |
| **TicketDetail** | ✅ live (behalve Terminal-tab = **seed**) | — | Send (wist input!), GitLab/add-ref/link-ticket (dood), promote/teardown (confirm-void) | ticket edit (titel/desc/labels), comment-composer, assignee/stage-picker |
| **Pipeline** | ❌ **seed** (`STAGE_CONFIGS`) | — (**niets persisteert**) | "Validate with AI" = lokale heuristiek, geen AI | **geen Save**; alle 10 tabs zijn lokaal → **refresh = alles kwijt** (= 7a.2) |
| **Terminals** | mix: metadata **seed**, xterm = **echte host-shell PTY** (dev-only, gated) | — | kill (confirm-void), restart/clear/rename/copy (stubs) | status-pills **liegen** (seed vs echte shell); per-ticket container = Fase-2 |
| **Sources** | ✅ live (docs/skills) | — | skill-toggle = **lokaal** (`skill-toggle` bestaat!), Upload/Reindex/Regenerate dood | add/remove doc+skill, search |
| **Activity** | ✅ live-uit-DB… maar **geen producer** | — | "Live"-badge decoratief | **niets schrijft TicketEvent** op acties → feed = seed-replay. **Timestamps altijd leeg** (snapshot geeft `time:''`) |
| **Usage** | ❌ **seed** (SPEND_7D, USAGE_ROWS); by-person telt live tickets | — | — (alleen navigatie) | echte usage = Fase-2 (AI-spend-tracking). Budget-veld niet eens getoond (bewust, geen metered API) |
| **WorkspaceSettings** | ✅ live | ✅ **change-role, role-update(togglePerm), role-create(addRole), save-env, remove-env, save-integration, remove-integration** | remove-member/transfer/delete (confirm-void), invite/revoke-invite/gitlab-verify (dood), GitLab-save (ontbreekt) | GitLab-save (`gitlab-settings` bestaat + heeft nu encryptie!), rename-workspace |
| **AccountSettings** | profiel/theme live; **sessions=seed**; SSH=client-only | ✅ theme (framework) | edit-profile/github/export/revoke (dood/confirm-void) | **SSH-keys persisteren niet** (client-only, terwijl ze "terminals unlocken"!), echte sessie-lijst + revoke, taal, web-push |
| **Shell/Nav/AI/Search** | nav ✅, workspaces live, search ✅ live | ✅ **create-workspace**, theme, navigatie | AI-chat fake, bel/panel/mark-read ontbreekt, **Sign-out no-op**, snooze/language dood | notificatie-panel, echte AI (Fase-2), logout, active-workspace-persistentie |

---

## Wat is NU fixbaar (Fase-1) vs Fase-2-gated

### ✅ Nu fixbaar — de Conductor-ops bestaan al, het is puur wiring (hoge waarde, lage kosten)
1. **Confirm-void-bug wegwerken** overal → `control()` op bevestigen: archive (Board/Backlog), remove-member, transfer-ownership, delete-workspace. (ops ✓)
2. **Backlog bulk-bar** → bulk-move/status/assign/sprint/archive + pickers. (ops ✓)
3. **Board "New ticket"** → `quick-add`. (op ✓)
4. **WorkspaceSettings:** Invite → `invite`, Revoke → `revoke-invite`, **GitLab-save** → `gitlab-settings` (encryptie zit er al!), Rename → `rename-workspace`. (ops ✓)
5. **Sources skill-toggle** → `skill-toggle` (+ van lokale state af). (op ✓)
6. **Sign-out** → framework-logout wiren.
7. **Fixes:** env-var-edit debounce (nu 1 write/toetsaanslag); Activity `time:''`-bug; Board sprint-dropdown filtert niet.

### 🔶 Fase-1 mogelijk maar groter / ontwerpkeuze
8. **Pipeline-config-persist** (= 7a.2, het grote item): volledige `PipelineStageCfg` in snapshot + save-stage-config uitbreiden.
9. **Activity event-production:** de Conductor zou een `TicketEvent` kunnen appenden per control-op (schrijft al `WorkspaceSignal`) → dan wordt de feed echt. Ontwerpkeuze.
10. **Notifications:** model bestaat + `mark-read` bestaat, maar geen producer + geen panel (panel = UI-werk).
11. **TicketDetail needs-input reply / comment:** raakt de Assistant/question-forwarding — grotendeels Fase-2.

### ⛔ Fase-2-gated (data-producers bestaan nog niet)
- Echte usage-cijfers (AI-spend), per-ticket container-terminals, de echte Workspace-AI-chat, real-time/presence, SSH-key-persist + echte sessie-lijst (7a.6).

---

## Aanbevolen volgorde (functionaliteit eerst)
**Ronde 1 (grootste functionele winst, ops bestaan):** confirm-void-klasse + dode knoppen wiren → archive, bulk-bar, new-ticket, invite/revoke, gitlab-save, remove-member/transfer/delete, skill-toggle, sign-out. Dit maakt in één klap ~20 acties écht werkend.
**Ronde 2:** Pipeline-config-persist (7a.2).
**Ronde 3:** Activity-event-production + notificatie-panel + kleine bugs (timestamps, env-debounce).
**Fase 2:** de rest (gated).
