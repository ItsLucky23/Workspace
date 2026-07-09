---
title: W2 — non-blocking (advisory) questions via the done-envelope, resolved with a divergence→revision loop
status: accepted
date: 2026-07-08
tags: [orchestrator, questions, non-blocking, needs-input, adoption, schema]
---

## Context

The user wants the agent to be able to ASK a question without fully blocking the ticket — "de AI kan vragen
stellen maar wel al verder met de rest" (mostly code-side). In the park-and-resume model a `ws-needs-input`
block STOPS the turn (parks the ticket), which is the opposite of "keep working". So a non-blocking question
cannot travel through `ws-needs-input`; it must be something the agent notes *while proceeding*.

The plan's phrasing ("re-express via de bestaande needs-input-payload + answer-input") was ambiguous about the
exact mechanism, so per the run's ambiguity rule this design was chosen and logged as an OPEN VRAAG in the
branch-log.

## Decision

- **A non-blocking question rides the DONE envelope, not `ws-needs-input`.** The agent, instead of stopping,
  makes a sensible assumption, keeps working, and records the question in the `ws-carryover` block's
  `openQuestions` as an object `{ question, assumption }`. `parseTurnResult` splits `openQuestions` into plain
  strings (unchanged, still fed to the next stage's `{{openQuestions}}` as before) + `advisories`
  (`{q, assumption}`). renderStage's guidance now tells the agent this explicitly, reserving `ws-needs-input`
  for TRULY blocking questions.
- **The ticket never parks on an advisory.** On stage-done, advisories are appended (dedup by question) to a new
  denormalized `Ticket.advisoryQuestions Json?` = `[{q,assumption,a,resolved}]`; the turn completes normally.
- **Resolving reuses the frozen `answer-input` op (no new verb).** `answer-input` with an `advisoryIndex` +
  `answer` resolves one advisory: a MATCHING answer (trim + case-insensitive) just marks it resolved; a DIVERGENT
  answer marks it resolved AND fires a **revision turn** (`reprovisionTicket` with `claude --resume` + a
  correction prompt naming the assumption + the human's answer). Pure core (`parseAdvisories`, `resolveAdvisory`)
  in `questionSet.ts`. Single-writer/B-23 unchanged.

## Rejected alternatives

- **Non-blocking via `ws-needs-input` with a `blocking:false` flag.** Rejected: `ws-needs-input` *is* the stop
  signal (the PTY is killed, the ticket parks) — a "non-blocking park" is a contradiction. The done-envelope is
  the only place the agent is still proceeding.
- **A new `resolve-advisory` verb.** Rejected: violates the frozen-verb invariant; `answer-input` + an
  `advisoryIndex` carries everything.
- **Semantic divergence detection (LLM judge "is this answer different?").** Rejected as over-engineered +
  non-deterministic; a normalized string compare is predictable and testable. A follow-up can add nuance.

## Consequences

- OPEN VRAAG (logged): the exact non-blocking UX was under-specified; this done-envelope interpretation is the
  default. If the user meant something else (e.g. the agent should be interrupted mid-turn), revisit.
- Surfacing advisories in the ticket UI (a "the AI assumed N things — confirm/correct" card) + a push
  notification + exposing `advisoryQuestions` in the snapshot are follow-up UI (browser-verify).
- Divergence only reprovisions when the ticket has a branch + Docker (else the resume no-ops) — same gate as
  every other autonomous turn.
- Backed by `questionSet.test.mts` (advisory assertions) + `turnResultStructured.test.mts` (envelope split) +
  `advisoryQuestion.test.mts` (the real Conductor resolve, match vs divergent, non-parking, audit trail).
