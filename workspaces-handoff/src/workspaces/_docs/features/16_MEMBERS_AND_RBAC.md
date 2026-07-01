# 16 — Members & RBAC

> The **Members** + **Permissions** + **Invites** + **Danger zone** tabs of `WorkspaceSettings.tsx`: who is in the workspace, what each role may do, how people are invited and removed, and the irreversible transfer/delete levers. Extends `[01 §3.3]` (Conductor is the only writer), `[02 §1]` (the user has exactly three ticket levers — everything here is a **control-API request**, not a verb), and feature `04_INTEGRATION_TOOLS` (the Env/Integrations tabs that share this settings screen). Grounds the matrix in **B-28** + **DATAMODEL §1**.

---

## Scope

**In**

- The **Members** tab: a per-member row (avatar, name, email) with a **searchable role `Dropdown`** (the `Owner` row is locked — a static "Owner" pill, never a dropdown) and a `PopMenu` with **Remove from workspace**.
- The **Permissions** tab: the editable per-workspace **RBAC matrix** — `RBAC_CAPABILITIES` (rows) × `PermRole[]` (columns, one per role) of allow/deny cells; the `Owner` column is `locked` all-allowed; **Add role** appends a custom `PermRole`.
- The **Invites** tab: pending `InviteEntry[]` (email + role + sent-time) with **Revoke**, and an **Invite members** modal (email + role `Dropdown`) per **B-06** (email invite via `@luckystack/email`).
- The confirm flows: **role change** (when it crosses a privilege tier), **remove member**, **transfer ownership** (type-to-confirm), **delete workspace** (type-to-confirm purge per **B-39**).
- A pointer to where enforcement actually lives: the **`preApiExecute` subscriber** that resolves the target `workspaceId`, loads `WorkspaceMember`, and checks the role against the action (**DATAMODEL §1** "Request-lifecycle") — authz is an app concern, **not a structured-channel verb**.

**Out**

- The **Env** and **Integrations** tabs of the same settings screen → feature `04_INTEGRATION_TOOLS` (env vars, integration tools, `ro`/`rw` tiers).
- The **GitLab** tab (base URL + encrypted token + Verify) → feature `22_BOARD_SYNC` (the GitLab-SoT board projection); the token storage itself is **B-07**, surfaced read-only-ish here.
- Account-level identity (OAuth, SSH keys, sessions, accept-invite landing) → feature `17_ACCOUNT_AND_AUTH`. This doc covers the *workspace's* view of membership; 17 covers the *user's* account.
- The pipeline/config RBAC **consumers** (who may raise a cost cap, edit stages) — the capability rows are defined here; the gates that read them live in the owning feature docs (`05`, `10`, etc.).

**Deferred**

- Per-resource ACLs finer than the role matrix (e.g. "this member may only see sprint X"). The trusted-small-group threat model (**B-26**) makes the role matrix sufficient for v1.
- Audit-log surfacing of role changes in the UI (they are written as `TicketEvent`-style system records server-side; a dedicated members-audit view is later).

---

## User flow

The four tabs render inside the existing `Tabs` strip in `WorkspaceSettings.tsx` (`members` | `permissions` | `env` | `integrations` | `invites` | `gitlab` | `danger`).

1. **Members tab.** A bordered card lists every `Member` (from `MEMBERS`, real: `WorkspaceMember` join rows). Each row:
   - **Owner** → a static `Owner` pill (locked; ownership only moves via the Danger zone).
   - **Everyone else** → a `Dropdown` (`size="sm"`, `showSearch`, placeholder "Find role…") whose items are the non-locked `permRoles` (so `Admin`, `Member`, and any custom role). Picking a role calls `setMemberRole(memberId, role)`.
   - A `PopMenu` with **Remove from workspace** (danger), gated behind a `menuHandler.confirm`.
2. **Changing a role.** Selecting a new role that crosses a privilege tier — promoting to `Admin`, or removing `Admin` — opens a `menuHandler.confirm` ("Promote Sanne to Admin? They gain pipeline + settings + invite rights."). Same-tier or lower changes apply immediately. The action is a **control-API request** the Conductor executes after the RBAC check (only an Owner may promote-to-Admin / downgrade-an-Admin per **B-28**); a member without that capability never sees the offending dropdown options.
3. **Permissions tab.** The matrix renders `RBAC_CAPABILITIES` down the left and one column per `permRoles` entry; each cell is a `PermCell` allow/deny toggle. The `Owner` column is `locked` (every cell on, non-interactive). **Add role** reveals an inline name input → `addRole(name)` appends a new editable `PermRole` (starts all-deny, copy-then-tweak). Toggling a cell calls `togglePerm(roleIndex, capIndex)`. Footer note: "Owner always has every permission. Changes apply to this workspace only." Edits persist in `WorkspacesContext` for the prototype (server-side: the per-workspace role definitions).
4. **Invites tab.** Lists `INVITES` (`InviteEntry`: email, role label via `ROLE_DISPLAY`, sent-time) with a **Revoke** action. **Invite members** opens a modal: an email input + a role `Dropdown` (non-Owner roles). Submit creates an `Invite` (B-06) — the Conductor issues the token + sends the email via `@luckystack/email`; the row appears as `pending`. Inviting is gated on the "Invite / remove members" capability (Owner + Admin per **B-28**).
5. **Danger zone tab.** Two rows in a `wrong`-tinted card:
   - **Transfer ownership** → `menuHandler.confirm` with `input: activeWorkspace.slug` (**type-to-confirm**). On confirm the current Owner becomes `Admin` and the target becomes `Owner` (Owner-only, **B-28**).
   - **Delete workspace** → `menuHandler.confirm` with `input: activeWorkspace.slug` (**type-to-confirm**). Purges all tickets, events, RAG, signals, and tears down containers (**B-39**, cascade in **DATAMODEL §10**). Owner-only.

**Desktop.** The settings screen is the existing tabbed `max-w-2xl/3xl` centered layout; the matrix scrolls horizontally (`overflow-x-auto`) when many custom roles are added.

**Mobile (~99% parity, B-37).** Tabs collapse into a horizontally scrollable strip (already the `Tabs` behavior). Member rows stack the role dropdown under the name on narrow widths. The matrix keeps its horizontal scroll; type-to-confirm sheets are full-width. Complex authz actions can also be driven from the Assistant ("remove Tom from the workspace") which proposes the same control-API request for the user to accept (B-23).

**Mockup hint (Members + matrix):**

```
Members
┌────────────────────────────────────────────────┐
│ 🟣 Mathijs   mathijs@youcomm.nl        [ Owner ] │
│ 🟢 Sanne     sanne@youcomm.nl   [ Admin  ▾ ] ⋯  │
│ 🟠 Tom       tom@youcomm.nl     [ Member ▾ ] ⋯  │
└────────────────────────────────────────────────┘

Permissions                                  [+ Add role]
Capability                       Owner  Admin  Member  QA
Use terminals + work on tickets    ✓      ✓      ✓     ✓
Edit pipeline / stages             ✓      ✓      ✗     ✗
Promote a member to Admin          ✓      ✗      ✗     ✗
…                                (Owner column locked)
```

---

## Data

All additive over existing prototype types in `_data/types.ts`; nothing edits `04_DATA_MODEL.md`.

- **`Member`** (existing) — `{ id, name, email, avatar?, avatarFallback, role }`. The Members tab renders these; `role` mirrors `WorkspaceMember.role` (**DATAMODEL §1**).
- **`Role`** (existing) — `'owner' | 'admin' | 'member'` — the three built-in tiers (**B-08**, the `Role` enum in **DATAMODEL §1**). Custom roles added via the matrix are extra `PermRole` rows, not new `Role` enum members; a custom role's effective grants are its `perms[]`.
- **`PermRole`** (existing) — `{ name, locked?, perms: boolean[] }`. One boolean per `RBAC_CAPABILITIES` entry (index-aligned). `locked` marks the always-all-true Owner row. Edits persist per workspace (held in context for the prototype). Validation: `name` non-empty + unique within the workspace; `perms.length === RBAC_CAPABILITIES.length`.
- **`InviteEntry`** (existing) — `{ id, email, role, sent }`. Maps to the `Invite` model (**DATAMODEL §1**): `email`, `role` (`@default(MEMBER)`), `token @unique`, `expiresAt`, `invitedById`, `acceptedAt?`. Validation: `email` valid format; `role` a non-Owner `Role`.
- **`Workspace`** (existing) — `{ id, name, slug, ownerId, role }`. Transfer-ownership rewrites `ownerId`; delete cascades (**DATAMODEL §10**). The server-only `gitlabTokenEnc` (**B-07**) is omitted from the prototype type per the "prototype omits server-only fields" rule.
- **Enforcement** is **not data added here**: the role check runs in the `preApiExecute` subscriber (**DATAMODEL §1** Request-lifecycle) — `auth={login:true}` → resolve target `workspaceId` → load `WorkspaceMember` → check role against the action → `runInTenant(...)`. No client-trusted flag; the matrix is the source the subscriber reads.

**INDEX delta:** (none) — `Member`, `Role`, `PermRole`, `InviteEntry`, `Workspace` and the `Invite`/`WorkspaceMember`/`User` models all already exist in `_data/types.ts` + DATAMODEL §1. This doc surfaces them; it introduces no new fields or models.

---

## Verbs / Events / Hooks

**No new verbs.** Membership and RBAC are deterministic, Conductor-executed control-API operations gated by app authz — none of them is a structured-channel verb (the frozen worker/assistant surfaces in `[02 §2]` are untouched).

- **User levers → control-API requests.** Change-role, remove-member, invite, revoke-invite, transfer-ownership, delete-workspace are **control-API requests** the **Conductor** executes after the RBAC check (`[01 §3.3]` — only the Conductor writes; `[02 §1]` — user levers are control-API requests, never verbs). They are *not* worker verbs and *not* assistant verbs.
- **Enforcement = `preApiExecute`, not a verb.** The role-vs-action gate is the membership/role check in the `preApiExecute` subscriber (**DATAMODEL §1** Request-lifecycle), the same boundary that enters `runInTenant(workspaceId, …)`. Authz is app-domain (the framework only supplies `auth={login:true}`, **B-08**).
- **Assistant interaction.** The Assistant may *propose* a membership change ("remove Tom") via `propose_suggestion` (`[02 §2]`), surfaced as a `WorkspaceSuggestion`; Accept routes through the same control-API path the Conductor executes (B-23 proposes → accept → execute). The Assistant never mutates membership itself.
- **Notifications.** An invite send / acceptance / removal can fan a `Notification` (B-34, `[09]` notification model) via the existing `notify` `TriggerActionKind` path — config, not a new verb.

---

## UI

**Reused (real components):**

- `WorkspaceSettings.tsx` — the host screen; the four tabs (`MembersTab`, `PermissionsTab`, `InvitesTab`, `DangerTab`) already exist and are extended here, not replaced.
- `Dropdown` (`src/_components/Dropdown`) — the searchable per-member role picker and the invite-modal role picker.
- `PopMenu`, `WsButton`, `Toggle`, `Tabs`, `AvatarBubble`, `IconButton` (`_components/primitives`) — row menus, buttons, tab strip, avatars.
- `PermCell` (local to `WorkspaceSettings.tsx`) — the allow/deny matrix toggle.
- `menuHandler.confirm` (`src/_functions/menuHandler`) — role-change / remove-member confirms (plain), and transfer-ownership / delete-workspace (with `input: activeWorkspace.slug` for **type-to-confirm**).
- `WorkspacesContext` — `memberRoles`/`setMemberRole`, `permRoles`/`togglePerm`/`addRole`, `activeWorkspace` (already wired).

**New (small):**

- An **Invite members** modal body (email input + role `Dropdown`), opened from the Invites tab's existing **Invite members** `WsButton` via `menuHandler.open` — mirrors the `CreateWorkspaceForm` modal pattern in `_shell/Shell.tsx`.
- A small **role-change confirm** wrapper that only fires `menuHandler.confirm` on tier-crossing changes (promote-to-Admin / downgrade-Admin); same-tier changes apply directly.

**Mobile parity.** Identical tabs/components; the role dropdown and matrix follow the screen's existing responsive layout. Type-to-confirm sheets are full-width and thumb-reachable.

---

## Extends

- `[01 §3.3]` "the **Conductor** … the only writer of board/git/status" — every membership/RBAC mutation is a Conductor-executed control-API request, not a client write.
- `[02 §1]` "status is AI-owned/read-only … the user has exactly three levers … control-API requests the Conductor executes, NOT verbs" — the same governance model the member/role levers follow.
- **B-08** (Owner/Admin/Member tiers) + **B-28** (the full RBAC matrix: Admin = everything except admin-role management + ownership/delete; Member = work-on-tickets only) — the exact column semantics the matrix encodes.
- **DATAMODEL §1** — the `User` / `Workspace` / `WorkspaceMember` / `Invite` models, the `Role` enum, the RBAC matrix table, and the "Request-lifecycle" `preApiExecute` enforcement boundary.
- **B-06** (members via email invite, `@luckystack/email`) — the Invites tab + invite modal.
- **B-07** (per-workspace encrypted GitLab token) — noted as the GitLab tab's storage; the tab itself is feature `22`.
- **B-39** (delete-workspace = cascade purge) + **DATAMODEL §10** — the Danger-zone delete semantics.
- **B-26** (trusted small-group threat model) — why the role matrix (not finer ACLs) is sufficient for v1.
- feature `04_INTEGRATION_TOOLS` — the sibling Env/Integrations tabs on the same settings screen.

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D76–D77)

1. **Custom-role grant ceiling → ⚑ D76 (deviates from the proposed hard-lock):** a custom `PermRole` is **fully configurable** — the matrix may grant *any* capability, including the admin-management rows ("Promote a member to Admin", "Transfer ownership / delete workspace"). **No** rows are hard-locked to the built-in tiers. The single-Owner invariant is preserved separately by **D77**: ownership only ever moves via an explicit transfer, regardless of which roles hold the "transfer ownership" capability.
2. **Last-Owner / self-demotion guard → D77:** an Owner **cannot** remove themselves or downgrade their own role without first transferring ownership; self-demotion is blocked, so a workspace always has exactly one Owner.
