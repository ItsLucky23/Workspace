---
name: short-kebab-slug
title: One-line statement of the decision (imperative or declarative)
status: proposed
date: 2026-01-01
deciders: [yourname]
tags: [area, area]
supersedes: []
relates: []
---

## Context

What situation, problem, or forces led to this decision? What constraints were
in play? Enough that a future reader (human or AI) who wasn't here understands
*why a decision was even needed*. Keep it factual, not a narrative of the chat.

## Decision

What we chose. State it plainly — this line is what the AI reads first from the
generated index. One short paragraph.

## Rejected alternatives

- **<Option Y>** — rejected because <reason>.
- **<Option Z>** — rejected because <reason>.

(This section is the whole point of a decision record. If there were no real
alternatives, this was probably a rule, not a decision — put it in CLAUDE.md
User Project Rules instead.)

## Consequences

The trade-offs we accepted, follow-up work this creates, and what would make us
revisit. Note anything that becomes an always-on rule (and link the CLAUDE.md
rule with `relates:`).

<!--
HOW TO USE THIS FILE
- Copy to docs/decisions/NNNN-your-slug.md (next free 4-digit number).
- Fill the frontmatter + the four sections. `status`: proposed | accepted | superseded | deprecated.
- Never rewrite history: to change a past decision, add a NEW file and set its
  `supersedes: [NNNN]`, and flip the old file's status to `superseded`.
- Run `npm run ai:decisions` (autonomous) to refresh docs/AI_DECISIONS_INDEX.md.
- The AI writes these automatically during sessions when a durable decision is made (no command to run).
- Spec: docs/DECISION_MEMORY_PROTOCOL.md.
-->
