//? Workspaces — the Conductor (Fase 1: in-process serial executor).
//?
//? The ONLY writer of authoritative workspace state (B-23, 01 §3.3). A control-API
//? route validates + RBAC-gates a request, then calls `enqueueControlAction(...)`;
//? the Conductor drains actions SERIALLY (a single-writer promise-chain) and writes
//? via `tenantDb` under `runInTenant(workspaceId)`. Every action also appends an
//? append-only `WorkspaceSignal` (the durable audit trail, B-O6).
//?
//? Fase-1 shape (see docs/decisions/0002-fase1-inprocess-conductor.md): the queue is
//? in-memory + the drain runs in this one process. Fase 2 swaps the in-memory queue
//? for the Redis signal-log and moves the drain into the leased orchestrator process
//? — the ControlRequest/ControlAck contract and this op-dispatch are unchanged.

import { getPrismaClient, redis, formatKey, tryCatch } from '@luckystack/core';
import type { Ticket as DbTicket } from '@prisma/client';

import { runInTenant } from '../tenant/tenantContext';
import { encryptSecret } from '../crypto/secretBox';
import { sendInviteEmail } from '../email/sendInviteEmail';
import { createBlankWorkspace } from '../bootstrap/seedWorkspace';
import { cloneRepo, addWorktree, isLinked, listRepoDocs } from '../git/repoStore';
import { dockerAvailable, launchTicketContainer } from '../container/runtime';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';

//? The Conductor knows the target workspaceId for every action, so it writes via
//? the plain client with an EXPLICIT `workspaceId` (type-correct; Prisma's input
//? types require it). `tenantDb` (server/tenant/tenantDb.ts) is the read-side seam
//? for _sync snapshot handlers where the filter is implicit (Lane B).

const prisma = getPrismaClient();

//? Cast-free readers over the loosely-typed control target/payload (the strict
//? no-`as` policy — a const + typeof narrows without an assertion).
function str(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' ? v : undefined;
}
function bool(o: Record<string, unknown>, k: string): boolean {
  return o[k] === true;
}
function num(o: Record<string, unknown>, k: string): number | undefined {
  const v = o[k];
  return typeof v === 'number' ? v : undefined;
}
function strArr(o: Record<string, unknown>, k: string): string[] {
  const v = o[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function boolArr(o: Record<string, unknown>, k: string): boolean[] {
  const v = o[k];
  return Array.isArray(v) ? v.map((x) => x === true) : [];
}
function asRec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
//? Coerce the client's integration `fields`/`mcp` payload into the Prisma composite shapes.
function readIntegrationFields(v: unknown): { id: string; label: string; placeholder?: string; envVarId?: string }[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => asRec(raw)).map((f) => {
    const out: { id: string; label: string; placeholder?: string; envVarId?: string } = { id: str(f, 'id') ?? '', label: str(f, 'label') ?? '' };
    const placeholder = str(f, 'placeholder');
    if (placeholder !== undefined) out.placeholder = placeholder;
    const envVarId = str(f, 'envVarId');
    if (envVarId !== undefined) out.envVarId = envVarId;
    return out;
  });
}
function readMcp(v: unknown): { enabled: boolean; command: string } {
  const o = asRec(v);
  return { enabled: o.enabled === true, command: str(o, 'command') ?? '' };
}
//? Coerce the client's stage-config `commands`/`tools`/`statuses`/`processes`/
//? `modelCfg`/`network`/`hooks` payload into the Prisma composite shapes
//? (mirrors PipelineStageCfg, src/workspaces/_data/types.ts).
function readCommandCfg(raw: unknown): { id: string; pattern: string; mode: string; title?: string; desc?: string; category?: string } {
  const f = asRec(raw);
  const out: { id: string; pattern: string; mode: string; title?: string; desc?: string; category?: string } = {
    id: str(f, 'id') ?? '', pattern: str(f, 'pattern') ?? '', mode: str(f, 'mode') ?? 'ask',
  };
  const title = str(f, 'title'); if (title !== undefined) out.title = title;
  const desc = str(f, 'desc'); if (desc !== undefined) out.desc = desc;
  const category = str(f, 'category'); if (category !== undefined) out.category = category;
  return out;
}
function readCommands(v: unknown): ReturnType<typeof readCommandCfg>[] {
  return Array.isArray(v) ? v.map((r) => readCommandCfg(r)) : [];
}
function readToolCfg(raw: unknown): { toolId: string; tier: string } {
  const f = asRec(raw);
  return { toolId: str(f, 'toolId') ?? '', tier: str(f, 'tier') ?? 'ro' };
}
function readTools(v: unknown): ReturnType<typeof readToolCfg>[] {
  return Array.isArray(v) ? v.map((r) => readToolCfg(r)) : [];
}
function readStatusCfg(raw: unknown): { key: string; label: string; kind: string } {
  const f = asRec(raw);
  return { key: str(f, 'key') ?? '', label: str(f, 'label') ?? '', kind: str(f, 'kind') ?? 'custom' };
}
function readStatuses(v: unknown): ReturnType<typeof readStatusCfg>[] {
  return Array.isArray(v) ? v.map((r) => readStatusCfg(r)) : [];
}
function readEnvVar(raw: unknown): { key: string; value: string } {
  const f = asRec(raw);
  return { key: str(f, 'key') ?? '', value: str(f, 'value') ?? '' };
}
function readEnvVars(v: unknown): ReturnType<typeof readEnvVar>[] {
  return Array.isArray(v) ? v.map((r) => readEnvVar(r)) : [];
}
function readProcessCfg(raw: unknown): { id: string; name: string; cwd: string; env: ReturnType<typeof readEnvVar>[]; commands: string[] } {
  const f = asRec(raw);
  return { id: str(f, 'id') ?? '', name: str(f, 'name') ?? '', cwd: str(f, 'cwd') ?? '', env: readEnvVars(f.env), commands: strArr(f, 'commands') };
}
function readProcesses(v: unknown): ReturnType<typeof readProcessCfg>[] {
  return Array.isArray(v) ? v.map((r) => readProcessCfg(r)) : [];
}
function readModelChoice(v: unknown): { model: string; effort: string; maxTurns: number } {
  const f = asRec(v);
  return { model: str(f, 'model') ?? 'sonnet', effort: str(f, 'effort') ?? 'medium', maxTurns: num(f, 'maxTurns') ?? 0 };
}
function readModelRule(raw: unknown): { id: string; minScore: number; model: string; effort: string; maxTurns: number } {
  const f = asRec(raw);
  return { id: str(f, 'id') ?? '', minScore: num(f, 'minScore') ?? 0, ...readModelChoice(f) };
}
function readModelCfg(v: unknown): { autoEscalate: boolean; base: ReturnType<typeof readModelChoice>; rules: ReturnType<typeof readModelRule>[]; contextBudgetTokens?: number } {
  const f = asRec(v);
  const out: { autoEscalate: boolean; base: ReturnType<typeof readModelChoice>; rules: ReturnType<typeof readModelRule>[]; contextBudgetTokens?: number } = {
    autoEscalate: bool(f, 'autoEscalate'), base: readModelChoice(f.base), rules: Array.isArray(f.rules) ? f.rules.map((r) => readModelRule(r)) : [],
  };
  const contextBudgetTokens = num(f, 'contextBudgetTokens');
  if (contextBudgetTokens !== undefined) out.contextBudgetTokens = contextBudgetTokens;
  return out;
}
function readNetworkCfg(v: unknown): { enabled: boolean; mode: string; categories: string[]; domains: string[] } {
  const f = asRec(v);
  return { enabled: bool(f, 'enabled'), mode: str(f, 'mode') ?? 'blacklist', categories: strArr(f, 'categories'), domains: strArr(f, 'domains') };
}
function readHooks(v: unknown): Record<string, boolean> {
  const f = asRec(v);
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(f)) out[k] = f[k] === true;
  return out;
}

//? Workspace teardown — delete every tenant-scoped row, then the workspace (04b §11d).
//? Live-container teardown (07 §A) precedes this in Fase 2; there are none in Fase 1.
async function cascadeDeleteWorkspace(workspaceId: string): Promise<void> {
  await prisma.ticketEvent.deleteMany({ where: { workspaceId } });
  await prisma.ticket.deleteMany({ where: { workspaceId } });
  await prisma.ticketLink.deleteMany({ where: { workspaceId } });
  await prisma.ticketReference.deleteMany({ where: { workspaceId } });
  await prisma.sprint.deleteMany({ where: { workspaceId } });
  await prisma.workspaceSuggestion.deleteMany({ where: { workspaceId } });
  await prisma.workspaceNote.deleteMany({ where: { workspaceId } });
  await prisma.workspaceBudget.deleteMany({ where: { workspaceId } });
  await prisma.workspaceSignal.deleteMany({ where: { workspaceId } });
  await prisma.workspaceTrigger.deleteMany({ where: { workspaceId } });
  await prisma.carryOver.deleteMany({ where: { workspaceId } });
  await prisma.handoff.deleteMany({ where: { workspaceId } });
  await prisma.questionSet.deleteMany({ where: { workspaceId } });
  await prisma.agentSession.deleteMany({ where: { workspaceId } });
  await prisma.spendRecord.deleteMany({ where: { workspaceId } });
  await prisma.notification.deleteMany({ where: { workspaceId } });
  await prisma.infoSource.deleteMany({ where: { workspaceId } });
  await prisma.ragEntry.deleteMany({ where: { workspaceId } });
  await prisma.envVar.deleteMany({ where: { workspaceId } });
  await prisma.integrationTool.deleteMany({ where: { workspaceId } });
  await prisma.invite.deleteMany({ where: { workspaceId } });
  await prisma.pipelineStage.deleteMany({ where: { workspaceId } });
  await prisma.workspaceRole.deleteMany({ where: { workspaceId } });
  await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
  await prisma.project.deleteMany({ where: { workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
}

//? The default RBAC perms for the seeded built-in roles (positional over
//? RBAC_CAPABILITIES; Owner is all-true). Mirrors seed DEFAULT_PERM_ROLES.
const OWNER_PERMS = [true, true, true, true, true, true, true, true];
const ADMIN_PERMS = [true, true, true, true, true, false, false, false];
const MEMBER_PERMS = [true, false, false, false, false, false, false, false];

export interface ControlAction {
  workspaceId: string;
  op: ControlOp;
  target: Record<string, unknown>;  // the ControlTarget, loosely typed at the transport edge
  payload: Record<string, unknown>;
  userId: string;          // the authenticated caller (already RBAC-checked at the route)
  clientRequestId: string;
}

//? Monotonic per-workspace signal seq (Redis INCR) — the client's merge-on-`seq`
//? key (CONTROL_API §6.3). Durable across restart; identical shape in Fase 2.
async function nextSignalSeq(workspaceId: string): Promise<number> {
  return runInTenant(workspaceId, async () => {
    const seq = await redis.incr(formatKey('evseq', 'workspace'));
    return seq;
  });
}

//? Activity-feed producer (04b §6). Appends a `TicketEvent` to the append-only,
//? per-ticket fact stream that the Activity feed + ticket timeline read. Runs INSIDE
//? the serial chain (single writer), so `seq` is race-free via read-max-then-+1 (no
//? Redis needed). BEST-EFFORT: a failed feed append must never fail the authoritative
//? write that already succeeded, so it's wrapped in tryCatch and only logged.
//? `actor` is the caller's userId (the feed resolves it to a member); `type` is a
//? TicketEvent type ('status-change' | 'comment' | …); `text` is the rendered one-liner.
async function recordTicketEvent(workspaceId: string, ticketId: string, type: string, actor: string, text: string): Promise<void> {
  const [error] = await tryCatch(async () => {
    const last = await prisma.ticketEvent.findFirst({ where: { workspaceId, ticketId }, orderBy: { seq: 'desc' }, select: { seq: true } });
    await prisma.ticketEvent.create({ data: { workspaceId, ticketId, seq: (last?.seq ?? 0) + 1, type, actor, text } });
  });
  if (error) console.error('[conductor] recordTicketEvent failed:', error);
}

//? Resolve DEV-#### keys → ticket ObjectIds (TicketEvent.ticketId is an ObjectId,
//? but the board/bulk ops address tickets by their human `key`).
async function ticketIdsForKeys(workspaceId: string, keys: string[]): Promise<{ id: string; key: string }[]> {
  if (keys.length === 0) return [];
  return prisma.ticket.findMany({ where: { workspaceId, key: { in: keys } }, select: { id: true, key: true } });
}

//? Fetch the FULL affected ticket rows so a mutation op can return them as the
//? realtime delta the `_sync` route broadcasts (client upserts by id, no refetch).
async function ticketRowsForKeys(workspaceId: string, keys: string[]): Promise<DbTicket[]> {
  if (keys.length === 0) return [];
  return prisma.ticket.findMany({ where: { workspaceId, key: { in: keys } } });
}

//? Notification producer — the in-app bell/panel (04b §10) reads `Notification` rows;
//? until now only the seed wrote them, so the bell was empty on real workspaces. This
//? emits an 'assignment' notification to a ticket's new assignee. Best-effort (a failed
//? notification must never fail the authoritative write). `deepLink` carries the DEV-key
//? so the bell can navigate to the board ticket (D65). `Notification.ticketId` is the
//? ObjectId, mirroring the seed shape.
async function notifyAssignment(workspaceId: string, recipientUserId: string, ticketId: string, ticketKey: string): Promise<void> {
  const [error] = await tryCatch(async () => {
    await prisma.notification.create({
      data: {
        workspaceId, userId: recipientUserId, type: 'assignment',
        title: 'Assigned to a ticket', body: `You were assigned ${ticketKey}.`,
        ticketId, deepLink: { view: 'board', ticketId: ticketKey }, read: false,
      },
    });
  });
  if (error) console.error('[conductor] notifyAssignment failed:', error);
}

//? Activation (07 §A step 3+5): when ticket(s) enter an `aiEnabled` stage, cut each
//? one's `DEV-####` git-worktree off the bare clone + freeze the baseline `commitHash`
//? (DH5). Docker-free — the container that mounts the worktree is a later slice. Skips
//? tickets that already have a branch (a re-move never re-freezes) and no-ops when no
//? repo is linked or the target stage is not AI-enabled. Best-effort per ticket: a git
//? failure is logged, never fails the authoritative stage move.
async function activateWorktreesForStage(workspaceId: string, keys: string[], stageId: string): Promise<void> {
  if (keys.length === 0 || !isLinked(workspaceId)) return;
  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, key: stageId }, select: { aiEnabled: true } });
  if (stage?.aiEnabled !== true) return;
  const activated: { key: string; branch: string }[] = [];
  for (const key of keys) {
    const t = await prisma.ticket.findFirst({ where: { workspaceId, key }, select: { branch: true } });
    if (t?.branch) continue;
    const [error, wt] = await tryCatch(() => addWorktree(workspaceId, key));
    if (error) { console.error(`[conductor] addWorktree ${key} failed:`, error); continue; }
    if (wt) { await prisma.ticket.updateMany({ where: { workspaceId, key }, data: { branch: wt.branch, commitHash: wt.commitHash } }); activated.push({ key, branch: wt.branch }); }
  }
  //? Provision each activated ticket's container OFF the serial chain (07b §0/§4): docker
  //? clone+run is slow and the authoritative stage move must return fast for realtime.
  //? Best-effort — the git/worktree layer is already durable; the container is a
  //? re-runnable convenience (idempotent by name), never blocks or fails the move.
  if (activated.length > 0) void provisionContainers(workspaceId, activated);
}

//? Fire-and-forget container provisioning for freshly-activated tickets. Gated on the
//? Docker daemon (a host without Docker still gets the full git/worktree layer). Errors
//? are logged, never surfaced into the stage move.
async function provisionContainers(workspaceId: string, activated: { key: string; branch: string }[]): Promise<void> {
  if (!(await dockerAvailable())) return;
  for (const { key, branch } of activated) {
    const [error] = await tryCatch(() => launchTicketContainer({ workspaceId, ticketKey: key, branch }));
    if (error) console.error(`[conductor] launchTicketContainer ${key} failed:`, error.message);
  }
}

//? The single-writer serial chain — each action awaits the previous one, so there
//? is never a concurrent authoritative write in this process.
let chain: Promise<unknown> = Promise.resolve();

//? Enqueue a control action + return the allocated signal seq (the ack payload).
//? Idempotency: a repeated clientRequestId is dropped (dedup) — see §6.4.
const seenRequestIds = new Set<string>();

export async function enqueueControlAction(action: ControlAction): Promise<{ signalSeq: number; result?: unknown }> {
  //? Dedup key is namespaced by workspace so a clientRequestId collision across
  //? tenants (or a client that reused an id) can never suppress a real write in a
  //? DIFFERENT workspace. Idempotent re-sends of the SAME action still dedup.
  const dedupKey = `${action.workspaceId}:${action.clientRequestId}`;
  if (seenRequestIds.has(dedupKey)) {
    // Duplicate re-send — already enqueued; return a benign ack (no double write).
    return { signalSeq: -1 };
  }
  seenRequestIds.add(dedupKey);

  //? Login-only ops (create-workspace / accept-invite) carry NO workspace yet: there
  //? is no per-workspace audit log to append to, and `workspaceId: ''` is not a valid
  //? ObjectId (the signal write would throw and the chain would swallow it, silently
  //? dropping the op). Run them on the serial chain WITHOUT a signal (they use the
  //? plain client, so they need no tenant scope either).
  if (!action.workspaceId) {
    let result: unknown;
    const link = chain.then(async () => { result = await executeAction(action); }).catch((error: unknown) => {
      console.error(`[conductor] action ${action.op} failed:`, error);
    });
    chain = link;
    //? AWAIT the write before returning so the caller's post-ack refetch reliably
    //? sees it (the old fire-and-forget ack raced the async write → "updates only
    //? half the time"). Serial ordering is preserved: `link` resolves after all
    //? prior queued actions + this one.
    await link;
    return { signalSeq: -1, result };
  }

  const signalSeq = await nextSignalSeq(action.workspaceId);

  //? Append the durable (append-only, B-O6) signal, then run the write — both
  //? inside the serial chain so there is never a concurrent authoritative write.
  const signalPayload = { op: action.op, userId: action.userId, clientRequestId: action.clientRequestId };
  let result: unknown;
  const link = chain.then(async () => {
    await runInTenant(action.workspaceId, async () => {
      await prisma.workspaceSignal.create({
        data: { workspaceId: action.workspaceId, seq: signalSeq, kind: action.op, payload: signalPayload },
      });
      result = await executeAction(action);
    });
  }).catch((error: unknown) => {
    console.error(`[conductor] action ${action.op} failed:`, error);
  });
  chain = link;
  //? AWAIT completion so the route responds only AFTER the write lands, and so the
  //? realtime `_sync` route can broadcast the write's delta (`result`). Serial-safe.
  await link;

  return { signalSeq, result };
}

//? The op dispatch. Runs INSIDE runInTenant(workspaceId). Fase 1 implements the
//? self-contained non-AI writes; the rest are scaffolded (logged no-op) until their
//? slice lands (member/settings/board breadth + the Fase-2 AI-session ops).
async function executeAction(action: ControlAction): Promise<unknown> {
  const { op, payload, target, userId } = action;
  switch (op) {
    case 'change-role': {
      const memberId = str(target, 'memberId');
      const roleKey = str(payload, 'roleKey') ?? str(payload, 'role');
      if (!memberId || !roleKey) return;
      await prisma.workspaceMember.updateMany({ where: { workspaceId: action.workspaceId, userId: memberId }, data: { roleKey } });
      return;
    }
    case 'save-env': {
      const key = str(payload, 'key');
      if (!key) return;
      const value = str(payload, 'value') ?? '';
      const secret = bool(payload, 'secret');
      const existing = await prisma.envVar.findFirst({ where: { workspaceId: action.workspaceId, key } });
      //? Return the upserted row so the realtime `_sync` route broadcasts the delta.
      return existing
        ? prisma.envVar.update({ where: { id: existing.id }, data: { value, secret } })
        : prisma.envVar.create({ data: { workspaceId: action.workspaceId, key, value, secret } });
    }
    case 'remove-env': {
      const envId = str(target, 'envId');
      if (!envId) return;
      await prisma.envVar.deleteMany({ where: { workspaceId: action.workspaceId, id: envId } });
      return;
    }
    case 'rename-workspace': {
      const name = str(payload, 'name');
      if (!name) return;
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { name } });
      return;
    }
    // ---- tickets / board ----
    case 'quick-add': {
      const title = str(payload, 'title');
      if (!title) return;
      const project = await prisma.project.findFirst({ where: { workspaceId: action.workspaceId } });
      if (!project) return;
      const last = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
      //? DEV-#### numbering starts at DEV-1 and auto-increments per workspace (Q6).
      const number = (last?.number ?? 0) + 1;
      const created = await prisma.ticket.create({
        data: {
          workspaceId: action.workspaceId, projectId: project.id, key: `DEV-${String(number)}`, number,
          //? A user-created ticket ALWAYS enters the pipeline at `unrefined` — the
          //? Conductor (single writer) enforces this, so no client can place a
          //? ticket mid-pipeline regardless of what it sends. The AI moves it on.
          title, description: str(payload, 'description') ?? null, stageId: 'unrefined',
          status: 'idle', labels: strArr(payload, 'labels'), creatorId: userId,
          sprintId: str(payload, 'sprintId') ?? null, assigneeId: str(payload, 'assigneeId') ?? null,
        },
      });
      await recordTicketEvent(action.workspaceId, created.id, 'status-change', userId, 'created the ticket');
      //? Assigned to someone else at creation → notify them (mirrors bulk-assign).
      const newAssignee = str(payload, 'assigneeId');
      if (newAssignee && newAssignee !== userId) await notifyAssignment(action.workspaceId, newAssignee, created.id, created.key);
      //? Return the created row so realtime `_sync` write routes can broadcast the delta.
      return created;
    }
    case 'ticket-edit': {
      const key = str(target, 'ticketId');
      if (!key) return;
      const data: { title?: string; description?: string | null; labels?: string[] } = {};
      const title = str(payload, 'title'); if (title !== undefined) data.title = title;
      if ('description' in payload) data.description = str(payload, 'description') ?? null;
      if (Array.isArray(payload.labels)) data.labels = strArr(payload, 'labels');
      if (Object.keys(data).length === 0) return;
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data });
      const [edited] = await ticketIdsForKeys(action.workspaceId, [key]);
      if (edited) await recordTicketEvent(action.workspaceId, edited.id, 'comment', userId, 'edited the ticket');
      return ticketRowsForKeys(action.workspaceId, [key]);
    }
    case 'add-comment': {
      const key = str(target, 'ticketId');
      const body = str(payload, 'body');
      if (!key || !body || body.trim().length === 0) return;
      const [commented] = await ticketIdsForKeys(action.workspaceId, [key]);
      if (!commented) return;
      const note = await prisma.workspaceNote.create({ data: { workspaceId: action.workspaceId, ticketId: commented.id, authorKind: 'user', authorId: userId, body } });
      await recordTicketEvent(action.workspaceId, commented.id, 'comment', userId, 'commented on the ticket');
      //? Return the created note so the realtime `_sync` route broadcasts it (the
      //? route maps the ObjectId ticketId → the DEV-key it operated on).
      return note;
    }
    case 'archive': {
      const key = str(target, 'ticketId');
      if (!key) return;
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { archived: true } });
      const [archived] = await ticketIdsForKeys(action.workspaceId, [key]);
      if (archived) await recordTicketEvent(action.workspaceId, archived.id, 'status-change', userId, 'archived the ticket');
      return ticketRowsForKeys(action.workspaceId, [key]);
    }
    case 'bulk-archive': {
      const keys = strArr(target, 'ticketIds');
      if (keys.length === 0) return [];
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key: { in: keys } }, data: { archived: true } });
      for (const r of await ticketIdsForKeys(action.workspaceId, keys)) await recordTicketEvent(action.workspaceId, r.id, 'status-change', userId, 'archived the ticket');
      return ticketRowsForKeys(action.workspaceId, keys);
    }
    case 'bulk-move': {
      const keys = strArr(target, 'ticketIds'); const stageId = str(payload, 'stageId');
      if (keys.length === 0 || !stageId) return [];
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key: { in: keys } }, data: { stageId } });
      for (const r of await ticketIdsForKeys(action.workspaceId, keys)) await recordTicketEvent(action.workspaceId, r.id, 'status-change', userId, `moved to ${stageId}`);
      //? Entering an aiEnabled stage → cut each ticket's DEV-#### worktree (07 §A step 5).
      await activateWorktreesForStage(action.workspaceId, keys, stageId);
      return ticketRowsForKeys(action.workspaceId, keys);
    }
    case 'bulk-status': {
      const keys = strArr(target, 'ticketIds'); const status = str(payload, 'status');
      if (keys.length === 0 || !status) return [];
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key: { in: keys } }, data: { status } });
      for (const r of await ticketIdsForKeys(action.workspaceId, keys)) await recordTicketEvent(action.workspaceId, r.id, 'status-change', userId, `status set to ${status}`);
      return ticketRowsForKeys(action.workspaceId, keys);
    }
    case 'bulk-assign': {
      const keys = strArr(target, 'ticketIds');
      if (keys.length === 0) return [];
      const assigneeId = str(payload, 'assigneeId') ?? null;
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key: { in: keys } }, data: { assigneeId } });
      for (const r of await ticketIdsForKeys(action.workspaceId, keys)) {
        await recordTicketEvent(action.workspaceId, r.id, 'status-change', userId, assigneeId ? 'reassigned the ticket' : 'unassigned the ticket');
        //? Notify the new assignee — unless they assigned it to themselves.
        if (assigneeId && assigneeId !== userId) await notifyAssignment(action.workspaceId, assigneeId, r.id, r.key);
      }
      return ticketRowsForKeys(action.workspaceId, keys);
    }
    case 'bulk-sprint': {
      const keys = strArr(target, 'ticketIds');
      if (keys.length === 0) return [];
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key: { in: keys } }, data: { sprintId: str(payload, 'sprintId') ?? null } });
      for (const r of await ticketIdsForKeys(action.workspaceId, keys)) await recordTicketEvent(action.workspaceId, r.id, 'status-change', userId, 'moved to another sprint');
      return ticketRowsForKeys(action.workspaceId, keys);
    }
    // ---- sprints ----
    case 'sprint-create': {
      const name = str(payload, 'name');
      if (!name) return;
      //? Return the created sprint so the realtime `_sync` route broadcasts it.
      return prisma.sprint.create({ data: { workspaceId: action.workspaceId, name, active: bool(payload, 'active') } });
    }
    case 'sprint-edit': {
      const sprintId = str(target, 'sprintId'); const name = str(payload, 'name');
      if (!sprintId) return;
      await prisma.sprint.updateMany({ where: { workspaceId: action.workspaceId, id: sprintId }, data: { ...(name ? { name } : {}), active: bool(payload, 'active') } });
      return;
    }
    // ---- members / RBAC / workspace lifecycle ----
    case 'remove-member': {
      const memberId = str(target, 'memberId');
      if (memberId) await prisma.workspaceMember.deleteMany({ where: { workspaceId: action.workspaceId, userId: memberId } });
      return;
    }
    case 'transfer-ownership': {
      const memberId = str(target, 'memberId');
      if (!memberId) return;
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { ownerId: memberId } });
      await prisma.workspaceMember.updateMany({ where: { workspaceId: action.workspaceId, userId: memberId }, data: { roleKey: 'owner' } });
      await prisma.workspaceMember.updateMany({ where: { workspaceId: action.workspaceId, userId }, data: { roleKey: 'admin' } });
      return;
    }
    case 'delete-workspace': {
      await cascadeDeleteWorkspace(action.workspaceId);
      return;
    }
    case 'role-create': {
      const key = str(payload, 'key'); const label = str(payload, 'label') ?? key;
      if (!key || !label) return;
      //? Return the created role so the realtime `_sync` route broadcasts the delta.
      return prisma.workspaceRole.create({ data: { workspaceId: action.workspaceId, key, label, perms: boolArr(payload, 'perms'), builtIn: false } });
    }
    case 'role-update': {
      const key = str(target, 'roleKey') ?? str(payload, 'key');
      if (!key) return;
      const label = str(payload, 'label');
      const data: { label?: string; perms?: boolean[] } = {};
      if (label) data.label = label;
      if (Array.isArray(payload.perms)) data.perms = boolArr(payload, 'perms');
      await prisma.workspaceRole.updateMany({ where: { workspaceId: action.workspaceId, key }, data });
      //? Return the updated role so the realtime `_sync` route broadcasts the delta.
      return prisma.workspaceRole.findFirst({ where: { workspaceId: action.workspaceId, key } });
    }
    // ---- invites ----
    case 'create-workspace': {
      //? Login-only op (no active workspace yet). Builds a blank-but-functional
      //? workspace owned by the caller — the onboarding "create a workspace" path.
      //? Uses the plain client (not tenant-scoped): there is no tenant yet.
      const name = str(payload, 'name');
      if (name) await createBlankWorkspace(prisma, userId, name.trim());
      return;
    }
    case 'invite': {
      const email = str(payload, 'email');
      if (!email) return;
      const invite = await prisma.invite.create({ data: { workspaceId: action.workspaceId, email, roleKey: str(payload, 'roleKey') ?? 'member', invitedById: userId, token: `inv-${action.clientRequestId}`, status: 'pending' } });
      //? Fire-and-forget the invite email (Resend/SMTP auto-selected; no-op if
      //? unconfigured) — never block or fail the authoritative write on delivery.
      const ws = await prisma.workspace.findUnique({ where: { id: action.workspaceId }, select: { name: true } });
      void sendInviteEmail(email, ws?.name ?? 'a workspace');
      //? Return the created invite so the realtime `_sync` route broadcasts the delta.
      return invite;
    }
    case 'revoke-invite': {
      const inviteId = str(target, 'inviteId');
      if (inviteId) await prisma.invite.updateMany({ where: { workspaceId: action.workspaceId, id: inviteId }, data: { status: 'revoked' } });
      return;
    }
    case 'accept-invite': {
      const token = str(target, 'inviteToken');
      if (!token) return;
      const inv = await prisma.invite.findFirst({ where: { token, status: 'pending' } });
      if (!inv) return;
      await prisma.workspaceMember.create({ data: { workspaceId: inv.workspaceId, userId, roleKey: inv.roleKey } });
      await prisma.invite.update({ where: { id: inv.id }, data: { status: 'accepted', acceptedAt: new Date() } });
      return;
    }
    // ---- settings ----
    case 'save-integration': {
      const name = str(payload, 'name');
      const integrationId = str(target, 'integrationId') ?? str(payload, 'id');
      if (!name) return;
      const type = str(payload, 'type') ?? 'custom';
      const fields = readIntegrationFields(payload.fields);
      const mcp = readMcp(payload.mcp);
      if (integrationId) {
        await prisma.integrationTool.updateMany({ where: { workspaceId: action.workspaceId, id: integrationId }, data: { name, type, fields: { set: fields }, mcp: { set: mcp } } });
        //? Return the updated row so the realtime `_sync` route broadcasts the delta.
        return prisma.integrationTool.findFirst({ where: { workspaceId: action.workspaceId, id: integrationId } });
      }
      return prisma.integrationTool.create({ data: { workspaceId: action.workspaceId, name, type, fields, mcp } });
    }
    case 'remove-integration': {
      const integrationId = str(target, 'integrationId');
      if (integrationId) await prisma.integrationTool.deleteMany({ where: { workspaceId: action.workspaceId, id: integrationId } });
      return;
    }
    case 'gitlab-settings': {
      const gitlabUrl = str(payload, 'baseUrl') ?? str(payload, 'url'); const token = str(payload, 'token');
      //? Token is app-encrypted at rest (B-07) — see server/crypto/secretBox.
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { ...(gitlabUrl ? { gitlabUrl } : {}), ...(token ? { gitlabTokenEnc: encryptSecret(token) } : {}) } });
      return;
    }
    case 'gitlab-verify':
    case 'gitlab-resync': {
      //? Verify = read-only; resync = kick a GitLab sync (Fase 2 engine). No-op write in Fase 1.
      return;
    }
    case 'link-repo': {
      //? Register-flow step A: bare-clone the linked repo into data/workspaces/<id>/
      //? (the baseline the runtime cuts DEV-#### worktrees from). Clone runs on the
      //? serial chain (link is rare); a failed clone returns an error delta, not a throw.
      const gitUrl = str(payload, 'gitUrl');
      if (!gitUrl) return { linked: false, error: 'sync.invalidRequest' };
      const token = str(payload, 'token');
      const [error, status] = await tryCatch(() => cloneRepo({ workspaceId: action.workspaceId, gitUrl, ...(token ? { token } : {}) }));
      if (error) return { linked: false, gitUrl, error: error.message };
      //? Persist the CLEAN url on the workspace's project (token is never stored here).
      await prisma.project.updateMany({ where: { workspaceId: action.workspaceId }, data: { gitUrl } });
      return status;
    }
    case 'scan-docs': {
      //? Docs-init scan (register-flow step D): find the linked repo's doc files and
      //? register each as a context-doc InfoSource. `enabled` doubles as the per-file
      //? aiEditable gate — DEFAULT OFF (the AI may not edit a doc until the user allows).
      //? Re-scan updates existing docs' content without flipping their aiEditable state.
      const found = await listRepoDocs(action.workspaceId);
      for (const doc of found) {
        const summary = doc.content.split('\n').map((l) => l.trim()).find((l) => l.length > 0)?.slice(0, 140) ?? '';
        const existing = await prisma.infoSource.findFirst({ where: { workspaceId: action.workspaceId, mode: 'context-doc', name: doc.path } });
        await (existing
          ? prisma.infoSource.update({ where: { id: existing.id }, data: { content: doc.content, summary, note: 'scanned' } })
          : prisma.infoSource.create({ data: { workspaceId: action.workspaceId, mode: 'context-doc', source: 'git', name: doc.path, content: doc.content, summary, note: 'scanned', enabled: false, usedByStages: [] } }));
      }
      //? Return the workspace's full context-doc set as the delta (client replaces list).
      return prisma.infoSource.findMany({ where: { workspaceId: action.workspaceId, mode: 'context-doc' }, orderBy: { name: 'asc' } });
    }
    case 'raise-cap':
    case 'edit-budget': {
      const cap = num(payload, 'cap') ?? num(payload, 'newCap');
      if (cap === undefined) return;
      const budget = await prisma.workspaceBudget.findFirst({ where: { workspaceId: action.workspaceId } });
      if (!budget) return;
      const data: { cap: number; alertPct?: number } = { cap };
      const alertPct = num(payload, 'alertPct');
      if (alertPct !== undefined) data.alertPct = alertPct;
      await prisma.workspaceBudget.update({ where: { id: budget.id }, data });
      return;
    }
    case 'resume-spend': {
      await prisma.workspaceBudget.updateMany({ where: { workspaceId: action.workspaceId }, data: { spent: 0, windowStartAt: new Date() } });
      return;
    }
    case 'skill-toggle': {
      const sourceId = str(target, 'sourceId') ?? str(payload, 'skillId') ?? str(payload, 'stageCfgId');
      if (sourceId) await prisma.infoSource.updateMany({ where: { workspaceId: action.workspaceId, id: sourceId }, data: { enabled: bool(payload, 'on') } });
      return;
    }
    case 'save-stage-config': {
      const stageId = str(target, 'stageId') ?? str(payload, 'id');
      if (!stageId) return;
      const data: Record<string, unknown> = {};
      const name = str(payload, 'name'); if (name) data.name = name;
      const kind = str(payload, 'kind'); if (kind) data.kind = kind;
      if ('aiEnabled' in payload) data.aiEnabled = bool(payload, 'aiEnabled');
      const ci = str(payload, 'customInstructions'); if (ci !== undefined) data.customInstructions = ci;
      const promptTemplate = str(payload, 'promptTemplate'); if (promptTemplate !== undefined) data.promptTemplate = promptTemplate;
      const systemPrompt = str(payload, 'systemPrompt'); if (systemPrompt !== undefined) data.systemPrompt = systemPrompt;
      const roleKey = str(payload, 'roleKey'); if (roleKey !== undefined) data.roleKey = roleKey;
      if ('userEditable' in payload) data.userEditable = bool(payload, 'userEditable');
      if ('gateForApproval' in payload) data.gateForApproval = bool(payload, 'gateForApproval');
      if (Array.isArray(payload.skillKeys)) data.skillKeys = { set: strArr(payload, 'skillKeys') };
      if (Array.isArray(payload.sourceIds)) data.sourceIds = { set: strArr(payload, 'sourceIds') };
      if (Array.isArray(payload.visibleStageIds)) data.visibleStageIds = { set: strArr(payload, 'visibleStageIds') };
      if (Array.isArray(payload.commands)) data.commands = { set: readCommands(payload.commands) };
      if (Array.isArray(payload.tools)) data.tools = { set: readTools(payload.tools) };
      if (Array.isArray(payload.statuses)) data.statuses = { set: readStatuses(payload.statuses) };
      if (Array.isArray(payload.processes)) data.processes = { set: readProcesses(payload.processes) };
      if (payload.modelCfg !== undefined) data.modelCfg = { set: readModelCfg(payload.modelCfg) };
      if (payload.network !== undefined) data.network = { set: readNetworkCfg(payload.network) };
      if (payload.hooks !== undefined) data.hooks = readHooks(payload.hooks);
      const wipLimit = num(payload, 'wipLimit'); if (wipLimit !== undefined) data.wipLimit = wipLimit;
      if (Object.keys(data).length > 0) await prisma.pipelineStage.updateMany({ where: { workspaceId: action.workspaceId, key: stageId }, data });
      //? Return the updated stage so the realtime `_sync` route broadcasts the delta.
      return prisma.pipelineStage.findFirst({ where: { workspaceId: action.workspaceId, key: stageId } });
    }
    // ---- suggestions ----
    case 'accept-suggestion': {
      const suggestionId = str(target, 'suggestionId');
      if (suggestionId) await prisma.workspaceSuggestion.updateMany({ where: { workspaceId: action.workspaceId, id: suggestionId }, data: { status: 'accepted' } });
      return;
    }
    // ---- notifications ----
    case 'mark-read': {
      if (target.all === true) {
        await prisma.notification.updateMany({ where: { workspaceId: action.workspaceId, userId }, data: { read: true } });
      } else {
        const notificationId = str(target, 'notificationId');
        if (notificationId) await prisma.notification.updateMany({ where: { workspaceId: action.workspaceId, id: notificationId }, data: { read: true } });
      }
      return;
    }
    default: {
      //? Scaffolded — the op's write slice (member/RBAC/settings/board breadth, and
      //? the Fase-2 AI-session ops) lands with its lane. Logged so it's visible in dev.
      console.warn(`[conductor] op '${op}' not yet implemented in Fase 1 (caller=${userId})`);
    }
  }
}

//? First-run + explicit workspace creation. NOT routed through the serial chain
//? because it CREATES the tenant (there is no workspaceId to scope by yet); it is a
//? direct, RBAC-gated (login-only) bootstrap write (MIGRATION §5, CONTROL_API §9).
//? Creates the Workspace + the 3 built-in roles + the caller's Owner membership.
export async function bootstrapWorkspace(input: { name: string; ownerId: string }): Promise<{ workspaceId: string }> {
  const slug = input.name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'workspace';
  const ws = await prisma.workspace.create({
    data: { name: input.name.trim(), slug, ownerId: input.ownerId },
  });
  await prisma.workspaceRole.createMany({
    data: [
      { workspaceId: ws.id, key: 'owner', label: 'Owner', perms: OWNER_PERMS, builtIn: true },
      { workspaceId: ws.id, key: 'admin', label: 'Admin', perms: ADMIN_PERMS, builtIn: true },
      { workspaceId: ws.id, key: 'member', label: 'Member', perms: MEMBER_PERMS, builtIn: true },
    ],
  });
  await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: input.ownerId, roleKey: 'owner' } });
  return { workspaceId: ws.id };
}
