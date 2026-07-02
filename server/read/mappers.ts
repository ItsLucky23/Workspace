//? Workspaces — shared read-mappers: Prisma row → frontend shape.
//?
//? Extracted so the realtime `_sync` write routes can broadcast a delta in EXACTLY
//? the shape the initial snapshot emits (`buildSnapshot`), so the client merges a
//? live delta identically to the first load — no divergence, no refetch.

import type { Ticket as DbTicket } from '@prisma/client';

import type { Ticket, TicketStatus } from '../../src/workspaces/_data/types';

const asStatus = (s: string): TicketStatus =>
  (s === 'needs-input' || s === 'busy' || s === 'done' || s === 'paused' || s === 'stuck' ? s : 'idle');

//? Runtime guard: is this the Conductor's op-result a Prisma Ticket row? Lets the
//? realtime `_sync` routes narrow the (deliberately `unknown`) op result to a typed
//? delta WITHOUT an `as`-cast (the codebase's strict no-assertion posture).
function isDbTicket(v: unknown): v is DbTicket {
  return v !== null && typeof v === 'object' && 'id' in v && 'key' in v && 'title' in v && 'stageId' in v;
}

//? The Conductor returns an op's write as `unknown`; narrow a ticket-producing op's
//? result to the frontend `Ticket` delta a `_sync` route broadcasts (or null if the
//? op no-oped). No cast — the `is` guard does the narrowing.
export function ticketDelta(result: unknown): Ticket | null {
  return isDbTicket(result) ? toTicket(result) : null;
}

//? Map a Prisma Ticket row → the frontend `Ticket` (the board/backlog key is the
//? DEV-#### `key`, not the ObjectId). Mirrors the mapping in `buildSnapshot`.
export function toTicket(t: DbTicket): Ticket {
  return {
    id: t.key, workspaceId: t.workspaceId, projectId: t.projectId, title: t.title, description: t.description ?? undefined,
    stageId: t.stageId, status: asStatus(t.status), labels: t.labels, creatorId: t.creatorId ?? undefined, assigneeId: t.assigneeId ?? undefined,
    viewers: [], hasTerminal: false, branch: t.branch ?? undefined, mr: t.mrUrl ?? undefined, issue: t.issueUrl ?? undefined,
    sprintId: t.sprintId ?? undefined, carryOver: t.carryOver ?? undefined, needsInput: t.needsInput ?? undefined, archived: t.archived,
  };
}
