//? Board/ticket UI write wiring — actionable controls must reach an authoritative operation.
//? This guard pins the regressions where a stage move only changed React state and several
//? visible buttons had intentionally empty handlers.

import { readFileSync } from 'node:fs';

import { assert, report } from '../_helpers.mts';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const card = read('src/workspaces/develop/board/KanbanCard.tsx');
const code = read('src/workspaces/develop/board/[ticketId]/CodePanel.tsx');
const activity = read('src/workspaces/develop/board/[ticketId]/ActivityPanel.tsx');
const ticketPage = read('src/workspaces/develop/board/[ticketId]/page.tsx');
const shell = read('src/workspaces/_shell/Shell.tsx');
const activityPage = read('src/workspaces/insights/activity/page.tsx');

assert(card.includes('ctx.bulkMove([ticket.id], stageId)'), 'manual card move uses the authoritative bulk-move write for one ticket');
assert(!card.includes('ctx.moveTicket(ticket.id, stageId)'), 'manual card move never falls back to a local-only stage override');
assert(card.includes('<ArtifactLinkPicker ticketKey={ticket.id} ctx={ctx}'), 'the card opens the shared working artifact picker');
assert(code.includes('<ArtifactLinkPicker ticketKey={ticketKey} ctx={ctx}'), 'the Code tab reuses the same working artifact picker');
assert(!code.includes('reference picker not wired'), 'the Code tab no longer advertises an empty reference handler');
assert(!activity.includes('ticket link picker not wired') && !activity.includes("key: 'workspaces.ticket.linkTicket'"), 'ticket-link controls stay hidden until a real write path exists');
assert(ticketPage.includes(".then((ok) => { if (ok) ctx.killTicket(ticket.id); })"), 'type-confirmed ticket teardown dispatches the authoritative kill ControlOp');
assert(!ticketPage.includes('no teardown-container control-op yet'), 'ticket teardown is no longer a knowingly empty handler');
assert(!ticketPage.includes("key: 'workspaces.ticket.killAgent'"), 'the ticket menu exposes one destructive teardown lever instead of a duplicate stop/no-op pair');
assert(!shell.includes('onSnoozeSuggestion'), 'the AI panel does not show a suggestion-snooze control with an empty handler');
assert(!activityPage.includes('dummy data today'), 'Activity documents its real TicketEvent snapshot source');

report('tests/unit/boardActionWiring.test.mts');
