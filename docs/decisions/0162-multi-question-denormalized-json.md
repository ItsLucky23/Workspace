---
title: W1 — multi-question sets via denormalized JSON on the ticket (not the relational QuestionSet models)
status: accepted
date: 2026-07-08
tags: [orchestrator, questions, needs-input, phone-first, adoption, schema]
---

## Context

An in-container agent can end its turn with a `ws-needs-input` block listing **several** questions
(`parseTurnResult` already returns `questions: string[]`), but `stageRunner` persisted only `questions[0]` onto
the single `Ticket.needsInput` banner and **silently dropped the rest**. So a phone-first "answer a few
questions" flow was impossible — if the agent asked 3, 2 were lost. The schema already modelled relational
`QuestionSet` + `Question` tables (04b, "phone-from-the-beach loop") but they were **dead code** — nothing read
or wrote them, and the docs (02 §2/§5, features/09) described a **blocking `request_input` held-open verb** that
was never implemented (the real mechanism is park-and-resume via the Stop-hook). W1 makes multi-question real
and the docs honest.

## Decision

- **Store the full set denormalized on the ticket**, not in the relational models: add `Ticket.needsInputQuestions
  Json?` = `[{ q, a }]` (q = the stored needsInput wire form — plain for free, `@@wsq:` for approve/choice; a =
  the answer or null). `Ticket.needsInput` stays the banner = the first UNANSWERED question (back-compat with
  every existing reader: the banner, the answer-queue, `isRealNeedsInput`, the P-B card).
- **A pure core module** `server/orchestrator/questionSet.ts` (`parseNeedsInputQuestions` with a legacy
  single-banner fallback, `applyAnswers`, `firstUnanswered`, `buildCombinedAnswerPrompt`) — no DB, unit-tested.
- **No new structured-channel verb** (frozen 7+6 intact): the existing `answer-input` control-op carries either a
  single `answer` (fills the first open question → the phone-first STEPPER advances the banner) or an `answers[]`
  batch (fills the open questions in order). The parked `claude` turn is resumed **only once every question is
  answered** — a single question resumes with the bare answer (byte-identical to the pre-W1 flow), many resume
  with a numbered, envelope-decoded `Q→A` prompt. Single-writer/B-23 unchanged (Conductor is the only writer).

## Rejected alternatives

- **Revive the relational `QuestionSet`/`Question` models.** More faithful to the original 04b design, but a much
  larger change (relations, a QuestionSet lifecycle, a new read/mapper surface, migration of the banner readers)
  for no user-visible gain over a denormalized array — and MongoDB makes the embedded `[{q,a}]` the natural
  shape. Left the models as dead code (a future cleanup may drop them).
- **A new `request_input`/`answer_input_set` verb** matching the docs' blocking framing. Rejected: it violates the
  frozen-verb invariant and the park-and-resume reality; `answer-input` already carries everything needed.
- **Resume after each answer.** Rejected: it would fire N expensive turns for N questions and lose the "answer a
  batch, then continue once" phone UX; we resume once, with all answers.

## Consequences

- The existing single-answer UI works transparently as a stepper (each answer advances the banner); a dedicated
  "answer N questions at once" card stepper + surfacing the full set in the snapshot are follow-up UI
  (browser-verify). The docs (02 §2, features/09) now carry an ERRATA making the code canonical.
- `needsInputQuestions` is cleared (`null`) on full-answer and overwritten on each new needs-input park; defer
  banners (editor/capacity) don't populate it, so they don't collide.
- Backed by `questionSet.test.mts` (23 pure assertions) + `multiQuestion.test.mts` (11, the real Conductor
  stepper + batch + audit-comment trail). No regression: answer-queue/answerInput/stageEngine/turnResult green.
