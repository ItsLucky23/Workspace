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
import { sanitizeSections } from '../../src/workspaces/_data/modules';
import { createDefaultPipeline } from '../bootstrap/defaultPipeline';
import { getTemplate } from '../scaffold/templates';
import { nextContentStage, isContentStage } from '../content/pipeline';
import { generateScript } from '../content/script';
import { decomposeIntoScenes } from '../content/sceneDecompose';
import { refineSceneRange } from '../content/sceneRefine';
import { runContentPipeline } from '../content/runPipeline';
import { generateVoiceover } from '../content/voice';
import { generateBeatImages } from '../content/images';
import { assembleContent } from '../content/assembly';
import { generateReferenceImage } from '../content/referenceImage';
import { generateShortForm } from '../content/shortForm';
import { analyzeReferenceVideo } from '../content/referenceVideo';
import { generateMediaAsset } from '../content/mediaAsset';
import type { MediaFeature } from '../media/types';
import { publishAsset, isPublishPlatform } from '../content/publish';
import { indexChannelBrand } from '../content/brandMemory';
import { jsonInput } from '../util/json';
import { cloneRepo, addWorktree, isLinked, listRepoDocs, branchHead, initGreenfieldRepo } from '../git/repoStore';
import { runPipeline } from '../ci/runner';
import { postAiReviewFindings } from '../mr/reviewRole';
import { getAgentRole } from '../automation/agentRoles';
import { applyMigration, introspectDb } from '../db/migrate';
import { indexWorkspace } from '../rag';
import { indexInstitutionalMemory } from '../rag/memory';
import { createMr, addReviewComment, approveMr, mergeMr, rollbackMr, resolveThread, mrForTicket } from '../mr/service';
import { normalizeGitConfig, resolveBranchName } from '../git/branchStrategy';
import { syncForgeIssues } from '../git/gitlabSync';
import { withWorkspaceLease, claimActionOnce } from './cluster';
import { dockerAvailable } from '../container/runtime';
import { runStage } from './stageRunner';
import { resolveProjectId } from './projectResolve';
import { ensureEnvironment, deployEnvironment, teardownEnvironment } from '../deploy/environment';
import { promoteEnvironment } from '../deploy/promote';
import { buildExport } from '../deploy/buildExport';
import { isEditorRunning } from './editGuard';
import { acquireSlot, releaseSlot, enqueueDeferred, dequeueDeferred } from './capacity';
import { killTicketAgent } from './agentControl';
import { broadcastTicketDelta, broadcastContentAssetDelta, broadcastContentDirty } from '../read/broadcast';
import { sendWebPush } from '../hooks/webPush';
import { runCustomTask } from '../ai/customTask';
import { exportStyleSet, importStyleSet } from '../content/styles';
import { exportBrandKit, importBrandKit } from '../studio/brand';
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
//? V5 — clamp a linear audio gain to [0, max]; a missing/invalid value falls back to `dflt`.
function clampVolume(v: number | undefined, dflt: number, max: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return dflt;
  return Math.max(0, Math.min(max, v));
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
  await prisma.environment.deleteMany({ where: { workspaceId } });
  await prisma.buildArtifact.deleteMany({ where: { workspaceId } });
  await prisma.pipelineJob.deleteMany({ where: { workspaceId } });
  await prisma.pipelineRun.deleteMany({ where: { workspaceId } });
  await prisma.pipeline.deleteMany({ where: { workspaceId } });
  await prisma.migration.deleteMany({ where: { workspaceId } });
  await prisma.dbConnection.deleteMany({ where: { workspaceId } });
  await prisma.forgeConnection.deleteMany({ where: { workspaceId } });
  await prisma.service.deleteMany({ where: { workspaceId } });
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

//? Accept an AI rollback suggestion (ADR 0042): forward-revert the ranked culprit MR (best-effort — a
//? no-op without a linked repo) + draft a `DEV-####` tracking ticket pre-filled from the analysis. The AI
//? never reverts; the Conductor does, on human consent (B-23). Returns the created ticket for the delta.
async function acceptRollback(workspaceId: string, userId: string, patch: unknown): Promise<unknown> {
  const p = (patch !== null && typeof patch === 'object') ? (patch as Record<string, unknown>) : {};
  const mrId = typeof p.mrId === 'string' ? p.mrId : '';
  const symptom = typeof p.symptom === 'string' && p.symptom.length > 0 ? p.symptom : 'a production regression';
  const reason = typeof p.reason === 'string' ? p.reason : '';
  if (mrId) await tryCatch(() => rollbackMr(prisma, workspaceId, mrId));
  const projectId = await resolveProjectId(prisma, workspaceId);
  if (!projectId) return { ok: true };
  const last = await prisma.ticket.findFirst({ where: { workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
  const number = (last?.number ?? 0) + 1;
  const created = await prisma.ticket.create({
    data: {
      workspaceId, projectId, key: `DEV-${String(number)}`, number,
      title: `Rollback follow-up: ${symptom}`.slice(0, 120), description: reason.length > 0 ? reason : null,
      stageId: 'unrefined', status: 'idle', labels: ['rollback'], creatorId: userId, priority: 'high',
    },
  });
  await recordTicketEvent(workspaceId, created.id, 'status-change', userId, 'created the tracking ticket from an AI rollback');
  void fireEvent(prisma, workspaceId, { on: 'ticket.created', ticketKey: created.key, stageId: 'unrefined', projectId });
  return created;
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
    //? A1 — also push it to the user's devices (best-effort; no-op without VAPID/subscriptions).
    await sendWebPush(prisma, recipientUserId, { title: 'Assigned to a ticket', body: `You were assigned ${ticketKey}.`, url: '/', tag: `ticket-${ticketKey}` }, 'assignment');
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
      //? Multi-project (ADR 0035): the ticket lands in the client's ACTIVE project
      //? (threaded through the quick-add payload); falls back to the first project.
      const projectId = await resolveProjectId(prisma, action.workspaceId, str(payload, 'projectId'));
      if (!projectId) return;
      const last = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
      //? DEV-#### numbering starts at DEV-1 and auto-increments per workspace (Q6).
      const number = (last?.number ?? 0) + 1;
      const created = await prisma.ticket.create({
        data: {
          workspaceId: action.workspaceId, projectId, key: `DEV-${String(number)}`, number,
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
      void fireEvent(prisma, action.workspaceId, { on: 'ticket.created', ticketKey: created.key, stageId: 'unrefined', projectId });
      //? O-D — "start with AI": the ticket still ENTERS at `unrefined` (invariant intact), then the Conductor
      //? advances it to the FIRST aiEnabled stage + activates it — so the user doesn't have to drag it. The
      //? Conductor remains the only writer; activation no-ops without a linked repo/Docker (as usual).
      if (payload.startWithAi === true) {
        const firstAi = await prisma.pipelineStage.findFirst({ where: { workspaceId: action.workspaceId, aiEnabled: true }, orderBy: { order: 'asc' }, select: { key: true } });
        if (firstAi) {
          await prisma.ticket.update({ where: { id: created.id }, data: { stageId: firstAi.key } });
          await recordTicketEvent(action.workspaceId, created.id, 'status-change', userId, `auto-started AI at ${firstAi.key}`);
          await activateWorktreesForStage(action.workspaceId, [created.key], firstAi.key);
          //? Return the ADVANCED row so the realtime delta shows the new stage.
          return (await prisma.ticket.findUnique({ where: { id: created.id } })) ?? created;
        }
      }
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
      //? Multi-project (ADR 0035): a sprint belongs to the active project's board.
      const sprintProjectId = await resolveProjectId(prisma, action.workspaceId, str(payload, 'projectId'));
      if (!sprintProjectId) return;
      //? Return the created sprint so the realtime `_sync` route broadcasts it.
      return prisma.sprint.create({ data: { workspaceId: action.workspaceId, projectId: sprintProjectId, name, active: bool(payload, 'active') } });
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
      if (name) await createBlankWorkspace(prisma, userId, name.trim(), sanitizeSections(payload.enabledSections));
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
      //? Pull the ACTIVE project's open forge issues (GitLab | GitHub) + upsert them as tickets
      //? (ingestion), then broadcast the touched tickets so the board updates live (ADR 0036).
      const resyncProjectId = await resolveProjectId(prisma, action.workspaceId, str(payload, 'projectId'));
      if (!resyncProjectId) return { ok: false, synced: 0, keys: [], error: 'forge.notConfigured' };
      const res = await syncForgeIssues(prisma, action.workspaceId, resyncProjectId);
      if (res.ok && res.keys.length > 0) await broadcastTicketDelta(prisma, action.workspaceId, res.keys);
      return res;
    }
    //? Per-project forge connection (ADR 0036) — B-23: the Conductor writes the ForgeConnection.
    case 'forge-connect': {
      const forgeProjectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      const modeRaw = str(payload, 'mode');
      const mode = modeRaw === 'github' ? 'github' : 'gitlab';
      if (!forgeProjectId) return;
      const token = str(payload, 'token');
      const baseUrl = str(payload, 'baseUrl');
      const repoPath = str(payload, 'repoPath');
      const data = {
        mode,
        ...(baseUrl ? { baseUrl } : {}),
        ...(repoPath ? { repoPath } : {}),
        ...(token ? { tokenEnc: encryptSecret(token) } : {}),
        status: 'connected',
      };
      const existing = await prisma.forgeConnection.findFirst({ where: { projectId: forgeProjectId }, select: { id: true } });
      await (existing
        ? prisma.forgeConnection.update({ where: { id: existing.id }, data })
        : prisma.forgeConnection.create({ data: { workspaceId: action.workspaceId, projectId: forgeProjectId, ...data } }));
      return;
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
    case 'save-ai-instruction': {
      //? Q4 + K4 + P2 — the workspace-wide AI-behaviour settings: the instruction + output language (prepended
      //? to every completion) + the per-workspace Gemini model + temperature (P2 — Gemini-only; Claude is PTY).
      const aiInstruction = str(payload, 'aiInstruction') ?? '';
      const outputLanguage = str(payload, 'outputLanguage') ?? '';
      const geminiModel = str(payload, 'geminiModel') ?? '';
      const geminiTemperature = str(payload, 'geminiTemperature') ?? '';
      const geminiBaseUrl = str(payload, 'geminiBaseUrl') ?? '';
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl } });
      return { aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl };
    }
    case 'save-sections': {
      //? Persist the enabled nav-section set (module gating, workspaces/_data/modules.ts).
      //? Sanitized to known gateable ids; [] ⇒ legacy all-on. Returns the stored list so
      //? the realtime `_sync` route broadcasts the delta back to the caller's shell.
      const enabledSections = sanitizeSections(payload.enabledSections);
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { enabledSections } });
      return { enabledSections };
    }
    case 'save-autonomy': {
      //? A4 — the workspace autonomy level modulating the per-stage human gate (stageRunner.resolveStageGate).
      //? Validated against the three known levels; anything else falls back to the safe default.
      const raw = str(payload, 'autonomyLevel');
      const autonomyLevel = raw === 'gate-every' || raw === 'full-auto' || raw === 'gate-key-stages' ? raw : 'gate-key-stages';
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { autonomyLevel } });
      return { autonomyLevel };
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
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { needsInput: null, status: 'idle', remindedAt: null } });
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
      //? Persist the CLEAN url on the TARGET project only (ADR 0035 — was updateMany
      //? over every project, which corrupted siblings once N>1). token is never stored.
      const linkProjectId = await resolveProjectId(prisma, action.workspaceId, str(payload, 'projectId'));
      if (linkProjectId) await prisma.project.update({ where: { id: linkProjectId }, data: { gitUrl } });
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
    case 'create-info-source': {
      //? K2 — a USER-UPLOADED context doc (md/txt) → a first-class context-doc InfoSource the AI can use
      //? (creative RAG grounding lands in K3). Upsert by name; enabled OFF by default (the user toggles it on).
      const name = str(payload, 'name');
      const content = str(payload, 'content') ?? '';
      if (!name || content.trim().length === 0) return prisma.infoSource.findMany({ where: { workspaceId: action.workspaceId, mode: 'context-doc' }, orderBy: { name: 'asc' } });
      const summary = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0)?.slice(0, 140) ?? '';
      const existing = await prisma.infoSource.findFirst({ where: { workspaceId: action.workspaceId, mode: 'context-doc', name } });
      await (existing
        ? prisma.infoSource.update({ where: { id: existing.id }, data: { content, summary, source: 'uploaded', note: 'uploaded' } })
        : prisma.infoSource.create({ data: { workspaceId: action.workspaceId, mode: 'context-doc', source: 'uploaded', name, content, summary, note: 'uploaded', enabled: false, usedByStages: [] } }));
      return prisma.infoSource.findMany({ where: { workspaceId: action.workspaceId, mode: 'context-doc' }, orderBy: { name: 'asc' } });
    }
    case 'scan-index': {
      //? RAG index (07 §D): read the linked repo's code, chunk + embed it, upsert the RagEntry
      //? store. Returns the index result (files/chunks/commit/embedder) as the delta.
      //? Multi-project (ADR 0035): index the active project (payload) or the first.
      const indexProjectId = await resolveProjectId(prisma, action.workspaceId, str(payload, 'projectId'));
      return indexWorkspace(prisma, action.workspaceId, indexProjectId ? { projectId: indexProjectId } : {});
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
      //? Incremental re-index on merge (ADR 0045): the target branch advanced, so refresh the RAG code
      //? index + the institutional memory (best-effort, off the caller's path — never blocks the merge).
      if (merge.ok) void (async () => {
        const reindexProjectId = await resolveProjectId(prisma, action.workspaceId);
        await indexWorkspace(prisma, action.workspaceId, reindexProjectId ? { projectId: reindexProjectId } : {}).catch(() => null);
        await indexInstitutionalMemory(prisma, action.workspaceId).catch(() => null);
      })();
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
    //? Media €-budget (F0.2, ADR 0051) — upsert the per-workspace media cap/alert/enabled.
    case 'edit-media-budget': {
      const capCents = num(payload, 'capCents');
      const alertPct = num(payload, 'alertPct');
      const enabled = bool(payload, 'enabled');
      const update: { capCents?: number; alertPct?: number; enabled: boolean } = { enabled };
      if (capCents !== undefined) update.capCents = capCents;
      if (alertPct !== undefined) update.alertPct = alertPct;
      await prisma.mediaBudget.upsert({
        where: { workspaceId: action.workspaceId },
        create: { workspaceId: action.workspaceId, capCents: capCents ?? 0, alertPct: alertPct ?? 80, enabled },
        update,
      });
      return;
    }
    //? Save a per-workspace (brand) style (F0.4, ADR 0049) — upsert by (workspace, feature, key).
    case 'save-style': {
      const feature = str(payload, 'feature');
      const key = str(payload, 'key');
      const systemPrompt = str(payload, 'systemPrompt');
      if (!feature || !key || !systemPrompt) return;
      const label = str(payload, 'label') ?? key;
      //? M1 — an optional preview asset (a sample image/video of the look) for the thumbnail gallery.
      const previewAssetUrl = str(payload, 'previewAssetUrl');
      const previewKind = str(payload, 'previewKind');
      const preview = { ...(previewAssetUrl ? { previewAssetUrl } : {}), ...(previewKind ? { previewKind } : {}) };
      const existing = await prisma.stylePreset.findFirst({ where: { workspaceId: action.workspaceId, feature, key } });
      if (existing) return prisma.stylePreset.update({ where: { id: existing.id }, data: { label, systemPrompt, ...preview } });
      return prisma.stylePreset.create({ data: { workspaceId: action.workspaceId, feature, key, label, systemPrompt, builtin: false, ...preview } });
    }
    case 'delete-style': {
      //? Q3 — remove a per-workspace style (never a global builtin — the filter is workspace-scoped).
      const feature = str(payload, 'feature');
      const key = str(payload, 'key');
      if (!feature || !key) return;
      await prisma.stylePreset.deleteMany({ where: { workspaceId: action.workspaceId, feature, key, builtin: false } });
      return;
    }
    //? Save per-workspace media settings (U3): an ENCRYPTED provider API key and/or a per-feature
    //? provider override, both in the EnvVar store (secretBox). Keys are namespaced so they never clash
    //? with the user's app env vars. (Per-workspace key CONSUMPTION by the providers is a follow-up; this
    //? persists + lets the settings UI show what is configured.)
    case 'save-media-provider': {
      const providerId = str(payload, 'providerId');
      const apiKey = str(payload, 'apiKey');
      const feature = str(payload, 'feature');
      if (providerId && apiKey) {
        const key = `__provider_key_${providerId}`;
        const value = encryptSecret(apiKey);
        await prisma.envVar.upsert({ where: { workspaceId_key: { workspaceId: action.workspaceId, key } }, create: { workspaceId: action.workspaceId, key, value, secret: true }, update: { value } });
      }
      if (feature && providerId) {
        const key = `__media_provider_${feature}`;
        await prisma.envVar.upsert({ where: { workspaceId_key: { workspaceId: action.workspaceId, key } }, create: { workspaceId: action.workspaceId, key, value: providerId, secret: false }, update: { value: providerId } });
      }
      //? P3 — a per-feature model override ('default'/empty clears it → the env/default model).
      const model = str(payload, 'model');
      if (feature && model !== undefined) {
        const key = `__media_model_${feature}`;
        await (!model || model === 'default'
          ? prisma.envVar.deleteMany({ where: { workspaceId: action.workspaceId, key } })
          : prisma.envVar.upsert({ where: { workspaceId_key: { workspaceId: action.workspaceId, key } }, create: { workspaceId: action.workspaceId, key, value: model, secret: false }, update: { value: model } }));
      }
      return;
    }
    case 'save-ai-provider': {
      //? P1 — a per-workspace AI provider override per feature (EnvVar `__ai_provider_<feature>`). 'default'
      //? (or empty) clears it → the global default. Returns the full override map for the settings UI.
      const feature = str(payload, 'feature');
      const providerId = str(payload, 'providerId');
      if (!feature) return [];
      const key = `__ai_provider_${feature}`;
      await (!providerId || providerId === 'default'
        ? prisma.envVar.deleteMany({ where: { workspaceId: action.workspaceId, key } })
        : prisma.envVar.upsert({ where: { workspaceId_key: { workspaceId: action.workspaceId, key } }, create: { workspaceId: action.workspaceId, key, value: providerId, secret: false }, update: { value: providerId } }));
      const rows = await prisma.envVar.findMany({ where: { workspaceId: action.workspaceId, key: { startsWith: '__ai_provider_' } }, select: { key: true, value: true } });
      return rows.map((r) => ({ feature: r.key.slice('__ai_provider_'.length), providerId: r.value }));
    }
    //? Edit a channel's brand voice (U4) — update the field + re-index the brand snippet into brand-RAG
    //? (F5.1) so every generation for the channel can ground on it. The Conductor is the only writer (B-23).
    case 'content-edit-brand': {
      const channelId = str(payload, 'channelId');
      const brandVoice = str(payload, 'brandVoice') ?? '';
      if (!channelId) return;
      await prisma.channel.updateMany({ where: { workspaceId: action.workspaceId, id: channelId }, data: { brandVoice } });
      await indexChannelBrand(prisma, action.workspaceId, channelId, brandVoice.trim() ? [brandVoice.trim()] : []);
      return;
    }
    //? A2 — social-account/channel management. A channel = a platform + brand identity a piece can bind to.
    case 'channel-create': {
      const name = str(payload, 'name');
      if (!name) return;
      const projectId = await resolveProjectId(prisma, action.workspaceId, str(payload, 'projectId'));
      if (!projectId) return { ok: false, status: 'error', error: 'env.noProject' };
      const created = await prisma.channel.create({ data: { workspaceId: action.workspaceId, projectId, name, platform: str(payload, 'platform') ?? 'none', ...(str(payload, 'handle') ? { handle: str(payload, 'handle') } : {}), ...(str(payload, 'brandVoice') ? { brandVoice: str(payload, 'brandVoice') } : {}) } });
      broadcastContentDirty(action.workspaceId);
      return created;
    }
    case 'channel-edit': {
      const channelId = str(payload, 'channelId');
      if (!channelId) return;
      const data = {
        ...(str(payload, 'name') ? { name: str(payload, 'name') } : {}),
        ...(str(payload, 'platform') ? { platform: str(payload, 'platform') } : {}),
        ...('handle' in payload ? { handle: str(payload, 'handle') ?? null } : {}),
        ...('brandVoice' in payload ? { brandVoice: str(payload, 'brandVoice') ?? null } : {}),
        ...('defaultStyleId' in payload ? { defaultStyleId: str(payload, 'defaultStyleId') ?? null } : {}),
      };
      await prisma.channel.updateMany({ where: { workspaceId: action.workspaceId, id: channelId }, data });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'channel-delete': {
      const channelId = str(payload, 'channelId');
      if (channelId) { await prisma.channel.deleteMany({ where: { workspaceId: action.workspaceId, id: channelId } }); broadcastContentDirty(action.workspaceId); }
      return;
    }
    case 'account-disconnect': {
      //? A2 — disconnect a connected social account: remove its stored token (EnvVar). accountId optional
      //? (omitted = the default per-platform connection). The publish surface then shows it as not connected.
      const platform = str(payload, 'platform');
      if (!platform) return;
      const accountId = str(payload, 'accountId');
      const key = `__publish_${platform}${accountId ? `_${accountId}` : ''}`;
      await prisma.envVar.deleteMany({ where: { workspaceId: action.workspaceId, key } });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-edit-product': {
      //? Q2 — the per-workspace product/brand context folded into every creative generation.
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { productContext: str(payload, 'productContext') ?? '' } });
      return;
    }
    case 'content-import-asset': {
      //? K1 — import a user-UPLOADED file (already persisted to /media by the upload route) as a first-class
      //? ContentAsset, on the single-writer chain (no MediaJob — it wasn't generated). Broadcasts the delta.
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      const url = str(payload, 'url');
      if (!contentProjectId || !url?.startsWith('/media/')) return;
      const kind = str(payload, 'kind') === 'video' ? 'video' : 'image';
      const asset = await prisma.contentAsset.create({ data: { workspaceId: action.workspaceId, contentProjectId, kind, url, status: 'ready', metadata: jsonInput({ imported: true, uploadedBy: userId }) } });
      await broadcastContentAssetDelta(prisma, action.workspaceId, contentProjectId, asset.id);
      return;
    }
    case 'content-reorder-beats': {
      //? E3 — the video timeline: persist a new beat order + per-beat duration (trim). The render reads beats
      //? `orderBy: order`, so this drives the ffmpeg plan (sequence + each clip's on-screen time).
      const contentProjectId = str(payload, 'contentProjectId');
      const beats = Array.isArray(payload.beats) ? payload.beats : [];
      if (!contentProjectId || beats.length === 0) return;
      for (const raw of beats) {
        const b = asRec(raw);
        const beatId = str(b, 'beatId');
        if (!beatId) continue;
        const order = typeof b.order === 'number' ? b.order : undefined;
        const durationMs = typeof b.durationMs === 'number' ? Math.max(500, Math.min(30_000, Math.round(b.durationMs))) : undefined;
        if (order === undefined && durationMs === undefined) continue;
        await prisma.beat.updateMany({ where: { workspaceId: action.workspaceId, id: beatId, contentProjectId }, data: { ...(order === undefined ? {} : { order }), ...(durationMs === undefined ? {} : { durationMs }) } });
      }
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-decompose-video': {
      //? V3 — long-video decomposition: split the piece's script beats into generated, continuity-linked video
      //? scenes (the multi-clip render (V2) stitches them). Needs a script; re-decomposing replaces the scenes.
      const contentProjectId = str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const script = await prisma.script.findFirst({ where: { workspaceId: action.workspaceId, contentProjectId }, orderBy: { createdAt: 'desc' } });
      if (!script) return;
      const sceneDurationMs = typeof payload.sceneDurationMs === 'number' ? payload.sceneDurationMs : undefined;
      await decomposeIntoScenes(prisma, { workspaceId: action.workspaceId, contentProjectId, scriptId: script.id, ...(sceneDurationMs === undefined ? {} : { sceneDurationMs }), ...(str(payload, 'styleKey') ? { styleKey: str(payload, 'styleKey') } : {}), ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}) });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-refine-range': {
      //? V4 — refine a selected time range: regenerate the covered scene(s) as new versions (parentId lineage)
      //? with the instruction folded into the prompt. Maps [startMs,endMs) onto the scene timeline.
      const contentProjectId = str(payload, 'contentProjectId');
      const instruction = str(payload, 'instruction');
      const startMs = typeof payload.startMs === 'number' ? payload.startMs : undefined;
      const endMs = typeof payload.endMs === 'number' ? payload.endMs : undefined;
      if (!contentProjectId || !instruction || startMs === undefined || endMs === undefined) return;
      await refineSceneRange(prisma, { workspaceId: action.workspaceId, contentProjectId, startMs, endMs, instruction });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-run-pipeline': {
      //? O-C — run the whole content pipeline (script → voice → scenes/images → assemble) in one op, so a
      //? user (or the Assistant) turns an idea into a complete piece without clicking each step.
      const contentProjectId = str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const mode = str(payload, 'mode') === 'slideshow' ? 'slideshow' : 'video';
      //? M2 — thread the chosen style (+ any extra instructions) through the whole pipeline so it reaches the
      //? video path too (decompose), not just the slideshow images.
      //? M3 — a target duration → the long-form beat/scene planner; sceneDurationMs sets per-scene length.
      const durationMs = num(payload, 'durationMs');
      const sceneDurationMs = num(payload, 'sceneDurationMs');
      await runContentPipeline(prisma, { workspaceId: action.workspaceId, contentProjectId, mode, ...(str(payload, 'styleKey') ? { styleKey: str(payload, 'styleKey') } : {}), ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}), ...(durationMs === undefined ? {} : { durationMs }), ...(sceneDurationMs === undefined ? {} : { sceneDurationMs }) });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-save-scenes': {
      //? V1 — persist the full ordered VIDEO SCENE list from the timeline editor. Upsert by id (existing
      //? scenes keep their id + lineage), create new ones, and remove any scene no longer present. The
      //? multi-clip render (V2) reads these `orderBy: order` to stitch the real video.
      const contentProjectId = str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const scenes = Array.isArray(payload.scenes) ? payload.scenes.map((r) => asRec(r)) : [];
      const validTransition = (t: string | undefined): string => (t === 'fade' || t === 'xfade' ? t : 'cut');
      const keepIds: string[] = [];
      for (const s of scenes) { const id = str(s, 'id'); if (id) keepIds.push(id); }
      //? Remove scenes dropped by the editor (empty keepIds → clears the timeline).
      await prisma.videoScene.deleteMany({ where: { workspaceId: action.workspaceId, contentProjectId, ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}) } });
      let order = 0;
      for (const s of scenes) {
        const durationMs = typeof s.durationMs === 'number' ? Math.max(200, Math.min(60_000, Math.round(s.durationMs))) : 5000;
        const startTrimMs = typeof s.startTrimMs === 'number' ? Math.max(0, Math.round(s.startTrimMs)) : 0;
        const endTrimMs = typeof s.endTrimMs === 'number' ? Math.max(0, Math.round(s.endTrimMs)) : null;
        const data = {
          order, durationMs, startTrimMs, endTrimMs,
          videoAssetId: str(s, 'videoAssetId') ?? null, imageAssetId: str(s, 'imageAssetId') ?? null,
          transitionIn: validTransition(str(s, 'transitionIn')), prompt: str(s, 'prompt') ?? null,
        };
        const id = str(s, 'id');
        await (id
          ? prisma.videoScene.updateMany({ where: { workspaceId: action.workspaceId, contentProjectId, id }, data })
          : prisma.videoScene.create({ data: { workspaceId: action.workspaceId, contentProjectId, ...data } }));
        order += 1;
      }
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-save-audio-mix': {
      //? V5 audio-track — persist the piece's voice gain + ducked music gain from the timeline editor's audio
      //? sliders. Clamped to sane ranges; the next render (assembly) mixes voice + music at these gains.
      const contentProjectId = str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const voiceVolume = clampVolume(num(payload, 'voiceVolume'), 1, 2);
      const musicVolume = clampVolume(num(payload, 'musicVolume'), 0.25, 1);
      await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { voiceVolume, musicVolume } });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-inpaint': {
      //? E1 — region-edit: run the inpaint feature (source image + mask + instruction → a NEW region-edited
      //? asset). The mask is produced by the canvas editor (a maskUrl); this op threads it to the provider. If a
      //? source asset id is given, the new asset chains to it (I2 lineage).
      const contentProjectId = str(payload, 'contentProjectId');
      const referenceUrl = str(payload, 'referenceUrl');
      const maskUrl = str(payload, 'maskUrl');
      const prompt = str(payload, 'prompt');
      if (!contentProjectId || !referenceUrl || !maskUrl || !prompt) return;
      const r = await generateMediaAsset(prisma, { workspaceId: action.workspaceId, contentProjectId, feature: 'inpaint', prompt, referenceUrl, maskUrl, label: 'Region edit' });
      const parentAssetId = str(payload, 'parentAssetId');
      if (r.assetId && parentAssetId) {
        const parent = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: parentAssetId }, select: { id: true, parentId: true } });
        if (parent) await prisma.contentAsset.update({ where: { id: r.assetId }, data: { parentId: parent.parentId ?? parent.id } });
      }
      if (r.assetId) await broadcastContentAssetDelta(prisma, action.workspaceId, contentProjectId, r.assetId);
      return;
    }
    case 'content-regenerate': {
      //? I1 — re-run a produced asset's generation (same feature/prompt/reference/style from its MediaJob) as
      //? N NEW variations, with an optional "make it more X" tweak. Each goes through the queue-aware lifecycle
      //? (generateMediaAsset). Only the generic single-asset features (not per-beat images/voice) are re-runnable.
      const assetId = str(payload, 'assetId');
      if (!assetId) return;
      const asset = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: assetId } });
      if (!asset?.mediaJobId) return;
      const job = await prisma.mediaJob.findUnique({ where: { id: asset.mediaJobId } });
      if (!job) return;
      const isMediaFeature = (v: string): v is MediaFeature => (['image-gen', 'reference-image', 'video-gen', 'tts', 'music', 'sfx', 'avatar', 'model-3d'] as string[]).includes(v);
      if (!isMediaFeature(job.feature)) return;
      const input = job.input;
      const rec = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
      const prompt = typeof rec.prompt === 'string' ? rec.prompt : undefined;
      const referenceUrl = typeof rec.referenceUrl === 'string' ? rec.referenceUrl : undefined;
      const style = job.styleId ? await prisma.stylePreset.findUnique({ where: { id: job.styleId }, select: { key: true } }) : null;
      const tweak = str(payload, 'tweak');
      const count = Math.min(4, Math.max(1, Number(str(payload, 'count') ?? '1') || 1));
      //? I2 — lineage: a variation points at the asset it was regenerated FROM (its parent). If the source is
      //? itself a variation, chain to the ORIGINAL so all variations share one root.
      const rootId = asset.parentId ?? asset.id;
      for (let i = 0; i < count; i += 1) {
        const r = await generateMediaAsset(prisma, {
          workspaceId: action.workspaceId, contentProjectId: asset.contentProjectId, feature: job.feature,
          ...(prompt ? { prompt } : {}), ...(referenceUrl ? { referenceUrl } : {}),
          ...(style ? { styleKey: style.key } : {}), ...(tweak ? { extraInstructions: tweak } : {}), label: 'Regenerate',
        });
        if (r.assetId) {
          await prisma.contentAsset.update({ where: { id: r.assetId }, data: { parentId: rootId } });
          await broadcastContentAssetDelta(prisma, action.workspaceId, asset.contentProjectId, r.assetId);
        }
      }
      return;
    }
    //? Content pipeline (F1.1, ADR 0049) — create a content piece / advance it through the fixed content
    //? stages / archive it. The Conductor is the only writer of ContentProject.stageId/status (B-23).
    case 'content-create': {
      const projectId = str(target, 'projectId') ?? str(payload, 'projectId');
      const title = str(payload, 'title');
      if (!projectId || !title) return;
      return prisma.contentProject.create({
        data: {
          workspaceId: action.workspaceId, projectId, title,
          ...(str(payload, 'brief') ? { brief: str(payload, 'brief') } : {}),
          ...(str(payload, 'format') ? { format: str(payload, 'format') } : {}),
          ...(str(payload, 'channelId') ? { channelId: str(payload, 'channelId') } : {}),
          ...(str(payload, 'styleId') ? { styleId: str(payload, 'styleId') } : {}),
        },
      });
    }
    case 'content-advance': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const piece = await prisma.contentProject.findFirst({ where: { workspaceId: action.workspaceId, id: contentProjectId } });
      if (!piece) return;
      const toStage = str(payload, 'toStage');
      const dest = toStage && isContentStage(toStage) ? toStage : nextContentStage(piece.stageId);
      //? Past `publish` (no next stage) → mark the piece done.
      if (!dest) return prisma.contentProject.update({ where: { id: piece.id }, data: { status: 'done' } });
      return prisma.contentProject.update({ where: { id: piece.id }, data: { stageId: dest, status: 'idle' } });
    }
    case 'content-archive': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (contentProjectId) await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { archived: true } });
      return;
    }
    case 'content-unarchive': {
      //? S2 — soft-undo of an archive: restore the piece. Non-destructive (the row was never deleted).
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (contentProjectId) await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { archived: false } });
      return;
    }
    case 'save-custom-task': {
      //? E5 — create/update a user-defined AI task (name + prompt-template). Propose/generate only; running is
      //? a separate op. Never writes authoritative state beyond the task definition itself.
      const taskId = str(payload, 'taskId');
      const name = (str(payload, 'name') ?? '').trim() || 'Task';
      const promptTemplate = str(payload, 'promptTemplate') ?? '';
      await (taskId
        ? prisma.customAiTask.updateMany({ where: { workspaceId: action.workspaceId, id: taskId }, data: { name, promptTemplate } })
        : prisma.customAiTask.create({ data: { workspaceId: action.workspaceId, name, promptTemplate } }));
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'delete-custom-task': {
      const taskId = str(payload, 'taskId');
      if (taskId) await prisma.customAiTask.deleteMany({ where: { workspaceId: action.workspaceId, id: taskId } });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'run-custom-task': {
      //? E5 — render + generate through the provider abstraction; stores lastOutput only (never authoritative
      //? state). The variables are a { key: string } map from the payload.
      const taskId = str(payload, 'taskId');
      if (!taskId) return;
      const rawVars = asRec(payload.vars);
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawVars)) if (typeof v === 'string') vars[k] = v;
      await runCustomTask(prisma, action.workspaceId, taskId, vars);
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'save-output-template': {
      //? O5 — create/update a reusable output spec (name + format + optional watermark position).
      const templateId = str(payload, 'templateId');
      const name = (str(payload, 'name') ?? '').trim() || 'Format';
      const fmt = str(payload, 'format');
      const format = fmt === '9:16' || fmt === '1:1' || fmt === '16:9' ? fmt : '16:9';
      const wp = str(payload, 'watermarkPosition');
      const watermarkPosition = wp === 'br' || wp === 'bl' || wp === 'tr' || wp === 'tl' ? wp : '';
      await (templateId
        ? prisma.outputTemplate.updateMany({ where: { workspaceId: action.workspaceId, id: templateId }, data: { name, format, watermarkPosition } })
        : prisma.outputTemplate.create({ data: { workspaceId: action.workspaceId, name, format, watermarkPosition } }));
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'copy-workspace-assets': {
      //? R2 — copy the user-authored styles + the brand kit FROM a source workspace INTO this one (reuses the
      //? R1/R3 export+import). The user must be a member of the SOURCE too (authorize the copy-from side).
      const sourceWorkspaceId = str(payload, 'sourceWorkspaceId');
      if (!sourceWorkspaceId || sourceWorkspaceId === action.workspaceId) return;
      const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: sourceWorkspaceId, userId }, select: { id: true } });
      if (!member) return;
      await importStyleSet(prisma, action.workspaceId, await exportStyleSet(prisma, sourceWorkspaceId));
      const brand = await exportBrandKit(prisma, sourceWorkspaceId);
      if (brand) await importBrandKit(prisma, action.workspaceId, brand);
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'delete-output-template': {
      const templateId = str(payload, 'templateId');
      if (templateId) await prisma.outputTemplate.deleteMany({ where: { workspaceId: action.workspaceId, id: templateId } });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-unpublish': {
      //? S2 — retract a published post: mark the done PublishJob 'unpublished' (best-effort platform delete is
      //? a follow-up — no platform delete adapter yet). Spend is monotonic; refunds are out of scope (flagged).
      const assetId = str(payload, 'assetId');
      const platform = str(payload, 'platform');
      if (!assetId || !platform) return;
      await prisma.publishJob.updateMany({ where: { workspaceId: action.workspaceId, assetId, platform, status: 'done' }, data: { status: 'unpublished' } });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    //? Content script generation (F1.2, ADR 0049) — write the Script + storyboard Beats for a piece.
    case 'content-gen-script': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const piece = await prisma.contentProject.findFirst({ where: { workspaceId: action.workspaceId, id: contentProjectId } });
      if (!piece) return;
      await generateScript(prisma, {
        workspaceId: action.workspaceId, contentProjectId: piece.id, brief: piece.brief ?? piece.title,
        ...(str(payload, 'styleKey') ? { styleKey: str(payload, 'styleKey') } : {}),
        ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}),
      });
      return;
    }
    //? Content voiceover (F1.3, ADR 0049) — the piece's latest script → a voice asset + per-beat timing.
    case 'content-gen-voice': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const script = await prisma.script.findFirst({ where: { workspaceId: action.workspaceId, contentProjectId }, orderBy: { createdAt: 'desc' } });
      if (!script) return;
      await generateVoiceover(prisma, {
        workspaceId: action.workspaceId, contentProjectId, scriptId: script.id,
        ...(str(payload, 'styleKey') ? { styleKey: str(payload, 'styleKey') } : {}),
        ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}),
      });
      return;
    }
    //? Per-beat image generation (F1.4, ADR 0049) — a visual per storyboard beat, in the chosen style.
    case 'content-gen-images': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const script = await prisma.script.findFirst({ where: { workspaceId: action.workspaceId, contentProjectId }, orderBy: { createdAt: 'desc' } });
      if (!script) return;
      await generateBeatImages(prisma, {
        workspaceId: action.workspaceId, contentProjectId, scriptId: script.id,
        ...(str(payload, 'styleKey') ? { styleKey: str(payload, 'styleKey') } : {}),
        ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}),
      });
      return;
    }
    //? Assembly / render (F1.5, ADR 0049) — beats+images+voice → the final downloadable render asset.
    case 'content-assemble': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const piece = await prisma.contentProject.findFirst({ where: { workspaceId: action.workspaceId, id: contentProjectId } });
      if (!piece) return;
      await assembleContent(prisma, { workspaceId: action.workspaceId, contentProjectId });
      return;
    }
    //? Short-form clip (F2.2, ADR 0049) — a hook-driven vertical video via video-gen.
    case 'content-gen-shortform': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      const prompt = str(payload, 'prompt');
      if (!contentProjectId || !prompt) return;
      await generateShortForm(prisma, {
        workspaceId: action.workspaceId, contentProjectId, prompt,
        ...(str(payload, 'styleKey') ? { styleKey: str(payload, 'styleKey') } : {}),
        ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}),
      });
      return;
    }
    //? Reference-video analysis (F2.3, ADR 0049) — a reference video → a blueprint that seeds a new script.
    case 'content-analyze-reference-video': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      const referenceVideoUrl = str(payload, 'referenceVideoUrl');
      const newStory = str(payload, 'newStory') ?? str(payload, 'story');
      if (!contentProjectId || !referenceVideoUrl || !newStory) return;
      await analyzeReferenceVideo(prisma, { workspaceId: action.workspaceId, contentProjectId, referenceVideoUrl, newStory });
      return;
    }
    //? Single-asset gens (F2.4 avatar, F2.5 music/sfx, F2.6 3d) — the shared metered path via generateMediaAsset.
    case 'content-gen-avatar':
    case 'content-gen-music':
    case 'content-gen-sfx':
    case 'content-gen-3d': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (!contentProjectId) return;
      const featureByOp: Record<string, MediaFeature> = { 'content-gen-avatar': 'avatar', 'content-gen-music': 'music', 'content-gen-sfx': 'sfx', 'content-gen-3d': 'model-3d' };
      const feature = featureByOp[action.op];
      if (!feature) return;
      await generateMediaAsset(prisma, {
        workspaceId: action.workspaceId, contentProjectId, feature,
        ...(str(payload, 'prompt') ? { prompt: str(payload, 'prompt') } : {}),
        ...(str(payload, 'styleKey') ? { styleKey: str(payload, 'styleKey') } : {}),
        ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}),
      });
      return;
    }
    //? Request publish (F3.1, ADR 0065) — propose publishing behind the B-23 gate: create a publish
    //? suggestion. The actual post happens ONLY when the user accepts it (accept-suggestion 'publish').
    case 'content-request-publish': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      const assetId = str(payload, 'assetId');
      const platform = str(payload, 'platform');
      if (!contentProjectId || !assetId || !platform || !isPublishPlatform(platform)) return;
      //? A3 — route to a specific connected account when chosen (default account otherwise).
      const accountId = str(payload, 'accountId');
      return prisma.workspaceSuggestion.create({ data: { workspaceId: action.workspaceId, type: 'publish', title: `Publish to ${platform}${accountId ? ` (${accountId})` : ''}`, body: `Ready to publish this content to ${platform}? This is public and hard to undo.`, patch: { contentProjectId, assetId, platform, ...(accountId ? { accountId } : {}) } } });
    }
    //? AI-drives-UI copilot (F4.3, ADR 0070) — the Assistant PROPOSES a UI directive (navigate + pre-fill a
    //? form + the op the user would run) as a suggestion. It never writes authoritative state (B-23): the
    //? client applies the navigate/pre-fill guidance, and the user confirms the underlying control-op.
    case 'copilot-propose': {
      const navigate = str(payload, 'navigate');
      const op = str(payload, 'op');
      return prisma.workspaceSuggestion.create({
        data: {
          workspaceId: action.workspaceId, type: 'copilot',
          title: str(payload, 'title') ?? 'Copilot suggestion',
          body: str(payload, 'note') ?? 'The assistant suggests an action — review and confirm.',
          patch: jsonInput({ navigate: navigate ?? null, prefill: asRec(payload.prefill), op: op ?? null }),
        },
      });
    }
    //? Conversational quick-start (F3.3, ADR 0067) — the Assistant spins up a content project + a first
    //? piece from a chat brief in one op (on the user's accept).
    case 'content-from-brief': {
      const brief = str(payload, 'brief');
      if (!brief) return;
      const project = await prisma.project.create({ data: { workspaceId: action.workspaceId, name: str(payload, 'channelName') ?? 'Content', projectType: 'content', gitlabPath: '' } });
      //? A4 — bind the piece to a channel when given ("make a video for channel Z"), so generation grounds on
      //? that channel's brand voice (brandContext + brand-RAG).
      const channelId = str(payload, 'channelId');
      return prisma.contentProject.create({ data: { workspaceId: action.workspaceId, projectId: project.id, title: str(payload, 'title') ?? 'New content', brief, format: str(payload, 'format') ?? 'faceless', ...(channelId ? { channelId } : {}) } });
    }
    //? Reference-driven photorealistic image (F2.1, ADR 0049 — #1 feature) — condition on a reference image.
    case 'content-gen-reference-image': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      const referenceUrl = str(payload, 'referenceUrl');
      if (!contentProjectId || !referenceUrl) return;
      await generateReferenceImage(prisma, {
        workspaceId: action.workspaceId, contentProjectId, referenceUrl,
        ...(str(payload, 'prompt') ? { prompt: str(payload, 'prompt') } : {}),
        ...(str(payload, 'styleKey') ? { styleKey: str(payload, 'styleKey') } : {}),
        ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}),
      });
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
      const definitionOfDone = str(payload, 'definitionOfDone'); if (definitionOfDone !== undefined) data.definitionOfDone = definitionOfDone;
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
      //? AI MR-review (ADR 0041): accepting posts each proposed finding as a ReviewComment(authorKind:'ai').
      //? The AI never wrote it — the Conductor does, on human consent (B-23).
      if (suggestion?.type === 'mr-review') await postAiReviewFindings(prisma, action.workspaceId, suggestion.patch);
      //? AI rollback (ADR 0042): accepting reverts the ranked culprit MR (forward `git revert -m 1`, #7) +
      //? drafts a tracking ticket. The AI never reverted — the Conductor does, on human consent (B-23).
      if (suggestion?.type === 'rollback') return acceptRollback(action.workspaceId, userId, suggestion.patch);
      //? Publish (F3.1, ADR 0065): accepting posts the asset to the platform (dummy, no key). The AI never
      //? published — the Conductor does, on explicit human consent (B-23; publishing is irreversible).
      if (suggestion?.type === 'publish') {
        const p = asRec(suggestion.patch);
        const contentProjectId = typeof p.contentProjectId === 'string' ? p.contentProjectId : '';
        const assetId = typeof p.assetId === 'string' ? p.assetId : '';
        const platform = typeof p.platform === 'string' ? p.platform : '';
        const accountId = typeof p.accountId === 'string' ? p.accountId : undefined;
        if (contentProjectId && assetId && isPublishPlatform(platform)) await publishAsset(prisma, action.workspaceId, { contentProjectId, assetId, platform, ...(accountId ? { accountId } : {}) });
      }
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
    //? Multi-project / multi-service (ADR 0035) — B-23: the Conductor is the only writer.
    case 'project-create': {
      const name = str(payload, 'name');
      if (!name) return;
      //? ADR 0049 — a project is a dev board OR a content lane (projectType).
      const projectType = str(payload, 'projectType') === 'content' ? 'content' : 'dev';
      const created = await prisma.project.create({
        data: {
          workspaceId: action.workspaceId, name, projectType,
          gitlabPath: str(payload, 'gitlabPath') ?? '',
          ...(str(payload, 'gitUrl') ? { gitUrl: str(payload, 'gitUrl') } : {}),
        },
      });
      //? A dev project owns its OWN board pipeline (ADR 0035); a content project uses the fixed
      //? content-stage sequence (F1.1), so it needs no board columns.
      if (projectType !== 'content') await createDefaultPipeline(prisma, action.workspaceId, created.id);
      return created;
    }
    case 'service-create': {
      const projectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      const name = str(payload, 'name');
      if (!projectId || !name) return;
      const created = await prisma.service.create({
        data: {
          workspaceId: action.workspaceId, projectId, name,
          path: str(payload, 'path') ?? '.',
          ...(str(payload, 'buildCmd') ? { buildCmd: str(payload, 'buildCmd') } : {}),
          ...(str(payload, 'deployUnit') ? { deployUnit: str(payload, 'deployUnit') } : {}),
        },
      });
      return created;
    }
    case 'service-delete': {
      const serviceId = str(target, 'serviceId') ?? str(payload, 'serviceId');
      if (serviceId) await prisma.service.deleteMany({ where: { workspaceId: action.workspaceId, id: serviceId } });
      return;
    }
    //? Greenfield scaffolding (ADR 0046): create a fresh project FROM a curated stack template — seeds the
    //? project's image/devCommand + its starter convention docs (as InfoSources) + its own default pipeline.
    case 'project-from-template': {
      const name = str(payload, 'name'); const templateKey = str(payload, 'template');
      if (!name || !templateKey) return;
      const template = getTemplate(templateKey);
      if (!template) return;
      const created = await prisma.project.create({
        data: {
          workspaceId: action.workspaceId, name, gitlabPath: '',
          ...(template.baseImageRef ? { baseImageRef: template.baseImageRef } : {}),
          devCommand: template.devCommand,
        },
      });
      //? Seed the template's starter convention docs as context-doc InfoSources (visible in Sources,
      //? injectable into the coding agent — the 'starter' source pattern).
      for (const doc of template.starterDocs) {
        await prisma.infoSource.create({ data: { workspaceId: action.workspaceId, projectId: created.id, mode: 'context-doc', source: 'starter', name: doc.name, content: doc.content, summary: `Starter (${template.label})`, note: 'template', enabled: true, usedByStages: [] } });
      }
      await createDefaultPipeline(prisma, action.workspaceId, created.id);
      //? G1 — actually make it a REPO: init the workspace bare repo from the template's seed file-tree so
      //? `isLinked` flips true → the runtime can cut a worktree + container from it (container → code). No-op
      //? if a repo already exists (never clobber). Best-effort — a git failure leaves the project unlinked.
      const [gitErr, status] = await tryCatch(() => initGreenfieldRepo(action.workspaceId, template.files));
      if (gitErr) console.error(`[greenfield] repo init for ${name} failed:`, gitErr.message);
      else if (status?.linked && !created.gitUrl) await prisma.project.updateMany({ where: { id: created.id, workspaceId: action.workspaceId }, data: { gitUrl: `greenfield://${action.workspaceId}` } });
      return created;
    }
    //? Environments / deploy (ADR 0037) — B-23: the Conductor deploys (the leader holds the lease).
    case 'env-deploy': {
      const deployProjectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      if (!deployProjectId) return { ok: false, status: 'error', error: 'env.noProject' };
      const serviceId = str(target, 'serviceId') ?? str(payload, 'serviceId') ?? null;
      const kind = str(payload, 'kind') ?? 'dev';
      //? D3 — a demo env can follow main (autoRedeploy, default true) or freeze at a pinned commit. Only pass
      //? autoRedeploy when the client set it explicitly, so ensureEnvironment's demo-default still applies.
      const pinnedCommit = str(payload, 'pinnedCommit');
      const envId = await ensureEnvironment(prisma, action.workspaceId, deployProjectId, serviceId, kind, { ...(pinnedCommit ? { pinnedCommit } : {}), ...('autoRedeploy' in payload ? { autoRedeploy: bool(payload, 'autoRedeploy') } : {}) });
      if (!envId) return { ok: false, status: 'error', error: 'env.noProject' };
      return deployEnvironment(prisma, action.workspaceId, envId);
    }
    case 'env-teardown': {
      const envId = str(target, 'envId') ?? str(payload, 'envId');
      if (!envId) return { ok: false };
      return teardownEnvironment(prisma, action.workspaceId, envId);
    }
    //? Promote up the dev→staging→prod ladder (ADR 0038) — deploys the SOURCE env's tested image to the
    //? next stage; prod is gated on an explicit approval + a live source (B-23).
    case 'env-promote': {
      const promoteProjectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      if (!promoteProjectId) return { ok: false, status: 'error', error: 'env.noProject' };
      const fromKind = str(payload, 'fromKind') ?? 'dev';
      const serviceId = str(target, 'serviceId') ?? str(payload, 'serviceId') ?? null;
      return promoteEnvironment(prisma, action.workspaceId, promoteProjectId, serviceId, fromKind, { approved: bool(payload, 'approved') });
    }
    //? Export a project's built image as a downloadable tarball (ADR 0038) — self-host-anywhere.
    case 'build-export': {
      const exportProjectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      if (!exportProjectId) return { ok: false, status: 'error', error: 'env.noProject' };
      return buildExport(prisma, action.workspaceId, exportProjectId, str(payload, 'kind') ?? 'image', Date.now());
    }
    //? Run the project's CI at a ticket's MR head (ADR 0039) — feeds the merge/promote gate.
    case 'ci-run': {
      const ticketKey = str(target, 'ticketId') ?? str(payload, 'ticketKey');
      if (!ticketKey) return { status: 'none', error: 'ci.noTicket' };
      const ticket = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId, key: ticketKey }, select: { id: true, projectId: true, branch: true } });
      if (!ticket?.branch) return { status: 'none', error: 'ci.notActivated' };
      const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId: action.workspaceId, ticketId: ticket.id }, orderBy: { createdAt: 'desc' }, select: { id: true, headSha: true } });
      const commitHash = mr?.headSha ?? (await branchHead(action.workspaceId, ticket.branch));
      return runPipeline(prisma, action.workspaceId, ticket.projectId, { branch: ticket.branch, commitHash, ticketId: ticket.id, mergeRequestId: mr?.id ?? null, trigger: str(payload, 'trigger') ?? 'manual' });
    }
    //? Admin override (ADR 0039): allow merge/promote while a required CI run is red (unwedge a broken runner).
    case 'ci-allow-red': {
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { allowMergeOnRedCI: bool(payload, 'enabled') } });
      return;
    }
    //? AI MR-review (ADR 0041): run the reviewer role on a ticket's MR → it PROPOSES findings as a
    //? WorkspaceSuggestion(type:'mr-review'). The human accepts to post them (B-23). AI never writes here.
    case 'mr-review': {
      const role = getAgentRole('mr-review');
      if (!role) return { ok: false };
      const ticketKey = str(target, 'ticketId') ?? str(payload, 'ticketKey');
      const mrId = str(payload, 'mrId');
      const artifact = await role.run({ workspaceId: action.workspaceId, ...(ticketKey ? { ticketKey } : {}), params: mrId ? { mrId } : {} });
      return { ok: true, ...(artifact ? { title: artifact.title, body: artifact.body } : {}) };
    }
    //? AI root-cause / rollback (ADR 0042): run the role on a symptom → it PROPOSES a rollback as a
    //? WorkspaceSuggestion(type:'rollback'). The human accepts to revert + get a tracking ticket (B-23).
    case 'root-cause': {
      const role = getAgentRole('root-cause');
      if (!role) return { ok: false };
      const artifact = await role.run({ workspaceId: action.workspaceId, params: { symptom: str(payload, 'symptom') ?? '' } });
      return { ok: true, ...(artifact ? { title: artifact.title, body: artifact.body } : {}) };
    }
    //? Institutional memory (ADR 0045): (re)index the workspace's Handoffs + CarryOvers into the RAG so
    //? prior learnings surface in later tickets. Also fires incrementally on merge.
    case 'index-memory': {
      return indexInstitutionalMemory(prisma, action.workspaceId);
    }
    //? Plan-critique gate (ADR 0044): run the adversarial reasoning pass on a ticket's plan → a
    //? WorkspaceSuggestion(type:'plan-critique') the human folds in before implement.
    case 'plan-critique': {
      const role = getAgentRole('plan-critique');
      const ticketKey = str(target, 'ticketId') ?? str(payload, 'ticketKey');
      if (!role || !ticketKey) return { ok: false };
      const artifact = await role.run({ workspaceId: action.workspaceId, ticketKey, params: {} });
      return { ok: true, ...(artifact ? { title: artifact.title, body: artifact.body } : {}) };
    }
    //? User-app DB + migrations (ADR 0043) — B-23: the Conductor writes the connection + applies migrations.
    case 'db-connect': {
      const dbProjectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      const url = str(payload, 'url'); const name = str(payload, 'name'); const kind = str(payload, 'kind');
      if (!dbProjectId || !url || !name || !kind) return { ok: false };
      const envKind = str(payload, 'envKind') ?? 'dev';
      const serviceId = str(payload, 'serviceId') ?? null;
      const existing = await prisma.dbConnection.findFirst({ where: { workspaceId: action.workspaceId, projectId: dbProjectId, envKind, ...(serviceId ? { serviceId } : {}) }, select: { id: true } });
      const data = { name, kind, urlEnc: encryptSecret(url), envKind, ...(serviceId ? { serviceId } : {}) };
      const conn = await (existing
        ? prisma.dbConnection.update({ where: { id: existing.id }, data })
        : prisma.dbConnection.create({ data: { workspaceId: action.workspaceId, projectId: dbProjectId, ...data } }));
      return { id: conn.id };
    }
    case 'db-migrate-create': {
      const migProjectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      const name = str(payload, 'name'); const sql = str(payload, 'sql');
      if (!migProjectId || !name || !sql) return { ok: false };
      const created = await prisma.migration.create({
        data: { workspaceId: action.workspaceId, projectId: migProjectId, name, sql, envKind: str(payload, 'envKind') ?? 'dev', ...(str(payload, 'rollbackSql') ? { rollbackSql: str(payload, 'rollbackSql') } : {}), status: 'pending' },
      });
      return { id: created.id };
    }
    case 'db-migrate-apply': {
      const migrationId = str(target, 'migrationId') ?? str(payload, 'migrationId');
      if (!migrationId) return { ok: false, status: 'error' };
      return applyMigration(prisma, action.workspaceId, migrationId, { approved: bool(payload, 'approved') });
    }
    case 'db-introspect': {
      const connectionId = str(target, 'connectionId') ?? str(payload, 'connectionId');
      if (!connectionId) return { ok: false, tables: [] };
      return introspectDb(prisma, action.workspaceId, connectionId);
    }
    //? Interviewer findings (ADR 0034) — B-23: the human turns a finding into a ticket / dismisses it.
    case 'finding-to-ticket': {
      const id = str(target, 'findingId') ?? str(payload, 'findingId');
      if (!id) return;
      const finding = await prisma.interviewFinding.findFirst({ where: { workspaceId: action.workspaceId, id } });
      if (!finding || finding.ticketId) return;
      //? Multi-project (ADR 0035): a finding is workspace-level → its ticket goes to the
      //? active project (payload) or the first. Was a raw findFirst.
      const findingProjectId = await resolveProjectId(prisma, action.workspaceId, str(payload, 'projectId'));
      if (!findingProjectId) return;
      const last = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      const created = await prisma.ticket.create({
        data: {
          workspaceId: action.workspaceId, projectId: findingProjectId, key: `DEV-${String(number)}`, number,
          title: finding.title, description: finding.summary, stageId: 'unrefined', status: 'idle',
          labels: [finding.area], creatorId: userId, priority: finding.severity === 'high' ? 'high' : 'normal',
        },
      });
      await prisma.interviewFinding.updateMany({ where: { workspaceId: action.workspaceId, id }, data: { status: 'accepted', ticketId: created.id } });
      await recordTicketEvent(action.workspaceId, created.id, 'status-change', userId, 'created the ticket from an Interviewer finding');
      void fireEvent(prisma, action.workspaceId, { on: 'ticket.created', ticketKey: created.key, stageId: 'unrefined', projectId: findingProjectId });
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
