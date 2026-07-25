# 17 — Account & Auth

> The user's account settings plus login, sessions, invitations and notifications. LuckyStack login establishes the
> user identity; workspace RBAC authorizes tenant actions. SSH keys are not a login or terminal capability gate
> (ADR 0301).

---

## Scope

**Account screen**

- Profile, theme and language.
- Connected identity providers.
- Signed-in sessions and revocation.
- Web-push preferences.
- User data export.

The old SSH-key card is no longer shown. Existing `SshKey` rows and add/remove routes remain readable/backward
compatible for installations that already stored keys, but no runtime authorization decision consumes them.

**Auth flows**

- LuckyStack credentials/OAuth login creates or resolves the framework `User` session.
- Accept-invite consumes an invite token and creates workspace membership.
- Every workspace operation layers capability checks over that authenticated session.

**Out**

- Workspace membership/role administration (feature 16).
- Workspace forge credentials (workspace/project settings).
- SSH nonce issuance, browser-side private-key signing and `crypto.verify`.
- External SSH access to the host.

---

## Terminal relationship

Opening a container terminal does not require a separate account key. The server instead requires:

1. a valid LuckyStack session;
2. membership/capability `workTickets` in the workspace;
3. the canonical ticket-container identity derived by the server;
4. exact workspace/ticket labels on that container.

The browser never selects a host shell, executable or arbitrary container. Production terminal access has no
host-shell fallback. Feature 14 owns the complete terminal boundary.

---

## Data

- Framework `User`/session records — primary account identity.
- `WorkspaceMember`/roles — tenant authorization.
- `Invite` — one-time membership onboarding.
- `PushSubscription` — web-push delivery.
- `SshKey` — retained legacy account data only; not an authorization source.

OAuth state/codes and invite tokens remain server-only transient values. There is no PTY nonce.

---

## Writes and ownership

No structured-channel verbs are added. Account updates, session revocation, invite acceptance and push
subscription changes use their existing framework/global-job paths. Tenant writes remain control-API → Conductor.

---

## UI

- Account settings shows profile, identity, sessions, notifications and data actions.
- The SSH-key management card and terminal-lock badges are removed because they promised a security mechanism that
  did not exist and is not part of the selected product contract.
- Terminal prerequisite messaging names Docker/repository/running-ticket state, never a missing SSH key.

---

## Resolved

1. OAuth/credentials session = login identity.
2. Workspace membership and capability checks = authorization.
3. **ADR 0301:** SSH keys do not unlock terminals; the earlier B-05 challenge design is retired.
