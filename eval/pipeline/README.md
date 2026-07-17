# Pipeline role-prompt eval — the replay half

> Every edit to a role prompt (refine / plan / implement / review) is otherwise untested. A change
> that makes the agent emit a malformed carry-over, drift out of a ticket's file-scope, ask a
> **blocking** question where an advisory belongs, or drop its complexity score degrades the whole
> pipeline silently. This harness catches that class **without spending a subscription turn**.

## What it is

A golden corpus of **recorded** stage turns (`scenarios/GT-*.json`) replayed through the REAL
pipeline code — `parseTurnResult`, `renderPromptTemplate`, the structured-question codec — and scored
on structural invariants:

- **kind-matches** — the turn parses to the expected `done` / `needs-input` / `continue`.
- **summary-nonempty**, **open-questions-clean** — the carry-over envelope is well-formed.
- **changed-files-in-scope** — every `changedFiles` entry matches the ticket's `scope.allow` globs and
  none match `scope.deny` (scope drift = the #1 pipeline failure).
- **advisories-have-assumptions** — a W2 non-blocking question without an assumption is a blocking
  question in disguise and would wrongly park the ticket.
- **complexity-in-range** — the 1–10 auto-escalation contract holds.
- **template-fully-filled** — the next stage's `promptTemplate` renders with no leftover `{{chip}}`.
- **questions-decode** — a `needs-input` turn's questions decode to non-empty prompts.

No LLM runs in the scorer. A fixture is re-recorded when a role-prompt version changes (bump
`promptVersion`); if the new turns break an invariant, the score drops → red.

## Run it

```
npm run ai:eval:pipeline               # score every golden ticket
npm run ai:eval:pipeline -- --list     # list the corpus
npm run ai:eval:pipeline -- --check    # CI gate: fail if any ticket regressed vs baseline.json
npm run ai:eval:pipeline -- --write-baseline   # re-baseline after an intentional change
```

`baseline.json` holds the per-ticket score the `--check` gate compares against — a code change that
lowers any score fails CI until either the code or the baseline is deliberately updated.

## Not in scope (yet)

Live golden **runs** — real subscription turns over these tickets, scored the same way — are the
paid, higher-coverage half. This replay net is the cheap regression guard that runs on every commit.
