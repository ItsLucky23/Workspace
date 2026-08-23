//? Unit test for toActivityEvent (server/read/mappers.ts) — the TicketEvent row → ActivityEvent mapper
//? the workspace snapshot emits. Pins the F-107 contract: `at` is the FULL ISO timestamp (not a bare
//? HH:MM the client would read as "today"), the ticket ObjectId resolves to its DEV-#### key (unknown
//? ids pass through) and an unknown event type falls back to 'ai-message'. No DB, no casts.

import { assert, eq, report } from '../_helpers.mts';

const { toActivityEvent } = await import('../../server/read/mappers.ts');

const createdAt = new Date('2026-07-07T09:00:00Z');
const keys = new Map([['64f0000000000000000000a1', 'DEV-1240']]);
const row = (over: Partial<{ ticketId: string; type: string }> = {}) => ({ createdAt, actor: 'ai', ticketId: '64f0000000000000000000a1', type: 'command', text: '`npm test` → 2 failing', ...over });

// 1) the timestamp travels as ISO, never as a clock-only string
{
  const ev = toActivityEvent(row(), keys);
  eq(ev.at, '2026-07-07T09:00:00.000Z', 'at is the full ISO timestamp');
  assert(!/^\d{2}:\d{2}$/.test(ev.at), 'at is not a bare HH:MM');
  eq(ev.actor, 'ai', 'actor passes through');
  eq(ev.text, '`npm test` → 2 failing', 'text passes through');
}

// 2) ticket ObjectId → DEV key; an unknown id passes through untouched
{
  eq(toActivityEvent(row(), keys).ticketId, 'DEV-1240', 'known ObjectId resolves to the ticket key');
  eq(toActivityEvent(row({ ticketId: 'unknown-id' }), keys).ticketId, 'unknown-id', 'unknown id passes through');
}

// 3) event type narrowing — known kinds keep their kind, anything else is an ai-message
{
  eq(toActivityEvent(row({ type: 'status-change' }), keys).type, 'status-change', 'known type kept');
  eq(toActivityEvent(row({ type: 'whatever' }), keys).type, 'ai-message', 'unknown type -> ai-message');
}

report('tests/unit/activityEvent.test.mts');
