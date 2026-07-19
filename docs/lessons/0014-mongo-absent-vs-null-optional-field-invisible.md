---
id: 0014
title: On MongoDB an omitted optional field is ABSENT, not null — `{ field: null }` never matches it, so freshly written rows are invisible to their own queries
severity: high
area: prisma, mongodb, schema-change
date: 2026-07-19
---

# 0014 — `purgedAt: null` did not match rows where `purgedAt` was never written

## What happened

`TrashedMedia` used the standard soft-delete shape: a nullable `purgedAt`, written only once the bytes are
actually unlinked. Every read filtered on `purgedAt: null` to mean "still in the bin". Creating a row left
`purgedAt` off entirely, because it has no value yet.

The result looked like the write silently failing:

- `trashMedia()` returned `true`,
- the row was really in the collection (a raw `findMany` on `workspaceId` returned it),
- but `listTrash()` returned `[]`, and the idempotency check (`findFirst({ …, purgedAt: null })`) never
  found the row it had just written — so a second delete of the same file created a *second* row.

Roughly twenty minutes went into suspecting the tenant extension, a stale generated client, and a missing
`prisma db push`, because every one of those produces the same symptom: "the write says ok, the read says
nothing".

## Root cause

On MongoDB, an omitted optional field is **absent from the document** — which is not the same as being
`null`. Prisma's `{ field: null }` filter matches an explicit `null`, not an absent field (that is
`{ field: { isSet: false } }`). So the row existed and was correct, and simply did not match any query that
defined the collection's own "not yet purged" state.

This is the same absent-vs-null trap that makes a newly added field read as absent on existing rows, but it
is easier to miss here: nothing was migrated, the field was absent from the moment the row was born.

## How to avoid

- On MongoDB, **write nullable state fields explicitly as `null` on create** whenever a query filters on
  them. `purgedAt: null` in the `create` data is the whole fix.
- When a query must also survive rows written before that rule existed, match both:
  `{ OR: [{ field: null }, { field: { isSet: false } }] }`.
- Symptom to recognise fast: *the write succeeds and a raw query by id finds the row, but the filtered
  query does not.* Before suspecting the client, the schema push, or the tenant extension, check whether
  the filtered field was ever actually written.
