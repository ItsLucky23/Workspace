# Lessons Protocol

> The committed, project-wide **pitfalls** layer: *what was tried, what failed, and the takeaway*.
> Like the Branch-Log and Decision-Memory protocols, this is **automatic AI behavior — there is no
> command for the user to run.** The AI fills and reads it as a normal part of working.

## Why this exists

`branch-logs/` is a per-branch firehose, and the per-developer `~/.claude` memory is private and never
committed. Neither is a shared, searchable, project-wide record of the dead-ends a team (and every fresh
AI session) keeps rediscovering. The lessons layer is that missing surface — durable, committed, and
queryable via the `@luckystack/mcp` tools `list_lessons` / `find_lesson` / `get_lesson`.

## Keep the four surfaces distinct — do not blur them

- `branch-logs/` = *what happened, per prompt* (the firehose).
- CLAUDE.md User Project Rules = *what you must always do* (the always-on imperative).
- `docs/decisions/` = *why it is this way / why not Y* (durable rationale, until superseded).
- `docs/lessons/` = *what failed and the takeaway* (a pitfall, so it isn't repeated).

A lesson is not a decision: a decision has a rejected alternative and settles a choice; a lesson captures
a non-obvious failure so the next person avoids it. If the right output is a rule, that's a decision (or a
CLAUDE.md rule); if it's "don't do X because it silently breaks Y", that's a lesson.

## AI MUST, on its own

- **Record a lesson when a non-obvious dead-end is hit.** When a session burns real effort on a path that
  failed for a reason that wasn't obvious up front (a leaky boundary, a platform footgun, a "static checks
  passed but runtime broke" surprise), write `docs/lessons/NNNN-slug.md` (What happened / Root cause / How
  to avoid) then regenerate `npm run ai:lessons`. Autonomous — a committed doc, like a branch-log append.
- **Consult it before retrying something hard.** Before re-attempting a tricky integration or a previously
  abandoned approach, `find_lesson` first — don't rediscover a known pitfall.
- **Offer to backfill on an existing project.** If at session start `docs/lessons/` is effectively empty
  (only `0000-template.md`) but the project has substantial history (many commits, populated `branch-logs/`,
  a `~/.claude` memory full of "learned this again" notes), proactively TELL the user and OFFER to seed it —
  from the written history AND a short, resumable interview ("welke dingen heb je al een paar keer opnieuw
  moeten leren in deze codebase?"). Mirror Decision Memory Protocol §8: offer once, early; act only on the
  user's go-ahead; never fabricate — unconfirmed inferences stay out until confirmed.

## File format

Frontmatter: `name`, `title`, `severity` (`low|medium|high|critical`), `area` (a path or subsystem),
`date` (absolute), `tags` (inline array). Body sections: `## What happened`, `## Root cause`, `## How to
avoid` (the takeaway the index surfaces). See `docs/lessons/0000-template.md`.
