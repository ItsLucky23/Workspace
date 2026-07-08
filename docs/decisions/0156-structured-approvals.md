---
title: P-B — structured approve/reject/choice cards for needs-input
status: accepted
date: 2026-07-08
tags: [approvals, needs-input, ui, phone-first, idea-to-outcome]
---

## Context

When an in-container agent blocked on a question it emitted a `ws-needs-input` block. Two problems: (1) the
parsed questions were **dropped** — `stageRunner` parked the session busy but never wrote the question onto
the ticket, so the human saw nothing; (2) even the defer-message banner was a single free-text input, so a
yes/no or pick-one decision meant typing prose on a phone. P-B makes the agent's question actually surface,
and as a structured, tap-to-answer card.

## Decision

- **Encode structure inside the existing `needsInput` string — no schema change, no new verb.** A FREE
  question stays its plain prompt (every existing reader — banner, answer-queue, `isRealNeedsInput` — is
  unaffected); an APPROVE or CHOICE question is stored as a compact `@@wsq:` JSON envelope. The pure,
  isomorphic `structuredQuestion.ts` (`encodeQuestion` / `parseStructuredQuestion` / `questionPrompt`) is the
  single wire-shape source shared by server and client.
- **Close the surfacing gap in `stageRunner`.** On a needs-input turn, persist the first question (already
  needsInput-encoded by `parseTurnResult`) onto the ticket + flip it to `needs-input` + broadcast, so the
  board/phone renders the card. `parseTurnResult` now accepts structured entries (`{prompt,kind,options}`)
  alongside bare strings.
- **The card (`NeedsInputBanner`) renders by kind:** approve → Approve/Reject (+ optional note); choice → one
  tap-target per option; free → the text input. Every path routes through the SAME `answerInput` op — the
  Conductor records the answer + re-fires the parked turn with `--resume`. B-23 intact: the human's tap is a
  proposal→accept, the Conductor is still the only writer.
- **The answer-queue shows the decoded prompt** (`questionPrompt`), never the raw envelope.

## Rejected alternatives

- **A new `request-input` write-op / a `QuestionSet`-backed table + a new answer verb.** Violates frozen 7+6 —
  `request-input` already exists as a read/propose ws-verb, and `answer-input` already exists as the write op.
  Reusing them + enriching the `needsInput` string needs zero new surface. The `QuestionSet` model stays for
  the multi-question beach-loop; a single blocking question rides the ticket field it already has.
- **A Prisma column for the structured question (kind/options).** A migration + a second source of truth for
  a value that is always read alongside `needsInput`. The `@@wsq:` envelope is back-compat and self-describing.
- **Keeping questions server-only until a human opens the ticket.** They were being dropped entirely; the fix
  is to persist + broadcast so the phone gets the card without opening anything.

## Consequences

- An agent can now block with a real structured question and the human answers it with one tap from the board
  or phone; a free question still works exactly as before. Legacy plain-string `needsInput` values decode as
  free questions, so nothing pre-existing breaks (stageEngine 27/27, answerQueue 5/5, answerInput 4/4 still
  green). Pure wire-format + turn-parse unit-tested (15/15 + 8/8). The isomorphic decoder keeps one scoped raw
  try/catch (documented) because it must stay sync and the client bundle has no `tryCatchSync`. i18n ×4. Live
  browser QA of the card (approve/choice/free rendering, phone tap-targets) folds into the shared browser pass.
