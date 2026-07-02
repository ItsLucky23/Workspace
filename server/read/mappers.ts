//? Workspaces — shared read-mappers: Prisma row → frontend shape.
//?
//? Extracted so the realtime `_sync` write routes can broadcast a delta in EXACTLY
//? the shape the initial snapshot emits (`buildSnapshot`), so the client merges a
//? live delta identically to the first load — no divergence, no refetch.

import type { Ticket as DbTicket, Sprint as DbSprint, WorkspaceNote as DbNote, EnvVar as DbEnvVar, IntegrationTool as DbIntegration, WorkspaceRole as DbRole, Invite as DbInvite } from '@prisma/client';

import type { EnvVar, IntegrationTool, InviteEntry, PermRole, Role, Sprint, Ticket, TicketNote, TicketStatus } from '../../src/workspaces/_data/types';

//? DB roleKey → the frontend `Role` union (ternary narrowing, no `as`). Mirrors
//? `asRole` in buildSnapshot so a live member/invite delta matches the snapshot.
export const asRole = (key: string): Role => (key === 'owner' || key === 'admin' ? key : 'member');

const asStatus = (s: string): TicketStatus =>
  (s === 'needs-input' || s === 'busy' || s === 'done' || s === 'paused' || s === 'stuck' ? s : 'idle');

//? The clock-time renderer for activity/notification/note timestamps (HH:MM). Lives
//? here so both the snapshot AND the realtime `_sync` deltas render a note's `time`
//? identically — a live comment must match the shape the initial snapshot emits.
export const formatTime = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

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
    //? Real recency for the backlog/board time column (was a hardcoded mock array).
    //? `lastActivityAt` is denormalized from the latest TicketEvent; fall back to createdAt.
    lastActivityAt: (t.lastActivityAt ?? t.createdAt).toISOString(),
  };
}

//? A ticket-MUTATION op (archive/ticket-edit/bulk-*) returns the affected rows from
//? the Conductor; narrow that (deliberately `unknown`) result to a `Ticket[]` delta
//? the `_sync` route broadcasts. The client UPSERTS these by id (the board/backlog
//? derive visibility from `archived`, so an archive is just an upsert). No cast.
export function ticketListDelta(result: unknown): Ticket[] {
  return Array.isArray(result) ? result.filter((r): r is DbTicket => isDbTicket(r)).map((r) => toTicket(r)) : [];
}

function isDbSprint(v: unknown): v is DbSprint {
  return v !== null && typeof v === 'object' && 'id' in v && 'name' in v && 'active' in v && !('stageId' in v);
}

//? Narrow the sprint-create op result to the frontend `Sprint` delta. A freshly
//? created sprint has no tickets yet (ticketCount 0) and no derived dates. Mirrors
//? the sprint mapping in `buildSnapshot`.
export function sprintDelta(result: unknown): Sprint | null {
  return isDbSprint(result) ? { id: result.id, name: result.name, start: null, end: null, active: result.active, ticketCount: 0, daysLeft: null } : null;
}

function isDbNote(v: unknown): v is DbNote {
  return v !== null && typeof v === 'object' && 'id' in v && 'body' in v && 'authorKind' in v;
}

//? Narrow the add-comment op result to the frontend `TicketNote` delta. The row's
//? `ticketId` is an ObjectId; the frontend keys notes by the DEV-#### `ticketKey`
//? (which the `_sync` route knows — it operated on it). Mirrors `buildSnapshot`.
export function noteDelta(result: unknown, ticketKey: string): TicketNote | null {
  return isDbNote(result) ? { id: result.id, ticketId: ticketKey, author: result.authorId ?? '', body: result.body, time: formatTime(result.createdAt) } : null;
}

function isDbEnvVar(v: unknown): v is DbEnvVar {
  return v !== null && typeof v === 'object' && 'id' in v && 'key' in v && 'value' in v && 'secret' in v;
}

//? Narrow the save-env op result to the frontend `EnvVar` delta (client upserts by id).
export function envDelta(result: unknown): EnvVar | null {
  return isDbEnvVar(result) ? { id: result.id, key: result.key, value: result.value, secret: result.secret } : null;
}

function isDbRole(v: unknown): v is DbRole {
  return v !== null && typeof v === 'object' && 'key' in v && 'label' in v && 'perms' in v && 'builtIn' in v;
}

//? Narrow the role-create/role-update op result to the frontend `PermRole` delta
//? (client upserts by key). `owner` is locked. Mirrors the role mapping in the snapshot.
export function roleDelta(result: unknown): PermRole | null {
  return isDbRole(result) ? { key: result.key, name: result.label, locked: result.key === 'owner', perms: result.perms } : null;
}

function isDbInvite(v: unknown): v is DbInvite {
  return v !== null && typeof v === 'object' && 'id' in v && 'email' in v && 'roleKey' in v && 'status' in v;
}

//? Narrow the invite op result to the frontend `InviteEntry` delta (client upserts
//? by id). Mirrors the invite mapping in the snapshot (only pending invites show).
export function inviteDelta(result: unknown): InviteEntry | null {
  return isDbInvite(result) ? { id: result.id, email: result.email, role: asRole(result.roleKey), sent: 'pending' } : null;
}

function isDbIntegration(v: unknown): v is DbIntegration {
  return v !== null && typeof v === 'object' && 'id' in v && 'name' in v && 'fields' in v && 'mcp' in v;
}

//? Narrow the save-integration op result to the frontend `IntegrationTool` delta.
//? Mirrors the integration mapping in `buildSnapshot`.
export function integrationDelta(result: unknown): IntegrationTool | null {
  if (!isDbIntegration(result)) return null;
  return {
    id: result.id, name: result.name, type: result.type,
    fields: result.fields.map((f) => ({ id: f.id, label: f.label, placeholder: f.placeholder ?? undefined, envVarId: f.envVarId })),
    mcp: result.mcp,
  };
}
