# 17 — Account & Auth (merged)

> The user's own `AccountSettings.tsx` screen **plus** the auth flows that stand it up: OAuth login (identity), the SSH-key terminal-capability gate, and accept-invite. Merged into one doc per **D70**. Extends `[01 §3.2]` (the per-user Assistant suspended on disconnect), `[01 §7]` (subscription auth mount), `[07 §A]` (the SSH challenge runs against the orchestrator's PTY namespace), and the onboarding wizard in feature `01_WORKSPACE_SETUP`. Grounds identity in **B-05** (OAuth = login, SSH = terminal gate), invites in **B-06**, and per-workspace token in **B-07**.

---

## Scope

**In — Account (the screen).**

- **Profile** — avatar + name + email, theme `Segmented` (light/dark), language (display only in v1).
- **Connections** — linked OAuth identity providers (GitLab connected, GitHub connect) — `OAuthAccount[]` (**B-05**, **DATAMODEL §1**).
- **SSH keys** — the list that **unlocks terminals**: add-key sheet (name + paste public key or drag a `~/.ssh/config`), fingerprint + added + last-used, the active-key badge, and **Remove** (a terminal-capability gate, **B-05**). Required to open terminals; no app-load login gate.
- **Sessions** — signed-in devices (`SessionEntry[]`): per-device **Revoke** + **Revoke all others** (confirm).
- **Notifications** — a **web-push** toggle behind an inline enable banner (`PushSubscription`, **B-34**).
- **Your data** — a **data export** action (**B-39** member data-export).

**In — Auth flows (how identity is established).**

- **OAuth login** — OAuth is the **primary login/identity** (**B-05**); first login creates the `User` + `OAuthAccount`. The framework supplies `auth={login:true}`; everything tenant-scoped layers on top.
- **SSH-link capability gate** — a linked SSH **public** key is required to open a terminal. The challenge is a **nonce + `crypto.verify`** handshake on the orchestrator's `/pty` namespace (**B-05**, gap **G19**; the endpoint lives at `[07 §A]`). The private key never leaves the device.
- **Accept-invite** — the `/invite/:token` landing card (**B-06**): shows the workspace + role, requires OAuth login (link identity if new), then joins via the `Invite` token.

**Out**

- The **workspace's** view of membership/roles (members list, RBAC matrix, invite *authoring*, danger zone) → feature `16_MEMBERS_AND_RBAC`. This doc is the *user/account* side; 16 is the *workspace* side. (Sending an invite = 16; accepting one = here.)
- The per-workspace **GitLab token** storage + verify (**B-07**) → the GitLab tab (feature `22`) / `16`. The account's GitLab *OAuth identity* is here (Connections); the workspace's *push/pull token* is not.
- The onboarding **workspace-create wizard** itself → feature `01_WORKSPACE_SETUP` (cross-referenced; a fresh user lands there after first OAuth login with no workspaces).

**Deferred**

- Hardware-key / WebAuthn as a second factor — later (OAuth + SSH-gate is the v1 model).
- Per-key scoping (a key that may only open terminals in workspace X) — the trusted-small-group model (**B-26**) makes account-wide keys sufficient for v1.

---

## User flow

### Account screen (`AccountSettings.tsx`)

1. **Profile.** Edit name/email (the **Edit** button), flip theme via `Segmented`. Language shows English (full i18n switch reserved).
2. **Connections.** GitLab shows **Connected** (a green check) since it backs login; GitHub shows a **Connect** button that runs the OAuth link flow → appends an `OAuthAccount` (**B-05**). Multiple providers may link to one `User`.
3. **SSH keys.** The card header shows the **terminal SSH user** badge (green "Terminal SSH user: <name>") when a key resolves, or an amber **Terminals locked** badge when none does.
   - **Add SSH key** → the inline `AddKeyForm`: a name, a textarea to **paste the public key**, and a **drag-and-drop / click** zone for a `~/.ssh/config` file. On submit the value resolves to an identity (real: server matches the public key's fingerprint against `SshKey.fingerprint`); success appends an `SshKeyEntry` with a `SHA256:…` fingerprint, `added`, `lastUsed`.
   - Each row shows name · type · fingerprint · added · "authenticates as <member>", with an **active** chip on the resolving key and a **Remove** action.
   - **Removing the last key locks terminals** — the badge flips to amber; opening a terminal will fail the capability gate until a key is re-added.
4. **Sessions.** Lists devices (`SessionEntry`): the current device is tagged "this device"; others show **Revoke**. **Revoke all others** is a header action behind `menuHandler.confirm` ("Every device except this one will be signed out.").
5. **Notifications.** A **Web push** `Toggle`. Turning it on first shows an **inline enable banner** that triggers the service-worker `PushManager.subscribe()` (PWA), persisting a `PushSubscription` (**B-34**). The toggle reflects the subscription state; off unsubscribes.
6. **Your data.** **Export** downloads a copy of the user's data (a dump of user-related rows, **B-39**).

### Auth flows

1. **OAuth login.** Unauthenticated → provider button (GitLab/GitHub) → OAuth round-trip → on return, find-or-create `User` + `OAuthAccount` (**B-05**). A brand-new user with no workspaces is routed to the **create-workspace wizard** (feature `01`); an invited user is routed to accept-invite (below).
2. **SSH-link capability gate (opening a terminal).** When a user opens a terminal, the orchestrator's `/pty` namespace issues a **nonce**; the client signs it with the device-held private key; the server runs **`crypto.verify`** against the stored **public** key (`SshKey.publicKey`/`fingerprint`) (**B-05**, **G19**). On success the PTY attaches and `SshKey.lastUsedAt` updates; on failure the terminal stays locked with the amber badge. The challenge endpoint is the orchestrator's, documented at `[07 §A]` (the launch/teardown owns the `/pty` proxy + subscription-auth mount, `[01 §7]`).
3. **Accept-invite.** Following an invite email lands on **`/invite/:token`** — a card showing the workspace name + offered role. The user signs in with OAuth (linking identity if new), then **Join** consumes the `Invite` token → creates the `WorkspaceMember` row at the invited `role` and stamps `acceptedAt` (**B-06**, **DATAMODEL §1**). Expired/used tokens show a clear reason.

**Desktop.** The account screen is the existing centered `max-w-2xl` stack of `Card`s. Auth flows are full-page (login) or a centered card (accept-invite).

**Mobile (~99% parity, B-37).** Cards stack; the add-key drop-zone also accepts a file picker (drag is desktop-only but click-to-choose works on mobile). The web-push banner is a full-width inline prompt. Accept-invite is a full-screen card. The SSH gate is identical (the signing happens client-side regardless of device).

**Mockup hint (SSH keys card):**

```
SSH keys                         [✓ Terminal SSH user: Mathijs]
Required to open terminals. Your private key stays on your device.
┌──────────────────────────────────────────────────────────┐
│ MacBook Pro · ed25519  [active]                            │
│ SHA256:9f3a…7c21 · added Mar 2025 · authenticates as …  [Remove]
└──────────────────────────────────────────────────────────┘
                                              [ + Add SSH key ]
```

---

## Data

All additive over existing prototype types in `_data/types.ts`; nothing edits `04_DATA_MODEL.md`.

- **`SshKeyEntry`** (existing) — `{ id, name, type, fingerprint, added, lastUsed, userId }`. Maps to the `SshKey` model (**DATAMODEL §1**): `publicKey` (public half only), `keyType`, `fingerprint @unique`, `addedAt`, `lastUsedAt?`. Validation: a parseable public key; fingerprint unique per account. (The prototype's `SSH_KEY_TO_USER` map stands in for fingerprint→identity resolution.)
- **`SessionEntry`** (existing) — `{ id, device, location, lastActive, current }`. The signed-in-device list; revoke removes the server session. (Sessions are framework-global, on the default client — **DATAMODEL §0/§11**.)
- **`InviteEntry`** (existing) — `{ id, email, role, sent }` ↔ the `Invite` model. Consumed here on accept (token → `WorkspaceMember` + `acceptedAt`); authored in feature `16`.
- **`Member`** (existing, `currentUser`) — the account you're using the app as.
- **`OAuthAccount`** (DATAMODEL §1, server-only) — `{ provider, providerUserId }` linked to `User`. Surfaced in the Connections card as connected/not; not a prototype type (no secrets in the UI).
- **`PushSubscription`** (DATAMODEL §9, server-only) — `{ endpoint @unique, keys }`. Created by the SW subscribe behind the inline banner (**B-34**); the prototype only holds a local `push` boolean on the screen.
- **Auth-flow transients** — the OAuth `state`/code, the `/pty` **nonce**, and the `Invite.token` are server-only transient values; none becomes a prototype type. The nonce + `crypto.verify` verification is the SSH gate's only new mechanism and it lives on the orchestrator (`[07 §A]`).

**INDEX delta:** (none) — `SshKeyEntry`, `SessionEntry`, `InviteEntry`, `Member` already exist in `_data/types.ts`; `User`/`OAuthAccount`/`SshKey`/`PushSubscription`/`Invite` already exist in DATAMODEL §1/§9. This doc surfaces them and the existing auth mechanisms; it introduces no new fields or models.

---

## Verbs / Events / Hooks

**No new verbs.** Account management and auth are framework/Conductor concerns, not structured-channel verbs (the frozen `[02 §2]` surface is untouched).

- **Auth is framework + app, not a verb.** OAuth login rides the framework's `auth={login:true}` (**B-08**); find-or-create `User`/`OAuthAccount` and `WorkspaceMember` writes are deterministic **control-API** operations the **Conductor**/web-app performs (`[01 §3.3]`), never an LLM verb.
- **SSH gate = `/pty` capability handshake.** The nonce + `crypto.verify` challenge is an **orchestrator** authentication step on the `/pty` namespace (`[07 §A]`, **B-05/G19**), gating terminal attach — it is infrastructure, not a worker/assistant verb.
- **Accept-invite = control-API.** Consuming an `Invite` token → `WorkspaceMember` is a deterministic write (the same governance as feature `16`); the Assistant may only *propose*, never join on a user's behalf (B-23).
- **Web-push** rides the existing `Notification` channels (`'push'`) (**B-34**, `[09]`); enabling it is a SW subscribe + persist, surfaced by the `notify` `TriggerActionKind` fan-out — config, not a verb.
- **Disconnect.** When the user's socket drops, their **Assistant is suspended** (`[01 §3.2]`); re-auth/reconnect resumes it. No verb involved.

---

## UI

**Reused (real components):**

- `AccountSettings.tsx` — the host screen; its `Card`/`Row`/`AddKeyForm` building blocks already exist and are extended, not replaced.
- `Segmented`, `Toggle`, `WsButton`, `AvatarBubble`, `Icon` (`_components/primitives`) — theme switch, push toggle, buttons, avatar.
- `menuHandler.confirm` (`src/_functions/menuHandler`) — **Revoke all other sessions** confirm.
- `WorkspacesContext` — `currentUser`, `theme`/`setTheme`, `sshKeys`/`sshUserId`/`addSshKey`/`removeSshKey` (already wired; SSH identity drives terminal unlock).
- `AddKeyForm` (local to `AccountSettings.tsx`) — the add-key sheet with paste + drag-drop `~/.ssh/config`.

**New (small):**

- An **OAuth login** view (provider buttons) — the unauthenticated entry; routes a workspace-less new user into feature `01`'s wizard.
- An **accept-invite card** at `/invite/:token` (workspace + role + Join), reusing the centered-card layout.
- A **web-push enable banner** — an inline prompt shown when the user flips the push `Toggle` on before the SW subscription exists.

**Mobile parity.** All cards stack; drag-drop degrades to click-to-pick; the push banner and accept-invite card are full-width.

---

## Extends

- `[01 §3.2]` "ASSISTANT … per active user per workspace … **suspended on disconnect**" — the account's session/identity lifecycle is what the Assistant's presence keys off.
- `[01 §7]` subscription-auth mount — the host `~/.claude` is mounted into containers for the Max subscription; the user's *SSH* key is a *separate* capability gate for opening terminals, not the model auth.
- `[07 §A]` "the per-container pty-agent … the orchestrator proxies the `/pty` namespace" — where the SSH **nonce + `crypto.verify`** challenge endpoint lives.
- **B-05** — OAuth = primary login/identity; a linked SSH **public** key is the terminal capability-gate (challenge/response on `/pty`), not the login.
- **B-06** — members via email invite (`@luckystack/email`); the accept-invite landing consumes the token.
- **B-07** — per-workspace encrypted GitLab token: an account-level GitLab *OAuth identity* (here, Connections) is distinct from the *workspace* push/pull token (feature `22`/`16`).
- **B-08** — Owner/Admin/Member; the framework provides only `auth={login:true}`, app RBAC layers on (the consumer is feature `16`).
- **B-34** — notifications in-app + email + **web-push** (PWA service worker, `PushSubscription`).
- **B-39** — member data-export (the "Your data" card).
- **DATAMODEL §1** (`User`/`OAuthAccount`/`SshKey`/`Invite`/`WorkspaceMember`) + **§9** (`PushSubscription`) — the persistence this doc surfaces.
- feature `01_WORKSPACE_SETUP` — a fresh, workspace-less user lands in its create-workspace wizard after first OAuth login; an invited user lands on accept-invite first.

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D78–D79)

1. **SSH key add → ⚑ D78 (deviates from the proposed trust-on-add):** adding a public key runs a **one-time proof-of-possession challenge at add-time** — the user signs a server-issued nonce before the key is accepted and stored. (The per-open `/pty` challenge still gates each terminal session; add-time PoP is an additional up-front check that a bad key never enters the store.)
2. **GitHub-login + GitLab-SoT workspaces → D79:** the user's OAuth provider is **identity-only** — the workspace's stored token (**B-07**) does the board sync. No per-provider workspace gating; a GitHub login can use a GitLab-synced workspace.
