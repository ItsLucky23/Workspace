---
title: A1+A2 — multi-account connections + channel management
status: accepted
date: 2026-07-08
tags: [content, publish, accounts, channels, ai-libraries-accounts]
---

## Context

Publishing stored ONE token per platform (`__publish_<platform>`), so connecting a second YouTube account
overwrote the first; and channels (a platform + brand identity) could only be created in tests — no
create/edit/delete op or UI. A1+A2 make "manage all your social accounts + channels via the workspace" real.

## Decision

- **A1 — re-key the connection store** so `tokenKey(platform, accountId?)` = `__publish_<platform>` (default,
  back-compat) or `__publish_<platform>_<accountId>` for N accounts per platform. `saveConnection`/
  `getConnection` gained an optional `accountId`. The token-refresh logic (ADOPTION F1) stays orthogonal —
  this only changes the KEY, not the read/refresh.
- **A2 — channel + account management ops** (content-* write family, RBAC): `channel-create`/`channel-edit`/
  `channel-delete` (a channel = projectId + name + platform + handle + brandVoice + defaultStyleId) and
  `account-disconnect` (remove a connected account's token by platform + optional accountId). Channels are
  already on the snapshot; the CRUD makes them user-managed.

## Rejected alternatives

- **A dedicated `SocialAccount` Prisma model now.** The EnvVar re-key already gives N accounts per platform
  with zero migration and stays compatible with the existing OAuth flow + F1's refresh. A first-class model is
  a later enhancement if per-account metadata (avatar, scopes) is needed; the token store doesn't require it.
- **A separate accounts route.** These are workspace content-side writes; they belong on the same Conductor
  control-op path (single-writer, B-23) as the rest of content management.

## Consequences

- A workspace can now connect N accounts per platform and manage its channels (create/edit/delete) +
  disconnect accounts — all via the Conductor. Proven E2E (11/11): two YouTube tokens stored separately, the
  channel CRUD, and a disconnect that leaves the other account intact. A3 routes a publish to a chosen account;
  A4 binds content to a channel. Real OAuth connect stays fixtures (no apps, per the run decision).
