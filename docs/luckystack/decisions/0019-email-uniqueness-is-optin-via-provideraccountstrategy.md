---
name: email-uniqueness-is-optin-via-provideraccountstrategy
title: Email uniqueness is opt-in and governed by auth.providerAccountStrategy, not a hard schema invariant
status: accepted
date: 2026-07-02
deciders: [ItsLucky23]
tags: [auth, schema, config, oauth]
supersedes: []
relates: []
---

## Context

The Prisma `User.email` column ships WITHOUT `@unique`. Security/correctness scans flag this as a bug because `confirmEmailChange` (and OAuth find-or-create) reference "the DB unique index on email" as a race backstop — so the absence of `@unique` looks like a missing invariant that permits duplicate-email accounts.

It is not a bug. Whether email is globally unique is a deliberate, config-toggleable choice driven by `auth.providerAccountStrategy`:

- **`'per-provider'` (default)** — a user is resolved by `(email, provider)`. The same address via Google and GitHub is intentionally TWO separate `User` rows. Email is deliberately NOT globally unique, so `@unique` must NOT be on the column.
- **`'unified'`** — a user is resolved by email alone across providers; a sign-in via a new provider LINKS to the existing account. This mode REQUIRES the consumer to add `email @unique` (documented in the `@luckystack/login` README "Account strategy" migration steps).

The framework degrades loudly, not silently: `resolveUserByEmail` warns once if `'unified'` is configured without a `findByEmailAnyProvider`-capable adapter, and `login.ts` (LOGIN-F7) treats a unique-constraint violation as a TOCTOU race *when the index exists*.

## Decision

Email uniqueness is opt-in. The default schema correctly omits `@unique` (per-provider strategy). Adding `@unique` is a consumer action tied to selecting `providerAccountStrategy: 'unified'`, performed via a Prisma migration on the consumer's own schema — never shipped as a framework default, because it would break the per-provider model and fail to migrate on any existing per-provider dataset that already has duplicate emails.

## Rejected alternatives

- **Add `@unique` to the default schema** — rejected: breaks the default `'per-provider'` strategy (same email across providers is intended), and the migration fails on existing multi-provider datasets.
- **Enforce uniqueness in application code unconditionally** — rejected: same semantic breakage as above for per-provider, and an app-level check without a DB constraint still has a TOCTOU window.

## Consequences

- `confirmEmailChange` / OAuth find-or-create rely on the unique index ONLY under `'unified'`, where the consumer has added it. Under the default `'per-provider'` strategy the "duplicate email" case is expected and not an error.
- The `//? @adr 0019` tag on `accountStrategy.ts` and `confirmEmailChange_v1.ts` points future scans (and `decision_for_file`) at this ADR so the missing `@unique` is not re-flagged as a defect.
