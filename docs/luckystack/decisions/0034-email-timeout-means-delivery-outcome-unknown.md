---
name: email-timeout-means-delivery-outcome-unknown
title: Email timeout is cancellation intent, not proof of delivery failure
status: accepted
date: 2026-07-21
deciders: [mathijs]
tags: [email, reliability, idempotency, cancellation]
supersedes: []
relates: []
---

## Context

`sendEmail` bounded a provider call with `Promise.race` and returned
`send-timeout`, while the losing SMTP/HTTP operation continued. A caller could
interpret that result as “not sent” and retry, producing duplicate transactional
mail when the first provider call completed late. Providers differ: Resend has
native idempotency, custom adapters may support abort signals, and SMTP cannot
reliably cancel once transmission begins.

## Decision

The adapter contract accepts an optional `EmailSendContext` containing a
cooperative `AbortSignal` and caller-provided stable `idempotencyKey`. Context is
optional so existing custom adapters remain source-compatible. `sendEmail`
aborts the signal when timeout/caller cancellation wins. Once adapter dispatch
has begun, the failure reports `deliveryOutcome: 'unknown'`; before dispatch it
reports `not-sent`. Retries of an unknown outcome must reuse the same key.
Resend forwards that key to provider-native deduplication. SMTP remains honest
about its inability to guarantee cancellation.

## Rejected alternatives

- **Keep returning a plain timeout failure.** It invites duplicate retries by
  claiming more certainty than the provider boundary offers.
- **Generate a random key inside every call.** A retry would receive a different
  key and therefore could not deduplicate the original attempt.
- **Require every adapter to accept the new context immediately.** That would
  break consumer adapters in a 0.x minor; optional context enables gradual
  adoption.
- **Close the shared SMTP transport on abort.** It can disrupt unrelated sends
  and still does not prove that the current message was not accepted.

## Consequences

- Callers that retry transactional mail should supply a deterministic logical
  key and persist/reuse it.
- Existing callers and adapters continue to compile, but only upgraded adapters
  gain cancellation/idempotency behavior.
- Timeout remains a bounded-wait mechanism; it is no longer presented as a
  definitive delivery result.
