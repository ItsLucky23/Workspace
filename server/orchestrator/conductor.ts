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
import { Prisma, type Ticket as DbTicket } from '@prisma/client';

import { runInTenant } from '../tenant/tenantContext';
import { encryptSecret } from '../crypto/secretBox';
import { sendInviteEmail } from '../email/sendInviteEmail';
import { createBlankWorkspace } from '../bootstrap/seedWorkspace';
import { cloneRepo, addWorktree, isLinked, listRepoDocs } from '../git/repoStore';
import { indexWorkspace } from '../rag';
import { createMr, addReviewComment, approveMr, mergeMr, rollbackMr, resolveThread, mrForTicket } from '../mr/service';
import { normalizeGitConfig, resolveBranchName } from '../git/branchStrategy';
import { syncGitlabIssues } from '../git/gitlabSync';
import { withWorkspaceLease, claimActionOnce } from './cluster';
import { dockerAvailable } from '../container/runtime';
import { runStage } from './stageRunner';
import { isEditorRunning } from './editGuard';
import { acquireSlot, releaseSlot, enqueueDeferred, dequeueDeferred } from './capacity';
import { killTicketAgent } from './agentControl';
import { broadcastTicketDelta } from '../read/broadcast';
import { fireEvent } from '../automation/triggers';
import { executeGatedAction, runTriggerAction } from '../automation/executor';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';
import { TICKET_PRIORITIES, type TicketPriority } from '../../src/workspaces/_data/types';

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
//? Narrow an untrusted payload value to a valid TicketPriority, or undefined if
//? absent/invalid — the Conductor (single writer) never persists a bad priority.
function asPriority(o: Record<string, unknown>, k: string): TicketPriority | undefined {
  const v = o[k];
  return typeof v === 'string' && (TICKET_PRIORITIES as readonly string[]).includes(v) ? (v as TicketPriority) : undefined;
}
function boolArr(o: Record<string, unknown>, k: string): boolean[] {
  const v = o[k];
  return Array.isArray(v) ? v.map((x) => x === true) : [];
}
function asRec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
//? Bridge a genuinely-JSON value to Prisma's Json WRITE type (read JsonValue vs write InputJsonValue
//? split; not an `as any` escape — the value is already JSON).
const asJsonValue = (v: unknown): Prisma.InputJsonValue => v ?? {};
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
    //? Respect the recipient's notification-preferences (User.preferences JSON, #13):
    //? the in-app assignment bell is opt-OUT — fired unless the user turned it off.
    const recipient = await prisma.user.findUnique({ where: { id: recipientUserId }, select: { preferences: true } });
    const prefs = asRec(recipient?.preferences);
    if (prefs.notifyOnAssignment === false) return;
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
  //? Resolve the branch NAME from the per-workspace strategy (branchStrategy.ts). Loaded once
  //? per activation; the derived name is persisted on Ticket.branch so it's stable thereafter.
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitConfig: true } });
  const gitCfg = normalizeGitConfig(ws?.gitConfig ?? null);
  const activated: { key: string; branch: string }[] = [];
  for (const key of keys) {
    const t = await prisma.ticket.findFirst({ where: { workspaceId, key }, select: { branch: true, title: true, labels: true, number: true } });
    if (t?.branch) continue;
    const branchName = resolveBranchName(gitCfg, { key, title: t?.title, labels: t?.labels, number: t?.number });
    const [error, wt] = await tryCatch(() => addWorktree(workspaceId, key, branchName));
    if (error) { console.error(`[conductor] addWorktree ${key} failed:`, error); continue; }
    if (wt) { await prisma.ticket.updateMany({ where: { workspaceId, key }, data: { branch: wt.branch, commitHash: wt.commitHash } }); activated.push({ key, branch: wt.branch }); }
  }
  //? Run each activated ticket's stage OFF the serial chain (07b §0/§4): the autonomous
  //? claude turn is minutes-long and the authoritative stage move must return fast for
  //? realtime. Best-effort — the git/worktree layer is already durable.
  if (activated.length > 0) void provisionContainers(workspaceId, activated, stageId);
}

//? Fire-and-forget autonomous stage execution for freshly-activated tickets (07 §A step
//? 6-7): launch the container + drive an in-container claude turn on the ticket. Gated on
//? the Docker daemon (a host without Docker still gets the full git/worktree layer). Each
//? ticket's turn runs concurrently; errors are logged, never surfaced into the stage move.
//? The ticket banners set when a turn is deferred; matched exactly to clear them again (never
//? wipes a real AI open-question). One per defer reason.
export const EDITOR_DEFER_MSG = '⏸ Editor open — AI-turn uitgesteld';
export const CAPACITY_DEFER_MSG = '⏳ Wachtrij — te veel AI-turns tegelijk';

//? Re-fire an autonomous turn for a ticket at its CURRENT stage, if that stage is aiEnabled and
//? the ticket is activated (has a branch). Used by `resume` — `activateWorktreesForStage` skips
//? already-branched tickets, so a resumed ticket is re-provisioned directly here.
export async function reprovisionTicket(workspaceId: string, key: string, resume = false, resumePrompt?: string): Promise<void> {
  const t = await prisma.ticket.findFirst({ where: { workspaceId, key }, select: { stageId: true, branch: true } });
  if (!t?.branch) return;
  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, key: t.stageId }, select: { aiEnabled: true } });
  if (stage?.aiEnabled !== true) return;
  void provisionContainers(workspaceId, [{ key, branch: t.branch }], t.stageId, resume, resumePrompt);
}

async function provisionContainers(workspaceId: string, activated: { key: string; branch: string }[], stageId: string, resume = false, resumePrompt?: string): Promise<void> {
  if (!(await dockerAvailable())) return;
  //? Pause (C2): pause-all halts ALL autonomous provisioning for the workspace.
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { paused: true } });
  if (ws?.paused === true) { console.log(`[conductor] provisioning skipped — workspace paused`); return; }
  for (const { key } of activated) {
    void tryCatch(async () => {
      //? Pause (C2): a per-ticket pause skips just this ticket.
      const t = await prisma.ticket.findFirst({ where: { workspaceId, key }, select: { status: true, priority: true } });
      if (t?.status === 'paused') { console.log(`[conductor] runStage ${key}@${stageId} skipped — ticket paused`); return; }
      //? Edit-lock (C4): never drive an autonomous turn on a container a human is editing in the
      //? live VS Code — that races their worktree. Checked BEFORE reserving a capacity slot so an
      //? edit-locked ticket never consumes the budget. Skip + banner + broadcast; re-entering
      //? (editor closed) re-triggers it.
      if (await isEditorRunning(workspaceId, key)) {
        console.warn(`[conductor] runStage ${key}@${stageId} skipped — a live editor is open (edit-lock)`);
        await prisma.ticket.updateMany({ where: { workspaceId, key }, data: { needsInput: EDITOR_DEFER_MSG } });
        await broadcastTicketDelta(prisma, workspaceId, [key]);
        return;
      }
      //? CapacityManager (#12): ATOMIC admission — reserve a slot before the turn runs. An
      //? `urgent` ticket (the hotfix/security tier) force-passes the cap (merge still needs
      //? approval, ADR 0018). A rejected turn is parked on the FIFO queue + banner; a completing
      //? turn releases its slot and drains the next parked turn (`drainCapacityQueue`).
      const urgent = t?.priority === 'urgent';
      const admitted = await acquireSlot(key, urgent, Date.now());
      if (!admitted) {
        const queued = await enqueueDeferred({ workspaceId, key, stageId });
        console.log(`[conductor] runStage ${key}@${stageId} deferred — capacity full${queued ? ' (queued)' : ' (already queued)'}`);
        await prisma.ticket.updateMany({ where: { workspaceId, key }, data: { needsInput: CAPACITY_DEFER_MSG } });
        await broadcastTicketDelta(prisma, workspaceId, [key]);
        return;
      }
      //? Clear a prior defer banner (editor/capacity; targeted, leaves real open-questions intact).
      await prisma.ticket.updateMany({ where: { workspaceId, key, needsInput: { in: [EDITOR_DEFER_MSG, CAPACITY_DEFER_MSG] } }, data: { needsInput: null } });
      try {
        await runStage(workspaceId, key, stageId, { resume, ...(resumePrompt === undefined ? {} : { resumePrompt }) });
      } finally {
        //? Free the slot the moment the turn ends (done/needs-input/continue/failed) and pull the
        //? next parked turn in — the queue drains at the pace turns complete.
        await releaseSlot(key);
        void drainCapacityQueue();
      }
    }).then(([error]) => {
      if (error) console.error(`[conductor] runStage ${key}@${stageId} failed:`, error.message);
    });
  }
}

//? Pull the next capacity-deferred turn off the FIFO queue and re-provision it at its CURRENT
//? stage (it may have moved since it was parked). No-op when the queue is empty or the ticket is
//? no longer activated (moved/archived). Called on every slot release, so the backlog drains
//? one turn per completion without any polling.
async function drainCapacityQueue(): Promise<void> {
  const next = await dequeueDeferred();
  if (!next) return;
  const t = await prisma.ticket.findFirst({ where: { workspaceId: next.workspaceId, key: next.key }, select: { branch: true, stageId: true } });
  if (!t?.branch) return;
  void provisionContainers(next.workspaceId, [{ key: next.key, branch: t.branch }], t.stageId);
}

//? The single-writer chains. Login-only ops share ONE global in-process chain; workspace-scoped
//? ops each serialise on their OWN in-process chain (`wsChains`, one entry per workspace, so
//? unrelated workspaces run in parallel — no head-of-line blocking) AND, inside it, hold the
//? cross-instance workspace lease. Multi-instance-safe: see server/orchestrator/cluster.ts.
let globalChain: Promise<unknown> = Promise.resolve();
const wsChains = new Map<string, Promise<unknown>>();

//? Enqueue a control action + return the allocated signal seq (the ack payload).
export async function enqueueControlAction(action: ControlAction): Promise<{ signalSeq: number; result?: unknown }> {
  //? Dedup key is namespaced by workspace so a clientRequestId collision across tenants (or a
  //? reused id) can never suppress a real write in a DIFFERENT workspace. Cross-instance (survives
  //? which instance the re-send lands on) + TTL-bounded, replacing the old in-process Set.
  const dedupKey = `${action.workspaceId}:${action.clientRequestId}`;
  if (!(await claimActionOnce(dedupKey))) {
    // Duplicate re-send — already claimed; return a benign ack (no double write).
    return { signalSeq: -1 };
  }

  //? Login-only ops (create-workspace / accept-invite) carry NO workspace yet: there is no
  //? per-workspace audit log to append to, and `workspaceId: ''` is not a valid ObjectId (the
  //? signal write would throw and the chain would swallow it, silently dropping the op). Run them
  //? on the global serial chain WITHOUT a signal or workspace-lease (independent rows; no tenant).
  if (!action.workspaceId) {
    let result: unknown;
    const link = globalChain.then(async () => { result = await executeAction(action); }).catch((error: unknown) => {
      console.error(`[conductor] action ${action.op} failed:`, error);
    });
    globalChain = link;
    //? AWAIT the write before returning so the caller's post-ack refetch reliably sees it. Serial
    //? ordering is preserved: `link` resolves after all prior queued global actions + this one.
    await link;
    return { signalSeq: -1, result };
  }

  //? Workspace-scoped: queue on this workspace's in-process chain, and inside it hold the
  //? cross-instance lease while allocating the seq, appending the durable (append-only, B-O6)
  //? signal, and running the authoritative write — so there is never a concurrent authoritative
  //? write for this workspace, on this instance OR another.
  const workspaceId = action.workspaceId;
  const signalPayload = { op: action.op, userId: action.userId, clientRequestId: action.clientRequestId };
  let result: unknown;
  let signalSeq = -1;
  const prev = wsChains.get(workspaceId) ?? Promise.resolve();
  const link = prev.then(() => withWorkspaceLease(workspaceId, async () => {
    signalSeq = await nextSignalSeq(workspaceId);
    await runInTenant(workspaceId, async () => {
      await prisma.workspaceSignal.create({
        data: { workspaceId, seq: signalSeq, kind: action.op, payload: signalPayload },
      });
      result = await executeAction(action);
    });
  })).catch((error: unknown) => {
    console.error(`[conductor] action ${action.op} failed:`, error);
  });
  wsChains.set(workspaceId, link);
  //? AWAIT completion so the route responds only AFTER the write lands, and so the realtime
  //? `_sync` route can broadcast the write's delta (`result`). Serial-safe per workspace.
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
      //? Secret values are ENCRYPTED at rest (B-07, same crypto as the GitLab token); non-secrets
      //? stay plaintext (readable config). The read paths (snapshot + envDelta) decrypt for display.
      const stored = secret ? encryptSecret(value) : value;
      const existing = await prisma.envVar.findFirst({ where: { workspaceId: action.workspaceId, key } });
      //? Return the upserted row so the realtime `_sync` route broadcasts the delta.
      return existing
        ? prisma.envVar.update({ where: { id: existing.id }, data: { value: stored, secret } })
        : prisma.envVar.create({ data: { workspaceId: action.workspaceId, key, value: stored, secret } });
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
          priority: asPriority(payload, 'priority') ?? 'normal',
          sprintId: str(payload, 'sprintId') ?? null, assigneeId: str(payload, 'assigneeId') ?? null,
        },
      });
      await recordTicketEvent(action.workspaceId, created.id, 'status-change', userId, 'created the ticket');
      //? Assigned to someone else at creation → notify them (mirrors bulk-assign).
      const newAssignee = str(payload, 'assigneeId');
      if (newAssignee && newAssignee !== userId) await notifyAssignment(action.workspaceId, newAssignee, created.id, created.key);
      //? Automation (#2): a new ticket may fire `ticket.created` triggers (best-effort, off-chain).
      void fireEvent(prisma, action.workspaceId, { on: 'ticket.created', ticketKey: created.key, stageId: 'unrefined', projectId: project.id });
      //? Return the created row so realtime `_sync` write routes can broadcast the delta.
      return created;
    }
    case 'ticket-edit': {
      const key = str(target, 'ticketId');
      if (!key) return;
      const data: { title?: string; description?: string | null; labels?: string[]; priority?: TicketPriority } = {};
      const title = str(payload, 'title'); if (title !== undefined) data.title = title;
      if ('description' in payload) data.description = str(payload, 'description') ?? null;
      if (Array.isArray(payload.labels)) data.labels = strArr(payload, 'labels');
      const priority = asPriority(payload, 'priority'); if (priority !== undefined) data.priority = priority;
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
      //? Automation (#2): each ticket entering the stage may fire `stage.on_enter` triggers.
      for (const key of keys) void fireEvent(prisma, action.workspaceId, { on: 'stage.on_enter', ticketKey: key, stageId });
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
      //? #10: the forge provider (gitlab | github). Anything else is coerced to gitlab (safe default).
      const forgeRaw = str(payload, 'forgeType'); const forgeType = (forgeRaw === 'github' || forgeRaw === 'gitlab') ? forgeRaw : undefined;
      //? Token is app-encrypted at rest (B-07) — see server/crypto/secretBox.
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { ...(gitlabUrl ? { gitlabUrl } : {}), ...(token ? { gitlabTokenEnc: encryptSecret(token) } : {}), ...(forgeType ? { forgeType } : {}) } });
      return;
    }
    case 'gitlab-verify': {
      //? Read-only connectivity check (Fase 2 engine wires a real verify). No-op write.
      return;
    }
    case 'gitlab-resync': {
      //? Pull the linked project's open GitLab issues + upsert them as tickets (ingestion), then
      //? broadcast the touched tickets so the board updates live.
      const res = await syncGitlabIssues(prisma, action.workspaceId);
      if (res.ok && res.keys.length > 0) await broadcastTicketDelta(prisma, action.workspaceId, res.keys);
      return res;
    }
    case 'save-git-config': {
      //? Persist the per-workspace git strategy + push policy (branchStrategy.ts). Normalize
      //? the payload (fill any missing field with the default) before storing. Written as a
      //? plain JSON literal (cast-free — an object literal satisfies Prisma's Json input type).
      const cfg = normalizeGitConfig(payload.gitConfig ?? payload);
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { gitConfig: {
        branchStrategy: cfg.branchStrategy, defaultBranchType: cfg.defaultBranchType,
        branchTemplate: cfg.branchTemplate, pushPolicy: cfg.pushPolicy, targetBranch: cfg.targetBranch,
        protectedBranches: cfg.protectedBranches, commitSigning: cfg.commitSigning,
      } } });
      return cfg;
    }
    // ---- agent controls (C2) ----
    case 'pause': {
      //? Per-ticket pause: skip further autonomous turns for this ticket (provisionContainers
      //? respects status='paused'). Does not stop an in-flight turn — use 'kill' for that.
      const key = str(target, 'ticketKey') ?? str(payload, 'ticketKey');
      if (key) { await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { status: 'paused' } }); await broadcastTicketDelta(prisma, action.workspaceId, [key]); }
      return;
    }
    case 'resume': {
      //? Clear a per-ticket pause + re-fire the turn if the current stage is aiEnabled.
      const key = str(target, 'ticketKey') ?? str(payload, 'ticketKey');
      if (key) {
        await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { status: 'idle' } });
        await broadcastTicketDelta(prisma, action.workspaceId, [key]);
        await reprovisionTicket(action.workspaceId, key);
      }
      return;
    }
    case 'answer-input': {
      //? #17: a human answers the ticket's open question. Record it as a comment (audit trail),
      //? clear the needs-input banner, and RE-FIRE the parked turn with `--resume` + the answer as
      //? the prompt (builds on #1's resume path). Only meaningful while the ticket is at needs-input.
      const key = str(target, 'ticketKey') ?? str(payload, 'ticketKey');
      const answer = str(payload, 'answer');
      if (!key || !answer || answer.trim().length === 0) return;
      const [t] = await ticketIdsForKeys(action.workspaceId, [key]);
      if (t) await prisma.workspaceNote.create({ data: { workspaceId: action.workspaceId, ticketId: t.id, authorKind: 'user', authorId: userId, body: `↩︎ ${answer}` } });
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { needsInput: null, status: 'idle' } });
      if (t) await recordTicketEvent(action.workspaceId, t.id, 'comment', userId, 'answered the AI question');
      await broadcastTicketDelta(prisma, action.workspaceId, [key]);
      await reprovisionTicket(action.workspaceId, key, true, answer);
      return ticketRowsForKeys(action.workspaceId, [key]);
    }
    case 'kill': {
      //? Stop the ticket's in-flight turn (procps-free) + mark its worker session stopped.
      const key = str(target, 'ticketKey') ?? str(payload, 'ticketKey');
      if (key) { await killTicketAgent(prisma, action.workspaceId, key); await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { status: 'idle' } }); await broadcastTicketDelta(prisma, action.workspaceId, [key]); }
      return;
    }
    case 'pause-all': {
      //? Workspace-wide pause: the engine provisions NO new autonomous turns until resumed.
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { paused: true } });
      return;
    }
    case 'resume-all': {
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { paused: false } });
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
    case 'scan-index': {
      //? RAG index (07 §D): read the linked repo's code, chunk + embed it, upsert the RagEntry
      //? store. Returns the index result (files/chunks/commit/embedder) as the delta.
      const proj = await prisma.project.findFirst({ where: { workspaceId: action.workspaceId }, select: { id: true } });
      return indexWorkspace(prisma, action.workspaceId, proj?.id ? { projectId: proj.id } : {});
    }
    case 'mr-create': {
      //? Built-in MR review (BUILTIN_MR_REVIEW): open/refresh the MR for a ticket's branch, return
      //? the fresh view (diff + threads + approvals) as the delta.
      const ticketKey = str(payload, 'ticketKey');
      if (!ticketKey) return;
      await createMr(prisma, action.workspaceId, ticketKey, userId);
      return mrForTicket(prisma, action.workspaceId, ticketKey);
    }
    case 'mr-comment': {
      const ticketKey = str(payload, 'ticketKey');
      const mrId = str(payload, 'mrId');
      const body = str(payload, 'body');
      if (!ticketKey || !mrId || !body) return;
      await addReviewComment(prisma, action.workspaceId, {
        mergeRequestId: mrId, threadId: str(payload, 'threadId'), filePath: str(payload, 'filePath') ?? null,
        line: num(payload, 'line') ?? null, side: str(payload, 'side') ?? 'new', body, authorId: userId, authorKind: 'user',
      });
      return mrForTicket(prisma, action.workspaceId, ticketKey);
    }
    case 'mr-approve': {
      const ticketKey = str(payload, 'ticketKey');
      const mrId = str(payload, 'mrId');
      if (!ticketKey || !mrId) return;
      await approveMr(prisma, action.workspaceId, mrId, userId);
      return mrForTicket(prisma, action.workspaceId, ticketKey);
    }
    case 'mr-merge': {
      const ticketKey = str(payload, 'ticketKey');
      const mrId = str(payload, 'mrId');
      if (!ticketKey || !mrId) return;
      //? Real git-merge (#9), approval-gated. We run under the per-workspace write-lease (this whole
      //? switch does), so merges are serial. Attach the outcome to the fresh view so the client can
      //? toast success / no-approval / conflict.
      const merge = await mergeMr(prisma, action.workspaceId, mrId);
      const view = await mrForTicket(prisma, action.workspaceId, ticketKey);
      return view ? { ...view, actionResult: { ok: merge.ok, ...(merge.ok ? {} : { reason: merge.reason, ...(merge.files ? { files: merge.files } : {}) }) } } : null;
    }
    case 'mr-rollback': {
      const ticketKey = str(payload, 'ticketKey');
      const mrId = str(payload, 'mrId');
      if (!ticketKey || !mrId) return;
      const revert = await rollbackMr(prisma, action.workspaceId, mrId);
      const view = await mrForTicket(prisma, action.workspaceId, ticketKey);
      return view ? { ...view, actionResult: { ok: revert.ok, ...(revert.ok ? {} : { reason: revert.reason }) } } : null;
    }
    case 'mr-resolve': {
      const ticketKey = str(payload, 'ticketKey');
      const threadId = str(payload, 'threadId');
      if (!ticketKey || !threadId) return;
      await resolveThread(prisma, action.workspaceId, threadId, bool(payload, 'resolved'));
      return mrForTicket(prisma, action.workspaceId, ticketKey);
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
      if (!suggestionId) return;
      const suggestion = await prisma.workspaceSuggestion.findFirst({ where: { workspaceId: action.workspaceId, id: suggestionId }, select: { type: true, patch: true } });
      await prisma.workspaceSuggestion.updateMany({ where: { workspaceId: action.workspaceId, id: suggestionId }, data: { status: 'accepted' } });
      //? Automation (#2): accepting an 'automation' suggestion EXECUTES the gated action it carries
      //? (the human consent the ActionExecutor's approval gate deferred to — B-23 single-writer).
      if (suggestion?.type === 'automation') await executeGatedAction(prisma, action.workspaceId, suggestion.patch);
      return;
    }
    // ---- automation triggers (#2) ----
    case 'trigger-save': {
      //? Create or update a WorkspaceTrigger. `on`/`action` are required; params/match are free JSON.
      const on = str(payload, 'on'); const act = str(payload, 'action'); const name = str(payload, 'name');
      if (!on || !act || !name) return;
      const id = str(target, 'triggerId') ?? str(payload, 'id');
      const data = {
        name, on, action: act,
        params: asJsonValue(asRec(payload.params)), match: asJsonValue(asRec(payload.match)),
        cron: str(payload, 'cron') ?? null, requiresApproval: bool(payload, 'requiresApproval'),
        ...(str(payload, 'dedupeKey') ? { dedupeKey: str(payload, 'dedupeKey') } : {}),
        ...(num(payload, 'debounceMs') === undefined ? {} : { debounceMs: num(payload, 'debounceMs') }),
      };
      await (id
        ? prisma.workspaceTrigger.updateMany({ where: { workspaceId: action.workspaceId, id }, data })
        : prisma.workspaceTrigger.create({ data: { workspaceId: action.workspaceId, enabled: true, ...data } }));
      return;
    }
    case 'trigger-toggle': {
      const id = str(target, 'triggerId') ?? str(payload, 'id');
      if (id) await prisma.workspaceTrigger.updateMany({ where: { workspaceId: action.workspaceId, id }, data: { enabled: bool(payload, 'enabled') } });
      return;
    }
    case 'trigger-delete': {
      const id = str(target, 'triggerId') ?? str(payload, 'id');
      if (id) await prisma.workspaceTrigger.deleteMany({ where: { workspaceId: action.workspaceId, id } });
      return;
    }
    //? Ticket ↔ artifact links (ADR 0034) — link a design/Studio artifact to a ticket so the Conductor
    //? injects it at stage-spawn (see server/orchestrator/artifactContext.ts).
    case 'ticket-link-artifact': {
      const ticketKey = str(target, 'ticketId');
      const artifactId = str(payload, 'artifactId');
      const artifactKind = str(payload, 'artifactKind');
      if (!ticketKey || !artifactId || (artifactKind !== 'design' && artifactKind !== 'studio')) return;
      const ticket = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId, key: ticketKey }, select: { id: true } });
      if (!ticket) return;
      const existing = await prisma.ticketArtifactLink.findFirst({ where: { workspaceId: action.workspaceId, ticketId: ticket.id, artifactId }, select: { id: true } });
      if (existing) return;
      await prisma.ticketArtifactLink.create({ data: { workspaceId: action.workspaceId, ticketId: ticket.id, artifactId, artifactKind, ...(str(payload, 'label') ? { label: str(payload, 'label') } : {}), linkedBy: userId } });
      return;
    }
    case 'ticket-unlink-artifact': {
      const linkId = str(target, 'linkId') ?? str(payload, 'linkId');
      if (linkId) await prisma.ticketArtifactLink.deleteMany({ where: { workspaceId: action.workspaceId, id: linkId } });
      return;
    }
    //? Interviewer findings (ADR 0034) — B-23: the human turns a finding into a ticket / dismisses it.
    case 'finding-to-ticket': {
      const id = str(target, 'findingId') ?? str(payload, 'findingId');
      if (!id) return;
      const finding = await prisma.interviewFinding.findFirst({ where: { workspaceId: action.workspaceId, id } });
      if (!finding || finding.ticketId) return;
      const project = await prisma.project.findFirst({ where: { workspaceId: action.workspaceId } });
      if (!project) return;
      const last = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      const created = await prisma.ticket.create({
        data: {
          workspaceId: action.workspaceId, projectId: project.id, key: `DEV-${String(number)}`, number,
          title: finding.title, description: finding.summary, stageId: 'unrefined', status: 'idle',
          labels: [finding.area], creatorId: userId, priority: finding.severity === 'high' ? 'high' : 'normal',
        },
      });
      await prisma.interviewFinding.updateMany({ where: { workspaceId: action.workspaceId, id }, data: { status: 'accepted', ticketId: created.id } });
      await recordTicketEvent(action.workspaceId, created.id, 'status-change', userId, 'created the ticket from an Interviewer finding');
      void fireEvent(prisma, action.workspaceId, { on: 'ticket.created', ticketKey: created.key, stageId: 'unrefined', projectId: project.id });
      return created;
    }
    case 'finding-dismiss': {
      const id = str(target, 'findingId') ?? str(payload, 'findingId');
      if (id) await prisma.interviewFinding.updateMany({ where: { workspaceId: action.workspaceId, id }, data: { status: 'dismissed' } });
      return;
    }
    case 'trigger-run': {
      //? Run a trigger's action NOW (on-demand, e.g. "Run now" on a scheduled task) — goes through the
      //? same approval gate as the scheduler (a `mutates`/requiresApproval action opens a suggestion).
      const id = str(target, 'triggerId') ?? str(payload, 'id');
      if (!id) return;
      const t = await prisma.workspaceTrigger.findFirst({ where: { workspaceId: action.workspaceId, id } });
      if (!t) return;
      await runTriggerAction(prisma, action.workspaceId, { action: t.action, params: asRec(t.params), triggerName: t.name }, t.requiresApproval);
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
