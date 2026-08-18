//? Workspaces — shared read-mappers: Prisma row → frontend shape.
//?
//? Extracted so the realtime `_sync` write routes can broadcast a delta in EXACTLY
//? the shape the initial snapshot emits (`buildSnapshot`), so the client merges a
//? live delta identically to the first load — no divergence, no refetch.

import type { Ticket as DbTicket, Sprint as DbSprint, WorkspaceNote as DbNote, EnvVar as DbEnvVar, IntegrationTool as DbIntegration, WorkspaceRole as DbRole, Invite as DbInvite, InfoSource as DbInfoSource, ContentAsset as DbContentAsset, MediaJob as DbMediaJob, VideoScene as DbVideoScene } from '@prisma/client';

import type { ContentAssetSummary, ContentPieceSummary, VideoSceneSummary, EnvVar, InfoDoc, IntegrationTool, InviteEntry, PermRole, RepoInfo, Role, Sprint, Ticket, TicketNote, TicketPriority, TicketStatus } from '../../src/workspaces/_data/types';
import { TICKET_PRIORITIES } from '../../src/workspaces/_data/types';
import { parseNeedsInputQuestions } from '../orchestrator/questionSet';

//? DB priority string → the frontend `TicketPriority` union (falls back to 'normal'
//? for a legacy row written before the column existed). Mirrors buildSnapshot.
const asPriority = (p: string | null | undefined): TicketPriority =>
  ((TICKET_PRIORITIES as readonly string[]).includes(p ?? '') ? p : 'normal') as TicketPriority;

const asDocSource = (s: string | null): InfoDoc['source'] => (s === 'generated' || s === 'uploaded' || s === 'starter' || s === 'design-system' ? s : 'git');

//? Map an InfoSource row (mode='context-doc') → the frontend `InfoDoc`. `aiEditable` is
//? backed by `enabled` (reused for docs: on = the AI may edit this file). Shared by the
//? snapshot AND the scan-docs `_sync` route so a live doc delta matches the snapshot.
export function toInfoDoc(s: DbInfoSource): InfoDoc {
  return {
    id: s.id, name: s.name, source: asDocSource(s.source), updated: '', note: s.note ?? '',
    summary: s.summary ?? '', usedByStages: s.usedByStages, content: s.content ?? '', aiEditable: s.enabled,
    //? ADR 0310 — archived docs still ship to the client (the Sources page has an Archived view and a
    //? restore action); it is the SERVER that stops feeding them to the AI, not this flag.
    ...(s.archivedAt === null ? {} : { archived: true }),
  };
}

//? Narrow the scan-docs op result (the workspace's context-doc InfoSource rows) to the
//? frontend `InfoDoc[]` delta the `_sync` route broadcasts (client replaces the list).
export function docListDelta(result: unknown): InfoDoc[] {
  return Array.isArray(result) ? result.filter((r): r is DbInfoSource => isDbInfoSource(r)).map((r) => toInfoDoc(r)) : [];
}
function isDbInfoSource(v: unknown): v is DbInfoSource {
  return v !== null && typeof v === 'object' && 'mode' in v && 'name' in v && 'enabled' in v;
}

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

//? #16 (W2) — parse the stored advisory-questions Json into the UNRESOLVED client list, keeping each
//? one's original index (the conductor's answer-input resolves an advisory by that index).
function parseAdvisoryForClient(raw: unknown): { index: number; q: string; assumption: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { index: number; q: string; assumption: string }[] = [];
  for (const [i, a] of raw.entries()) {
    if (a !== null && typeof a === 'object') {
      const rec = a as Record<string, unknown>;
      if (rec.resolved !== true && typeof rec.q === 'string') out.push({ index: i, q: rec.q, assumption: typeof rec.assumption === 'string' ? rec.assumption : '' });
    }
  }
  return out;
}

//? Map a Prisma Ticket row → the frontend `Ticket` (the board/backlog key is the
//? DEV-#### `key`, not the ObjectId). Mirrors the mapping in `buildSnapshot`.
export function toTicket(t: DbTicket): Ticket {
  const advisory = parseAdvisoryForClient(t.advisoryQuestions);
  //? W1 multi-question sets: how many of the parked questions are still unanswered. The answer inbox
  //? derives its queue from tickets directly (ADR 0048 follow-up), so this is the only place this count
  //? can be computed once for both the initial snapshot AND every live ticket delta.
  const openQuestionCount = parseNeedsInputQuestions(t.needsInputQuestions, t.needsInput).filter((q) => q.a === null).length;
  return {
    id: t.key, workspaceId: t.workspaceId, projectId: t.projectId, title: t.title, description: t.description ?? undefined,
    stageId: t.stageId, status: asStatus(t.status), labels: t.labels, creatorId: t.creatorId ?? undefined, assigneeId: t.assigneeId ?? undefined,
    viewers: [], hasTerminal: false, branch: t.branch ?? undefined, mr: t.mrUrl ?? undefined, issue: t.issueUrl ?? undefined,
    sprintId: t.sprintId ?? undefined, serviceId: t.serviceId, carryOver: t.carryOver ?? undefined, needsInput: t.needsInput ?? undefined, archived: t.archived,
    ...(advisory.length > 0 ? { advisoryQuestions: advisory } : {}),
    ...(openQuestionCount > 1 ? { openQuestionCount } : {}),
    priority: asPriority(t.priority),
    //? Real recency for the backlog/board time column (was a hardcoded mock array).
    //? `lastActivityAt` is denormalized from the latest TicketEvent; fall back to createdAt.
    lastActivityAt: (t.lastActivityAt ?? t.createdAt).toISOString(),
  };
}

//? An in-flight asset (queued/processing) whose job hasn't advanced in this long is treated as a
//? TIMED-OUT/orphaned generation (e.g. the server crashed mid-gen, leaving no error write) and shown
//? as `error` — so the UI never spins forever. Generous: a legit slow fal job terminates far sooner
//? via the provider's own poll timeout (ADR 0096). 20 min.
const INFLIGHT_STALE_MS = 20 * 60 * 1000;

//? Map a ContentAsset row (+ its MediaJob, for the live queue/timer fields) → the frontend
//? `ContentAssetSummary`. Shared by `buildSnapshot` (first load) AND `broadcastContentAssetDelta`
//? (mid-generation deltas) so the client merges both identically. `queuePosition`/`startedAt` come from
//? the job's live lifecycle. `nowMs` is injectable for deterministic tests (defaults to real time).
export function toContentAssetSummary(a: DbContentAsset, job?: DbMediaJob | null, nowMs: number = Date.now()): ContentAssetSummary {
  const m = a.metadata;
  const stub = typeof m === 'object' && m !== null && 'stub' in m && m.stub === true;
  const inFlight = a.status === 'queued' || a.status === 'processing';
  //? Freshest heartbeat = the later of the asset's + the job's updatedAt (progress writes touch both).
  const heartbeat = job && job.updatedAt > a.updatedAt ? job.updatedAt : a.updatedAt;
  const stale = inFlight && nowMs - heartbeat.getTime() > INFLIGHT_STALE_MS;
  const status = stale ? 'error' : a.status;
  //? I1 — regenerable = a ready, AI-generated (has a MediaJob), non-imported asset.
  const imported = typeof m === 'object' && m !== null && 'imported' in m && m.imported === true;
  const regenerable = Boolean(job) && a.status === 'ready' && !imported;
  //? F5 — a stored AI critique (from content-critique-image) surfaces under the image asset.
  const critique = typeof m === 'object' && m !== null && 'critique' in m && typeof m.critique === 'string' ? m.critique : undefined;
  //? F4 — a real poster frame extracted from a rendered mp4 (a `render` asset's url is an .mp4, so the
  //? gallery uses this as the thumbnail instead of a broken `<img src=mp4>`).
  const posterUrl = typeof m === 'object' && m !== null && 'posterUrl' in m && typeof m.posterUrl === 'string' ? m.posterUrl : undefined;
  return {
    id: a.id, kind: a.kind, url: a.url ?? '', status, stub,
    ...(stale || job?.queuePosition == null ? {} : { queuePosition: job.queuePosition }),
    ...(stale || !job?.startedAt ? {} : { startedAt: job.startedAt.getTime() }),
    ...(regenerable ? { regenerable: true } : {}),
    ...(a.parentId ? { variant: true } : {}),
    ...(critique ? { critique } : {}),
    ...(posterUrl ? { posterUrl } : {}),
  };
}

//? Map a VideoScene row → the frontend `VideoSceneSummary`. Shared by `buildSnapshot` AND
//? `broadcastContentPieceDelta` so the timeline shape can't diverge between first-load and live-upsert.
export function toVideoSceneSummary(s: DbVideoScene): VideoSceneSummary {
  return { id: s.id, order: s.order, videoAssetId: s.videoAssetId, imageAssetId: s.imageAssetId, startTrimMs: s.startTrimMs, endTrimMs: s.endTrimMs, durationMs: s.durationMs, transitionIn: s.transitionIn, prompt: s.prompt };
}

//? Assemble ONE content piece's frontend summary from its row + its already-mapped assets/scenes/spend.
//? Shared by `buildSnapshot` (all pieces, first load) AND `broadcastContentPieceDelta` (a single piece, live
//? upsert) so the piece shape can NEVER diverge between the two paths — the exact divergence class the tests
//? guard. The caller owns the querying (batch vs single); this is the pure, identical assembly.
export function toContentPieceSummary(
  c: { id: string; title: string; format: string; stageId: string; status: string; channelId: string | null; voiceVolume: number; musicVolume: number; archived: boolean },
  assets: ContentAssetSummary[],
  scenes: VideoSceneSummary[],
  spentCents: number,
): ContentPieceSummary {
  //? V5 — the piece's NEWEST voice/music asset url for the audio-track waveform.
  const urlOfKind = (k: string): string | null => { for (let i = assets.length - 1; i >= 0; i -= 1) { const a = assets[i]; if (a?.kind === k && a.url.length > 0) return a.url; } return null; };
  return {
    id: c.id, title: c.title, format: c.format, stageId: c.stageId, status: c.status, channelId: c.channelId,
    assets, scenes, voiceVolume: c.voiceVolume, musicVolume: c.musicVolume,
    voiceUrl: urlOfKind('voice'), musicUrl: urlOfKind('music'), spentCents,
    ...(c.archived ? { archived: true } : {}),
  };
}

//? P1 — the save-ai-provider op returns the full per-feature provider override map; narrow the (unknown)
//? control-op result to the typed array the `_sync` route broadcasts (client replaces `snap.aiOverrides`).
export function aiOverrideDelta(result: unknown): { feature: string; providerId: string }[] {
  if (!Array.isArray(result)) return [];
  const out: { feature: string; providerId: string }[] = [];
  for (const r of result) {
    if (r !== null && typeof r === 'object' && 'feature' in r && 'providerId' in r) {
      const rec = r as Record<'feature' | 'providerId', unknown>;
      if (typeof rec.feature === 'string' && typeof rec.providerId === 'string') out.push({ feature: rec.feature, providerId: rec.providerId });
    }
  }
  return out;
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

//? Map an EnvVar row to its client-safe metadata projection. Secret values are write-only:
//? the browser receives an empty replacement buffer plus `configured`, never plaintext/ciphertext.
//? Internal `__` rows stay server-only because they carry provider/OAuth/runtime configuration.
export function toEnvVar(result: DbEnvVar): EnvVar | null {
  if (result.key.startsWith('__')) return null;
  return {
    id: result.id,
    key: result.key,
    value: result.secret ? '' : result.value,
    secret: result.secret,
    configured: result.value.length > 0,
  };
}

//? Narrow the save-env op result to the same safe `EnvVar` projection used by snapshots.
export function envDelta(result: unknown): EnvVar | null {
  return isDbEnvVar(result) ? toEnvVar(result) : null;
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
  return isDbInvite(result) ? { id: result.id, email: result.email, role: asRole(result.roleKey), sentAt: result.createdAt.toISOString(), expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null } : null;
}

//? Narrow the link-repo op result (a plain RepoStatus/error object, not a Prisma row)
//? to the frontend `RepoInfo` delta. Cast-free: read each field via typeof guards.
export function repoDelta(result: unknown): RepoInfo | null {
  if (result === null || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const out: RepoInfo = { linked: r.linked === true };
  if (typeof r.gitUrl === 'string') out.gitUrl = r.gitUrl;
  if (typeof r.branch === 'string') out.branch = r.branch;
  if (typeof r.head === 'string') out.head = r.head;
  if (typeof r.error === 'string') out.error = r.error;
  return out;
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
