---
name: transport-contracts-are-json-stable
title: Shared API and sync type maps accept only JSON-stable contracts
status: accepted
date: 2026-07-16
deciders: [ItsLucky23]
tags: [devkit, api, sync, types, json, transport]
supersedes: []
relates: []
---

## Context

LuckyStack derives one input/output map per API or sync route and uses it for both
HTTP and Socket.io. Route source types describe server values, but the client holds
transport values. A server `Date` output is therefore an ISO string. The output
projector fixed that mismatch, but two remaining classes were still unsound:

- A `Date` input annotation made the client and handler promise a Date instance even
  though JSON delivered a string. Validation accepted that string, after which
  `data.at.getTime()` compiled and threw.
- Binary output has no single shared shape: Socket.io reconstructs a binary
  attachment, while HTTP JSON serializes `Buffer.toJSON()` or an empty object for
  several browser binary values.

JSON omission adds a smaller version of the same problem: object properties whose
value is `undefined`, symbol, or callable disappear; array slots become `null`.

## Decision

Shared route contracts must be JSON-stable. Input generation rejects `Date`; route
authors declare an ISO string, validate it, and convert explicitly. Output and stream
generation recursively projects JSON semantics (`Date -> string`, `toJSON()` return
types, property omission, array-slot `null`). Binary and BigInt outputs abort
generation with an actionable message; authors return an explicit JSON DTO/base64
string or use a transport-specific custom route.

## Rejected alternatives

- **Automatically hydrate ISO strings into Date instances before handlers** — implicit
  conversion would have to be identical across API/sync and dev/prod validators,
  changes hook-visible input values, and makes a nominal `Date` accept only one of
  many possible date encodings without the route author choosing that policy.
- **Project Date inputs to string only in the generated client map** — the source
  handler would still be typed as Date, preserving the most dangerous half of the
  lie.
- **Emit a broad binary union** — browser Socket.io, Node Socket.io, and HTTP JSON
  produce different values; a union would force every consumer to narrow several
  platform shapes while still not proving which transport was used.
- **Create separate HTTP and Socket.io maps now** — truthful but a much larger public
  API and generator migration. Revisit only when a concrete route needs first-class
  binary responses on both transports.

## Consequences

- Existing routes with `Date` input or binary/BigInt output fail generation and must
  migrate explicitly; this is intentionally fail-loud rather than silently unsafe.
- Date outputs and ORM DTOs retain their projected client shapes.
- Optional/omitted output fields and array slots now match JSON behavior more closely.
- Custom HTTP routes remain the escape hatch for streaming/download responses whose
  contract is intentionally transport-specific.
