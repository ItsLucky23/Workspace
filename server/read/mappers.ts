//? Workspaces — shared read-mappers: Prisma row → frontend shape.
//?
//? Extracted so the realtime `_sync` write routes can broadcast a delta in EXACTLY
//? the shape the initial snapshot emits (`buildSnapshot`), so the client merges a
//? live delta identically to the first load — no divergence, no refetch.

import type { Ticket as DbTicket } from '@prisma/client';

import type { Ticket, TicketStatus } from '../../src/workspaces/_data/types';

const asStatus = (s: string): TicketStatus =>
  (s === 'needs-input' || s === 'busy' || s === 'done' || s === 'paused' || s === 'stuck' ? s : 'idle');

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
