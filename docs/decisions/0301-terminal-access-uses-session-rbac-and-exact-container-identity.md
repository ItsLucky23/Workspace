---
id: 0301
title: Terminal access uses session, RBAC and exact container identity
status: accepted
date: 2026-07-23
tags: [terminals, auth, rbac, ssh, containers, security]
supersedes: []
---

# 0301 — Terminal access uses session, RBAC and exact container identity

## Context

The original Workspaces design corpus required a linked SSH public key and a per-open nonce + `crypto.verify`
challenge before attaching to a terminal. That mechanism was never implemented. The production runtime instead has
a complete, simpler authorization chain: LuckyStack authenticates the socket, `workTickets` authorizes the user in
the workspace, and the server derives then label-verifies the exact workspace/ticket container. Production has no
host-shell fallback.

Keeping the old prose and SSH-unlock UI would claim a security boundary that did not exist. Adding the challenge
would also require browser/device private-key signing and a second identity lifecycle without granting access that
session + tenant RBAC does not already express. On 2026-07-23 the owner explicitly chose the KISS option: retire the
SSH gate rather than build it.

## Decision

- A valid LuckyStack session is the terminal login identity.
- `workTickets` capability in the requested workspace is mandatory.
- The server derives the canonical container from `(workspaceId, ticketKey)` and verifies the container's exact
  workspace/ticket labels before attach. The browser never chooses a host shell, executable or arbitrary container.
- Production has no host-shell fallback and exposes no product SSH-to-host escape hatch.
- SSH keys do not unlock terminals and are not consulted by terminal authorization.
- Remove the SSH-unlock card, active-SSH badges and the stale nonce/signature promises from the current product/docs.
- Retain existing `SshKey` rows and add/remove routes only for backward-compatible data handling; they are not a
  security source and are not shown in the primary settings UI.

## Rejected alternatives

- **Implement nonce + `crypto.verify`:** rejected as a second identity/capability system with substantial device UX
  and protocol complexity but no additional workspace authorization semantics.
- **Use possession of any stored public key as a boolean gate:** rejected because storing a public key proves
  neither current private-key possession nor workspace permission.
- **External SSH into the host with container routing:** rejected because it adds an SSH daemon/routing surface and
  risks reintroducing a host-shell path.
- **Leave the UI/docs while relying on session + RBAC:** rejected because a fictional security control is worse than
  an explicit, testable contract.

## Consequences

- Terminal access remains restricted to authenticated members with `workTickets` and the exact ticket container.
- Users no longer need to create or possess SSH keys to use browser terminals.
- Existing SSH-key records remain harmless legacy data until a separate real use-case either consumes or migrates
  them; they confer no permission.
- The frozen B-05/V1-scope wording is consciously revised by this owner decision.
