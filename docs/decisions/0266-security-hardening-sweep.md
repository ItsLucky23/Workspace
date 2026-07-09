---
status: accepted
date: 2026-07-09
tags: [security, rbac, ssrf, push, git]
---

# 0266 — Security-critical hardening sweep (FASE SEC): privilege-escalation, owner-protection, secret-leak, SSRF, prod-bypass

## Context

The completeness/universal-tool scans surfaced a cluster of security defects (Rule 19). They fall in
five groups: RBAC privilege-escalation (a `manageMembers`-only member could mint/assign admin-tier
roles; the `promoteAdmin`/`demoteAdmin` capabilities were dead code; role perms had no ceiling and
built-in roles were only client-locked), owner-protection (crafted sync-requests could re-role or
remove the owner → dangling `ownerId`), a secret leak (internal `__`-prefixed EnvVars — provider API
keys, OAuth-token JSON — were shipped in the workspace snapshot + Env tab and over the delta channel),
a redacted-push regression (`PushSubscription.fullBodyOptIn` was stored but never read, so the full
notification body always hit the lock screen despite the D80-reversed posture), a webhook SSRF hole
(the trigger `webhook` action POSTed to any URL incl. loopback/metadata), a prod-deploy bypass (the
direct prod Deploy button/op skipped the promote ladder's approval + green-CI + security gates), a
missing confirm on the destructive `env-teardown`, a caller-scoping bug on single-notification
mark-read, and the git clone/push token travelling in argv/URL.

## Decision

Fix all of them at the authoritative layer (the Conductor / server read-path / helpers), not the UI:

- **SEC1** `change-role`: owner membership is never re-roled through this op; promoting INTO an
  admin-tier role requires `promoteAdmin`; re-roling a member who currently HOLDS an admin-tier role
  requires `demoteAdmin` (the dead capabilities are now live). Admin-tier = holds promote/demote/owner.
- **SEC2** `role-create`/`role-update`: an actor cannot grant a perm he lacks (capability-ceiling);
  built-in roles are immutable server-side; role-create is audited.
- **SEC3** `remove-member`: refuses to remove the owner's membership.
- **SEC4** `sendWebPush`: payload is redacted (title + "Open the app to view.") unless the device's
  `fullBodyOptIn` is set.
- **SEC5** single-notification `mark-read` is scoped to the caller's `userId`.
- **SEC6** the trigger `webhook` action refuses loopback/RFC1918/link-local/cloud-metadata/`*.internal`
  /`*.local` targets (`isBlockedWebhookTarget`).
- **SEC7** a direct `env-deploy{kind:'prod'}` is rejected (`env.prodViaPromote`); the prod Deploy button
  is removed — prod is reachable only through the gated promote. The chat op-catalog also drops `prod`
  from `env-deploy`'s enum.
- **SEC8** `env-teardown` is added to `CONFIRM_REQUIRED` + wrapped in `menuHandler.confirm`.
- **SEC9** the git token never touches argv/URL: the URL keeps only the username convention
  (`x-access-token@`/`oauth2@`) and the token is supplied via a `GIT_ASKPASS` helper reading it from
  the spawn env (`GIT_TERMINAL_PROMPT=0` hard-fails instead of hanging).
- **RS-B1** internal `__`-EnvVars are filtered out of the snapshot AND the `envDelta` channel
  (mirrors `serviceEnv.ts`'s container filter); the derived `aiOverrides`/`mediaModels` projections
  still expose only feature→id mappings, never the secret value.

## Rejected alternatives

- **Client-side guards only** — every one of these is reachable by a crafted `syncRequest`; the guard
  must live where the Conductor writes.
- **Blanket-deny `__` keys at write time** — they are legitimately written by provider/publish flows;
  the fix is to stop *exposing* them on read, not to stop storing them.
- **A DNS-resolving SSRF check** — needs a resolving egress proxy; the literal/hostname blocklist
  covers the self-hosted threat model now, with DNS-rebinding noted as a proxy-layer follow-up.

## Consequences

- 14 Conductor-level assertions (`securityHardening.test.mts`) + 31 pure-guard assertions
  (`securityGuards.test.mts`) lock the properties down; existing memberRoles/webhook/push/automation
  suites stay green.
- Redacted push (SEC4) and live git-auth (SEC9) get their real-device/real-clone proof in FASE Z.
