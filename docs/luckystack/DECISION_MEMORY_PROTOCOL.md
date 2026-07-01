# Decision Memory Protocol

The authoritative protocol for `docs/decisions/` — the committed, team-shareable record of the
project's durable decisions. This is the shareable replacement for a per-developer `~/.claude` memory
palace: rationale travels with the repo, so every teammate and every fresh AI session inherits it.

## 1. Purpose

A decision record (ADR — Architecture Decision Record) answers the one question every other artifact
leaves out: **why is it this way, and why not the obvious alternative?**

- The diff shows *what* changed. Commit messages show *what + a one-line why*.
- `branch-logs/` show *what happened, per prompt* (the firehose).
- CLAUDE.md User Project Rules state *what you must always do* (the imperative).
- A decision record states *the durable reasoning + the rejected alternatives* behind a choice.

Decisions are read by both humans and AI agents. The generated `docs/AI_DECISIONS_INDEX.md` is what an
AI reads at session start; it then opens the relevant `docs/decisions/NNNN-*.md` for the full story.

## 2. The three-way distinction (do not blur these)

| Surface | Granularity | Answers | Lifetime |
|---|---|---|---|
| `branch-logs/*.md` | per-prompt | *what happened on this branch* | per-branch, append-only |
| CLAUDE.md User Project Rules | always-on | *what I MUST always do* | until edited |
| `docs/decisions/` (this) | per durable decision | *why it is this way / why not Y* | until superseded |

A rule is the **imperative**; a decision is the **rationale + rejected alternatives** behind it. When a
decision hardens into an always-on constraint, promote a one-line rule into CLAUDE.md User Project Rules
and `relates:`-link it back to the ADR. Never auto-rewrite CLAUDE.md — that is user-gated (Rule 27 +
Report-Without-Auto-Fixing).

If a branch-log entry's notes contain a *durable, cross-cutting* rationale, promote it to a decision file
and link back. Branch-logs stay the firehose; `docs/decisions/` stays curated.

## 3. Storage

- Location: `docs/decisions/` at the repository root.
- One file per decision: `NNNN-slug.md` (zero-padded 4-digit number + kebab slug).
- **Not gitignored** — this is the whole point; it ships with the repo to every developer.
- `0000-template.md` is the seed; it is skipped by the index generator.
- The generated index `docs/AI_DECISIONS_INDEX.md` is committed and regenerated deterministically.

## 4. File format

Frontmatter (a tiny YAML subset — `key: value`, inline `[a, b]` arrays) + four markdown sections:

```markdown
---
name: peer-dep-guard-policy        # kebab slug, matches a ~/.claude memory name when migrated
title: Configured-but-not-installed peer dep is a hard boot crash
status: accepted                   # proposed | accepted | superseded | deprecated
date: 2026-06-11
deciders: [mathijs]
tags: [packaging, boot, error-handling]
supersedes: []                     # ADR numbers this replaces
relates: [0003]                    # ADR numbers / related decisions
---

## Context
## Decision
## Rejected alternatives
## Consequences
```

The `Decision` section's first line is what surfaces in the index summary — make it a plain, standalone
statement.

## 5. When to record a decision

### Record it
- A cross-cutting architecture choice (dependencies, layering, public contracts, a package's job).
- A policy that will shape future code (typing rules, error-handling stance, security posture).
- A deliberate deviation from this repo's own docs/conventions (CLAUDE.md Rule 3b) — record BOTH sides.
- Choosing one approach over a real alternative that a future reader would otherwise re-litigate.

### Skip it
- Routine implementation with no real alternative (that's just code — the diff suffices).
- Per-prompt work narrative (that's a branch-log entry).
- An always-on imperative with no rationale to capture (that's a CLAUDE.md rule).

### When in doubt
Record it. A superseded decision is still valuable history; a lost rationale costs the next session — or
the next teammate — an afternoon of archaeology.

## 6. Supersession (never rewrite history)

Decisions are immutable once accepted. To change one:
1. Write a NEW `NNNN-*.md` with `supersedes: [OLD]`.
2. Flip the OLD file's `status:` to `superseded`.
3. Regenerate the index.

This gives an auditable trail of how the project's thinking evolved, instead of a git-blame mystery.

## 7. Capture workflow — automatic, AI-driven (no command to run)

There is **no slash command** and nothing the user is expected to run. Recording decisions is automatic
AI behavior, exactly like the branch-log protocol: the AI captures them as a normal part of working in a
session. Specifically, **the AI MUST**:

1. **Write a decision file when a durable decision is made during a session.** When a choice with a real
   rejected alternative is settled (a dependency/layering/contract choice, a policy, a deliberate
   deviation from the docs per Rule 3b), the AI creates `docs/decisions/NNNN-slug.md` then and there —
   allocating the next free number, filling the four sections from the in-session reasoning it already
   has. This is an autonomous action (a committed doc, not an install) — no permission prompt, same as
   appending a branch-log entry.
2. **Regenerate the index in-session** after writing one: `npm run ai:decisions` (autonomous). The
   pre-commit hook is the backstop, not the primary path.
3. **Read the index before answering "why".** When the AI (or the user) wonders why something is the way
   it is, it consults `docs/AI_DECISIONS_INDEX.md` first and opens the relevant decision file — instead
   of guessing or re-deriving. This is why the index is in the session-start read sequence.

The user does not trigger any of this. They may of course *ask* the AI to record a specific decision, but
the default is the AI noticing and capturing on its own.

## 8. Empty-memory backfill (offer it, don't run it silently)

When the AI starts a session and finds the decision memory effectively **empty** (only `0000-template.md`,
no real ADRs) **OR clearly incomplete** — the project already has substantial history (many commits,
populated `branch-logs/`, a large `src/`) but few or no ADRs explaining its big architectural choices —
it should **proactively TELL the user and OFFER** to backfill the decision memory. There are two
complementary sources; use both.

### 8a. Mine what's already written down (automatic, with go-ahead)

- **git history** (`git log`, notable commits, merge/PR messages) for the durable choices already made,
- **`branch-logs/`** entries whose notes contain durable, cross-cutting rationale,
- optionally the per-developer `~/.claude` memory for this project: classify each entry as **team truth**
  (→ a committed ADR) vs **personal preference** (→ stays local), decide per entry with the user (never
  auto-import — Rule 27), and note in the local entry that it was promoted so a later pass doesn't repeat
  it.

### 8b. Interview the user (the richest source — the "why" lives in their head)

Most real rationale was never written down anywhere. So the AI should also OFFER a **one-time, focused
interview**, framed honestly as a worthwhile investment:

> *"Heb je nu even tijd om samen door de bestaande codebase te lopen en mijn vragen erover te
> beantwoorden? Het is eenmalig, en het verbetert al mijn toekomstige changes drastisch — daarna snap ik
> waaróm dingen zo zijn en herhaal ik je beslissingen niet onbedoeld."*

How to run it well (do NOT just ask "tell me about your code"):

1. **Prep first, then ask.** Before any questions, scan the code + `git log` + the indexes/graph to build a
   list of the BIG undocumented decisions (auth model, data model, packaging, a surprising pattern, a
   place where the obvious approach was NOT taken). Ask about *those specific gaps* — targeted, not open.
2. **Ask in small batches**, one feature/area at a time, so the user can answer at their pace. For each:
   "I see you did X here instead of the more common Y — what was the reason?" / "What does this feature
   need to guarantee?" / "What did you deliberately rule out?"
3. **It's resumable.** The user can answer a few now and continue later; never demand the whole thing in
   one go. Track which areas are still un-interviewed so a later session can pick up.
4. **Record each confirmed answer as an ADR** (Context / Decision / Rejected alternatives / Consequences),
   in the user's own words. Capture the *rejected alternative* explicitly — that's the highest-value part.
5. **Never fabricate.** If the user doesn't know or doesn't remember, leave it out; an inferred-but-
   unconfirmed rationale is marked as an assumption (`status: proposed`), never written as `accepted`.

This whole thing is an **offer**, surfaced once when the gap is detected — not an automatic bulk write and
not a command the user has to remember. The result is a seeded `docs/decisions/` that reflects the
project's real past (from history AND from the people who made it), so every future session inherits the
"why" instead of re-deriving or re-litigating it.

## 9. Staleness

The index can never drift from the files: `npm run ai:decisions` rebuilds it from disk, the AI runs it
in-session right after writing a decision, and `.githooks/pre-commit` rebuilds + `git add`s it as the
commit-time backstop. The output is deterministic (no timestamps) so a no-op commit leaves it byte-identical.
Decision *content* staleness is handled by `status`/`supersedes`, never by editing an accepted record.

## 10. Numbering collisions

Two branches may both grab the next number. Mitigation: the slug-first filename keeps them distinct on
disk; renumber the later one on merge (same posture as branch-log filename collisions). Rare and cheap.
