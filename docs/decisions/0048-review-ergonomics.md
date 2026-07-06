---
id: 0048
title: Review ergonomics — cross-ticket answer-queue + presence soft-claim
status: accepted
date: 2026-07-06
tags: [review, answer-queue, presence, claim, expansion-g2]
supersedes: []
depends_on: [0024]
---

# Review ergonomics

## Context

G2 un-defers additions/05 + 06: a cross-ticket **answer-queue** (drain every pending question from one
place, phone-first) + **presence/claim** (who's viewing/answering + a soft-claim so two reviewers don't
double-answer). The presence relay already exists (`_sync/presence`, ephemeral who's-viewing).

## Decision

1. **Answer-queue = a snapshot-derived cross-ticket view.** Every ticket parked on a question
   (`Ticket.needsInput` set, or status `needs-input`) surfaces in `snapshot.answerQueue` (`ticketKey`,
   `title`, `question`, `priority`), highest-priority first — one queue the reviewer swipes/stacks through
   instead of hunting per-ticket. Pure derivation over the existing tickets — no new write path/model.

2. **Soft-claim on the presence relay.** The presence event gains a `claiming` flag: a reviewer answering
   a ticket broadcasts `{viewing:true, claiming:true}`; the client renders "X is answering" and can disable
   the answer input for others. Ephemeral + idempotent (like viewing) — the authenticated user id comes
   from the session (unspoofable), the socket room fan-out makes it multi-instance-safe for free. NOT
   authoritative state (no Conductor write) — it's a coordination hint, not a lock.

## Rejected alternatives

- **A hard claim / DB lock on the ticket.** Rejected — a claim is a coordination hint to avoid a
  double-answer, not authoritative state; a hard lock would need a Conductor write + a release path + a
  stale-lock reaper. The ephemeral presence soft-claim (idempotent, auto-expiring like viewing) is right.
- **A separate answer-queue model / write path.** Rejected — the queue is a pure fold over the tickets
  already carrying `needsInput`; PRODUCT/additions specify no new write surface.
- **A dedicated answer-queue page.** The data + `claimTicket`/`claimedBy` are wired on the context; a
  dedicated swipe/stack UI is the remaining UX layer (follow-up) — the queue is available to any surface.

## Consequences

- New `AnswerQueueItem` type; snapshot `answerQueue`; presence `claiming` flag; context `answerQueue` +
  `claimTicket` + `claimedBy` (derived from presence). No new model, no new op, no new write path.
- Reuses the presence relay + the existing `answer-input` op (the queue links to a ticket the reviewer
  answers via the existing path).
- Follow-ups: the dedicated swipe/stack answer-queue UI; a per-project queue scope; a "typing" indicator
  on top of the claim.
