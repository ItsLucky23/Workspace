---
id: 0328
title: Workspace time is the workspace's timezone, and the Assistant remembers its own conversation
status: accepted
date: 2026-08-26
tags: [timezone, pricing, assistant, chat, context, compaction, control-api, ui]
supersedes: []
---

## Context

ADR 0327 wired the stored-but-inert columns it could reach and left three that needed real product
work rather than a wiring fix. The owner named them on 2026-08-26: *"pricing moet een UI krijgen,
timezone moet overal gebruikt worden, assistant chat moet niet fire and forget zijn maar dus context
hebben. en misschien kijken voor een chat history in die assistant en een auto compact layer voor
zijn context window als die boven de e.g. 272k tokens komt"*.

Three separate failures with one shape — a value existed, but only one consumer honoured it:

1. **`Workspace.timezone`** was read by exactly one caller (the cron scheduler). Every other window a
   human reads — the budget month, the seven-day usage buckets, the analytics week, sprint start/end
   days, and roughly fifteen client-side date labels — ran on UTC or on the reader's device clock.
   Two people on the same team could read different answers to "how much did we spend this month".
   There was also no screen to set it; the in-app copy said so out loud ("Er is nergens een scherm om
   dat te wijzigen").
2. **`Workspace.pricing`** got its reader in 0327 (`priceFor` merges it over the built-in defaults and
   the `WS_MODEL_PRICE_PER_1K_JSON` env), but nothing could write it, so the € figures on the Usage
   page were whatever the host operator had baked into env — per host, not per workspace.
3. **The Assistant chat** was fire-and-forget at both ends. Forward: it carried only the last 8
   client-side bubbles as context, so a reload, a second device, or simply a long thread silently
   amnesia'd it mid-conversation, and the 20 000-character one-shot prompt budget clipped even that.
   Backward: an op it proposed and the user accepted returned a real answer (db-introspect's table
   list, a connection test's verdict) that was dropped on the floor — the assistant could not talk
   about the thing it had just done.

## Decision

**Timezone is the workspace's, everywhere.** One dependency-free module (`server/util/dateTz.ts`,
Intl only, the house standard) owns the calendar math: `zonedDay` / `zonedToUtc` (two-pass, so a DST
transition resolves to the right instant), `startOfMonthInTz`, `startOfDayInTz`, `dayKeyInTz`,
`weekdayInTz`, `parseDayInTz`, `calendarDaysBetween`, plus the write-side guard `isUsableTimeZone`.
Every human-facing window is anchored through it: the budget-month roll, the usage day buckets, the
analytics weeks (boundaries built in CALENDAR space, so a DST shift cannot slide a bucket onto the
neighbouring day), sprint dates on both the write (a bare `YYYY-MM-DD` stores the workspace's
midnight) and the read (labels and days-left). On the client, `useWorkspaceTimeZone()` feeds
`{ timeZone }` into every workspace-scoped `toLocale*` call.

**Reads fail closed to UTC; the write refuses.** Every function degrades to UTC on a zone `Intl`
cannot resolve, so a bad stored value can never throw inside a spend write or a snapshot read. The
inverse holds on the write path: `save-workspace-prefs` rejects an unusable zone outright rather than
storing something every reader would silently ignore.

**One new control-op, `save-workspace-prefs`, covers both settings.** It carries `timezone` and
`pricing`, because both are workspace preferences with a reader and no writer, and one op is less
surface than two. It speaks two shapes over one route: the settings UI sends the whole price map, the
chat AI sends a single `model` + `pricePer1k` pair (the op-catalog only speaks scalars) which merges
into the stored map. `0` is a legal price — a subscription seat costs nothing per token while its
token counts still accrue. The route reads the STORED values back rather than echoing the input, so a
refused zone snaps every client back to the truth.

**The Assistant's context comes from the persisted log, not the browser tab.** `interpretChat` loads
`WorkspaceChatMessage` rows for that user, workspace and surface. The client still sends what it saw;
those turns are merged in when the Conductor has not drained the previous pair yet, so a fast
follow-up is never answered blind.

**Compaction, not truncation, is what bounds the context.** Above `CHAT_CONTEXT_TOKENS` (default
272 000, `WS_CHAT_CONTEXT_TOKENS`) the oldest 70 % of the conversation is folded into a written
summary and that summary stands in for it. The summary is a `Handoff` row — the same mechanism the
coding agent uses to survive its own budget ceiling, whose `sessionKey` comment already reserved
`assistant:…` — with its `createdAt` stamped to the last summarised message so it doubles as the
watermark. No new model, no new verb. Compaction is best-effort: if the summarising call fails the
oldest turns are dropped instead, because a chat turn must never fail because its own memory
management did.

**The prompt budget becomes per-feature.** `workspace-chat` gets a prompt sized to the compaction
ceiling; every one-shot generation keeps the tight 20 000-character default. Clipping a conversation
at one-shot size is exactly the amnesia this ADR removes.

**An executed op's answer re-enters the conversation.** `executeTrackedChatDispatch` returns the
receipts' results alongside the ok/failed verdict, rendered generically (each op's own `result`, JSON,
capped at 2 000 characters) rather than through one bespoke formatter per op going stale one by one.
The accept handler appends it as an assistant turn.

## Rejected alternatives

- **Store UTC and convert only at the edge.** Already the situation, and it is what broke: there is no
  single edge. Cron, the budget roll, the analytics fold, the snapshot mapper and fifteen JSX call
  sites each decided independently, and all but cron chose the reader's clock or UTC.
- **A date library (date-fns-tz, Luxon, Temporal polyfill).** `Intl` already ships the tz database in
  the runtime, the repo has no date dependency, and the two existing hand-rolled implementations
  (`cron.ts`, `dateUtils.ts`) prove the surface needed is small. A dependency for eight functions is a
  supply-chain and bundle cost with no offsetting capability.
- **Two ops, `save-timezone` and `save-pricing`.** Symmetric with `save-autonomy`, but it doubles the
  catalog entry, RBAC row, `_sync` route, effect-matrix row and parity row for two fields that are
  both "a workspace preference with a reader and no writer".
- **A per-user timezone.** Tempting and wrong for this product: the whole point is that a scheduled
  post, a budget month and a sprint deadline mean the same instant for everyone on the team. A
  per-user display preference can be layered on later; a per-user *anchor* cannot.
- **Keep client-side chat history and just send more of it.** It cannot survive a reload or reach a
  second device, and it makes the browser the authority on what the assistant knows. The rows were
  already being persisted (#111) — nothing was reading them back.
- **A rolling window (keep the last N turns, drop the rest).** Cheap, and it is exactly the amnesia the
  owner asked us to remove: the decision taken forty turns ago is usually the one that still governs.
  It survives here only as the degradation path when the summariser is unavailable.
- **A new model for the chat summary.** `Handoff` already is that model, down to the reserved
  `sessionKey` prefix. A parallel `ChatSummary` table would have been a second answer to a solved
  question.
- **A per-op result formatter for the chat.** Reads better for the three ops someone remembers to
  write one for, and silently returns nothing for the other 149 as the catalog grows.
- **Raising `AI_PROMPT_BUDGET.prompt` globally.** It would let a workspace instruction or a skill block
  crowd out a one-shot feature's own contract — the exact thing the budget exists to prevent. The chat
  is a conversation; the rest are one-shots, and they deserve different ceilings.

## Consequences

- A workspace whose stored zone differs from its members' devices now shows DIFFERENT (correct)
  dates than before on the Usage, Analytics, Sprint, Scheduled-posts and Settings surfaces. Nothing
  moved — the labels became honest. The seed default stays `Europe/Amsterdam`.
- The budget month can roll at a different instant than before (the workspace's midnight rather than
  UTC's). Spend recorded in that gap now belongs to the month the team would say it belongs to.
- A workspace clone carries the source's timezone and price map; both are tuned settings, and losing
  either silently re-dates or re-prices the clone.
- The Assistant's turns cost more tokens: it now sends a real conversation rather than eight bubbles.
  `WS_CHAT_CONTEXT_TOKENS` is the operator's lever, and the honest ceiling is the context window of
  whichever backend actually serves `workspace-chat`.
- Compaction spends one extra AI call on the turn that crosses the ceiling. It is charged to
  `workspace-chat` like any other turn and shows up in the Activity tab as "Assistant chat compaction".
- An op-outcome bubble is session-local: the persisted log is written by the aiChat route around a
  real message, so an outcome does not survive a reload the way a normal turn does. It exists to give
  the NEXT turn its context, which is the half that was missing.
- `Channel.defaultStyleId` (#153) remains the one item from the 0327 follow-up list still awaiting an
  owner ruling: wire it into content generation, or delete it.
