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
import { Prisma, type PrismaClient, type Ticket as DbTicket } from '@prisma/client';

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { currentWorkspaceId, hasTenantScope, runInTenant } from '../tenant/tenantContext';
import { encryptSecret } from '../crypto/secretBox';
import { credentialKey, getValidConnection } from '../content/publishOAuth';
import { sendInviteEmail } from '../email/sendInviteEmail';
import { createBlankWorkspace } from '../bootstrap/seedWorkspace';
import { ensureWorkspaceBuiltins, scheduleWorkspaceBuiltinIndexing } from '../bootstrap/workspaceBuiltins';
import { isPipelinePreset, createDefaultPipeline, stageBlueprint, baseStageStatuses, stagesForPreset, stageCreateData, blueprintForStage, fallbackStageKey, defaultStageKeys, isStageKind } from '../bootstrap/defaultPipeline';
import { cloneWorkspace } from '../bootstrap/cloneWorkspace';
import { publishArtifactSite, unpublishArtifactSite, publicBaseUrl } from '../deploy/staticSite';
import { setAssetStarred } from '../content/assetLibrary';
import { trashMedia, restoreFromTrash, purgeTrashItem } from '../media/trash';
import { sanitizeSections } from '../../src/workspaces/_data/modules';
import { createStarterLibrary } from '../bootstrap/starterLibrary';
import { getTemplate } from '../scaffold/templates';
import { nextContentStage, isContentStage } from '../content/pipeline';
import { generateScript } from '../content/script';
import { addReference, deleteReference } from '../content/referenceLibrary';
import { decomposeIntoScenes } from '../content/sceneDecompose';
import { refineSceneRange } from '../content/sceneRefine';
import { runContentPipeline } from '../content/runPipeline';
import { generateVoiceover } from '../content/voice';
import { generateBeatImages } from '../content/images';
import { assembleContent } from '../content/assembly';
import { localizeAsset, trimAudioFile, transcodeContainer } from '../content/render';
import { runCapture, buildCaptureScenario, generateCaptureScenario, coerceScenario } from '../content/capture';
import { generateReferenceImage } from '../content/referenceImage';
import { critiqueImage } from '../content/imageCritique';
import { renderThumbnail } from '../content/thumbnail';
import { parseCaptionStyle } from '../content/captionStyle';
import { enqueueExtractJob, claimExtractJob, completeExtractJob, reclaimStaleExtractJobs } from '../documents/extractJob';
import { withTenant } from '../tenant/tenantGuard';
import { postReply } from '../content/commentActions';
import { generateShortForm } from '../content/shortForm';
import { analyzeReferenceVideo } from '../content/referenceVideo';
import { generateMediaAsset } from '../content/mediaAsset';
import type { MediaFeature } from '../media/types';
import { publishAsset, isPublishPlatform, deletePlatformPost } from '../content/publish';
import { indexChannelBrand } from '../content/brandMemory';
import { recordAiRun } from '../ai/activity';
import { jsonInput } from '../util/json';
import { cloneRepo, addWorktree, isLinked, listRepoDocs, initGreenfieldRepo, readRepoBranchFile, commitFilesToBranch } from '../git/repoStore';
import { applyPublicCiComplete } from '../ci/publicWriter';
import { postAiReviewFindings } from '../mr/reviewRole';
import { executeAgentRole, getAgentRole } from '../automation/agentRoles';
import { parseNeedsInputQuestions, applyAnswers, firstUnanswered, buildCombinedAnswerPrompt, parseAdvisories, resolveAdvisory } from './questionSet';
import { questionPrompt } from '../../src/workspaces/_functions/structuredQuestion';
import { applyMigration, introspectDb } from '../db/migrate';
import { indexWorkspace } from '../rag';
import { indexInstitutionalMemory } from '../rag/memory';
import { createMr, addReviewComment, approveMr, mergeMr, rollbackMr, resolveThread, mrForTicket } from '../mr/service';
import { normalizeGitConfig, resolveBranchName } from '../git/branchStrategy';
import { applyForgeSnapshot, readForgeSnapshot } from '../git/gitlabSync';
import { applyForgeEvent } from '../git/webhookIngest';
import {
  withWorkspaceLease,
  claimControlAction,
  completeControlAction,
  abandonControlAction,
  waitForControlActionOutcome,
  boundedControlActionResultKeys,
  type ControlActionFailureCode,
  type ControlActionTerminalOutcome,
  type WorkspaceLeaseGuard,
} from './cluster';
import { dockerAvailable, teardownExactTicketContainer, teardownWorkspaceContainers } from '../container/runtime';
import { isSpendEnforcementActive } from '../spend/record';
import { provisionServiceStack, teardownServiceStack, teardownWorkspaceServiceNetwork } from '../container/composeEngine';
import { presetCompose, presetEnv } from '../container/servicePresets';
import { sanitizeProblems, sanitizeScreenshots } from '../ui/uiReview';
import { recordAudit } from '../control/audit';
import { runStage, shouldRetryStageFailure } from './stageRunner';
import { resolveProjectId } from './projectResolve';
import { ensureEnvironment, deployEnvironment, teardownEnvironment, rollbackEnvironment } from '../deploy/environment';
import { promoteEnvironment } from '../deploy/promote';
import { buildExport } from '../deploy/buildExport';
import { isEditorRunning, ticketEditGuard } from './editGuard';
import { extendsBase, saveDockerfileDraft } from '../container/dockerfileDraft';
import { isSafeWorktreePath, writeWorktreeFile } from '../container/worktreeFiles';
import { acquireSlot, releaseSlot, enqueueDeferred, dequeueDeferredUntil, inFlightByWorkspace, recoveryReservation, withReservationRenewal } from './capacity';
import { ciPublicIntentId, ciPublicIntentSignalId, runtimeLaunchCompletionId, stageForgeIntentId } from './actionIds';
import { beginArtifact, completeArtifact, isArtifactKind } from '../studio/generate';
import { withStudioBriefLock } from '../studio/briefLock';
import { persistProjectDoc } from '../ai/docsGen';
import { runAgentRecovery } from './agentControl';
import { disconnectProjectRepo } from '../git/repoDisconnect';
import { broadcastTicketDelta, broadcastContentAssetDelta, broadcastContentDirty, broadcastContentPieceDelta, broadcastWorkspaceDirty } from '../read/broadcast';
import { sendWebPush } from '../hooks/webPush';
import { runCustomTask } from '../ai/customTask';
import { SKILL_APPLY_POINTS, builtinSkillDefault } from '../ai/skills';
import { indexDocument, runDocumentAi, generateDocumentImage, pruneDocumentRevisions, indexDocumentAsset, clearDocumentAssets, parseAssetEntries } from '../documents/docs';
import { exportDocument, DOCUMENT_EXPORT_FORMATS } from '../documents/export';
import { extractUploadText, isParseableUpload } from '../documents/parseUpload';
import { resolveTemplate, buildSkeleton, buildTemplateStructure, parseSections } from '../documents/templates';
import { activeThemeTokens, designTokenCssPath, patchManagedThemeCss } from '../designer/applyTokens';
import { deleteDesignArtifact, saveDesignArtifact, setActiveDesignArtifact } from '../designer/library';
import { refreshComments } from '../content/commentInbox';
import { exportStyleSet, importStyleSet, parseStyleSet } from '../content/styles';
import { exportBrandKit, parseBrandKit, saveBrandLibrary } from '../studio/brand';
import { applyAutomationEvent, fireEvent } from '../automation/triggers';
import { fireCronTrigger } from '../automation/cron';
import { executeGatedAction, executeTriggerAction, runTriggerAction } from '../automation/executor';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';
import { TICKET_PRIORITIES, type TicketPriority } from '../../src/workspaces/_data/types';
import { CRASH_REPLAYABLE_INTERNAL_OPS, INTERNAL_OP_NAMES, internalActionFromSignal, internalActionReplayKeys, isInternalOp, type AgentRecoveryTransitionInternalAction, type InternalAction, type InternalOp, type StageDeferUpdateInternalAction } from './internalOps';
import { applyEntityCas, dockerfileEntityKey, ENTITY_VERSION_KEYS, projectImageEntityKey, readEntityVersion, worktreeFileEntityKey } from './entityVersion';
import {
  applyStageActivationComplete,
  applyStageDeferUpdate,
  applyStageForgeComplete,
  applyStageForgePrepare,
  applyStageHandoffComplete,
  applyStageSessionStart,
  applyStageSessionUpdate,
  applyStageToolTrailAppend,
  applyStageTurnComplete,
  readStageActivationCompleteResult,
  stageActionPersisted,
  stageActionResultKeys,
} from './stageWriter';
import { applyAgentRecoveryTransition, applyWatchdogReminder, needsInputHash, readRecoveryTransitionResult, reconstructAcceptedRecoveryPrepare, recoveryIntentId } from './recoveryWriter';
import { assertWriterContext, assertWriterLeaseHeld, currentWriterScope, GLOBAL_WRITER_SCOPE, hasActiveWriterDedupKey, runInWriterContext } from './writerContext';

export { BLOCKED_DEFER_MSG, CAPACITY_DEFER_MSG, EDITOR_DEFER_MSG } from './stageWriter';

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
export async function cascadeDeleteWorkspace(workspaceId: string): Promise<void> {
  //? Mongo has no relational cascade here. Keep this exhaustive over every tenant-owned Prisma
  //? delegate: deleting the Workspace row first would strand unreadable data indefinitely.
  await prisma.ticketEvent.deleteMany({ where: { workspaceId } });
  await prisma.ticket.deleteMany({ where: { workspaceId } });
  await prisma.ticketLink.deleteMany({ where: { workspaceId } });
  await prisma.ticketReference.deleteMany({ where: { workspaceId } });
  await prisma.sprint.deleteMany({ where: { workspaceId } });
  await prisma.agentSession.deleteMany({ where: { workspaceId } });
  await prisma.carryOver.deleteMany({ where: { workspaceId } });
  await prisma.handoff.deleteMany({ where: { workspaceId } });
  await prisma.questionSet.deleteMany({ where: { workspaceId } });
  await prisma.workspaceTrigger.deleteMany({ where: { workspaceId } });
  await prisma.workspaceSignal.deleteMany({ where: { workspaceId } });
  await prisma.workspaceEntityVersion.deleteMany({ where: { workspaceId } });
  await prisma.workspaceSuggestion.deleteMany({ where: { workspaceId } });
  await prisma.workspaceNote.deleteMany({ where: { workspaceId } });
  await prisma.workspaceChatMessage.deleteMany({ where: { workspaceId } });
  await prisma.workspaceBudget.deleteMany({ where: { workspaceId } });
  await prisma.spendRecord.deleteMany({ where: { workspaceId } });
  await prisma.notification.deleteMany({ where: { workspaceId } });
  await prisma.infoSource.deleteMany({ where: { workspaceId } });
  await prisma.ragEntry.deleteMany({ where: { workspaceId } });
  await prisma.envVar.deleteMany({ where: { workspaceId } });
  await prisma.integrationTool.deleteMany({ where: { workspaceId } });
  await prisma.invite.deleteMany({ where: { workspaceId } });
  await prisma.promptTrial.deleteMany({ where: { workspaceId } });
  await prisma.promptExperiment.deleteMany({ where: { workspaceId } });
  await prisma.publishMetricSnapshot.deleteMany({ where: { workspaceId } });
  await prisma.siteSnapshot.deleteMany({ where: { workspaceId } });
  await prisma.publishedSite.deleteMany({ where: { workspaceId } });
  await prisma.uiReviewRequest.deleteMany({ where: { workspaceId } });
  await prisma.studioArtifact.deleteMany({ where: { workspaceId } });
  await prisma.studioBrandLibrary.deleteMany({ where: { workspaceId } });
  await prisma.studioBrief.deleteMany({ where: { workspaceId } });
  await prisma.designArtifact.deleteMany({ where: { workspaceId } });
  await prisma.interviewFinding.deleteMany({ where: { workspaceId } });
  await prisma.ticketArtifactLink.deleteMany({ where: { workspaceId } });
  await prisma.personalAccessToken.deleteMany({ where: { workspaceId } });
  await prisma.outputTemplate.deleteMany({ where: { workspaceId } });
  await prisma.customAiTask.deleteMany({ where: { workspaceId } });
  await prisma.reviewComment.deleteMany({ where: { workspaceId } });
  await prisma.reviewThread.deleteMany({ where: { workspaceId } });
  await prisma.approval.deleteMany({ where: { workspaceId } });
  await prisma.mergeRequest.deleteMany({ where: { workspaceId } });
  await prisma.socialComment.deleteMany({ where: { workspaceId } });
  await prisma.publishJob.deleteMany({ where: { workspaceId } });
  await prisma.shortLink.deleteMany({ where: { workspaceId } });
  await prisma.mediaSpend.deleteMany({ where: { workspaceId } });
  await prisma.mediaBudget.deleteMany({ where: { workspaceId } });
  await prisma.referenceExample.deleteMany({ where: { workspaceId } });
  await prisma.skill.deleteMany({ where: { workspaceId } });
  await prisma.documentRevision.deleteMany({ where: { workspaceId } });
  await prisma.documentTemplate.deleteMany({ where: { workspaceId } });
  await prisma.document.deleteMany({ where: { workspaceId } });
  await prisma.stylePreset.deleteMany({ where: { workspaceId } });
  await prisma.renderJob.deleteMany({ where: { workspaceId } });
  await prisma.mediaJob.deleteMany({ where: { workspaceId } });
  await prisma.videoScene.deleteMany({ where: { workspaceId } });
  await prisma.beat.deleteMany({ where: { workspaceId } });
  await prisma.script.deleteMany({ where: { workspaceId } });
  //? F48 — the workspace's media BYTES were left on disk forever (no GC). They now go to the trash with a
  //? grace window rather than being unlinked here: deleting a workspace is exactly the moment an
  //? irreversible wipe hurts most, and the trash view lets an owner pull something back or purge it now.
  const doomedAssets = await prisma.contentAsset.findMany({ where: { workspaceId, url: { not: null } }, select: { url: true, kind: true } });
  for (const asset of doomedAssets) {
    if (asset.url) await trashMedia(prisma, { workspaceId, url: asset.url, label: asset.kind, kind: asset.kind, reason: 'workspace-deleted' });
  }
  await prisma.contentAsset.deleteMany({ where: { workspaceId } });
  await prisma.contentProject.deleteMany({ where: { workspaceId } });
  await prisma.channel.deleteMany({ where: { workspaceId } });
  await prisma.environment.deleteMany({ where: { workspaceId } });
  await prisma.buildArtifact.deleteMany({ where: { workspaceId } });
  await prisma.pipelineJob.deleteMany({ where: { workspaceId } });
  await prisma.pipelineRun.deleteMany({ where: { workspaceId } });
  await prisma.pipeline.deleteMany({ where: { workspaceId } });
  await prisma.migration.deleteMany({ where: { workspaceId } });
  await prisma.dbConnection.deleteMany({ where: { workspaceId } });
  await prisma.forgeConnection.deleteMany({ where: { workspaceId } });
  await prisma.serviceStack.deleteMany({ where: { workspaceId } });
  await prisma.service.deleteMany({ where: { workspaceId } });
  await prisma.pipelineStage.deleteMany({ where: { workspaceId } });
  await prisma.project.deleteMany({ where: { workspaceId } });
  await prisma.workspaceRole.deleteMany({ where: { workspaceId } });
  await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
  //? Tenant audit/deploy rows are purged; AuditArchive deliberately survives outside the tenant.
  await prisma.deployHistory.deleteMany({ where: { workspaceId } });
  await prisma.auditLog.deleteMany({ where: { workspaceId } });
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

export type WriterOp = ControlOp | InternalOp;
type WriterAction = ControlAction | InternalAction;
type WriterActionKind = 'public' | 'internal';

function writerSignalId(action: WriterAction): string | undefined {
  if (action.op === 'stage-forge-prepare') return stageForgeIntentId(action.workspaceId, action.clientRequestId);
  if (action.op === 'agent-recovery-transition' && action.payload.phase === 'prepare') return recoveryIntentId(action.workspaceId, action.clientRequestId);
  if (action.op === 'ci-run' && action.payload.phase === 'prepare') return ciPublicIntentSignalId(action.workspaceId, action.clientRequestId);
  if (action.op === 'runtime-launch-prepare') return action.target.intentId;
  if (action.op === 'runtime-launch-complete') return runtimeLaunchCompletionId(action.workspaceId, action.target.intentId);
  return undefined;
}

function writerSignalPayload(action: WriterAction): ReturnType<typeof jsonInput> {
  const base = { op: action.op, userId: action.userId, clientRequestId: action.clientRequestId };
  if (action.op === 'stage-forge-prepare') {
    const intentId = stageForgeIntentId(action.workspaceId, action.clientRequestId);
    return jsonInput({
      ...base,
      intent: {
        id: intentId,
        ticketId: action.target.ticketId,
        ticketKey: action.target.ticketKey,
        projectId: action.target.projectId,
        stageId: action.target.stageId,
        sessionId: action.target.sessionId,
        runToken: action.target.runToken,
        runFence: action.target.runFence,
        containerId: action.payload.containerId,
        expectedBranch: action.payload.expectedBranch,
      },
      replay: { version: 1, target: action.target, payload: action.payload },
    });
  }
  if (action.op === 'agent-recovery-transition' && action.payload.phase === 'prepare') {
    const intentId = recoveryIntentId(action.workspaceId, action.clientRequestId);
    const recovery = recoveryReservation(action.workspaceId, action.target.ticketKey, intentId, action.payload.expected.runFence);
    return jsonInput({
      ...base,
      intent: {
        id: intentId,
        ticketId: action.target.ticketId,
        ticketKey: action.target.ticketKey,
        projectId: action.target.projectId,
        stageId: action.target.stageId,
        sessionId: action.target.sessionId,
        reason: action.payload.reason,
        expected: action.payload.expected,
        recovery: { runToken: recovery.runToken, runFence: recovery.fence },
      },
      replay: { version: 1, target: action.target, payload: action.payload },
    });
  }
  if (action.op === 'ci-run' && action.payload.phase === 'prepare') {
    const binding = asRec(action.payload.binding);
    return jsonInput({
      ...base,
      intent: {
        id: ciPublicIntentId(action.workspaceId, str(action.target, 'projectId') ?? '', action.clientRequestId),
        signalId: ciPublicIntentSignalId(action.workspaceId, action.clientRequestId),
        ticketId: str(binding, 'ticketId') ?? '',
        ticketKey: str(action.target, 'ticketId') ?? '',
        projectId: str(action.target, 'projectId') ?? '',
        branch: str(binding, 'branch') ?? '',
        commitHash: str(binding, 'commitHash') ?? '',
        mergeRequestId: str(binding, 'mergeRequestId') ?? null,
        trigger: str(binding, 'trigger') ?? 'manual',
      },
    });
  }
  //? Persist full typed input only for the reviewed replay/runtime allowlist. Other internal payloads can
  //? contain source files, webhook parameters or provider material; their audit signal keeps identity only,
  //? exactly like public actions, until an explicit credential-free replay contract is added.
  if (isInternalOp(action.op) && (
    CRASH_REPLAYABLE_INTERNAL_OPS.includes(action.op)
    || action.op === 'runtime-launch-prepare'
    || action.op === 'runtime-launch-complete'
  )) return jsonInput({ ...base, version: 1, target: action.target, payload: action.payload });
  return jsonInput(base);
}

//? Monotonic per-workspace signal seq (Redis INCR) — the client's merge-on-`seq`
//? key (CONTROL_API §6.3). Durable across restart; identical shape in Fase 2.
async function nextSignalSeq(workspaceId: string): Promise<number> {
  if (hasTenantScope()) {
    if (currentWorkspaceId() !== workspaceId) throw new Error('[conductor] signal seq tenant does not match the action workspace');
    return redis.incr(formatKey('evseq', 'workspace'));
  }
  return runInTenant(workspaceId, () => redis.incr(formatKey('evseq', 'workspace')));
}

interface WriterSignalProjection {
  id: string;
  seq: number;
}

//? Deterministic intent rows outlive the Redis dedup TTL. A retry reuses that exact
//? append-only row (and repairs an unfinished apply) only when kind + request identity match;
//? it never collides on create or aliases a foreign deterministic id.
async function appendWriterSignal(
  action: WriterAction,
  payload: ReturnType<typeof writerSignalPayload>,
  signalId: string | undefined,
  assertAuthority: () => void,
): Promise<WriterSignalProjection> {
  if (signalId !== undefined) {
    assertAuthority();
    const existing = await prisma.workspaceSignal.findUnique({
      where: { id: signalId },
      select: { id: true, workspaceId: true, seq: true, kind: true, payload: true },
    });
    if (existing) {
      const stored = asRec(existing.payload);
      if (existing.workspaceId !== action.workspaceId || existing.kind !== action.op
        || str(stored, 'clientRequestId') !== action.clientRequestId) {
        throw new Error('[conductor] deterministic signal identity collision');
      }
      return { id: existing.id, seq: existing.seq };
    }
  }
  assertAuthority();
  const seq = await nextSignalSeq(action.workspaceId);
  assertAuthority();
  return prisma.workspaceSignal.create({
    data: { ...(signalId ? { id: signalId } : {}), workspaceId: action.workspaceId, seq, kind: action.op, payload },
    select: { id: true, seq: true },
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
  const p = asRec(patch);
  const mrId = str(p, 'mrId');
  const symptomRaw = str(p, 'symptom') ?? '';
  const symptom = symptomRaw.length > 0 ? symptomRaw : 'a production regression';
  const reason = str(p, 'reason') ?? '';
  if (!mrId) return { ok: false, error: 'rollback.invalidRequest' };

  //? The culprit MR + its source ticket are the project authority. Once an MR is known, falling
  //? back to the workspace's first project would create the follow-up on an unrelated board.
  const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId, id: mrId }, select: { projectId: true, ticketId: true } });
  if (!mr) return { ok: false, error: 'rollback.mrNotFound' };
  const sourceTicket = await prisma.ticket.findFirst({ where: { workspaceId, id: mr.ticketId }, select: { projectId: true } });
  if (sourceTicket?.projectId !== mr.projectId) return { ok: false, error: 'rollback.invalidSource' };
  const project = await prisma.project.findFirst({ where: { workspaceId, id: sourceTicket.projectId }, select: { id: true } });
  if (!project) return { ok: false, error: 'project.notFound' };

  await tryCatch(() => rollbackMr(prisma, workspaceId, mrId));
  const last = await prisma.ticket.findFirst({ where: { workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
  const number = (last?.number ?? 0) + 1;
  const created = await prisma.ticket.create({
    data: {
      workspaceId, projectId: project.id, key: `DEV-${String(number)}`, number,
      title: `Rollback follow-up: ${symptom}`.slice(0, 120), description: reason.length > 0 ? reason : null,
      stageId: 'unrefined', status: 'idle', labels: ['rollback'], creatorId: userId, priority: 'high',
    },
  });
  await recordTicketEvent(workspaceId, created.id, 'status-change', userId, 'created the tracking ticket from an AI rollback');
  void fireEvent(prisma, workspaceId, { on: 'ticket.created', ticketKey: created.key, stageId: 'unrefined', projectId: project.id });
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
    await sendWebPush(prisma, recipientUserId, { title: 'Assigned to a ticket', body: `You were assigned ${ticketKey}.`, url: `/?ticket=${ticketKey}`, tag: `ticket-${ticketKey}` }, 'assignment');
  });
  if (error) console.error('[conductor] notifyAssignment failed:', error);
}

//? Activation (07 §A step 3+5): when ticket(s) enter an `aiEnabled` stage, cut each
//? one's `DEV-####` git-worktree off the bare clone + freeze the baseline `commitHash`
//? (DH5). Docker-free — the container that mounts the worktree is a later slice. Skips
//? tickets that already have a branch (a re-move never re-freezes) and no-ops when no
//? repo is linked or the target stage is not AI-enabled. Best-effort per ticket: a git
//? failure is logged, never fails the authoritative stage move.
async function runStageActivation(workspaceId: string, projectId: string, keys: string[], stageId: string): Promise<void> {
  await runInTenant(workspaceId, async () => {
    const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, projectId, key: stageId }, select: { aiEnabled: true } });
    if (stage?.aiEnabled !== true) return;
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitConfig: true } });
    const gitCfg = normalizeGitConfig(workspace?.gitConfig ?? null);
    for (const key of keys) {
      const ticket = await prisma.ticket.findFirst({
        where: { workspaceId, projectId, key, stageId, archived: false, status: { notIn: ['done', 'paused', 'stuck'] } },
        select: { id: true, branch: true, title: true, labels: true, number: true },
      });
      if (!ticket || ticket.branch || !isLinked(workspaceId, projectId)) continue;
      const branchName = resolveBranchName(gitCfg, { key, title: ticket.title, labels: ticket.labels, number: ticket.number });
      //? Bare-repo/worktree git runs after the public writer returned. Only its bounded branch+HEAD
      //? result re-enters the Conductor, where current ticket/project/stage is revalidated.
      const [gitError, worktree] = await tryCatch(() => addWorktree(workspaceId, projectId, key, branchName));
      if (gitError || !worktree) {
        if (gitError) console.error(`[conductor] addWorktree ${key} failed:`, gitError);
        continue;
      }
      const { enqueueInternalAction } = await import('./internalOps');
      const [applyError, appliedAction] = await tryCatch(() => enqueueInternalAction({
        workspaceId,
        op: 'stage-activation-complete',
        target: { ticketId: ticket.id, ticketKey: key, projectId, stageId },
        payload: { branch: worktree.branch, commitHash: worktree.commitHash },
        userId: 'stage-runner',
        clientRequestId: `stage-activation:${ticket.id}:${worktree.commitHash}`,
      }));
      const applied = readStageActivationCompleteResult(appliedAction?.result);
      if (applyError || !applied?.applied) continue;
      await broadcastTicketDelta(prisma, workspaceId, applied.keys);
      void provisionContainers(workspaceId, [{ key, branch: worktree.branch }], stageId);
    }
  });
}

function activateWorktreesForStage(workspaceId: string, projectId: string, keys: string[], stageId: string): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  //? Schedule after the current public writer action returns, so no git/process/container work can
  //? inherit or hold its renewable workspace lease.
  setTimeout(() => {
    void tryCatch(() => runStageActivation(workspaceId, projectId, keys, stageId)).then(([error]) => {
      if (error) console.error(`[conductor] stage activation ${stageId} failed:`, error.message);
    });
  }, 0);
  return Promise.resolve();
}

//? Fire-and-forget autonomous stage execution for freshly-activated tickets (07 §A step
//? 6-7): launch the container + drive an in-container claude turn on the ticket. Gated on
//? the Docker daemon (a host without Docker still gets the full git/worktree layer). Each
//? ticket's turn runs concurrently; errors are logged, never surfaced into the stage move.
//? The keys of OPEN tickets that block `ticketId` via a TicketLink(rel:'blocks') pointing AT it.
//? A blocker counts as open unless archived / status 'done' / parked on the 'done' stage. Exported
//? for the blocks-gate integration test (the live path continues into a real container launch).
export async function openBlockersFor(db: PrismaClient, workspaceId: string, ticketId: string): Promise<string[]> {
  const blockLinks = await db.ticketLink.findMany({ where: { workspaceId, rel: 'blocks', targetTicketId: ticketId }, select: { ticketId: true } });
  if (blockLinks.length === 0) return [];
  const blockerRows = await db.ticket.findMany({ where: { workspaceId, id: { in: blockLinks.map((b) => b.ticketId) } }, select: { key: true, status: true, stageId: true, archived: true } });
  return blockerRows.filter((b) => !b.archived && b.status !== 'done' && b.stageId !== 'done').map((b) => b.key);
}

//? Re-fire an autonomous turn for a ticket at its CURRENT stage, if that stage is aiEnabled and
//? the ticket is activated (has a branch). Used by `resume` — `activateWorktreesForStage` skips
//? already-branched tickets, so a resumed ticket is re-provisioned directly here.
export async function resolveReprovisionTarget(db: PrismaClient, workspaceId: string, key: string) {
  const ticket = await db.ticket.findFirst({
    where: { workspaceId, key, archived: false, status: { notIn: ['done', 'paused', 'stuck'] } },
    select: { stageId: true, branch: true, projectId: true },
  });
  if (!ticket?.branch) return null;
  const stage = await db.pipelineStage.findFirst({ where: { workspaceId, projectId: ticket.projectId, key: ticket.stageId }, select: { aiEnabled: true } });
  return stage?.aiEnabled === true ? { key, branch: ticket.branch, stageId: ticket.stageId, projectId: ticket.projectId } : null;
}

export type ProvisionStatus = 'completed' | 'duplicate' | 'queued' | 'skipped' | 'unavailable';
export interface ProvisionResult { key: string; status: ProvisionStatus }
export interface ProvisionDependencies { dockerAvailable?: typeof dockerAvailable }

async function reprovisionResolvedTicket(workspaceId: string, key: string, resume: boolean, resumePrompt: string | undefined, waitForRun: boolean): Promise<boolean> {
  return runInTenant(workspaceId, async () => {
    const target = await resolveReprovisionTarget(prisma, workspaceId, key);
    if (!target) return false;
    const run = provisionContainers(workspaceId, [{ key: target.key, branch: target.branch }], target.stageId, resume, resumePrompt);
    if (!waitForRun) {
      void tryCatch(() => run);
      return true;
    }
    const results = await run;
    return results.some((result) => result.key === key && (result.status === 'completed' || result.status === 'duplicate'));
  });
}

export async function reprovisionTicket(workspaceId: string, key: string, resume = false, resumePrompt?: string): Promise<void> {
  await reprovisionResolvedTicket(workspaceId, key, resume, resumePrompt, false);
}

//? Recovery waits for an honest provisioning outcome. `true` still requires the caller to
//? prove the exact higher-fence AgentSession; queued/unavailable admission is always false.
export function reprovisionTicketAndWait(workspaceId: string, key: string, resume = false, resumePrompt?: string): Promise<boolean> {
  return reprovisionResolvedTicket(workspaceId, key, resume, resumePrompt, true);
}

async function writeStageDefer(
  workspaceId: string,
  target: StageDeferUpdateInternalAction['target'],
  payload: StageDeferUpdateInternalAction['payload'],
): Promise<void> {
  const { enqueueInternalAction } = await import('./internalOps');
  const [error, applied] = await tryCatch(() => enqueueInternalAction({
    workspaceId,
    op: 'stage-defer-update',
    target,
    payload,
    userId: 'stage-runner',
    clientRequestId: `stage-defer:${target.ticketId}:${randomUUID()}`,
  }));
  if (!error && applied && stageActionPersisted(applied.result, target.ticketKey)) {
    await broadcastTicketDelta(prisma, workspaceId, stageActionResultKeys(applied.result));
  }
}

export async function provisionContainers(
  workspaceId: string,
  activated: { key: string; branch: string }[],
  stageId: string,
  resume = false,
  resumePrompt?: string,
  dependencies: ProvisionDependencies = {},
): Promise<ProvisionResult[]> {
  return runInTenant(workspaceId, async () => {
    const dockerReady = await (dependencies.dockerAvailable ?? dockerAvailable)();
    //? Pause (C2): pause-all halts ALL autonomous provisioning for the workspace.
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { paused: true } });
    if (ws?.paused === true) {
      console.log('[conductor] provisioning skipped — workspace paused');
      return activated.map(({ key }) => ({ key, status: 'skipped' as const }));
    }
    //? Metered-budget enforcement blocks only NEW autonomous turns.
    if (await isSpendEnforcementActive(prisma, workspaceId)) {
      console.log('[conductor] provisioning skipped — metered budget cap reached');
      return activated.map(({ key }) => ({ key, status: 'skipped' as const }));
    }
    const runs: Promise<ProvisionResult>[] = [];
    for (const { key } of activated) {
      const run = tryCatch(async (): Promise<ProvisionResult> => {
        const ticket = await prisma.ticket.findFirst({
          where: { workspaceId, key, archived: false, status: { notIn: ['done', 'paused', 'stuck'] } },
          select: { id: true, status: true, priority: true, projectId: true, stageId: true },
        });
        if (ticket?.stageId !== stageId) return { key, status: 'skipped' };
        const target = { ticketId: ticket.id, ticketKey: key, projectId: ticket.projectId, stageId };

        if (!dockerReady) {
          const queued = await enqueueDeferred({ workspaceId, key, stageId });
          await writeStageDefer(workspaceId, target, { mode: 'set', reason: 'capacity', blockers: [] });
          console.warn(`[conductor] runStage ${key}@${stageId} deferred — Docker unavailable${queued ? ' (queued)' : ''}`);
          return { key, status: queued ? 'queued' : 'unavailable' };
        }
        if (ticket.priority !== 'urgent') {
          const blockers = await openBlockersFor(prisma, workspaceId, ticket.id);
          if (blockers.length > 0) {
            console.log(`[conductor] runStage ${key}@${stageId} skipped — blocked by ${blockers.join(', ')}`);
            await writeStageDefer(workspaceId, target, { mode: 'set', reason: 'blocked', blockers });
            return { key, status: 'skipped' };
          }
        }
        if (await isEditorRunning(workspaceId, key)) {
          console.warn(`[conductor] runStage ${key}@${stageId} skipped — a live editor is open (edit-lock)`);
          await writeStageDefer(workspaceId, target, { mode: 'set', reason: 'editor', blockers: [] });
          return { key, status: 'skipped' };
        }

        const acquired = await acquireSlot(key, workspaceId, ticket.priority === 'urgent', Date.now());
        if (!acquired.acquired) {
          //? A duplicate may already be the successor; the recovery caller proves its exact
          //? higher token/fence before reporting success.
          if (acquired.reason === 'duplicate') {
            console.log(`[conductor] runStage ${key}@${stageId} skipped — duplicate turn already active`);
            return { key, status: 'duplicate' };
          }
          const queued = await enqueueDeferred({ workspaceId, key, stageId });
          console.log(`[conductor] runStage ${key}@${stageId} deferred — capacity ${acquired.reason}${queued ? ' (queued)' : ''}`);
          await writeStageDefer(workspaceId, target, { mode: 'set', reason: 'capacity', blockers: [] });
          return { key, status: queued ? 'queued' : 'unavailable' };
        }

        await writeStageDefer(workspaceId, target, { mode: 'clear', reason: 'capacity', blockers: [] });
        const [runError, outcome] = await tryCatch(() => withReservationRenewal(acquired.reservation, (reservationGuard) => runStage(workspaceId, key, stageId, {
          runToken: acquired.reservation.runToken,
          runFence: acquired.reservation.fence,
          reservationGuard,
          resume,
          ...(resumePrompt === undefined ? {} : { resumePrompt }),
        })));
        //? Owner-checked release: after TTL expiry an old run cannot remove a successor's
        //? reservation. Drain only when THIS exact reservation actually freed capacity.
        const released = await releaseSlot(acquired.reservation);
        if (released) void drainCapacityQueue();
        if (runError || outcome?.ok !== true) {
          const failure = outcome?.error ?? runError?.message;
          if (!shouldRetryStageFailure(failure)) {
            if (runError) console.error(`[conductor] runStage ${key}@${stageId} failed:`, runError.message);
            return { key, status: 'skipped' };
          }
          const queued = await enqueueDeferred({ workspaceId, key, stageId });
          await writeStageDefer(workspaceId, target, { mode: 'set', reason: 'capacity', blockers: [] });
          if (runError) console.error(`[conductor] runStage ${key}@${stageId} failed:`, runError.message);
          return { key, status: queued ? 'queued' : 'unavailable' };
        }
        return { key, status: 'completed' };
      }).then(async ([error, result]) => {
        if (!error && result) return result;
        if (error) console.error(`[conductor] runStage ${key}@${stageId} failed:`, error.message);
        const queued = await enqueueDeferred({ workspaceId, key, stageId });
        return { key, status: queued ? 'queued' as const : 'unavailable' as const };
      });
      runs.push(run);
    }
    return Promise.all(runs);
  });
}

//? Release-driven drain is the fast path; this leader-scheduled backstop also evicts
//? expired reservations and continuously skips stale queued targets after crashes.
export const CAPACITY_DRAIN_MS = Number(process.env.WS_CAPACITY_DRAIN_MS ?? '10000');

//? Pull the next capacity-deferred turn off the fair queue and re-provision it at its CURRENT
//? stage (it may have moved since it was parked). No-op when the queue is empty or the ticket is
//? no longer activated (moved/archived/done/paused). Atomic dequeue remains in capacity.ts Lua.
export async function resolveCapacityDeferredTarget(item: { workspaceId: string; key: string; stageId: string }): Promise<{ branch: string; stageId: string } | null> {
  return runInTenant(item.workspaceId, async () => {
    const ticket = await prisma.ticket.findFirst({
      where: {
        workspaceId: item.workspaceId,
        key: item.key,
        archived: false,
        status: { notIn: ['done', 'paused', 'stuck'] },
      },
      select: { branch: true, stageId: true },
    });
    return ticket?.branch ? { branch: ticket.branch, stageId: ticket.stageId } : null;
  });
}

export interface CapacityDrainDependencies {
  inFlight?: () => Promise<Record<string, number>>;
  resolve?: typeof resolveCapacityDeferredTarget;
  provision?: (workspaceId: string, activated: { key: string; branch: string }[], stageId: string) => Promise<void>;
}

export async function drainCapacityQueue(dependencies: CapacityDrainDependencies = {}): Promise<void> {
  //? Keep consuming after stale DB targets. One dead queue head must never strand a
  //? valid successor; one freed slot still starts at most one valid turn.
  const inFlight = dependencies.inFlight ?? (() => inFlightByWorkspace(Date.now()));
  const resolve = dependencies.resolve ?? resolveCapacityDeferredTarget;
  const resolved = await dequeueDeferredUntil(await inFlight(), resolve);
  if (!resolved) return;
  const provision = dependencies.provision ?? provisionContainers;
  await provision(
    resolved.item.workspaceId,
    [{ key: resolved.item.key, branch: resolved.value.branch }],
    resolved.value.stageId,
  );
}

//? The single-writer chains. Login-only ops share ONE global in-process chain; workspace-scoped
//? ops each serialise on their OWN in-process chain (`wsChains`, one entry per workspace, so
//? unrelated workspaces run in parallel — no head-of-line blocking) AND, inside it, hold the
//? cross-instance workspace lease. Multi-instance-safe: see server/orchestrator/cluster.ts.
let globalChain: Promise<unknown> = Promise.resolve();
const wsChains = new Map<string, Promise<unknown>>();

export interface ConductorRouteWrite {
  kind: string;
  userId: string;
  clientRequestId?: string;
}

//? Migration seam for legacy typed routes whose writes predate the control-op split. The route still owns
//? validation/RBAC, but the callback executes only inside the Conductor's serial writer context. Workspace
//? writes additionally hold the cross-instance lease, runInTenant and append/complete a durable signal.
//? New domain writes should prefer a typed ControlOp/InternalOp; this seam exists to eliminate direct writers
//? without inventing public AI verbs for account/PAT/Studio route internals.
export async function enqueueWorkspaceRouteWrite<T>(
  workspaceId: string,
  request: ConductorRouteWrite,
  write: () => Promise<T>,
): Promise<T> {
  if (!workspaceId || !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(request.kind)) throw new Error('[conductor] invalid route-write identity');
  const activeScope = currentWriterScope();
  if (activeScope !== null) {
    assertWriterContext(workspaceId);
    return write();
  }
  let result: T | undefined;
  const previous = wsChains.get(workspaceId) ?? Promise.resolve();
  const actionPromise = previous.then(() => withWorkspaceLease(workspaceId, async (lease) => {
    await runInTenant(workspaceId, async () => {
      await runInWriterContext(workspaceId, async () => {
        lease.assertHeld();
        // luckystack-allow tenant-scope: creation includes workspaceId in data and executes inside runInTenant; create has no where clause.
        const signal = await prisma.workspaceSignal.create({
          data: {
            workspaceId,
            seq: await nextSignalSeq(workspaceId),
            kind: `route.${request.kind}`,
            payload: jsonInput({ userId: request.userId, clientRequestId: request.clientRequestId ?? randomUUID() }),
          },
          select: { id: true },
        });
        lease.assertHeld();
        result = await write();
        lease.assertHeld();
        await markWorkspaceSignalProcessed(workspaceId, signal.id);
      }, lease, `route:${request.kind}:${request.clientRequestId ?? randomUUID()}`);
    });
  }));
  wsChains.set(workspaceId, actionPromise.catch((error: unknown) => { console.error(`[conductor] route write ${request.kind} failed:`, error); }));
  await actionPromise;
  if (result === undefined) throw new Error('[conductor] route write completed without a result');
  return result;
}

//? A handled action may reject without throwing (for example a failed provider operation).
//? Transport callers treat that as a failed ACK while successful `void` results remain valid.
export function isControlActionFailure(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'ok' in result && result.ok === false;
}

function writerActionWasApplied(result: unknown): boolean {
  if (isControlActionFailure(result)) return false;
  if (typeof result === 'object' && result !== null && 'applied' in result) return result.applied === true;
  return true;
}

async function markWorkspaceSignalProcessed(workspaceId: string, signalId: string): Promise<void> {
  const marked = await prisma.workspaceSignal.updateMany({
    where: { workspaceId, id: signalId },
    data: { processedAt: new Date() },
  });
  if (marked.count === 1) return;

  //? Zero rows updated means the signal row is GONE, not that marking it failed — the workspace was
  //? deleted while this action was still in flight. That is a benign lost race (there is nothing left to
  //? mark, and nothing left to act on), and throwing turned it into a stack trace plus a failed action.
  //?
  //? The distinction matters: a real marking failure must stay loud, because an unmarked signal gets
  //? REPLAYED. So check whether the row still exists before deciding which of the two this is — and if it
  //? does exist, keep throwing.
  const stillThere = await prisma.workspaceSignal.findFirst({ where: { workspaceId, id: signalId }, select: { id: true } });
  if (stillThere) throw new Error('[conductor] durable signal could not be marked processed');
  console.log(`[conductor] signal ${signalId} vanished before it could be marked (workspace ${workspaceId} deleted mid-flight) — nothing to do`);
}

export interface EnqueuedControlAction {
  signalSeq: number;
  result?: unknown;
}

export type ControlActionEnqueueErrorCode = ControlActionFailureCode | 'control.pending';

//? Stable, scrubbed codes are the only failure detail replayed through Redis. Raw Prisma/provider/
//? lease errors never become part of the cross-instance idempotency record or the client ACK.
export class ControlActionEnqueueError extends Error {
  constructor(public readonly code: ControlActionEnqueueErrorCode) {
    super(code);
    this.name = 'ControlActionEnqueueError';
  }
}

export type WorkspaceLeaseRunner = <T>(
  workspaceId: string,
  fn: (guard: WorkspaceLeaseGuard) => Promise<T>,
) => Promise<T>;
export interface EnqueueControlActionOptions {
  workspaceLease?: WorkspaceLeaseRunner;
}

function controlActionResultKeys(result: unknown): string[] {
  if (typeof result !== 'object' || result === null || !('keys' in result)) return [];
  return boundedControlActionResultKeys(result.keys);
}

function replayTerminalControlAction(outcome: ControlActionTerminalOutcome): EnqueuedControlAction {
  if (outcome.state === 'failure') throw new ControlActionEnqueueError(outcome.errorCode);
  return outcome.resultKeys && outcome.resultKeys.length > 0
    ? { signalSeq: outcome.signalSeq, result: { keys: [...outcome.resultKeys] } }
    : { signalSeq: outcome.signalSeq };
}

//? A same-workspace enqueue made while executeAction is already running cannot wait on its own wsChains
//? tail or reacquire its own lease. It still performs the complete claimed action protocol, but reuses the
//? active tenant/writer/renewable-lease boundary. No exported direct-execute bypass is introduced.
async function executeReentrantWriterAction(action: WriterAction): Promise<EnqueuedControlAction> {
  const workspaceId = action.workspaceId;
  if (!workspaceId) throw new ControlActionEnqueueError('control.executionFailure');
  assertWriterContext(workspaceId);
  if (currentWorkspaceId() !== workspaceId) throw new Error('[conductor] reentrant action tenant does not match the writer workspace');

  const signalPayload = writerSignalPayload(action);
  const signalId = writerSignalId(action);
  const signal = await appendWriterSignal(
    action,
    signalPayload,
    signalId,
    () => { assertWriterLeaseHeld(workspaceId); },
  );
  const signalSeq = signal.seq;
  assertWriterLeaseHeld(workspaceId); // before authoritative action execution
  const result = await executeAction(action);
  if (action.op !== 'delete-workspace' && writerActionWasApplied(result)) {
    assertWriterLeaseHeld(workspaceId);
    await markWorkspaceSignalProcessed(workspaceId, signal.id);
  }
  assertWriterLeaseHeld(workspaceId); // before successful completion / ACK outcome
  return { signalSeq, result };
}

//? Run an already-claimed public or internal action through the original serial queues. Keeping the
//? lease runner injectable makes lease-failure verification instant while production stays identical.
async function enqueueClaimedWriterAction(
  action: WriterAction,
  options: EnqueueControlActionOptions,
  dedupKey: string,
): Promise<EnqueuedControlAction> {
  //? Login-only public ops (create-workspace / accept-invite) carry NO workspace yet. They share the
  //? renewable global lease with typed account/import jobs, so multiple app instances still expose one
  //? authoritative global writer rather than one in-process chain per instance.
  if (!action.workspaceId) {
    let result: unknown;
    const runGlobalLease = options.workspaceLease ?? withWorkspaceLease;
    const actionPromise = globalChain.then(() => runGlobalLease(GLOBAL_WRITER_SCOPE, async (lease) => {
      result = await runInWriterContext(GLOBAL_WRITER_SCOPE, () => executeAction(action), lease, dedupKey);
      lease.assertHeld();
    }));
    //? Keep the queue tail recovered for later actions, but await the UNRECOVERED action promise
    //? below so this caller observes execute failures instead of receiving a false-success ACK.
    globalChain = actionPromise.catch((error: unknown) => {
      console.error(`[conductor] action ${action.op} failed:`, error);
    });
    //? AWAIT the write before returning so the caller's post-ack refetch reliably sees it. Serial
    //? ordering is preserved: `actionPromise` settles after all prior queued global actions + this one.
    await actionPromise;
    return { signalSeq: -1, result };
  }

  //? Workspace-scoped: queue on this workspace's in-process chain, and inside it hold the
  //? cross-instance lease while allocating the seq, appending the durable (append-only, B-O6)
  //? signal, and running the authoritative write. This excludes contenders while ownership is observed;
  //? it is not atomic Redis↔Mongo fencing (event-loop/in-flight-write residuals: ADR 0277).
  const workspaceId = action.workspaceId;
  const activeWriterScope = currentWriterScope();
  if (activeWriterScope !== null) {
    assertWriterContext(workspaceId);
    return runInWriterContext(workspaceId, () => executeReentrantWriterAction(action), undefined, dedupKey);
  }

  const signalPayload = writerSignalPayload(action);
  const signalId = writerSignalId(action);
  const runWorkspaceLease = options.workspaceLease ?? withWorkspaceLease;
  let result: unknown;
  let signalSeq = -1;
  const prev = wsChains.get(workspaceId) ?? Promise.resolve();
  const actionPromise = prev.then(() => runWorkspaceLease(workspaceId, async (lease) => {
    //? Renewable-lease checkpoints bracket every irreversible boundary. They fail the caller closed
    //? after an observed lease loss; `lease.signal` is also available to future abort-aware actions.
    await runInTenant(workspaceId, async () => {
      const signal = await appendWriterSignal(action, signalPayload, signalId, () => { lease.assertHeld(); });
      signalSeq = signal.seq;
      lease.assertHeld(); // before authoritative action execution
      result = await runInWriterContext(workspaceId, () => executeAction(action), lease, dedupKey);
      //? delete-workspace intentionally cascades its own WorkspaceSignal before this point;
      //? there is no surviving row to mark and successful deletion must not become a false failure.
      if (action.op !== 'delete-workspace' && writerActionWasApplied(result)) {
        lease.assertHeld();
        await markWorkspaceSignalProcessed(workspaceId, signal.id);
      }
      lease.assertHeld(); // before successful completion / ACK outcome
    });
  }));
  //? Recover only the stored queue tail: a failed lease/write must not poison later actions, while
  //? the original action promise stays rejected so its caller cannot report success.
  wsChains.set(workspaceId, actionPromise.catch((error: unknown) => {
    console.error(`[conductor] action ${action.op} failed:`, error);
  }));
  //? AWAIT completion so the route responds only AFTER the write lands, and so the realtime
  //? `_sync` route can broadcast the write's delta (`result`). Serial-safe per workspace.
  await actionPromise;

  return { signalSeq, result };
}

async function enqueueWriterAction(
  action: WriterAction,
  writerKind: WriterActionKind,
  options: EnqueueControlActionOptions,
): Promise<EnqueuedControlAction> {
  if (writerKind === 'internal' && !action.workspaceId) {
    throw new ControlActionEnqueueError('control.executionFailure');
  }
  const activeWriterScope = currentWriterScope();
  if (activeWriterScope !== null) {
    //? Only a leased, tenant-matching workspace execute boundary may reenter. Global nesting remains
    //? unsupported, and a different workspace fails before it can claim a dedup key.
    if (!action.workspaceId) throw new ControlActionEnqueueError('control.executionFailure');
    assertWriterContext(action.workspaceId);
    if (currentWorkspaceId() !== action.workspaceId) throw new Error('[conductor] nested action tenant does not match the writer workspace');
    assertWriterLeaseHeld(action.workspaceId);
  }
  //? Workspace-scoped public/internal keys stay rollout-compatible. Login-only public actions cannot:
  //? the old `:${clientRequestId}` key let two authenticated users share one terminal outcome. The new
  //? user-scoped namespace may re-execute one retry across a rolling deploy, but security wins over
  //? replay compatibility at this boundary.
  let dedupKey: string;
  if (writerKind === 'internal') dedupKey = `internal:${action.workspaceId}:${action.clientRequestId}`;
  else if (action.workspaceId) dedupKey = `${action.workspaceId}:${action.clientRequestId}`;
  else dedupKey = `global:${action.userId}:${action.clientRequestId}`;
  //? A nested replay of any active ancestor key is self-wait: its pending outcome cannot settle until
  //? this call returns. Reject before Redis claim/poll so it never burns the 2s pending wait. Public and
  //? internal namespaces remain intentionally distinct even when the raw request id is identical.
  if (hasActiveWriterDedupKey(dedupKey)) throw new ControlActionEnqueueError('control.pending');
  const claim = await claimControlAction(dedupKey);
  if (claim.state === 'success' || claim.state === 'failure') {
    return replayTerminalControlAction(claim);
  }
  if (claim.state === 'pending') {
    const outcome = await waitForControlActionOutcome(dedupKey);
    if (outcome.state === 'pending') throw new ControlActionEnqueueError('control.pending');
    return replayTerminalControlAction(outcome);
  }

  const [executionError, enqueued] = await tryCatch(() => enqueueClaimedWriterAction(action, options, dedupKey));
  if (executionError || !enqueued) {
    const repairableInternal = writerKind === 'internal'
      && (action.op === 'stage-turn-complete'
        || action.op === 'stage-handoff-complete'
        || action.op === 'ci-public-complete'
        || action.op === 'agent-recovery-transition'
        || action.op === 'watchdog-reminder-apply');
    //? Deterministic row ids + ledger recomputation make these partial multi-write
    //? applies repairable. Do not fossilize a crash as terminal failure.
    await (repairableInternal
      ? abandonControlAction(dedupKey, claim.token)
      : completeControlAction(dedupKey, claim.token, {
        state: 'failure',
        errorCode: 'control.executionFailure',
      }));
    throw new ControlActionEnqueueError('control.executionFailure');
  }
  if (isControlActionFailure(enqueued.result)) {
    await completeControlAction(dedupKey, claim.token, {
      state: 'failure',
      errorCode: 'control.semanticFailure',
    });
    return enqueued;
  }
  const resultKeys = controlActionResultKeys(enqueued.result);
  await completeControlAction(dedupKey, claim.token, {
    state: 'success',
    signalSeq: enqueued.signalSeq,
    ...(resultKeys.length > 0 ? { resultKeys } : {}),
  });
  //? Realtime convergence: a coarse "workspace changed" nudge to the whole room after every successfully
  //? drained PUBLIC control write, so EVERY member converges — not just the initiator (which closes the
  //? ~25 cold settings/infra ops that were initiator-only). Hot ticket paths carry their own targeted
  //? deltas and are skipped (WORKSPACE_DIRTY_SKIP) so board dragging never triggers a redundant full
  //? refetch. Default = fire, so a forgotten/new op is live-for-all by construction; the skip set is a pure
  //? optimization. Best-effort + synchronous (no-op without an io); delete-workspace emits its own `gone`
  //? eviction signal from its case, so it is skipped here.
  if (writerKind === 'public' && action.workspaceId && !WORKSPACE_DIRTY_SKIP.has(action.op)) {
    broadcastWorkspaceDirty(action.workspaceId);
  }
  return enqueued;
}

//? Ops that already push their own fine-grained realtime delta (the ticket hot paths merge the `_sync`
//? serverOutput by id via a client callback) — firing the coarse workspaceDirty for them too would add a
//? redundant full refetch during high-churn board interaction. delete-workspace is here because its case
//? fires the explicit `gone` eviction broadcast instead. Everything NOT listed converges via workspaceDirty.
const WORKSPACE_DIRTY_SKIP = new Set<string>([
  'quick-add', 'ticket-edit', 'add-comment', 'archive',
  'bulk-move', 'bulk-status', 'bulk-assign', 'bulk-sprint', 'bulk-archive',
  'answer-input', 'delete-workspace',
]);

//? Public control entry point: compile-time restricted to client-visible ControlOp.
export function enqueueControlAction(
  action: ControlAction,
  options: EnqueueControlActionOptions = {},
): Promise<EnqueuedControlAction> {
  return enqueueWriterAction(action, 'public', options);
}

//? Server-only bridge used by internalOps.ts; it cannot accept a public ControlAction.
export function enqueueInternalWriterAction(
  action: InternalAction,
  options: EnqueueControlActionOptions = {},
): Promise<EnqueuedControlAction> {
  return enqueueWriterAction(action, 'internal', options);
}

//? DESIGN_DOCS_PROGRAM 1.2 — extract an uploaded file's text OUTSIDE the write lock (a container parse can
//? take seconds/minutes), then enqueue the server-only writer op that persists it onto the asset + indexes
//? it into RAG. Fire-and-forget from document-edit so the attach op returns immediately (asset is pending).
async function extractDocumentAssetText(workspaceId: string, documentId: string, url: string, userId: string): Promise<void> {
  //? F35 — the intent is DURABLE before the work starts. A crash mid-parse used to strand the asset at
  //? `pending` with nothing to retry it; now a row exists that the recovery sweep can find and re-drive.
  const jobId = await enqueueExtractJob(prisma, { workspaceId, documentId, url, userId });
  if (jobId !== null && !(await claimExtractJob(prisma, jobId))) return;   //? another instance has it
  const [error, parsed] = await tryCatch(() => extractUploadText(url));
  const { enqueueInternalAction } = await import('./internalOps');
  await enqueueInternalAction({
    workspaceId, op: 'document-set-asset-text', userId,
    target: { documentId }, payload: { url, text: parsed?.text ?? '', status: parsed?.status ?? 'failed' },
    clientRequestId: `docasset-${randomUUID()}`,
  });
  if (jobId !== null) {
    const ok = !error && parsed?.status === 'ok';
    await completeExtractJob(prisma, jobId, { ok, ...(error ? { error: error.message } : {}) });
  }
}

//? F35 — the recovery half: re-drive extractions whose process died. Runs on the same leader loop as the
//? other sweeps; each job is re-entered inside its own workspace's tenant scope.
export async function runExtractRecovery(): Promise<{ revived: number }> {
  const stale = await reclaimStaleExtractJobs(prisma);
  for (const job of stale) {
    await tryCatch(() => withTenant(job.workspaceId, 'documents.extractRecovery', () => extractDocumentAssetText(job.workspaceId, job.documentId, job.url, job.userId)));
  }
  return { revived: stale.length };
}

export const ROUTE_JOB_RECOVERY_MS = Math.max(60_000, Number(process.env.WS_ROUTE_JOB_RECOVERY_MIN ?? '1') * 60_000);
const ROUTE_JOB_STALE_MS = 30_000;

//? Typed route completions persist their complete bounded action in WorkspaceSignal before execution.
//? This leader-only sweep reconstructs an action after a process crash and replays it under the normal
//? tenant lease/writer context. Every allow-listed handler is idempotent (deterministic create, CAS or upsert).
export async function runRouteJobRecovery(now = Date.now()): Promise<{ replayed: number; superseded: number; failed: number }> {
  // luckystack-allow tenant-scope: leader discovery intentionally scans pending signals across workspaces; every row re-enters its own tenant lease before apply.
  const rows = await prisma.workspaceSignal.findMany({
    where: {
      OR: [{ processedAt: null }, { processedAt: { isSet: false } }],
      kind: { in: [...CRASH_REPLAYABLE_INTERNAL_OPS] },
      createdAt: { lte: new Date(now - ROUTE_JOB_STALE_MS) },
    },
    select: { id: true, workspaceId: true, seq: true, kind: true, payload: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  let replayed = 0;
  let superseded = 0;
  let failed = 0;
  for (const row of rows) {
    const action = internalActionFromSignal(row);
    const replayKeys = action ? internalActionReplayKeys(action) : [];
    if (!action || !CRASH_REPLAYABLE_INTERNAL_OPS.includes(action.op) || replayKeys.length === 0) {
      failed += 1;
      continue;
    }
    const previous = wsChains.get(row.workspaceId) ?? Promise.resolve();
    const replay = previous.then(() => withWorkspaceLease(row.workspaceId, async (lease) => {
      await runInTenant(row.workspaceId, async () => {
        // luckystack-allow tenant-scope: this plain query explicitly binds both the signal id and row.workspaceId inside that tenant's runInTenant boundary.
        const pending = await prisma.workspaceSignal.findFirst({
          where: { id: row.id, workspaceId: row.workspaceId, OR: [{ processedAt: null }, { processedAt: { isSet: false } }] },
          select: { id: true },
        });
        if (!pending) return;
        //? A process can restart, accept a newer write, and only then reach this sweep. Never let the old
        //? completion overwrite that newer state. Read the earliest bounded window of later processed
        //? internal signals; if the window overflows, fail conservatively by treating the old job as stale.
        // luckystack-allow tenant-scope: the supersession scan explicitly constrains row.workspaceId inside runInTenant and the renewable workspace lease.
        const later = await prisma.workspaceSignal.findMany({
          where: { workspaceId: row.workspaceId, seq: { gt: row.seq }, kind: { in: [...INTERNAL_OP_NAMES] }, processedAt: { not: null } },
          select: { workspaceId: true, kind: true, payload: true },
          orderBy: { seq: 'asc' },
          take: 5001,
        });
        const replayKeySet = new Set(replayKeys);
        const hasNewerEntityWrite = later.length > 5000 || later.some((candidate) => {
          const laterAction = internalActionFromSignal(candidate);
          return laterAction !== null && internalActionReplayKeys(laterAction).some((key) => replayKeySet.has(key));
        });
        if (hasNewerEntityWrite) {
          lease.assertHeld();
          await markWorkspaceSignalProcessed(row.workspaceId, row.id);
          superseded += 1;
          return;
        }
        const result = await runInWriterContext(row.workspaceId, async () => {
          lease.assertHeld();
          return executeAction(action);
        }, lease, `replay:${row.id}`);
        lease.assertHeld();
        if (writerActionWasApplied(result) || isControlActionFailure(result)) {
          await markWorkspaceSignalProcessed(row.workspaceId, row.id);
        }
        replayed += 1;
      });
    }));
    wsChains.set(row.workspaceId, replay.catch((error: unknown) => { console.error(`[conductor] route job replay ${row.id} failed:`, error); }));
    const [replayError] = await tryCatch(() => replay);
    if (replayError) failed += 1;
  }
  return { replayed, superseded, failed };
}

//? SEC1/SEC2 (COMPLETION FASE SEC) — RBAC-hardening helpers. Positional capability indices
//? mirror `server/control/rbac.ts` CAP (promoteAdmin=5, demoteAdmin=6, ownerActions=7).
const CAP_PROMOTE_ADMIN = 5;
const CAP_DEMOTE_ADMIN = 6;
//? A role is "admin-tier" when it holds any of the promote/demote/owner capabilities.
function isAdminTierPerms(perms: boolean[]): boolean {
  return perms[CAP_PROMOTE_ADMIN] === true || perms[CAP_DEMOTE_ADMIN] === true || perms[7] === true;
}
//? The acting member's capability row (null when the actor is not a member — reject-by-default).
async function actorPerms(workspaceId: string, userId: string): Promise<boolean[] | null> {
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId }, select: { roleKey: true } });
  if (!member) return null;
  const role = await prisma.workspaceRole.findFirst({ where: { workspaceId, key: member.roleKey }, select: { perms: true } });
  return role?.perms ?? null;
}

//? The public+internal writer dispatch. Workspace actions run inside runInTenant + the renewable
//? workspace lease; login-only tenant bootstrap runs in the serialized global writer scope.
async function executeAction(action: WriterAction): Promise<unknown> {
  const writerScope = action.workspaceId || GLOBAL_WRITER_SCOPE;
  assertWriterContext(writerScope);
  if (action.workspaceId && currentWorkspaceId() !== action.workspaceId) {
    throw new Error('[conductor] writer tenant context does not match the action workspace');
  }
  if (action.op === 'stage-activation-complete') return applyStageActivationComplete(prisma, action.workspaceId, action);
  if (action.op === 'stage-session-start') return applyStageSessionStart(prisma, action.workspaceId, action);
  if (action.op === 'stage-session-update') return applyStageSessionUpdate(prisma, action.workspaceId, action);
  if (action.op === 'stage-tool-trail-append') return applyStageToolTrailAppend(prisma, action.workspaceId, action);
  if (action.op === 'stage-turn-complete') return applyStageTurnComplete(prisma, action.workspaceId, action);
  if (action.op === 'stage-handoff-complete') return applyStageHandoffComplete(prisma, action.workspaceId, action);
  if (action.op === 'stage-forge-prepare') return applyStageForgePrepare(prisma, action.workspaceId, action);
  if (action.op === 'stage-forge-complete') return applyStageForgeComplete(prisma, action.workspaceId, action);
  if (action.op === 'stage-defer-update') return applyStageDeferUpdate(prisma, action.workspaceId, action);
  if (action.op === 'agent-recovery-transition') return applyAgentRecoveryTransition(prisma, action.workspaceId, action);
  if (action.op === 'watchdog-reminder-apply') return applyWatchdogReminder(prisma, action.workspaceId, action);
  if (action.op === 'studio-artifact-begin') {
    if (!isArtifactKind(action.payload.kind)) return { ok: false, error: 'studio.invalidKind' };
    const begun = await beginArtifact(prisma, {
      workspaceId: action.workspaceId,
      briefId: action.target.briefId,
      kind: action.payload.kind,
      ...(action.payload.tweak ? { tweak: action.payload.tweak } : {}),
    }, { artifactId: action.target.artifactId });
    return begun.ok ? { keys: [action.target.artifactId], artifactId: action.target.artifactId } : begun;
  }
  if (action.op === 'studio-artifact-complete') {
    if (!isArtifactKind(action.payload.kind)) return { ok: false, error: 'studio.invalidKind' };
    const changed = await completeArtifact(prisma, action.target.artifactId, {
      workspaceId: action.workspaceId,
      briefId: action.target.briefId,
      kind: action.payload.kind,
    }, {
      status: action.payload.status,
      ...(action.payload.title === undefined ? {} : { title: action.payload.title }),
      ...(action.payload.content === undefined ? {} : { content: asJsonValue(action.payload.content) }),
      ...(action.payload.providerId === undefined ? {} : { providerId: action.payload.providerId }),
      ...(action.payload.error === undefined ? {} : { error: action.payload.error }),
    });
    return { applied: true, changed, keys: [action.target.artifactId] };
  }
  if (action.op === 'project-docs-complete') {
    const cas = await applyEntityCas(prisma, {
      workspaceId: action.workspaceId, entityKey: ENTITY_VERSION_KEYS.projectDocs,
      expectedVersion: action.target.expectedVersion ?? 0, requestId: action.clientRequestId,
      contentHash: createHash('sha256').update(action.payload.content).digest('hex'),
    }, () => persistProjectDoc(prisma, { workspaceId: action.workspaceId, content: action.payload.content, summary: action.payload.summary }));
    return cas.applied ? { applied: true } : { ok: false, error: 'write.superseded' };
  }
  if (action.op === 'project-image-complete') {
    const project = await prisma.project.findFirst({ where: { workspaceId: action.workspaceId, id: action.target.projectId }, select: { id: true } });
    if (!project) return { ok: false, error: 'project.notFound' };
    const cas = await applyEntityCas(prisma, {
      workspaceId: action.workspaceId, entityKey: projectImageEntityKey(action.target.projectId),
      expectedVersion: action.target.expectedVersion ?? 0, requestId: action.clientRequestId,
      contentHash: createHash('sha256').update(action.payload.tag).digest('hex'),
    }, () => prisma.project.updateMany({ where: { workspaceId: action.workspaceId, id: action.target.projectId }, data: { baseImageRef: action.payload.tag } }));
    return cas.applied ? { applied: true } : { ok: false, error: 'write.superseded' };
  }
  if (action.op === 'brand-import') {
    const parsed = parseBrandKit(action.payload.kit);
    if (!parsed) return { ok: false, error: 'brand.invalidKit' };
    //? ADR 0310 — record WHERE this brand came from (a promoted artifact's title, or 'manual'), so
    //? the panel can say so and a silent overwrite by a stray artifact leaves a trace.
    if (action.payload.setFrom !== undefined) parsed.setFrom = action.payload.setFrom;
    const cas = await applyEntityCas(prisma, {
      workspaceId: action.workspaceId, entityKey: ENTITY_VERSION_KEYS.brandLibrary,
      expectedVersion: action.target.expectedVersion ?? 0, requestId: action.clientRequestId,
      contentHash: createHash('sha256').update(JSON.stringify(parsed)).digest('hex'),
    }, () => saveBrandLibrary(prisma, action.workspaceId, parsed));
    return cas.applied ? { applied: true } : { ok: false, error: 'write.superseded' };
  }
  if (action.op === 'style-import') {
    const parsed = parseStyleSet(action.payload.styles);
    const cas = await applyEntityCas(prisma, {
      workspaceId: action.workspaceId, entityKey: ENTITY_VERSION_KEYS.stylePresets,
      expectedVersion: action.target.expectedVersion ?? 0, requestId: action.clientRequestId,
      contentHash: createHash('sha256').update(JSON.stringify(parsed)).digest('hex'),
    }, () => importStyleSet(prisma, action.workspaceId, parsed));
    return cas.applied ? { applied: true, imported: cas.result ?? 0 } : { ok: false, error: 'write.superseded' };
  }
  if (action.op === 'dockerfile-save') {
    const project = await prisma.project.findFirst({ where: { workspaceId: action.workspaceId, id: action.target.projectId }, select: { id: true } });
    if (!project) return { ok: false, error: 'project.notFound' };
    const content = action.payload.dockerfile.trim();
    if (content.length === 0) return { ok: false, error: 'dockerfile.empty' };
    if (!extendsBase(content)) return { ok: false, error: 'dockerfile.invalidBase' };
    const cas = await applyEntityCas(prisma, {
      workspaceId: action.workspaceId, entityKey: dockerfileEntityKey(action.target.projectId),
      expectedVersion: action.target.expectedVersion ?? 0, requestId: action.clientRequestId,
      contentHash: createHash('sha256').update(content).digest('hex'),
    }, async () => {
      const saved = saveDockerfileDraft(action.workspaceId, action.target.projectId, content);
      if (saved.ok) await prisma.project.updateMany({ where: { workspaceId: action.workspaceId, id: action.target.projectId }, data: { dockerfilePath: '.workspaces/Dockerfile' } });
      return saved;
    });
    return cas.applied ? (cas.result ?? { ok: true }) : { ok: false, error: 'write.superseded' };
  }
  if (action.op === 'worktree-file-save') {
    const guard = await ticketEditGuard(prisma, action.workspaceId, action.target.ticketKey);
    if (!guard.allowed) return { ok: false, error: guard.reason ?? 'editor.locked' };
    if (!isSafeWorktreePath(action.payload.path)) return { ok: false, error: 'editor.pathInvalid' };
    const cas = await applyEntityCas(prisma, {
      workspaceId: action.workspaceId, entityKey: worktreeFileEntityKey(action.target.ticketKey, action.payload.path),
      expectedVersion: action.target.expectedVersion ?? 0, requestId: action.clientRequestId,
      contentHash: createHash('sha256').update(action.payload.content).digest('hex'),
    }, async () => {
      const saved = await writeWorktreeFile(action.workspaceId, action.target.ticketKey, action.payload.path, action.payload.content);
      if (!saved.ok) throw new Error(saved.error ?? 'editor.writeFailed');
      return saved;
    });
    return cas.applied ? (cas.result ?? { ok: true }) : { ok: false, error: 'write.superseded' };
  }
  if (action.op === 'chat-turn-record') {
    const identities = [
      { id: action.target.userMessageId, role: 'user', text: action.payload.userText },
      { id: action.target.aiMessageId, role: 'ai', text: action.payload.aiText },
    ];
    const existing = await prisma.workspaceChatMessage.findMany({ where: { id: { in: identities.map((entry) => entry.id) } } });
    for (const row of existing) {
      const expected = identities.find((entry) => entry.id === row.id);
      if (!expected || row.workspaceId !== action.workspaceId || row.userId !== action.userId || row.role !== expected.role || row.text !== expected.text) {
        throw new Error('[conductor] chat message identity collision');
      }
    }
    const existingIds = new Set(existing.map((row) => row.id));
    for (const entry of identities) {
      if (!existingIds.has(entry.id)) {
        await prisma.workspaceChatMessage.create({ data: { id: entry.id, workspaceId: action.workspaceId, userId: action.userId, role: entry.role, text: entry.text } });
      }
    }
    return { applied: true };
  }
  if (action.op === 'design-library-write') {
    if (action.payload.mode === 'save') {
      const id = await saveDesignArtifact(prisma, action.workspaceId, {
        ...(action.target.artifactId ? { id: action.target.artifactId } : {}),
        kind: action.payload.kind ?? '',
        name: action.payload.name ?? '',
        ...(action.payload.description === undefined ? {} : { description: action.payload.description }),
        content: action.payload.content,
        ...(action.payload.source === undefined ? {} : { source: action.payload.source }),
      });
      return id ? { applied: true, keys: [id] } : { ok: false, error: 'design.notFound' };
    }
    const artifactId = action.target.artifactId;
    if (!artifactId) return { ok: false, error: 'design.notFound' };
    if (action.payload.mode === 'activate') {
      const activated = await setActiveDesignArtifact(prisma, action.workspaceId, artifactId);
      return activated ? { applied: true, keys: [artifactId] } : { ok: false, error: 'design.notFound' };
    }
    await deleteDesignArtifact(prisma, action.workspaceId, artifactId);
    return { applied: true, keys: [artifactId] };
  }
  if (action.op === 'studio-brief-save') {
    const fields = {
      name: action.payload.name,
      productName: action.payload.productName,
      audience: action.payload.audience,
      tone: action.payload.tone,
      goals: action.payload.goals,
      notes: action.payload.notes,
      ...(action.payload.projectId ? { projectId: action.payload.projectId } : {}),
    };
    if (!action.payload.create) {
      const updated = await prisma.studioBrief.updateMany({ where: { workspaceId: action.workspaceId, id: action.target.briefId }, data: fields });
      return updated.count === 1 ? { applied: true, keys: [action.target.briefId] } : { ok: false, error: 'studio.briefNotFound' };
    }
    // luckystack-allow tenant-scope: deterministic-id collision detection must query globally, then explicitly rejects a row owned by another workspace.
    const existing = await prisma.studioBrief.findUnique({ where: { id: action.target.briefId } });
    if (existing) {
      return existing.workspaceId === action.workspaceId
        ? { applied: true, keys: [existing.id] }
        : { ok: false, error: 'studio.briefIdentityCollision' };
    }
    const created = await prisma.studioBrief.create({ data: { id: action.target.briefId, workspaceId: action.workspaceId, ...fields } });
    return { applied: true, keys: [created.id] };
  }
  if (action.op === 'studio-delete') {
    if (action.target.artifactId) {
      const deleted = await prisma.studioArtifact.deleteMany({ where: { workspaceId: action.workspaceId, id: action.target.artifactId } });
      return { applied: true, changed: deleted.count === 1, keys: [action.target.artifactId] };
    }
    const briefId = action.target.briefId;
    if (!briefId) return { ok: false, error: 'studio.briefNotFound' };
    return withStudioBriefLock(action.workspaceId, briefId, async () => {
      const brief = await prisma.studioBrief.findFirst({ where: { workspaceId: action.workspaceId, id: briefId }, select: { id: true } });
      if (!brief) return { applied: true, changed: false, keys: [briefId] };
      await prisma.studioArtifact.deleteMany({ where: { workspaceId: action.workspaceId, briefId } });
      const deleted = await prisma.studioBrief.deleteMany({ where: { workspaceId: action.workspaceId, id: briefId } });
      return { applied: true, changed: deleted.count === 1, keys: [briefId] };
    });
  }
  if (action.op === 'pat-issue') {
    const existing = await prisma.personalAccessToken.findUnique({ where: { id: action.target.patId } });
    if (existing) {
      const exact = existing.workspaceId === action.workspaceId && existing.userId === action.userId
        && existing.tokenHash === action.payload.tokenHash && existing.tokenPrefix === action.payload.tokenPrefix;
      return exact ? { applied: true, keys: [existing.id] } : { ok: false, error: 'pat.identityCollision' };
    }
    const created = await prisma.personalAccessToken.create({
      data: {
        id: action.target.patId,
        userId: action.userId,
        workspaceId: action.workspaceId,
        name: action.payload.name,
        tokenHash: action.payload.tokenHash,
        tokenPrefix: action.payload.tokenPrefix,
        scopes: action.payload.scopes,
      },
    });
    return { applied: true, keys: [created.id] };
  }
  if (action.op === 'runtime-launch-prepare') {
    // luckystack-allow tenant-scope: executeAction asserted the active tenant and the query explicitly includes action.workspaceId.
    const ticket = await prisma.ticket.findFirst({
      where: { workspaceId: action.workspaceId, projectId: action.target.projectId, key: action.target.ticketKey, archived: false },
      select: { branch: true },
    });
    if (!ticket) return { ok: false, error: 'runtime.ticketNotFound' };
    if (action.payload.mode !== 'preview-close' && !ticket.branch) return { ok: false, error: 'runtime.ticketNotActivated' };
    if (action.payload.branch !== undefined && ticket.branch !== action.payload.branch) return { ok: false, error: 'runtime.staleBranch' };
    if (action.payload.mode === 'editor-open') {
      const guard = await ticketEditGuard(prisma, action.workspaceId, action.target.ticketKey);
      if (!guard.allowed) return { ok: false, error: guard.reason ?? 'editor.locked' };
    }
    return { applied: true, keys: [action.target.ticketKey] };
  }
  if (action.op === 'runtime-launch-complete') {
    // luckystack-allow tenant-scope: executeAction asserted the active tenant and the completion check explicitly includes action.workspaceId.
    const prepared = await prisma.workspaceSignal.findFirst({
      where: { id: action.target.intentId, workspaceId: action.workspaceId, kind: 'runtime-launch-prepare', processedAt: { not: null } },
      select: { id: true },
    });
    return prepared ? { applied: true, keys: [action.target.ticketKey] } : { ok: false, error: 'runtime.intentNotPrepared' };
  }
  if (action.op === 'ci-public-complete') return applyPublicCiComplete(prisma, action.workspaceId, action);
  if (action.op === 'automation-event-apply') {
    return applyAutomationEvent(prisma, action.workspaceId, action.payload.event, action.payload.depth);
  }
  if (action.op === 'automation-cron-fire') {
    return fireCronTrigger(prisma, action.workspaceId, action.target.triggerId, action.payload.minuteAt);
  }
  if (action.op === 'automation-action-run') {
    return action.payload.mode === 'gated'
      ? runTriggerAction(prisma, action.workspaceId, action.payload.action, action.payload.requiresApproval)
      : executeTriggerAction(prisma, action.workspaceId, action.payload.action);
  }
  if (action.op === 'workspace-builtins-ensure') {
    return ensureWorkspaceBuiltins(prisma, action.workspaceId);
  }
  //? Server-only forge inputs are already parsed/fetched and bounded before enqueue.
  //? These cases perform deterministic DB apply only; no external network can hold the lease.
  if (action.op === 'forge-event-apply') {
    return applyForgeEvent(prisma, action.workspaceId, action.payload.event, action.payload.acceptedAt);
  }
  if (action.op === 'forge-snapshot-apply') {
    return applyForgeSnapshot(prisma, action.workspaceId, action.target.projectId, action.payload.snapshot);
  }
  const { op, payload, target, userId } = action;
  switch (op) {
    case 'change-role': {
      const memberId = str(target, 'memberId');
      const roleKey = str(payload, 'roleKey') ?? str(payload, 'role');
      if (!memberId || !roleKey) return;
      //? SEC1 — owner-protection + privilege-ceiling. The owner's membership can never be re-roled
      //? through change-role (only transfer-ownership moves it); promoting INTO an admin-tier role
      //? requires promoteAdmin; re-roling a member who currently HOLDS an admin-tier role requires
      //? demoteAdmin. Prevents a manageMembers-only holder from minting (or stripping) admins.
      const ws = await prisma.workspace.findFirst({ where: { id: action.workspaceId }, select: { ownerId: true } });
      if (ws?.ownerId === memberId) return { ok: false, error: 'member.ownerProtected' };
      const acting = await actorPerms(action.workspaceId, userId);
      if (!acting) return { ok: false, error: 'rbac' };
      const newRole = await prisma.workspaceRole.findFirst({ where: { workspaceId: action.workspaceId, key: roleKey }, select: { perms: true } });
      if (!newRole) return { ok: false, error: 'role.unknown' };
      //? `owner` is never assignable as a role: ownership has its own CAS-protected transfer path.
      if (roleKey === 'owner') return { ok: false, error: 'member.ownerTransferRequired' };
      //? Built-in admin has no promote/demote bits itself, so checking only its permission vector missed it.
      if ((roleKey === 'admin' || isAdminTierPerms(newRole.perms)) && acting[CAP_PROMOTE_ADMIN] !== true) return { ok: false, error: 'rbac' };
      if (newRole.perms.some((granted, index) => granted && acting[index] !== true)) return { ok: false, error: 'rbac' };
      const targetMember = await prisma.workspaceMember.findFirst({ where: { workspaceId: action.workspaceId, userId: memberId }, select: { roleKey: true } });
      if (!targetMember) return { ok: false, error: 'member.notFound' };
      const currentRole = await prisma.workspaceRole.findFirst({ where: { workspaceId: action.workspaceId, key: targetMember.roleKey }, select: { perms: true } });
      if ((targetMember.roleKey === 'admin' || targetMember.roleKey === 'owner' || (currentRole && isAdminTierPerms(currentRole.perms))) && acting[CAP_DEMOTE_ADMIN] !== true) return { ok: false, error: 'rbac' };
      await prisma.workspaceMember.updateMany({ where: { workspaceId: action.workspaceId, userId: memberId }, data: { roleKey } });
      await recordAudit(prisma, action.workspaceId, userId, 'change-role', memberId, { roleKey });
      return;
    }
    case 'save-env': {
      const key = str(payload, 'key');
      if (!key) return;
      const value = str(payload, 'value') ?? '';
      const secret = bool(payload, 'secret');
      const existing = await prisma.envVar.findFirst({ where: { workspaceId: action.workspaceId, key } });
      //? A masked secret reaches the client as an empty replacement buffer. Keeping an existing
      //? secret on an empty secret-save prevents an untouched blur/save from erasing it; typing a
      //? non-empty replacement still rotates it normally.
      if (existing?.secret === true && secret && value.length === 0) {
        await recordAudit(prisma, action.workspaceId, userId, 'save-env', key, { secret, unchanged: true });
        return existing;
      }
      //? Secret values are encrypted at rest (B-07); non-secrets remain readable configuration.
      const stored = secret ? encryptSecret(value) : value;
      //? Return the upserted row so the realtime `_sync` route broadcasts only its safe metadata delta.
      const row = await (existing
        ? prisma.envVar.update({ where: { id: existing.id }, data: { value: stored, secret } })
        : prisma.envVar.create({ data: { workspaceId: action.workspaceId, key, value: stored, secret } }));
      //? H1 — audit the fact + the key (never the secret VALUE).
      await recordAudit(prisma, action.workspaceId, userId, 'save-env', key, { secret });
      return row;
    }
    case 'remove-env': {
      const envId = str(target, 'envId');
      if (!envId) return;
      await prisma.envVar.deleteMany({ where: { workspaceId: action.workspaceId, id: envId } });
      await recordAudit(prisma, action.workspaceId, userId, 'remove-env', envId);
      return;
    }
    case 'rename-workspace': {
      const name = str(payload, 'name');
      if (!name) return;
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { name } });
      await recordAudit(prisma, action.workspaceId, userId, 'rename-workspace', name);
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
        const firstAi = await prisma.pipelineStage.findFirst({ where: { workspaceId: action.workspaceId, projectId, aiEnabled: true }, orderBy: { order: 'asc' }, select: { key: true } });
        if (firstAi) {
          await prisma.ticket.update({ where: { id: created.id }, data: { stageId: firstAi.key } });
          await recordTicketEvent(action.workspaceId, created.id, 'status-change', userId, `auto-started AI at ${firstAi.key}`);
          await activateWorktreesForStage(action.workspaceId, projectId, [created.key], firstAi.key);
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
      const data: { title?: string; description?: string | null; labels?: string[]; priority?: TicketPriority; serviceId?: string | null } = {};
      const title = str(payload, 'title'); if (title !== undefined) data.title = title;
      if ('description' in payload) data.description = str(payload, 'description') ?? null;
      if (Array.isArray(payload.labels)) data.labels = strArr(payload, 'labels');
      const priority = asPriority(payload, 'priority'); if (priority !== undefined) data.priority = priority;
      //? Which monorepo unit this ticket's work belongs to — it decides which service a preview boots and
      //? which service's CI gates the ticket. Explicitly settable to null ("the project root"), so the key
      //? being PRESENT is what matters, not whether it has a value.
      if ('serviceId' in payload) data.serviceId = str(payload, 'serviceId') ?? null;
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
      const keys = [...new Set(strArr(target, 'ticketIds'))];
      const stageId = str(payload, 'stageId');
      if (keys.length === 0 || !stageId) return { ok: false, error: 'bulkMove.invalidRequest' };
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      const explicitProjectId = requestedProjectId === undefined ? null : await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (requestedProjectId !== undefined && !explicitProjectId) return { ok: false, error: 'project.notFound' };

      //? Validate the COMPLETE move before any mutation. Explicit moves may only contain tickets from
      //? that project; legacy/system moves without a project split safely by each ticket's project.
      const priorStages = await prisma.ticket.findMany({ where: { workspaceId: action.workspaceId, key: { in: keys } }, select: { key: true, stageId: true, projectId: true } });
      if (priorStages.length !== keys.length) return { ok: false, error: 'ticket.notFound' };
      if (explicitProjectId && priorStages.some((ticket) => ticket.projectId !== explicitProjectId)) return { ok: false, error: 'bulkMove.mixedProject' };
      const projectIds = [...new Set(priorStages.map((ticket) => ticket.projectId))];
      const targetStages = await prisma.pipelineStage.findMany({ where: { workspaceId: action.workspaceId, projectId: { in: projectIds }, key: stageId }, select: { projectId: true } });
      if (targetStages.length !== projectIds.length) return { ok: false, error: 'stage.notFound' };

      for (const projectId of projectIds) {
        const projectKeys = priorStages.filter((ticket) => ticket.projectId === projectId).map((ticket) => ticket.key);
        await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, projectId, key: { in: projectKeys } }, data: { stageId } });
        await activateWorktreesForStage(action.workspaceId, projectId, projectKeys, stageId);
      }
      for (const ticket of await ticketIdsForKeys(action.workspaceId, keys)) await recordTicketEvent(action.workspaceId, ticket.id, 'status-change', userId, `moved to ${stageId}`);
      //? Automation (#2, #83): each ticket LEAVING its prior stage may fire stage.on_complete, and
      //? ENTERING the new stage may fire stage.on_enter with the exact project match facet.
      for (const ticket of priorStages) {
        if (ticket.stageId && ticket.stageId !== stageId) void fireEvent(prisma, action.workspaceId, { on: 'stage.on_complete', ticketKey: ticket.key, stageId: ticket.stageId, projectId: ticket.projectId });
        void fireEvent(prisma, action.workspaceId, { on: 'stage.on_enter', ticketKey: ticket.key, stageId, projectId: ticket.projectId });
      }
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
      const sprintId = str(target, 'sprintId') ?? str(payload, 'sprintId'); const name = str(payload, 'name');
      if (!sprintId) return;
      //? #1 — activate + rename + DATES. A date string ('YYYY-MM-DD') sets it; an empty string clears it.
      const parseDate = (key: string): Date | null | undefined => {
        if (!(key in payload)) return undefined;
        const raw = str(payload, key);
        if (!raw || raw.trim().length === 0) return null;
        const ms = Date.parse(raw);
        return Number.isFinite(ms) ? new Date(ms) : undefined;
      };
      const startAt = parseDate('startAt'); const endAt = parseDate('endAt');
      await prisma.sprint.updateMany({ where: { workspaceId: action.workspaceId, id: sprintId }, data: {
        ...(name ? { name } : {}),
        ...('active' in payload ? { active: bool(payload, 'active') } : {}),
        ...(startAt === undefined ? {} : { startAt }),
        ...(endAt === undefined ? {} : { endAt }),
      } });
      return prisma.sprint.findFirst({ where: { workspaceId: action.workspaceId, id: sprintId } });
    }
    // ---- members / RBAC / workspace lifecycle ----
    case 'remove-member': {
      const memberId = str(target, 'memberId');
      if (!memberId) return { ok: false, error: 'member.invalidRequest' };
      //? SEC3 — owner-protection: removing the owner's membership would leave a dangling
      //? `ownerId` (a crafted sync-request could do it; the UI never offered it).
      const wsRow = await prisma.workspace.findFirst({ where: { id: action.workspaceId }, select: { ownerId: true } });
      if (wsRow?.ownerId === memberId) return { ok: false, error: 'member.ownerProtected' };
      const acting = await actorPerms(action.workspaceId, userId);
      const targetMember = await prisma.workspaceMember.findFirst({ where: { workspaceId: action.workspaceId, userId: memberId }, select: { roleKey: true } });
      if (!acting || !targetMember) return { ok: false, error: 'member.notFound' };
      const currentRole = await prisma.workspaceRole.findFirst({ where: { workspaceId: action.workspaceId, key: targetMember.roleKey }, select: { perms: true } });
      if ((targetMember.roleKey === 'admin' || (currentRole && isAdminTierPerms(currentRole.perms))) && acting[CAP_DEMOTE_ADMIN] !== true) return { ok: false, error: 'rbac' };
      const removed = await prisma.workspaceMember.deleteMany({ where: { workspaceId: action.workspaceId, userId: memberId } });
      if (removed.count !== 1) return { ok: false, error: 'member.notFound' };
      await recordAudit(prisma, action.workspaceId, userId, 'remove-member', memberId);
      return;
    }
    case 'transfer-ownership': {
      const memberId = str(target, 'memberId');
      if (!memberId || memberId === userId) return { ok: false, error: 'member.invalidRequest' };
      const wsRow = await prisma.workspace.findFirst({ where: { id: action.workspaceId }, select: { ownerId: true } });
      const targetMember = await prisma.workspaceMember.findFirst({ where: { workspaceId: action.workspaceId, userId: memberId }, select: { id: true, roleKey: true } });
      if (!wsRow || !targetMember) return { ok: false, error: 'member.notFound' };
      //? Only the actual current owner may transfer ownership. A custom role carrying ownerActions is
      //? intentionally insufficient; workspace RBAC can never mint host- or ownership identity.
      if (wsRow.ownerId !== userId && wsRow.ownerId !== memberId) return { ok: false, error: 'rbac' };
      if (wsRow.ownerId === userId) {
        //? Make the successor membership replayable BEFORE changing the authoritative ownerId. The current
        //? owner keeps owner capability until the final step, so a crash at either boundary can be retried.
        await prisma.workspaceMember.updateMany({ where: { workspaceId: action.workspaceId, userId: memberId }, data: { roleKey: 'owner' } });
        const claimed = await prisma.workspace.updateMany({ where: { id: action.workspaceId, ownerId: userId }, data: { ownerId: memberId } });
        if (claimed.count !== 1) {
          await prisma.workspaceMember.updateMany({ where: { workspaceId: action.workspaceId, userId: memberId }, data: { roleKey: targetMember.roleKey } });
          return { ok: false, error: 'workspace.ownerChanged' };
        }
      } else {
        await prisma.workspaceMember.updateMany({ where: { workspaceId: action.workspaceId, userId: memberId }, data: { roleKey: 'owner' } });
      }
      await prisma.workspaceMember.updateMany({ where: { workspaceId: action.workspaceId, userId }, data: { roleKey: 'admin' } });
      await recordAudit(prisma, action.workspaceId, userId, 'transfer-ownership', memberId, { from: userId });
      return;
    }
    case 'delete-workspace': {
      //? Remove every public environment route/container BEFORE deleting its ownership rows. The workspace
      //? lease remains held so no concurrent Conductor deploy can recreate runtime during the purge; any
      //? unprovable proxy/Docker teardown fails closed and leaves the tenant rows available for retry.
      const environments = await prisma.environment.findMany({
        where: { workspaceId: action.workspaceId },
        select: { id: true },
      });
      for (const environment of environments) {
        const tornDown = await teardownEnvironment(prisma, action.workspaceId, environment.id);
        if (!tornDown.ok) throw new Error('[conductor] workspace environment teardown could not be proven');
      }
      const serviceStacks = await prisma.serviceStack.findMany({
        where: { workspaceId: action.workspaceId },
        select: { name: true },
      });
      for (const stack of serviceStacks) {
        const tornDown = await teardownServiceStack(prisma, action.workspaceId, stack.name);
        if (!tornDown.ok) throw new Error('[conductor] workspace service-stack teardown could not be proven');
      }
      if (!(await teardownWorkspaceContainers(action.workspaceId))) {
        throw new Error('[conductor] workspace container teardown could not be proven');
      }
      if (!(await teardownWorkspaceServiceNetwork(action.workspaceId))) {
        throw new Error('[conductor] workspace service-network teardown could not be proven');
      }
      await recordAudit(prisma, action.workspaceId, userId, 'delete-workspace', action.workspaceId);
      await cascadeDeleteWorkspace(action.workspaceId);
      //? P2 — evict the OTHER members still sitting in this now-deleted workspace: an in-room refetch can't
      //? converge a workspace that no longer exists, so broadcast the `gone` lifecycle signal. Their clients
      //? drop the dead tenant + fall back to their workspace picker (the initiator already reset locally).
      broadcastWorkspaceDirty(action.workspaceId, { gone: true });
      return;
    }
    case 'role-create': {
      const key = str(payload, 'key'); const label = str(payload, 'label') ?? key;
      if (!key || !label) return;
      //? SEC2 — capability-ceiling: the actor cannot mint a role holding a perm the actor lacks
      //? (an editPipeline-tier member could otherwise create an owner-tier role and self-assign).
      const creatorPerms = await actorPerms(action.workspaceId, userId);
      if (!creatorPerms) return { ok: false, error: 'rbac' };
      const newPerms = boolArr(payload, 'perms');
      if (newPerms.some((granted, i) => granted && creatorPerms[i] !== true)) return { ok: false, error: 'rbac' };
      //? H1/SEC2 — audit role creation (perm grants are governance events).
      const created = await prisma.workspaceRole.create({ data: { workspaceId: action.workspaceId, key, label, perms: newPerms, builtIn: false } });
      await recordAudit(prisma, action.workspaceId, userId, 'role-create', key, { perms: newPerms });
      //? Return the created role so the realtime `_sync` route broadcasts the delta.
      return created;
    }
    case 'role-update': {
      const key = str(target, 'roleKey') ?? str(payload, 'key');
      if (!key) return;
      //? SEC2 — built-in roles are immutable server-side (the client `locked` flag was the only
      //? guard) + the same capability-ceiling as role-create for perm changes.
      const existingRole = await prisma.workspaceRole.findFirst({ where: { workspaceId: action.workspaceId, key }, select: { builtIn: true, perms: true } });
      if (!existingRole) return { ok: false, error: 'role.unknown' };
      if (existingRole.builtIn) return { ok: false, error: 'role.builtInImmutable' };
      const label = str(payload, 'label');
      const data: { label?: string; perms?: boolean[] } = {};
      if (label) data.label = label;
      if (Array.isArray(payload.perms)) {
        const updaterPerms = await actorPerms(action.workspaceId, userId);
        if (!updaterPerms) return { ok: false, error: 'rbac' };
        const nextPerms = boolArr(payload, 'perms');
        if (nextPerms.some((granted, i) => granted && updaterPerms[i] !== true)) return { ok: false, error: 'rbac' };
        //? Editing an already elevated custom role downward is a demotion of every member holding it.
        if (isAdminTierPerms(existingRole.perms) && updaterPerms[CAP_DEMOTE_ADMIN] !== true) return { ok: false, error: 'rbac' };
        data.perms = nextPerms;
      }
      await prisma.workspaceRole.updateMany({ where: { workspaceId: action.workspaceId, key }, data });
      await recordAudit(prisma, action.workspaceId, userId, 'role-update', key, { ...(label ? { label } : {}), ...(Array.isArray(payload.perms) ? { permsChanged: true } : {}) });
      //? Return the updated role so the realtime `_sync` route broadcasts the delta.
      return prisma.workspaceRole.findFirst({ where: { workspaceId: action.workspaceId, key } });
    }
    // ---- invites ----
    case 'create-workspace': {
      //? Login-only op (no active workspace yet). Builds a blank-but-functional
      //? workspace owned by the caller — the onboarding "create a workspace" path.
      //? Uses the plain client (not tenant-scoped): there is no tenant yet.
      const name = str(payload, 'name');
      //? G5 — the creation form's tier (simple/advanced/professional) decides the seeded pipeline; an
      //? unknown or absent value keeps the previous full-pipeline behaviour.
      const rawPreset = str(payload, 'presetKey') ?? '';
      const preset = isPipelinePreset(rawPreset) ? rawPreset : 'professional';
      //? #19 — a pack id seeds the starting content; an unknown id simply seeds nothing.
      const packId = str(payload, 'packId');
      if (!name) return;
      const created = await createBlankWorkspace(prisma, userId, name.trim(), sanitizeSections(payload.enabledSections), preset, packId);
      //? The caller has no workspace yet and therefore nothing to poll for, so the id has to come back
      //? with the op. The route's own doc-comment promised this and the op returned void — which is why
      //? onboarding could only guess at which workspace it had just created. Returned as the op's plain
      //? result value, the same way `role-update` returns the updated role.
      return { workspaceId: created.workspaceId };
    }
    //? GAP_SCAN G2 — clone THIS workspace's configuration into a new one owned by the caller. Config only:
    //? no tickets, no content, no credentials, no members (see cloneWorkspace for the full contract).
    case 'clone-workspace': {
      const cloneName = str(payload, 'name');
      if (!cloneName) return { ok: false, error: 'clone.invalidRequest' };
      const cloned = await cloneWorkspace(prisma, action.workspaceId, userId, cloneName.trim());
      if (!cloned.ok) return { ok: false, error: cloned.error ?? 'clone.failed' };
      await recordAudit(prisma, action.workspaceId, userId, 'clone-workspace', cloned.workspaceId ?? null, cloned.copied);
      return { workspaceId: cloned.workspaceId, copied: cloned.copied };
    }
    case 'invite': {
      const email = str(payload, 'email')?.trim().toLowerCase();
      const roleKey = str(payload, 'roleKey') ?? 'member';
      if (!email?.includes('@')) return { ok: false, error: 'invite.invalidEmail' };
      if (roleKey === 'owner') return { ok: false, error: 'member.ownerTransferRequired' };
      const acting = await actorPerms(action.workspaceId, userId);
      const invitedRole = await prisma.workspaceRole.findFirst({ where: { workspaceId: action.workspaceId, key: roleKey }, select: { perms: true } });
      if (!acting || !invitedRole) return { ok: false, error: 'role.unknown' };
      //? manageMembers alone may invite members, but promoting to built-in admin/elevated custom roles
      //? requires promoteAdmin and nobody may grant a capability they do not personally hold.
      if ((roleKey === 'admin' || isAdminTierPerms(invitedRole.perms)) && acting[CAP_PROMOTE_ADMIN] !== true) return { ok: false, error: 'rbac' };
      if (invitedRole.perms.some((granted, index) => granted && acting[index] !== true)) return { ok: false, error: 'rbac' };
      //? F3 — a CRYPTO-RANDOM, unguessable token (was `inv-${clientRequestId}`: derived from a client-supplied
      //? id → forgeable/replayable) + a 7-day expiry. The token reaches only the matched-email invitee via the
      //? email-scoped `myInvites` snapshot; accept-invite additionally binds it to that email + rejects expiry.
      const token = randomBytes(24).toString('base64url');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const invite = await prisma.invite.upsert({
        where: { workspaceId_email: { workspaceId: action.workspaceId, email } },
        create: { workspaceId: action.workspaceId, email, roleKey, invitedById: userId, token, status: 'pending', expiresAt },
        update: { roleKey, invitedById: userId, token, status: 'pending', expiresAt, acceptedAt: null },
      });
      await recordAudit(prisma, action.workspaceId, userId, 'invite', email, { roleKey });
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
      if (!inv) return { ok: false, error: 'invite.invalid' };
      //? F3 — an expired invite cannot be accepted; mark it so it stops surfacing (light sweep-on-touch).
      if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
        await prisma.invite.update({ where: { id: inv.id }, data: { status: 'expired' } });
        return { ok: false, error: 'invite.expired' };
      }
      //? F3 — bind the invite to its target email: only the account whose email matches the invite may accept it
      //? (defense-in-depth beyond the now-unguessable token). Case-insensitive.
      const acceptor = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (acceptor?.email.trim().toLowerCase() !== inv.email.trim().toLowerCase()) return { ok: false, error: 'invite.emailMismatch' };
      const invitedRole = await prisma.workspaceRole.findFirst({ where: { workspaceId: inv.workspaceId, key: inv.roleKey }, select: { key: true } });
      if (!invitedRole || invitedRole.key === 'owner') return { ok: false, error: 'role.unknown' };
      const [existingMembership, inviteWorkspace] = await Promise.all([
        // luckystack-allow tenant-scope: the compound unique lookup contains the invite-owned workspaceId and exact accepting userId.
        prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } },
          select: { roleKey: true },
        }),
        prisma.workspace.findUnique({ where: { id: inv.workspaceId }, select: { ownerId: true } }),
      ]);
      //? An invite is never an ownership-transfer mechanism. A stale or malicious owner-address invite
      //? must not demote the current owner and bypass the dedicated transfer CAS/audit path.
      if (inviteWorkspace?.ownerId === userId || existingMembership?.roleKey === 'owner') return { ok: false, error: 'member.ownerProtected' };
      //? Upsert makes a replay/race safe. A later invite may deliberately change an existing member's role,
      //? but it went through the inviter's capability ceiling above before this token was minted.
      // luckystack-allow tenant-scope: the compound unique key contains the exact invite-owned workspaceId; no cross-tenant row can match.
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } },
        create: { workspaceId: inv.workspaceId, userId, roleKey: inv.roleKey },
        update: { roleKey: inv.roleKey },
      });
      await prisma.invite.updateMany({ where: { workspaceId: inv.workspaceId, id: inv.id, status: 'pending' }, data: { status: 'accepted', acceptedAt: new Date() } });
      return { ok: true, workspaceId: inv.workspaceId };
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
      //? RBAC + external fetch happened in projectAdmin before dispatch. The public
      //? Conductor case accepts only that bounded snapshot and applies it deterministically.
      const resyncProjectId = str(target, 'projectId');
      const snapshot = readForgeSnapshot(payload.snapshot);
      if (!resyncProjectId || snapshot?.projectId !== resyncProjectId) {
        return { ok: false, synced: 0, keys: [], error: 'forge.snapshotRequired' };
      }
      return applyForgeSnapshot(prisma, action.workspaceId, resyncProjectId, snapshot);
    }
    //? Per-project forge connection (ADR 0036) — B-23: the Conductor writes the ForgeConnection.
    case 'forge-connect': {
      const forgeProjectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      if (!forgeProjectId) return;
      if (bool(payload, 'disconnect')) {
        await prisma.forgeConnection.deleteMany({ where: { workspaceId: action.workspaceId, projectId: forgeProjectId } });
        if (bool(payload, 'clearExternalRefs')) {
          //? Explicit operator cleanup for a removed external repository. Preserve internal
          //? ticket/MR history, but remove dead forge URLs and close only MRs belonging to
          //? tickets that actually carried an external reference in this exact project.
          // luckystack-allow tenant-scope: the explicit workspaceId + projectId filter below is the exact cleanup boundary.
          const referencedTickets = await prisma.ticket.findMany({
            where: { workspaceId: action.workspaceId, projectId: forgeProjectId, OR: [{ mrUrl: { not: null } }, { issueUrl: { not: null } }] },
            select: { id: true },
          });
          const ticketIds = referencedTickets.map((ticket) => ticket.id);
          if (ticketIds.length > 0) {
            await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, projectId: forgeProjectId, id: { in: ticketIds } }, data: { mrUrl: null, issueUrl: null } });
            await prisma.mergeRequest.updateMany({ where: { workspaceId: action.workspaceId, projectId: forgeProjectId, ticketId: { in: ticketIds }, status: 'open' }, data: { status: 'closed', externalUrl: null } });
          }
        }
        return { projectId: forgeProjectId, status: 'disconnected' };
      }
      const modeRaw = str(payload, 'mode');
      const mode = modeRaw === 'github' ? 'github' : 'gitlab';
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
    //? #27 — mint/rotate the per-workspace inbound-webhook secret. The Conductor is the single writer
    //? (B-23); returns the new secret so the settings card can show it once for pasting into the forge.
    case 'forge-webhook-rotate': {
      const webhookSecret = randomBytes(24).toString('base64url');
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: { webhookSecret } });
      return { webhookSecret };
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
    case 'project-runtime-save': {
      const requestedProjectId = str(target, 'projectId');
      const devCommand = str(payload, 'devCommand');
      const projectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (!projectId || devCommand === undefined) return { ok: false, error: 'project.invalidRuntime' };

      const data: Prisma.ProjectUpdateManyMutationInput = {
        devCommand: devCommand.trim() || null,
      };
      if ('prodCommand' in payload) {
        const prodCommand = str(payload, 'prodCommand');
        if (prodCommand === undefined) return { ok: false, error: 'project.invalidRuntime' };
        data.prodCommand = prodCommand.trim() || null;
      }
      //? ADR 0317 — the runtime as a LIST. Only written when the client sends it, so an older client
      //? (or a save that only touches the stack) never clears someone's processes. `devCommand` stays
      //? the fallback for an empty list, which is what keeps every untouched project working.
      if ('runProcesses' in payload) {
        const processes = readProcesses(payload.runProcesses).filter((proc) => proc.commands.some((c) => c.trim().length > 0));
        data.runProcesses = { set: processes };
        //? The preview id must name a process that exists, or the preview would proxy nothing. An
        //? unknown id is corrected to the first process here rather than tolerated at boot time.
        const wanted = str(payload, 'previewProcessId') ?? '';
        data.previewProcessId = processes.some((proc) => proc.id === wanted) ? wanted : (processes[0]?.id ?? null);
      }
      const stack = str(payload, 'stack');
      if (stack && ['node', 'python', 'go', 'rust', 'java', 'php', 'dotnet', 'ruby', 'generic'].includes(stack)) data.stack = stack;
      if ('allowCustomBase' in payload) {
        if (typeof payload.allowCustomBase !== 'boolean') return { ok: false, error: 'project.invalidRuntime' };
        data.allowCustomBase = payload.allowCustomBase;
      }

      const updated = await prisma.project.updateMany({ where: { id: projectId, workspaceId: action.workspaceId }, data });
      if (updated.count !== 1) return { ok: false, error: 'project.invalidRuntime' };
      return { projectId, keys: [projectId] };
    }
    case 'save-ai-instruction': {
      //? Q4 + K4 + P2 — the workspace-wide AI-behaviour settings: the instruction + output language (prepended
      //? to every completion) + the per-workspace Gemini model + temperature (P2 — Gemini-only; Claude is PTY).
      const aiInstruction = str(payload, 'aiInstruction') ?? '';
      const outputLanguage = str(payload, 'outputLanguage') ?? '';
      const geminiModel = str(payload, 'geminiModel') ?? '';
      //? Clamp the temperature to Gemini's valid 0.0–2.0 range before persist (a bad value would 400 the API).
      const geminiTempRaw = str(payload, 'geminiTemperature') ?? '';
      const geminiTempNum = Number(geminiTempRaw);
      const geminiTemperature = geminiTempRaw.trim() && Number.isFinite(geminiTempNum) ? String(Math.min(2, Math.max(0, geminiTempNum))) : '';
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
      //? #17 / W1: a human answers the ticket's open question(s). MULTI-QUESTION: a `answers` array batch-fills
      //? the open questions in order; a single `answer` fills the first unanswered one (the phone-first stepper).
      //? Each answer is recorded as a comment (audit trail). The parked turn is RE-FIRED with `--resume` ONLY
      //? once EVERY question is answered — until then the banner just advances to the next question (no resume).
      const key = str(target, 'ticketKey') ?? str(payload, 'ticketKey');
      if (!key) return;
      const single = str(payload, 'answer');
      const batch = Array.isArray(payload.answers) ? payload.answers.filter((x): x is string => typeof x === 'string') : null;
      const ticket = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId, key } });
      if (!ticket) return;
      //? W2 — resolving a NON-blocking ADVISORY question (the ticket never parked on it). A divergent answer
      //? schedules a revision turn with the correction as the resume prompt; a matching one just marks it resolved.
      const advisoryIndex = typeof payload.advisoryIndex === 'number' ? payload.advisoryIndex : null;
      if (advisoryIndex !== null) {
        const advisories = parseAdvisories(ticket.advisoryQuestions);
        const res = resolveAdvisory(advisories, advisoryIndex, single ?? '');
        if (!res.applied) return;
        await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { advisoryQuestions: jsonInput(res.list) } });
        const [ta] = await ticketIdsForKeys(action.workspaceId, [key]);
        if (ta) await prisma.workspaceNote.create({ data: { workspaceId: action.workspaceId, ticketId: ta.id, authorKind: 'user', authorId: userId, body: `↩︎ (advisory) ${questionPrompt(advisories[advisoryIndex]?.q ?? '')} → ${single ?? ''}` } });
        await broadcastTicketDelta(prisma, action.workspaceId, [key]);
        if (res.revisionPrompt !== null) await reprovisionTicket(action.workspaceId, key, true, res.revisionPrompt);
        return ticketRowsForKeys(action.workspaceId, [key]);
      }
      const openSet = parseNeedsInputQuestions(ticket.needsInputQuestions, ticket.needsInput);
      if (openSet.length === 0) return;
      const { set, newlyAnswered, appliedCount } = applyAnswers(openSet, { single, batch });
      if (appliedCount === 0) return; // nothing answerable → no-op
      const [t] = await ticketIdsForKeys(action.workspaceId, [key]);
      if (t) for (const { q, a } of newlyAnswered) await prisma.workspaceNote.create({ data: { workspaceId: action.workspaceId, ticketId: t.id, authorKind: 'user', authorId: userId, body: `↩︎ ${questionPrompt(q)} → ${a ?? ''}` } });
      const nextBanner = firstUnanswered(set);
      if (nextBanner !== null) {
        //? Still open questions → advance the banner + keep parked (do NOT resume yet).
        await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { needsInput: nextBanner, needsInputQuestions: jsonInput(set), remindedAt: null } });
        await broadcastTicketDelta(prisma, action.workspaceId, [key]);
        return ticketRowsForKeys(action.workspaceId, [key]);
      }
      //? All answered → clear + resume the parked turn once with the combined answers.
      await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, key }, data: { needsInput: null, needsInputQuestions: null, status: 'idle', remindedAt: null } });
      if (t) await recordTicketEvent(action.workspaceId, t.id, 'comment', userId, 'answered the AI question(s)');
      await broadcastTicketDelta(prisma, action.workspaceId, [key]);
      await reprovisionTicket(action.workspaceId, key, true, buildCombinedAnswerPrompt(set));
      return ticketRowsForKeys(action.workspaceId, [key]);
    }
    case 'kill': {
      //? Manual kill uses the same exact fenced recovery transition as watchdog/reaper. The public
      //? writer captures the expected session; the nested prepare establishes the recovery fence and
      //? only then moves the ticket idle. Docker runs after this writer context/lease becomes inactive.
      const key = str(target, 'ticketKey') ?? str(payload, 'ticketKey');
      if (!key) return;
      const ticket = await prisma.ticket.findFirst({
        where: { workspaceId: action.workspaceId, key, archived: false },
        select: { id: true, key: true, projectId: true, stageId: true, status: true, needsInput: true },
      });
      if (!ticket) return;
      const session = await prisma.agentSession.findFirst({
        where: {
          workspaceId: action.workspaceId,
          ticketId: ticket.id,
          stageId: ticket.stageId,
          kind: 'worker',
          sessionKey: `worker:${ticket.id}:${ticket.stageId}`,
          status: { in: ['busy', 'paused'] },
        },
        select: { id: true, status: true, containerId: true, runToken: true, runFence: true, startedAt: true },
      });
      if (!session) {
        //? A destructive kill parks the ticket before detached Docker teardown, so the
        //? capacity loop cannot recreate the same canonical container during cleanup.
        await prisma.ticket.updateMany({ where: { id: ticket.id, workspaceId: action.workspaceId }, data: { status: 'paused' } });
        await broadcastTicketDelta(prisma, action.workspaceId, [key]);
        //? With no session there is no recovery fence to coordinate. Await exact idempotent
        //? teardown before this durable ControlAction can be marked processed; a failure stays visible.
        if (!(await teardownExactTicketContainer(action.workspaceId, ticket.projectId, key))) throw new Error('container.notRemoved');
        return;
      }
      if (!session.containerId || !session.runToken || session.runFence <= 0 || (session.status !== 'busy' && session.status !== 'paused')) {
        return { ok: false, error: 'agent.recoveryPrepare' };
      }
      const prepare: AgentRecoveryTransitionInternalAction = {
        workspaceId: action.workspaceId,
        op: 'agent-recovery-transition' as const,
        target: { ticketId: ticket.id, ticketKey: ticket.key, projectId: ticket.projectId, stageId: ticket.stageId, sessionId: session.id },
        payload: {
          phase: 'prepare' as const,
          reason: 'manual-kill' as const,
          expected: {
            ticketStatus: ticket.status,
            needsInputHash: needsInputHash(ticket.needsInput),
            sessionStatus: session.status,
            containerId: session.containerId,
            runToken: session.runToken,
            runFence: session.runFence,
            startedAt: session.startedAt.getTime(),
          },
          observedAt: Date.now(),
        },
        userId: action.userId,
        clientRequestId: `agent-recovery-prepare:manual-kill:${session.id}:${session.runToken}:${String(session.runFence)}:${String(session.startedAt.getTime())}`,
      };
      //? Manual success may not leave this writer until the durable prepare + Redis fence
      //? are accepted. The nested InternalOp is reentrant under this same tenant/lease.
      const { enqueueInternalAction } = await import('./internalOps');
      const [prepareError, preparedEnqueue] = await tryCatch(() => enqueueInternalAction(prepare));
      const directPrepare = readRecoveryTransitionResult(preparedEnqueue?.result);
      if (prepareError || (directPrepare?.phase === 'prepare' && !directPrepare.applied)) {
        return { ok: false, error: 'agent.recoveryPrepare' };
      }
      const [reconstructError, reconstructed] = await tryCatch(() => reconstructAcceptedRecoveryPrepare(prisma, prepare));
      if (reconstructError || reconstructed?.state !== 'recovering') return { ok: false, error: 'agent.recoveryPrepare' };
      await broadcastTicketDelta(prisma, action.workspaceId, [key]);

      //? Only Docker + complete/cancel detach, after the public action can no longer ACK
      //? ahead of the fence. runAgentRecovery reconstructs the rich prepare on dedup replay.
      setTimeout(() => {
        void tryCatch(async () => {
          //? The durable manual-kill recovery intent now owns stop + exact removal before
          //? complete. Crash replay treats an already-absent exact container/volume as success.
          const recovered = await runAgentRecovery({ prepare, mode: 'teardown-container' });
          if (!recovered.recovered) throw new Error(`agent.recovery.${recovered.reason}`);
        }).then(([error]) => {
          if (error) console.error(`[conductor] manual teardown ${key} failed:`, error.message);
        });
      }, 0);
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
      //? R3-b — require and resolve the TARGET project FIRST so a lost transport field can
      //? never silently fall back to project 1 and clobber its persisted URL/repo slot.
      const requestedProjectId = str(payload, 'projectId');
      if (!requestedProjectId) return { linked: false, error: 'sync.invalidRequest' };
      const linkProjectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (!linkProjectId) return { linked: false, error: 'project.notFound' };
      if (bool(payload, 'disconnect')) return disconnectProjectRepo(prisma, action.workspaceId, linkProjectId);
      const gitUrl = str(payload, 'gitUrl');
      if (!gitUrl) return { linked: false, error: 'sync.invalidRequest' };
      const token = str(payload, 'token');
      const [error, status] = await tryCatch(() => cloneRepo({ workspaceId: action.workspaceId, projectId: linkProjectId, gitUrl, ...(token ? { token } : {}) }));
      if (error) return { linked: false, gitUrl, error: error.message };
      //? Persist the CLEAN url on the TARGET project only (ADR 0035). token is never stored.
      await prisma.project.update({ where: { id: linkProjectId }, data: { gitUrl } });
      return status;
    }
    case 'scan-docs': {
      //? Docs-init scan (register-flow step D): find the linked repo's doc files and
      //? register each as a context-doc InfoSource. `enabled` doubles as the per-file
      //? aiEditable gate — DEFAULT OFF (the AI may not edit a doc until the user allows).
      //? Re-scan updates existing docs' content without flipping their aiEditable state.
      const scanProjectId = await resolveProjectId(prisma, action.workspaceId, str(payload, 'projectId'));
      const found = scanProjectId ? await listRepoDocs(action.workspaceId, scanProjectId) : [];
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
    case 'info-source-archive': {
      //? ADR 0310 — soft-archive a context doc: it stops feeding the coding AI (loadStageContextDocs
      //? and the content knowledge-context both filter on archivedAt) and moves to the Sources page's
      //? Archived view, restorable at any time. `updateMany` scoped by workspaceId is the tenant guard:
      //? an id from another workspace matches zero rows instead of writing across the boundary.
      const infoSourceId = str(payload, 'infoSourceId');
      if (!infoSourceId) return;
      //? Absent/garbled `archived` means archive: the op exists to retire a doc, so that is the safe default.
      const archived = bool(payload, 'archived');
      await prisma.infoSource.updateMany({
        where: { id: infoSourceId, workspaceId: action.workspaceId },
        data: { archivedAt: archived ? new Date() : null },
      });
      return prisma.infoSource.findMany({ where: { workspaceId: action.workspaceId, mode: 'context-doc' }, orderBy: { name: 'asc' } });
    }
    case 'info-source-delete': {
      //? The irreversible sibling of the archive op. The UI gates this behind a confirm; the Conductor
      //? does not second-guess an explicit delete, it only refuses to cross the tenant boundary.
      const deleteId = str(payload, 'infoSourceId');
      if (!deleteId) return;
      await prisma.infoSource.deleteMany({ where: { id: deleteId, workspaceId: action.workspaceId } });
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
      //? Resolve the linked source pair before merge. The MR/ticket project — never project #1 —
      //? owns the git operation, post-merge RAG refresh and automation facet.
      const mergedTicket = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId, key: ticketKey }, select: { id: true, stageId: true, projectId: true } });
      if (!mergedTicket) return { ok: false, error: 'ticket.notFound' };
      const sourceMr = await prisma.mergeRequest.findFirst({ where: { workspaceId: action.workspaceId, id: mrId, ticketId: mergedTicket.id }, select: { projectId: true } });
      if (sourceMr?.projectId !== mergedTicket.projectId) return { ok: false, error: 'mr.projectMismatch' };
      //? Real git-merge (#9), approval-gated. We run under the per-workspace write-lease (this whole
      //? switch does), so merges are serial. Attach the outcome to the fresh view so the client can
      //? toast success / no-approval / conflict.
      const merge = await mergeMr(prisma, action.workspaceId, mrId);
      //? Incremental re-index on merge (ADR 0045): refresh the source ticket's project, not the
      //? workspace's first repo. Best-effort + off the caller path; memory remains workspace-wide.
      if (merge.ok) void (async () => {
        await tryCatch(() => indexWorkspace(prisma, action.workspaceId, { projectId: mergedTicket.projectId }));
        await tryCatch(() => indexInstitutionalMemory(prisma, action.workspaceId));
      })();
      //? Automation (#83): a successful merge fires `ticket.merged` (stage/project carried for match facets).
      if (merge.ok) {
        void fireEvent(prisma, action.workspaceId, { on: 'ticket.merged', ticketKey, ...(mergedTicket.stageId ? { stageId: mergedTicket.stageId } : {}), projectId: mergedTicket.projectId });
      }
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
      const alertPct = num(payload, 'alertPct');
      const label = str(payload, 'label');
      const enforcementRaw = str(payload, 'enforcement');
      const enforcement = enforcementRaw === 'pauseAll' ? 'pauseAll' : (enforcementRaw === 'pauseNew' ? 'pauseNew' : undefined);
      const budgetId = str(payload, 'budgetId');
      const enabled = 'enabled' in payload ? bool(payload, 'enabled') : undefined;
      //? #103 — multi-cap: a `budgetId` edits THAT specific cap (cap/alertPct/label/enforcement, or
      //? enabled:false to retire it); a `create` flag always adds a NEW cap; otherwise the legacy path
      //? edits the first cap or creates the first one (single-cap back-compat). Enforcement stays ADVISORY
      //? here (visibility-first #16) — pausing on it is the coupled #99 product decision, not wired yet.
      if (budgetId) {
        //? ADR 0310 — deleting a cap. Deliberately a flag on `edit-budget` rather than a new op: it is
        //? the same target, the same capability and the same tenant guard, and a separate verb would
        //? have to be classified, RBAC'd and taught to the assistant for no behavioural gain. Retiring
        //? via `enabled:false` stays available — delete is for caps you never want to see again.
        if (bool(payload, 'remove')) {
          await prisma.workspaceBudget.deleteMany({ where: { id: budgetId, workspaceId: action.workspaceId } });
          return;
        }
        const data: { cap?: number; alertPct?: number; label?: string; enforcement?: string; enabled?: boolean } = {};
        if (cap !== undefined) data.cap = cap;
        if (alertPct !== undefined) data.alertPct = alertPct;
        if (label !== undefined && label.length > 0) data.label = label;
        if (enforcement !== undefined) data.enforcement = enforcement;
        if (enabled !== undefined) data.enabled = enabled;
        await prisma.workspaceBudget.updateMany({ where: { id: budgetId, workspaceId: action.workspaceId }, data });
        return;
      }
      if (bool(payload, 'create')) {
        if (cap === undefined) return;
        await prisma.workspaceBudget.create({ data: { workspaceId: action.workspaceId, label: label && label.length > 0 ? label : 'Budget', cap, alertPct: alertPct ?? 80, enforcement: enforcement ?? 'pauseNew' } });
        return;
      }
      if (cap === undefined) return;
      const budget = await prisma.workspaceBudget.findFirst({ where: { workspaceId: action.workspaceId } });
      if (budget) {
        const data: { cap: number; alertPct?: number; label?: string; enforcement?: string } = { cap };
        if (alertPct !== undefined) data.alertPct = alertPct;
        if (label !== undefined && label.length > 0) data.label = label;
        if (enforcement !== undefined) data.enforcement = enforcement;
        await prisma.workspaceBudget.updateMany({ where: { id: budget.id, workspaceId: action.workspaceId }, data });
      } else {
        //? No create-op existed → the first edit creates the budget with sensible defaults (so the editor works
        //? on a fresh workspace without a separate "create budget" flow).
        await prisma.workspaceBudget.create({ data: { workspaceId: action.workspaceId, label: label && label.length > 0 ? label : 'Budget', cap, alertPct: alertPct ?? 80, enforcement: enforcement ?? 'pauseNew' } });
      }
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
      //? KG1 — re-arm the alert push on any budget edit (a new cap/threshold is a fresh crossing).
      const update: { capCents?: number; alertPct?: number; enabled: boolean; alertPushed: boolean } = { enabled, alertPushed: false };
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
      const expectedVersion = await readEntityVersion(prisma, action.workspaceId, ENTITY_VERSION_KEYS.stylePresets);
      const cas = await applyEntityCas(prisma, {
        workspaceId: action.workspaceId, entityKey: ENTITY_VERSION_KEYS.stylePresets,
        expectedVersion, requestId: action.clientRequestId,
        contentHash: createHash('sha256').update(JSON.stringify({ feature, key, label, systemPrompt, preview })).digest('hex'),
      }, async () => {
        const existing = await prisma.stylePreset.findFirst({ where: { workspaceId: action.workspaceId, feature, key } });
        if (existing) return prisma.stylePreset.updateMany({ where: { id: existing.id, workspaceId: action.workspaceId }, data: { label, systemPrompt, ...preview } });
        return prisma.stylePreset.create({ data: { workspaceId: action.workspaceId, feature, key, label, systemPrompt, builtin: false, ...preview } });
      });
      return cas.applied ? cas.result : { ok: false, error: 'write.superseded' };
    }
    case 'delete-style': {
      //? Q3 — remove a per-workspace style (never a global builtin — the filter is workspace-scoped).
      const feature = str(payload, 'feature');
      const key = str(payload, 'key');
      if (!feature || !key) return;
      const expectedVersion = await readEntityVersion(prisma, action.workspaceId, ENTITY_VERSION_KEYS.stylePresets);
      const cas = await applyEntityCas(prisma, {
        workspaceId: action.workspaceId, entityKey: ENTITY_VERSION_KEYS.stylePresets,
        expectedVersion, requestId: action.clientRequestId,
        contentHash: createHash('sha256').update(`delete:${feature}:${key}`).digest('hex'),
      }, () => prisma.stylePreset.deleteMany({ where: { workspaceId: action.workspaceId, feature, key, builtin: false } }));
      return cas.applied ? undefined : { ok: false, error: 'write.superseded' };
    }
    //? GAP_SCAN A7 — store this workspace's platform APP credentials (the once-per-app YouTube/TikTok
    //? registration) encrypted at rest, so a self-hoster never has to edit `.env` + restart. Write-only:
    //? the snapshot reports "configured" and never the values. An empty value CLEARS that half, which falls
    //? the resolver back to `.env`. Nothing is auto-migrated (owner decision).
    case 'save-platform-credentials': {
      const platform = str(payload, 'platform');
      if (platform !== 'youtube' && platform !== 'tiktok') return;
      const parts: { part: 'id' | 'secret'; value: string | undefined }[] = [
        { part: 'id', value: str(payload, 'clientId') },
        { part: 'secret', value: str(payload, 'clientSecret') },
      ];
      for (const { part, value } of parts) {
        if (value === undefined) continue;
        const key = credentialKey(platform, part);
        await (value.trim().length === 0
          ? prisma.envVar.deleteMany({ where: { workspaceId: action.workspaceId, key } })
          : prisma.envVar.upsert({ where: { workspaceId_key: { workspaceId: action.workspaceId, key } }, create: { workspaceId: action.workspaceId, key, value: encryptSecret(value.trim()), secret: true }, update: { value: encryptSecret(value.trim()) } }));
      }
      return;
    }
    //? Save per-workspace media settings (U3): an ENCRYPTED provider API key and/or a per-feature
    //? provider override, both in the EnvVar store (secretBox). Keys are namespaced so they never clash
    //? with the user's app env vars. The providers CONSUME these at dispatch time —
    //? server/media/registry.ts:80-88 reads __provider_key_ / __media_provider_ (env as fallback).
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
      //? Workspace-wide media generation defaults (Content → Settings), each overriding its host-env fallback
      //? (WS_MEDIA_CHEAP / WS_SCENE_CONTINUITY / ELEVENLABS_VOICE_ID). Presence-based: a field only acts when the
      //? client actually sent it, so a key/model save never clears an unrelated pref. Plaintext (not secrets).
      const setPref = async (key: string, on: boolean, value: string): Promise<void> => {
        await (on
          ? prisma.envVar.upsert({ where: { workspaceId_key: { workspaceId: action.workspaceId, key } }, create: { workspaceId: action.workspaceId, key, value, secret: false }, update: { value } })
          : prisma.envVar.deleteMany({ where: { workspaceId: action.workspaceId, key } }));
      };
      if (typeof payload.cheap === 'boolean') await setPref('__media_cheap', payload.cheap, '1');
      if (typeof payload.sceneContinuity === 'boolean') await setPref('__media_scene_continuity', payload.sceneContinuity, 'on');
      const voiceId = str(payload, 'voiceId');
      if (voiceId !== undefined) await setPref('__media_voice_id', voiceId.trim().length > 0, voiceId.trim());
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
      const created = await prisma.channel.create({ data: { workspaceId: action.workspaceId, projectId, name, platform: str(payload, 'platform') ?? 'none', ...(str(payload, 'handle') ? { handle: str(payload, 'handle') } : {}), ...(str(payload, 'brandVoice') ? { brandVoice: str(payload, 'brandVoice') } : {}), aiDisclosureDefault: bool(payload, 'aiDisclosureDefault'), ...(str(payload, 'defaultAccountId') ? { defaultAccountId: str(payload, 'defaultAccountId') } : {}), autopilot: bool(payload, 'autopilot') } });
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
        //? '' → null: defaultStyleId is @db.ObjectId — an empty string made Prisma throw and the WHOLE
        //? edit silently no-op (pre-existing: every channel-edit without a house style saved nothing).
        ...('defaultStyleId' in payload ? { defaultStyleId: (str(payload, 'defaultStyleId') ?? '').trim() || null } : {}),
        ...('aiDisclosureDefault' in payload ? { aiDisclosureDefault: bool(payload, 'aiDisclosureDefault') } : {}),
        ...('defaultAccountId' in payload ? { defaultAccountId: (str(payload, 'defaultAccountId') ?? '').trim() || null } : {}),
        ...('autopilot' in payload ? { autopilot: bool(payload, 'autopilot') } : {}),
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
    //? Inspiration/reference library — a workspace collects great examples (ads/thumbnails/intros) the content
    //? AI emulates the STRUCTURE of. The description is the grounding signal (indexed into per-workspace RAG).
    case 'reference-add': {
      const kind = str(payload, 'kind') ?? 'other';
      const title = str(payload, 'title');
      const description = str(payload, 'description');
      if (!title || !description) return;
      const tags = Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === 'string') : [];
      const id = await addReference(prisma, action.workspaceId, { kind, title, description, ...(str(payload, 'assetUrl') ? { assetUrl: str(payload, 'assetUrl') } : {}), tags });
      broadcastContentDirty(action.workspaceId);
      return { id };
    }
    case 'reference-delete': {
      const id = str(payload, 'referenceId');
      if (!id) return;
      await deleteReference(prisma, action.workspaceId, id);
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'content-edit-product': {
      //? Q2 — the per-workspace product/brand context folded into every creative generation.
      //? Gap-fix: also carries the brand logo (/media upload) the render watermark overlays. Partial
      //? updates: only the provided fields change.
      await prisma.workspace.update({ where: { id: action.workspaceId }, data: {
        ...('productContext' in payload ? { productContext: str(payload, 'productContext') ?? '' } : {}),
        ...('brandLogoUrl' in payload ? { brandLogoUrl: str(payload, 'brandLogoUrl') ?? null } : {}),
      } });
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
    //? KG2 — transcode a rendered mp4 asset to an alternative container (webm/gif) as a NEW sibling asset.
    case 'content-transcode': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      const assetId = str(payload, 'assetId');
      const targetFmt = str(payload, 'format') === 'gif' ? 'gif' : 'webm';
      if (!contentProjectId || !assetId) return;
      const src = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: assetId, contentProjectId } });
      const srcUrl = src?.url ?? '';
      if (!srcUrl.startsWith('/media/') || !srcUrl.endsWith('.mp4')) return { ok: false, status: 'error', error: 'content.notTranscodable' };
      const newUrl = await transcodeContainer(srcUrl.slice('/media/'.length), targetFmt);
      if (!newUrl) return { ok: false, status: 'error', error: 'content.transcodeFailed' };
      const asset = await prisma.contentAsset.create({ data: { workspaceId: action.workspaceId, contentProjectId, kind: 'video', url: newUrl, status: 'ready', metadata: jsonInput({ transcodedFrom: assetId, container: targetFmt }) } });
      await broadcastContentAssetDelta(prisma, action.workspaceId, contentProjectId, asset.id);
      return { url: newUrl };
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
      //? The timeline "decompose" fires no style (no picker there) — fall back to the piece's REMEMBERED style
      //? so standalone decomposes stay on-style. A style passed explicitly wins + is remembered for next time.
      const piece = await prisma.contentProject.findFirst({ where: { workspaceId: action.workspaceId, id: contentProjectId }, select: { styleKey: true } });
      const styleKey = str(payload, 'styleKey') ?? piece?.styleKey ?? '';
      if (str(payload, 'styleKey')) await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { styleKey: str(payload, 'styleKey') } });
      await decomposeIntoScenes(prisma, { workspaceId: action.workspaceId, contentProjectId, scriptId: script.id, ...(sceneDurationMs === undefined ? {} : { sceneDurationMs }), ...(styleKey ? { styleKey } : {}), ...(str(payload, 'extraInstructions') ? { extraInstructions: str(payload, 'extraInstructions') } : {}) });
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
      //? Remember the chosen style on the piece so a later timeline-only decompose stays on-style.
      if (str(payload, 'styleKey')) await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { styleKey: str(payload, 'styleKey') } });
      //? F1 — persist the chosen aspect ratio (9:16/1:1/16:9) so assemble renders it + a later re-render stays on-format.
      const aspect = str(payload, 'aspectRatio');
      if (aspect === '16:9' || aspect === '9:16' || aspect === '1:1') await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { aspectRatio: aspect } });
      //? F2 — persist the caption-delivery mode (sidecar/burn/soft) so assemble applies it + a re-render keeps it.
      const capMode = str(payload, 'captionMode');
      if (capMode === 'sidecar' || capMode === 'burn' || capMode === 'soft') await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { captionMode: capMode } });
      //? H1 (ads) — persist a CTA/end-card line for the ad render (empty clears it).
      if ('ctaText' in payload) await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { ctaText: (str(payload, 'ctaText') ?? '').trim() || null } });
      //? GAP_SCAN F2 — persist the caption LOOK (size/colour/box/word-by-word) so the burn-in pass uses it
      //? and a re-render keeps it. Validated by `parseCaptionStyle`; an unrecognizable blob clears it back
      //? to the plain default rather than being stored as junk.
      if ('captionStyle' in payload) {
        const parsedStyle = parseCaptionStyle(payload.captionStyle);
        await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { captionStyle: parsedStyle === null ? null : jsonInput(parsedStyle) } });
      }
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
    case 'content-trim-audio': {
      //? F9 — audio-editor-lite: trim a standalone audio asset (voice/music/sfx) to [startMs,endMs] + apply a
      //? linear gain, LOCALLY via ffmpeg (no provider cost). Produces a NEW audio asset chained to the source
      //? (I2 lineage). Best-effort: a localize/ffmpeg failure is a no-op (the source is never lost).
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      const assetId = str(payload, 'assetId');
      if (!contentProjectId || !assetId) return;
      const src = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, contentProjectId, id: assetId }, select: { id: true, url: true, kind: true, parentId: true } });
      if (!src?.url) return;
      const inName = await localizeAsset(src.url);
      if (!inName) return;
      const startMs = num(payload, 'startMs') ?? 0;
      const endMs = num(payload, 'endMs') ?? startMs + 1000;
      const gain = clampVolume(num(payload, 'gain'), 1, 4);
      const url = await trimAudioFile(inName, startMs, endMs, gain);
      if (!url) return;
      const asset = await prisma.contentAsset.create({ data: { workspaceId: action.workspaceId, contentProjectId, kind: src.kind, url, status: 'ready', parentId: src.parentId ?? src.id, metadata: jsonInput({ imported: true, trimmed: true, editedBy: userId }) } });
      await broadcastContentAssetDelta(prisma, action.workspaceId, contentProjectId, asset.id);
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
    //? GAP_SCAN F1 — compose a thumbnail for a piece and attach it as a `thumbnail` ContentAsset. The
    //? template path is free (solid colour or an existing asset as background); `backgroundPrompt` opts into
    //? a paid AI background, budget-guarded inside renderThumbnail. The publish path uploads it (YouTube
    //? thumbnails.set); TikTok has no public cover endpoint, so there it stays an asset.
    case 'content-gen-thumbnail': {
      const contentProjectId = str(payload, 'contentProjectId');
      const headline = str(payload, 'headline');
      if (!contentProjectId || !headline) return;
      const piece = await prisma.contentProject.findFirst({ where: { workspaceId: action.workspaceId, id: contentProjectId }, select: { id: true, channelId: true } });
      if (!piece) return { ok: false, status: 'error', error: 'content.notFound' };
      //? Prefer an explicitly-supplied background, else the piece's newest ready image.
      const bgAssetId = str(payload, 'backgroundAssetId');
      const bg = bgAssetId
        ? await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: bgAssetId, status: 'ready' }, select: { url: true } })
        : await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, contentProjectId, kind: 'image', status: 'ready' }, orderBy: { createdAt: 'desc' }, select: { url: true } });
      const brand = await prisma.workspace.findUnique({ where: { id: action.workspaceId }, select: { brandLogoUrl: true } });
      const rendered = await renderThumbnail(prisma, action.workspaceId, {
        headline,
        ...(bg?.url ? { backgroundUrl: bg.url } : {}),
        ...(brand?.brandLogoUrl ? { logoUrl: brand.brandLogoUrl } : {}),
        ...(str(payload, 'backgroundPrompt') ? { backgroundPrompt: str(payload, 'backgroundPrompt') } : {}),
      });
      if (!rendered.ok || !rendered.url) return { ok: false, status: 'error', error: rendered.error ?? 'thumbnail.failed' };
      const asset = await prisma.contentAsset.create({
        data: {
          workspaceId: action.workspaceId, contentProjectId, kind: 'thumbnail', url: rendered.url, status: 'ready',
          metadata: jsonInput({ headline, aiBackground: rendered.aiBackground, costCents: rendered.costCents }),
        },
      });
      broadcastContentDirty(action.workspaceId);
      return { id: asset.id, url: rendered.url, aiBackground: rendered.aiBackground };
    }
    //? GAP_SCAN F5 — post a reply to an inbox comment. The TEXT is the user's (drafted in the inbox,
    //? edited, then approved) — the Conductor only ships it, so an AI draft never posts itself (B-23).
    case 'content-reply-comment': {
      const commentId = str(payload, 'commentId');
      const replyText = (str(payload, 'replyText') ?? '').trim();
      if (!commentId || replyText.length === 0) return { ok: false, status: 'error', error: 'reply.invalidRequest' };
      const posted = await postReply(prisma, action.workspaceId, { commentId, text: replyText }, {
        accessTokenFor: async (platform, accountId) => {
          if (platform !== 'youtube' && platform !== 'tiktok') return null;
          const conn = await getValidConnection(prisma, action.workspaceId, platform, { ...(accountId ? { accountId } : {}) });
          return conn?.accessToken ?? null;
        },
      });
      if (!posted.ok) return { ok: false, status: 'error', error: posted.error ?? 'reply.failed' };
      //? A replied-to comment is handled: mark it read so the inbox reflects reality.
      await prisma.socialComment.updateMany({ where: { workspaceId: action.workspaceId, id: commentId }, data: { read: true } });
      broadcastContentDirty(action.workspaceId);
      return { ok: true };
    }
    //? GAP_SCAN G7 — create or update a prompt A/B experiment. At most ONE running experiment per feature:
    //? two overlapping tests on the same prompt make both unreadable, so starting a new one stops the old.
    case 'prompt-experiment-save': {
      const feature = str(payload, 'feature');
      const variantA = str(payload, 'variantA');
      const variantB = str(payload, 'variantB');
      const expName = str(payload, 'name') ?? feature ?? 'Experiment';
      if (!feature || !variantA || !variantB) return { ok: false, status: 'error', error: 'experiment.invalidRequest' };
      const experimentId = str(payload, 'experimentId');
      if (experimentId) {
        await prisma.promptExperiment.updateMany({ where: { workspaceId: action.workspaceId, id: experimentId }, data: { name: expName, variantA, variantB } });
        return { id: experimentId };
      }
      await prisma.promptExperiment.updateMany({ where: { workspaceId: action.workspaceId, feature, status: 'running' }, data: { status: 'stopped' } });
      const experiment = await prisma.promptExperiment.create({ data: { workspaceId: action.workspaceId, feature, name: expName, variantA, variantB, status: 'running' } });
      return { id: experiment.id };
    }
    //? G7 — stop measuring. Trials are KEPT: the whole value of the experiment is the record of what the
    //? two variants actually achieved, and deleting that on stop would make the feature pointless.
    case 'prompt-experiment-stop': {
      const experimentId = str(payload, 'experimentId');
      if (!experimentId) return { ok: false, status: 'error', error: 'experiment.invalidRequest' };
      await prisma.promptExperiment.updateMany({ where: { workspaceId: action.workspaceId, id: experimentId }, data: { status: 'stopped' } });
      return { ok: true };
    }
    //? F48 — pull a file back out of the trash, or destroy it now. Both are tenant-scoped by id, so a
    //? foreign trash row is simply not found rather than being an error worth distinguishing.
    case 'media-trash-restore': {
      const trashId = str(payload, 'trashId');
      if (!trashId) return { ok: false, status: 'error', error: 'trash.invalidRequest' };
      const ok = await restoreFromTrash(prisma, action.workspaceId, trashId);
      if (!ok) return { ok: false, status: 'error', error: 'trash.notFound' };
      broadcastContentDirty(action.workspaceId);
      return { ok: true };
    }
    case 'media-trash-purge': {
      const trashId = str(payload, 'trashId');
      if (!trashId) return { ok: false, status: 'error', error: 'trash.invalidRequest' };
      const ok = await purgeTrashItem(prisma, action.workspaceId, trashId);
      if (!ok) return { ok: false, status: 'error', error: 'trash.notFound' };
      broadcastContentDirty(action.workspaceId);
      return { ok: true };
    }
    //? GAP_SCAN G4 — mark an asset as part of the workspace's reusable library (or take it out).
    case 'asset-star': {
      const assetId = str(payload, 'assetId');
      if (!assetId) return { ok: false, status: 'error', error: 'asset.invalidRequest' };
      const res = await setAssetStarred(prisma, action.workspaceId, assetId, bool(payload, 'starred'));
      if (!res.ok) return { ok: false, status: 'error', error: 'asset.notFound' };
      broadcastContentDirty(action.workspaceId);
      return { ok: true };
    }
    //? GAP_SCAN G3 — put a generated Studio page live at /s/<slug> (re-publishing keeps the same URL).
    case 'studio-publish-site': {
      const artifactId = str(payload, 'artifactId');
      if (!artifactId) return { ok: false, status: 'error', error: 'site.invalidRequest' };
      const published = await publishArtifactSite(prisma, action.workspaceId, artifactId, publicBaseUrl());
      if (!published.ok) return { ok: false, status: 'error', error: published.error ?? 'site.failed' };
      broadcastContentDirty(action.workspaceId);
      return { slug: published.slug, url: published.url };
    }
    case 'studio-unpublish-site': {
      const slug = str(payload, 'slug');
      if (!slug) return { ok: false, status: 'error', error: 'site.invalidRequest' };
      await unpublishArtifactSite(prisma, action.workspaceId, slug);
      broadcastContentDirty(action.workspaceId);
      return { ok: true };
    }
    case 'content-critique-image': {
      //? F5 — AI critique of an existing IMAGE asset ("what should change about this photo"). A vision model
      //? reads the pixels + returns concrete edit suggestions; the result is stored on the asset's metadata so
      //? the UI shows it under the image. Advisory only — never edits the asset (the user runs an edit op next).
      const contentProjectId = str(payload, 'contentProjectId');
      const assetId = str(payload, 'assetId');
      if (!contentProjectId || !assetId) return;
      const asset = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: assetId, kind: 'image' }, select: { url: true, metadata: true } });
      if (!asset?.url) return;
      const critique = await critiqueImage(prisma, { workspaceId: action.workspaceId, imageUrl: asset.url, ...(str(payload, 'prompt') ? { userNote: str(payload, 'prompt') } : {}) });
      const meta = (asset.metadata !== null && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)) ? { ...(asset.metadata as Record<string, unknown>) } : {};
      meta.critique = critique.critique;
      meta.critiqueStub = critique.stub;
      await prisma.contentAsset.update({ where: { id: assetId }, data: { metadata: jsonInput(meta) } });
      await broadcastContentAssetDelta(prisma, action.workspaceId, contentProjectId, assetId);
      return;
    }
    case 'content-video-restyle': {
      //? F7 — video-to-video restyle ("make this clip cinematic"): take a SOURCE video (an uploaded/generated
      //? asset's url, or a raw referenceUrl) + a style prompt → a NEW restyled video asset (fal v2v). Chains to
      //? the source for lineage (I2). Goes through the queue-aware generateMediaAsset (honest stub without a key).
      const contentProjectId = str(payload, 'contentProjectId');
      const prompt = str(payload, 'prompt');
      let referenceUrl = str(payload, 'referenceUrl');
      const sourceAssetId = str(payload, 'assetId');
      if (!contentProjectId || !prompt) return;
      if (!referenceUrl && sourceAssetId) {
        const src = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: sourceAssetId, kind: 'video' }, select: { url: true } });
        referenceUrl = src?.url ?? undefined;
      }
      if (!referenceUrl) return;
      const r = await generateMediaAsset(prisma, { workspaceId: action.workspaceId, contentProjectId, feature: 'video-restyle', prompt, referenceUrl, label: 'Video restyle' });
      if (r.assetId && sourceAssetId) {
        const parent = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: sourceAssetId }, select: { id: true, parentId: true } });
        if (parent) await prisma.contentAsset.update({ where: { id: r.assetId }, data: { parentId: parent.parentId ?? parent.id } });
      }
      if (r.assetId) await broadcastContentAssetDelta(prisma, action.workspaceId, contentProjectId, r.assetId);
      return;
    }
    case 'capture-run': {
      //? I1 (demo-video) — capture a running app (a preview/env URL) into an mp4 via the workspaces/capture
      //? container, following a scenario (I2 AI-authored, or a default screen-hold). The captured mp4 becomes a
      //? video ContentAsset (I3 then drops it into the timeline via the upload→scene picker). B-23: Conductor writes.
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      const url = str(payload, 'url');
      if (!contentProjectId || !url || !/^https?:\/\//.test(url)) return { ok: false, status: 'error', error: 'capture.badUrl' };
      //? Scenario precedence: an explicit one (client-provided) → an AI-authored one (I2, when a `goal` is set) →
      //? the deterministic route-walk. Routes come from the payload (the app's own routes) or default to '/'.
      const routes = Array.isArray(payload.routes) ? payload.routes.filter((r): r is string => typeof r === 'string').map((p) => ({ path: p })) : [{ path: '/' }];
      const explicit = coerceScenario(payload.scenario);
      const goal = str(payload, 'goal');
      const scenario = explicit ?? (goal ? await generateCaptureScenario(prisma, action.workspaceId, goal, routes) : buildCaptureScenario(routes));
      const cap = await runCapture(url, scenario);
      if (!cap.ok || !cap.url) return { ok: false, status: 'error', error: cap.error ?? 'capture.failed' };
      const asset = await prisma.contentAsset.create({ data: { workspaceId: action.workspaceId, contentProjectId, kind: 'video', url: cap.url, status: 'ready', metadata: jsonInput({ imported: true, capture: true, editedBy: userId }) } });
      await broadcastContentAssetDelta(prisma, action.workspaceId, contentProjectId, asset.id);
      return { ok: true, assetId: asset.id };
    }
    case 'shortlink-create': {
      //? H3 (ads) — create a trackable short link (`/l/<slug>` → click + redirect to targetUrl). A slug is
      //? auto-derived from the target (or a provided one), made unique with a short random suffix. Optional
      //? contentProjectId + A/B `variant`. The Conductor is the only writer (B-23).
      const targetUrl = str(payload, 'targetUrl');
      if (!targetUrl || !/^https?:\/\//.test(targetUrl)) return { ok: false, status: 'error', error: 'shortlink.badTarget' };
      const base = (str(payload, 'slug') ?? targetUrl).toLowerCase().replaceAll(/^https?:\/\//g, '').replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 24) || 'link';
      const slug = `${base}-${randomBytes(3).toString('hex')}`;
      const link = await prisma.shortLink.create({ data: { workspaceId: action.workspaceId, slug, targetUrl, ...(str(payload, 'contentProjectId') ? { contentProjectId: str(payload, 'contentProjectId') } : {}), ...(str(payload, 'variant') ? { variant: str(payload, 'variant') } : {}) } });
      broadcastContentDirty(action.workspaceId);
      return { ok: true, id: link.id, slug };
    }
    case 'content-edit-image': {
      //? F6 — instruct-edit ("change the sky to sunset"): a WHOLE source image (an asset's url or a raw
      //? referenceUrl) + an instruction → a NEW edited image (fal flux-kontext, mask-less). Chains to the source
      //? for lineage (I2). Queue-aware generateMediaAsset (honest stub without a key).
      const contentProjectId = str(payload, 'contentProjectId');
      const prompt = str(payload, 'prompt');
      let referenceUrl = str(payload, 'referenceUrl');
      const sourceAssetId = str(payload, 'assetId');
      if (!contentProjectId || !prompt) return;
      if (!referenceUrl && sourceAssetId) {
        const src = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: sourceAssetId, kind: { in: ['image', 'render'] } }, select: { url: true } });
        referenceUrl = src?.url ?? undefined;
      }
      if (!referenceUrl) return;
      const r = await generateMediaAsset(prisma, { workspaceId: action.workspaceId, contentProjectId, feature: 'image-edit', prompt, referenceUrl, label: 'Instruct edit' });
      if (r.assetId && sourceAssetId) {
        const parent = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: sourceAssetId }, select: { id: true, parentId: true } });
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
      //? `piece` was fetched scoped to this workspaceId above, so updating by its id is tenant-safe.
      const updated = dest
        ? await prisma.contentProject.update({ where: { id: piece.id }, data: { stageId: dest, status: 'idle' } }) // luckystack-allow tenant-scope: piece fetched scoped to workspaceId above
        : await prisma.contentProject.update({ where: { id: piece.id }, data: { status: 'done' } }); // luckystack-allow tenant-scope: piece fetched scoped to workspaceId above
      //? P7 — a single-piece structural change: push the ONE fresh piece (granular upsert) rather than the
      //? coarse contentDirty full refetch. The `contentControl` route skips its contentDirty for this op.
      await broadcastContentPieceDelta(prisma, action.workspaceId, contentProjectId);
      return updated;
    }
    case 'content-archive': {
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (contentProjectId) { await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { archived: true } }); await broadcastContentPieceDelta(prisma, action.workspaceId, contentProjectId); }
      return;
    }
    case 'content-unarchive': {
      //? S2 — soft-undo of an archive: restore the piece. Non-destructive (the row was never deleted).
      const contentProjectId = str(target, 'contentProjectId') ?? str(payload, 'contentProjectId');
      if (contentProjectId) { await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { archived: false } }); await broadcastContentPieceDelta(prisma, action.workspaceId, contentProjectId); }
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
      const styles = await exportStyleSet(prisma, sourceWorkspaceId);
      const styleVersion = await readEntityVersion(prisma, action.workspaceId, ENTITY_VERSION_KEYS.stylePresets);
      await applyEntityCas(prisma, {
        workspaceId: action.workspaceId, entityKey: ENTITY_VERSION_KEYS.stylePresets,
        expectedVersion: styleVersion, requestId: `${action.clientRequestId}:styles`,
        contentHash: createHash('sha256').update(JSON.stringify(styles)).digest('hex'),
      }, () => importStyleSet(prisma, action.workspaceId, styles));
      const brand = await exportBrandKit(prisma, sourceWorkspaceId);
      if (brand) {
        const brandVersion = await readEntityVersion(prisma, action.workspaceId, ENTITY_VERSION_KEYS.brandLibrary);
        await applyEntityCas(prisma, {
          workspaceId: action.workspaceId, entityKey: ENTITY_VERSION_KEYS.brandLibrary,
          expectedVersion: brandVersion, requestId: `${action.clientRequestId}:brand`,
          contentHash: createHash('sha256').update(JSON.stringify(brand)).digest('hex'),
        }, () => saveBrandLibrary(prisma, action.workspaceId, brand));
      }
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
      //? S2/#131 — retract a published post: best-effort PLATFORM DELETE (YouTube deletes via the API; TikTok
      //? has no public delete endpoint → retract-only) THEN mark the done PublishJob 'unpublished'. The delete
      //? never blocks the local status change. Spend is monotonic; refunds are out of scope (flagged).
      const assetId = str(payload, 'assetId');
      const platform = str(payload, 'platform');
      if (!assetId || !platform) return;
      const job = await prisma.publishJob.findFirst({ where: { workspaceId: action.workspaceId, assetId, platform, status: 'done' }, select: { externalId: true } });
      if (job?.externalId) await deletePlatformPost(prisma, action.workspaceId, platform, job.externalId);
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
      //? Gap-fix (render settings): the assemble call can carry an aspect ratio (persisted on the piece —
      //? the backend was ready but no UI could ever set it) and/or an OutputTemplate — which was pure CRUD
      //? without effect; its format + watermarkPosition now actually drive the render.
      let wmPosition = str(payload, 'watermarkPosition');
      const assembleAspect = str(payload, 'aspectRatio');
      if (assembleAspect === '16:9' || assembleAspect === '9:16' || assembleAspect === '1:1') {
        await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { aspectRatio: assembleAspect } });
      }
      const templateId = str(payload, 'templateId');
      if (templateId) {
        const tpl = await prisma.outputTemplate.findFirst({ where: { workspaceId: action.workspaceId, id: templateId } });
        if (tpl) {
          if (tpl.format === '16:9' || tpl.format === '9:16' || tpl.format === '1:1') {
            await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { aspectRatio: tpl.format } });
          }
          if (tpl.watermarkPosition) wmPosition ??= tpl.watermarkPosition;
        }
      }
      await assembleContent(prisma, { workspaceId: action.workspaceId, contentProjectId, ...(wmPosition ? { watermarkPosition: wmPosition } : {}) });
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
      const genPrompt = str(payload, 'prompt');
      const genStyleKey = str(payload, 'styleKey');
      const genExtra = str(payload, 'extraInstructions');
      let referenceUrl = str(payload, 'referenceUrl');
      //? #133 — model-3d (image-to-3D, e.g. triposr) takes a SOURCE IMAGE, not a prompt. If none was
      //? supplied, generate an image from the prompt FIRST, then convert it → the described chain.
      if (feature === 'model-3d' && !referenceUrl && genPrompt) {
        const img = await generateMediaAsset(prisma, {
          workspaceId: action.workspaceId, contentProjectId, feature: 'image-gen', prompt: genPrompt,
          ...(genStyleKey ? { styleKey: genStyleKey } : {}), ...(genExtra ? { extraInstructions: genExtra } : {}),
        });
        if (img.ok && img.assetId) {
          const asset = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: img.assetId }, select: { url: true } });
          referenceUrl = asset?.url ?? undefined;
        }
      }
      await generateMediaAsset(prisma, {
        workspaceId: action.workspaceId, contentProjectId, feature,
        ...(genPrompt ? { prompt: genPrompt } : {}),
        ...(referenceUrl ? { referenceUrl } : {}),
        ...(genStyleKey ? { styleKey: genStyleKey } : {}),
        ...(genExtra ? { extraInstructions: genExtra } : {}),
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
      //? C1 — an optional `scheduledAt` (ISO) parks the post for later; the leader loop (runScheduledPublish)
      //? fires it when due. Only kept when it is a valid FUTURE timestamp, else it publishes on accept.
      const schedRaw = str(payload, 'scheduledAt');
      const schedMs = schedRaw ? Date.parse(schedRaw) : Number.NaN;
      const scheduledAt = Number.isFinite(schedMs) && schedMs > Date.now() ? new Date(schedMs).toISOString() : null;
      //? G1 — the publish composer can set a per-platform caption/hashtags/privacy. Persist them into the
      //? piece's `publishVariants` JSON (merged by platform) BEFORE publishing, so the upload's
      //? extractPublishVariant reads them instead of falling back to a private, title-only post.
      const caption = str(payload, 'caption');
      const privacy = str(payload, 'privacy');
      const hashtags = strArr(payload, 'hashtags');
      //? Channel-binding (gap-fix): the piece's channel supplies the DEFAULT publish account and — on an
      //? autopilot channel — replaces the per-post approval (the autopilot switch IS the consent, ADR).
      const pieceRow = await prisma.contentProject.findFirst({ where: { workspaceId: action.workspaceId, id: contentProjectId }, select: { channelId: true } });
      const channelRow = pieceRow?.channelId ? await prisma.channel.findFirst({ where: { workspaceId: action.workspaceId, id: pieceRow.channelId } }) : null;
      const effectiveAccountId = accountId ?? channelRow?.defaultAccountId ?? undefined;
      //? AI-disclosure (EU AI Act art. 50 / platform policy): the composer's synthetic-media checkbox —
      //? persisted per platform so the upload adapter sets the platform's disclosure flag. Absent (an
      //? autopilot run has no human ticking boxes) → the channel's aiDisclosureDefault applies.
      const syntheticMedia = 'syntheticMedia' in payload ? bool(payload, 'syntheticMedia') : (channelRow?.autopilot ? channelRow.aiDisclosureDefault : undefined);
      const hasVariant = caption !== undefined || (privacy === 'public' || privacy === 'unlisted' || privacy === 'private') || hashtags.length > 0 || syntheticMedia !== undefined;
      if (hasVariant) {
        const proj = await prisma.contentProject.findFirst({ where: { workspaceId: action.workspaceId, id: contentProjectId }, select: { publishVariants: true } });
        const existing = proj?.publishVariants;
        const current: Record<string, unknown> = (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) ? { ...(existing as Record<string, unknown>) } : {};
        current[platform] = {
          ...(caption === undefined ? {} : { caption }),
          ...(hashtags.length > 0 ? { hashtags } : {}),
          ...(privacy === 'public' || privacy === 'unlisted' || privacy === 'private' ? { privacy } : {}),
          ...(syntheticMedia === undefined ? {} : { syntheticMedia }),
        };
        await prisma.contentProject.updateMany({ where: { workspaceId: action.workspaceId, id: contentProjectId }, data: { publishVariants: jsonInput(current) } });
      }
      //? @adr 0269
      //? AUTOPILOT (per-channel opt-in consent): the channel owner explicitly flipped autopilot ON,
      //? which IS the prior approval for publishing from this channel — so skip the suggestion and post
      //? now (through the same publishAsset path a human accept would take; B-23 intact: the Conductor is
      //? still the only writer). Every autopilot post lands in the Activity feed. The kill-switch is the
      //? channel toggle itself.
      if (channelRow?.autopilot) {
        const startedAt = Date.now();
        const published = await publishAsset(prisma, action.workspaceId, { contentProjectId, assetId, platform, ...(effectiveAccountId ? { accountId: effectiveAccountId } : {}), scheduledAt: scheduledAt ? new Date(scheduledAt) : null });
        recordAiRun({
          workspaceId: action.workspaceId, feature: 'autopilot-publish', label: `Autopilot · ${channelRow.name} → ${platform}`,
          prompt: `piece ${contentProjectId} asset ${assetId}${effectiveAccountId ? ` account ${effectiveAccountId}` : ''}`,
          output: published.externalUrl ?? (published.scheduled ? 'scheduled' : ''), providerId: platform,
          status: published.ok ? 'ok' : 'error', ...(published.error ? { error: published.error } : {}), startedAt,
        });
        broadcastContentDirty(action.workspaceId);
        return published;
      }
      const acctLabel = effectiveAccountId ? ` (${effectiveAccountId})` : '';
      const title = scheduledAt ? `Schedule for ${platform}${acctLabel}` : `Publish to ${platform}${acctLabel}`;
      const body = scheduledAt ? `Schedule this content for ${platform} at ${scheduledAt}?` : `Ready to publish this content to ${platform}? This is public and hard to undo.`;
      return prisma.workspaceSuggestion.create({ data: { workspaceId: action.workspaceId, type: 'publish', title, body, patch: { contentProjectId, assetId, platform, ...(effectiveAccountId ? { accountId: effectiveAccountId } : {}), ...(scheduledAt ? { scheduledAt } : {}) } } });
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
      //? #126 — reuse ONE shared content Project per workspace (was a new Project per piece → project
      //? sprawl; pieces can now share a board/project). Create the shared project lazily on first use.
      let project = await prisma.project.findFirst({ where: { workspaceId: action.workspaceId, projectType: 'content' }, orderBy: { createdAt: 'asc' } });
      project ??= await prisma.project.create({ data: { workspaceId: action.workspaceId, name: str(payload, 'channelName') ?? 'Content', projectType: 'content', gitlabPath: '' } });
      //? A4 — bind the piece to a channel when given ("make a video for channel Z"), so generation grounds on
      //? that channel's brand voice (brandContext + brand-RAG).
      const channelId = str(payload, 'channelId');
      return prisma.contentProject.create({ data: { workspaceId: action.workspaceId, projectId: project.id, title: str(payload, 'title') ?? 'New content', brief, format: str(payload, 'format') ?? 'faceless', ...(channelId ? { channelId } : {}) } });
    }
    //? Send-to-Content (gap-fix "verbind de eilanden"): hand a ready Studio artifact over to the content
    //? lane — a new piece whose brief carries the artifact, plus a 'script' asset holding its body, so
    //? thumbnails/scripts/landing copy stop needing a manual download → re-upload round-trip.
    case 'studio-send-to-content': {
      const artifactId = str(payload, 'artifactId');
      if (!artifactId) return;
      const artifact = await prisma.studioArtifact.findFirst({ where: { workspaceId: action.workspaceId, id: artifactId } });
      if (artifact?.status !== 'ready') return { ok: false, error: 'studio.artifactNotReady' };
      const studioBrief = await prisma.studioBrief.findFirst({ where: { workspaceId: action.workspaceId, id: artifact.briefId } });
      let contentProj = await prisma.project.findFirst({ where: { workspaceId: action.workspaceId, projectType: 'content' }, orderBy: { createdAt: 'asc' } });
      contentProj ??= await prisma.project.create({ data: { workspaceId: action.workspaceId, name: 'Content', projectType: 'content', gitlabPath: '' } });
      const piece = await prisma.contentProject.create({ data: {
        workspaceId: action.workspaceId, projectId: contentProj.id,
        title: artifact.title,
        brief: `From Studio (${artifact.kind})${studioBrief ? ` — ${studioBrief.productName}` : ''}: use the attached ${artifact.kind} artifact as the starting material.`,
        format: artifact.kind === 'videoScript' ? 'faceless' : 'image',
      } });
      await prisma.contentAsset.create({ data: {
        workspaceId: action.workspaceId, contentProjectId: piece.id, kind: 'script', url: null, status: 'ready',
        metadata: jsonInput({ source: 'studio', artifactId: artifact.id, artifactKind: artifact.kind, body: JSON.stringify(artifact.content).slice(0, 60_000) }),
      } });
      broadcastContentDirty(action.workspaceId);
      return piece;
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
      if (!sourceId) return;
      const skill = await prisma.skill.updateMany({ where: { workspaceId: action.workspaceId, id: sourceId, skillType: 'capability' }, data: { enabled: bool(payload, 'on') } });
      //? The frozen op also toggles context documents on the Sources page. Capabilities moved to Skill;
      //? context docs intentionally remain InfoSource, so fall back only when no canonical skill matched.
      if (skill.count === 0) await prisma.infoSource.updateMany({ where: { workspaceId: action.workspaceId, id: sourceId, mode: 'context-doc' }, data: { enabled: bool(payload, 'on') } });
      return;
    }
    //? SK1 (DOCUMENTS_AND_SKILLS) — prompt-instruction skills share the canonical Skill store with
    //? workflow capabilities; skillType prevents either UI/control path from mutating the other semantic kind.
    case 'ai-skill-save': {
      const skillId = str(payload, 'skillId');
      const name = (str(payload, 'name') ?? '').trim();
      const instruction = str(payload, 'instruction') ?? '';
      const examples = str(payload, 'examples') ?? '';
      const applyPoints = Array.isArray(payload.applyPoints) ? payload.applyPoints.filter((p): p is string => typeof p === 'string' && (SKILL_APPLY_POINTS as readonly string[]).includes(p)) : [];
      if (skillId) {
        await prisma.skill.updateMany({ where: { workspaceId: action.workspaceId, id: skillId, skillType: 'instruction' }, data: { ...(name ? { name } : {}), instruction, examples, applyPoints } });
        broadcastContentDirty(action.workspaceId);
        return;
      }
      if (!name) return;
      const slug = `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '').slice(0, 40) || 'skill'}-${Date.now().toString(36)}`;
      const created = await prisma.skill.create({ data: { workspaceId: action.workspaceId, slug, name, instruction, examples, applyPoints, skillType: 'instruction', enabled: bool(payload, 'enabled') } });
      broadcastContentDirty(action.workspaceId);
      return { id: created.id };
    }
    case 'ai-skill-toggle': {
      const skillId = str(payload, 'skillId');
      if (skillId) { await prisma.skill.updateMany({ where: { workspaceId: action.workspaceId, id: skillId, skillType: 'instruction' }, data: { enabled: bool(payload, 'on') } }); broadcastContentDirty(action.workspaceId); }
      return;
    }
    case 'ai-skill-delete': {
      const skillId = str(payload, 'skillId');
      //? builtins are never deletable (only resettable) — deleteMany's builtin:false filter enforces it.
      if (skillId) { await prisma.skill.deleteMany({ where: { workspaceId: action.workspaceId, id: skillId, skillType: 'instruction', builtin: false } }); broadcastContentDirty(action.workspaceId); }
      return;
    }
    case 'ai-skill-reset': {
      const skillId = str(payload, 'skillId');
      if (!skillId) return;
      const row = await prisma.skill.findFirst({ where: { workspaceId: action.workspaceId, id: skillId, skillType: 'instruction', builtin: true }, select: { slug: true } });
      const seed = row ? builtinSkillDefault(row.slug) : null;
      if (seed) { await prisma.skill.updateMany({ where: { workspaceId: action.workspaceId, id: skillId, skillType: 'instruction' }, data: { name: seed.name, instruction: seed.instruction, applyPoints: seed.applyPoints, examples: '' } }); broadcastContentDirty(action.workspaceId); }
      return;
    }
    //? DOC (DOCUMENTS_AND_SKILLS) — the Documents module. The Conductor is the ONLY writer of
    //? Document.content; AI output lands as aiDraft and document-apply-draft is the consent (B-23).
    case 'document-create': {
      const title = (str(payload, 'title') ?? '').trim();
      if (!title) return;
      //? DESIGN_DOCS_PROGRAM 2.1 — an optional template seeds the doc's `kind` + a starting section skeleton.
      const templateSlug = str(payload, 'templateSlug') ?? '';
      let content = str(payload, 'content') ?? '';
      let kind = str(payload, 'kind') ?? '';
      if (templateSlug) {
        const tpl = await resolveTemplate(prisma, action.workspaceId, templateSlug);
        if (tpl) { content = content.trim().length > 0 ? content : buildSkeleton(title, tpl.sections); kind = templateSlug; }
      }
      const created = await prisma.document.create({ data: { workspaceId: action.workspaceId, title, content, ...(kind ? { kind } : {}) } });
      await tryCatch(() => indexDocument(prisma, action.workspaceId, created.id, created.title, created.content));
      broadcastContentDirty(action.workspaceId);
      return { id: created.id };
    }
    case 'document-edit': {
      const documentId = str(payload, 'documentId');
      if (!documentId) return;
      const doc = await prisma.document.findFirst({ where: { workspaceId: action.workspaceId, id: documentId } });
      if (!doc) return;
      const title = (str(payload, 'title') ?? '').trim() || doc.title;
      const content = 'content' in payload ? (str(payload, 'content') ?? '') : doc.content;
      //? A manual overwrite of non-trivial content snapshots the previous version (history/undo).
      if ('content' in payload && content !== doc.content && doc.content.trim().length > 0) {
        await prisma.documentRevision.create({ data: { workspaceId: action.workspaceId, documentId, content: doc.content, note: 'edit' } });
        await pruneDocumentRevisions(prisma, action.workspaceId, documentId);
      }
      //? Optional asset attach (uploaded via /media/upload) — appended alongside the text fields. A
      //? parseable source file (pdf/docx/txt/md) starts as extractStatus 'pending'; its text is extracted
      //? off the write lock (1.2) and persisted by document-set-asset-text.
      const addUrl = str(payload, 'addAssetUrl');
      const addExt = addUrl ? (addUrl.split('.').pop() ?? '').toLowerCase() : '';
      const willExtract = addUrl !== undefined && isParseableUpload(addExt);
      const prevAssets = Array.isArray(doc.assets) ? doc.assets : [];
      const assets = addUrl ? [...prevAssets, { kind: str(payload, 'addAssetKind') ?? 'file', url: addUrl, label: str(payload, 'addAssetLabel') ?? '', ...(willExtract ? { extractStatus: 'pending' } : {}) }] : undefined;
      await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { title, content, ...(assets ? { assets } : {}) } });
      await tryCatch(() => indexDocument(prisma, action.workspaceId, documentId, title, content));
      //? Fire-and-forget: parse the uploaded source, then enqueue the persist+index op (never blocks the write).
      if (willExtract) void extractDocumentAssetText(action.workspaceId, documentId, addUrl, userId);
      broadcastContentDirty(action.workspaceId);
      return;
    }
    //? DESIGN_DOCS_PROGRAM 1.2/1.3 — persist an uploaded file's extracted text onto its Document.assets
    //? entry + index it into the doc-assets corpus. Enqueued by extractDocumentAssetText (server-internal).
    case 'document-set-asset-text': {
      const documentId = str(payload, 'documentId') ?? str(target, 'documentId');
      const url = str(payload, 'url');
      if (!documentId || !url) return;
      const doc = await prisma.document.findFirst({ where: { workspaceId: action.workspaceId, id: documentId } });
      if (!doc) return;
      const status = str(payload, 'status') ?? 'failed';
      const text = str(payload, 'text') ?? '';
      const prevRaw = Array.isArray(doc.assets) ? doc.assets : [];
      const next = prevRaw.map((a) => {
        if (a === null || typeof a !== 'object' || Array.isArray(a)) return a;
        const rec = a as Record<string, unknown>;
        if (rec.url !== url) return a;
        return { ...rec, extractStatus: status, ...(status === 'ok' ? { extractedText: text } : {}) };
      });
      await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { assets: next } });
      if (status === 'ok' && text.trim().length > 0) await tryCatch(() => indexDocumentAsset(prisma, action.workspaceId, documentId, url, text));
      broadcastContentDirty(action.workspaceId);
      return;
    }
    //? GAP_SCAN C7 — the `archived` column existed with NO op to write it: a finished document could only
    //? be deleted (losing its revisions + RAG rows) or kept cluttering the list forever. Archive hides it
    //? from the default list; restore brings it back. Both keep every revision.
    case 'document-archive':
    case 'document-unarchive': {
      const documentId = str(payload, 'documentId');
      if (!documentId) return;
      await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { archived: action.op === 'document-archive' } });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'document-delete': {
      const documentId = str(payload, 'documentId');
      if (!documentId) return;
      await prisma.documentRevision.deleteMany({ where: { workspaceId: action.workspaceId, documentId } });
      await prisma.document.deleteMany({ where: { workspaceId: action.workspaceId, id: documentId } });
      //? Clear its RAG rows (content + uploaded-source corpora; best-effort — a failed cleanup must not fail the delete).
      await tryCatch(() => indexDocument(prisma, action.workspaceId, documentId, '', ''));
      await tryCatch(() => clearDocumentAssets(prisma, action.workspaceId, documentId));
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'document-ai': {
      const documentId = str(payload, 'documentId');
      if (!documentId) return;
      const doc = await prisma.document.findFirst({ where: { workspaceId: action.workspaceId, id: documentId } });
      if (!doc) return;
      const mode = (['generate', 'rewrite', 'summarize', 'extend'] as const).find((m) => m === str(payload, 'mode')) ?? 'rewrite';
      const instruction = str(payload, 'instruction') ?? '';
      const docAssets = parseAssetEntries(doc.assets);
      //? DESIGN_DOCS_PROGRAM 2.1 — a templated doc (kind = a template slug) generates against the template's
      //? required section structure (outline-then-sections).
      let structure: string | undefined;
      if (doc.kind) { const tpl = await resolveTemplate(prisma, action.workspaceId, doc.kind); if (tpl) structure = buildTemplateStructure(tpl); }
      const res = await runDocumentAi(prisma, action.workspaceId, { id: doc.id, title: doc.title, content: doc.content, assets: docAssets }, mode, instruction, structure);
      if (!res.ok) return { ok: false, status: 'error', error: res.error ?? 'ai.failed' };
      await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { aiDraft: res.text, aiDraftLabel: `${mode}${instruction.trim() ? `: ${instruction.trim().slice(0, 80)}` : ''}` } });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'document-apply-draft': {
      const documentId = str(payload, 'documentId');
      if (!documentId) return;
      const doc = await prisma.document.findFirst({ where: { workspaceId: action.workspaceId, id: documentId } });
      if (!doc) return;
      if (doc.aiDraft === null) return;
      const draft = doc.aiDraft;
      if (doc.content.trim().length > 0) {
        await prisma.documentRevision.create({ data: { workspaceId: action.workspaceId, documentId, content: doc.content, note: `ai: ${doc.aiDraftLabel}` } });
        await pruneDocumentRevisions(prisma, action.workspaceId, documentId);
      }
      await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { content: draft, aiDraft: null, aiDraftLabel: '' } });
      await tryCatch(() => indexDocument(prisma, action.workspaceId, documentId, doc.title, draft));
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'document-discard-draft': {
      const documentId = str(payload, 'documentId');
      if (documentId) { await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { aiDraft: null, aiDraftLabel: '' } }); broadcastContentDirty(action.workspaceId); }
      return;
    }
    //? DESIGN_DOCS_PROGRAM 2.5 — restore a prior revision as the current content. Snapshots the current
    //? content first (so a restore is itself undoable), then reindexes. Single writer (B-23).
    case 'document-restore-revision': {
      const documentId = str(payload, 'documentId');
      const revisionId = str(payload, 'revisionId');
      if (!documentId || !revisionId) return;
      const doc = await prisma.document.findFirst({ where: { workspaceId: action.workspaceId, id: documentId } });
      const rev = await prisma.documentRevision.findFirst({ where: { workspaceId: action.workspaceId, id: revisionId, documentId } });
      if (!doc || !rev) return;
      if (doc.content.trim().length > 0 && doc.content !== rev.content) {
        await prisma.documentRevision.create({ data: { workspaceId: action.workspaceId, documentId, content: doc.content, note: 'edit' } });
        await pruneDocumentRevisions(prisma, action.workspaceId, documentId);
      }
      await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { content: rev.content, aiDraft: null, aiDraftLabel: '' } });
      await tryCatch(() => indexDocument(prisma, action.workspaceId, documentId, doc.title, rev.content));
      broadcastContentDirty(action.workspaceId);
      return;
    }
    //? DESIGN_DOCS_PROGRAM 2.1 — user-authorable document templates (option B). Save = upsert by slug (a
    //? builtin slug gets a workspace override row); delete removes the row (for a builtin slug that reverts
    //? it to the virtual builtin, i.e. a reset). Single writer (B-23).
    case 'doc-template-save': {
      const name = (str(payload, 'name') ?? '').trim();
      if (!name) return;
      const parsed = parseSections(payload.sections);
      if (parsed.length === 0) return;
      //? Plain-object array for the Json column (a named interface isn't InputJsonValue-assignable).
      const sections = parsed.map((s) => ({ heading: s.heading, hint: s.hint }));
      const description = str(payload, 'description') ?? '';
      const slug = (str(payload, 'slug') ?? '').trim() || `tpl-${randomUUID().slice(0, 8)}`;
      const existing = await prisma.documentTemplate.findFirst({ where: { workspaceId: action.workspaceId, slug } });
      await (existing
        ? prisma.documentTemplate.updateMany({ where: { workspaceId: action.workspaceId, slug }, data: { name, description, sections } })
        : prisma.documentTemplate.create({ data: { workspaceId: action.workspaceId, slug, name, description, sections, builtin: false } }));
      broadcastContentDirty(action.workspaceId);
      return { slug };
    }
    case 'doc-template-delete': {
      const slug = (str(payload, 'slug') ?? '').trim();
      if (!slug) return;
      await prisma.documentTemplate.deleteMany({ where: { workspaceId: action.workspaceId, slug } });
      broadcastContentDirty(action.workspaceId);
      return;
    }
    //? EXP — render the markdown source to a target format; the produced file lands in the media
    //? store and is appended to the document's assets (kind 'export') so the UI lists + links it.
    case 'document-export': {
      const documentId = str(payload, 'documentId');
      const format = DOCUMENT_EXPORT_FORMATS.find((f) => f === str(payload, 'format'));
      if (!documentId || !format) return;
      const doc = await prisma.document.findFirst({ where: { workspaceId: action.workspaceId, id: documentId } });
      if (!doc) return;
      const ws = await prisma.workspace.findUnique({ where: { id: action.workspaceId }, select: { brandLogoUrl: true } });
      const res = await exportDocument({ id: doc.id, title: doc.title, content: doc.content }, format, ws?.brandLogoUrl ?? null, action.workspaceId);
      if (!res.ok || !res.url) return { ok: false, status: 'error', error: res.error ?? 'export.failed' };
      const prevAssets2 = Array.isArray(doc.assets) ? doc.assets : [];
      await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { assets: [...prevAssets2, { kind: 'export', url: res.url, label: format }] } });
      broadcastContentDirty(action.workspaceId);
      return { url: res.url };
    }
    //? CI (DOCUMENTS_AND_SKILLS) — the read-only comment inbox: on-demand refresh + mark read.
    case 'comments-refresh': {
      const res = await refreshComments(prisma, action.workspaceId);
      broadcastContentDirty(action.workspaceId);
      return { checkedPosts: res.checkedPosts, newComments: res.newComments, notes: res.notes };
    }
    case 'comments-mark-read': {
      const commentId = str(payload, 'commentId');
      await (commentId ? prisma.socialComment.updateMany({ where: { workspaceId: action.workspaceId, id: commentId }, data: { read: true } }) : prisma.socialComment.updateMany({ where: { workspaceId: action.workspaceId, read: false }, data: { read: true } }));
      broadcastContentDirty(action.workspaceId);
      return;
    }
    case 'document-gen-image': {
      const documentId = str(payload, 'documentId');
      const prompt = (str(payload, 'prompt') ?? '').trim();
      //? GAP_SCAN C2 — REUSE before regenerate: the workspace is full of already-approved media
      //? (ContentAsset renders/images), and paying an image-gen for something that exists is pure waste.
      //? An `assetId` picked in the UI attaches that asset directly — no provider call, no spend. The
      //? asset must belong to THIS workspace and be ready (tenant + state check, not a client promise).
      const assetId = str(payload, 'assetId');
      if (!documentId || (!prompt && !assetId)) return;
      const doc = await prisma.document.findFirst({ where: { workspaceId: action.workspaceId, id: documentId } });
      if (!doc) return;
      if (assetId) {
        const existing = await prisma.contentAsset.findFirst({ where: { workspaceId: action.workspaceId, id: assetId, status: 'ready' }, select: { url: true, kind: true } });
        if (!existing?.url) return { ok: false, status: 'error', error: 'asset.notFound' };
        const prevAssets = Array.isArray(doc.assets) ? doc.assets : [];
        const reused = [...prevAssets, { kind: existing.kind === 'video' ? 'file' : 'image', url: existing.url, label: prompt.slice(0, 80) || existing.kind }];
        await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { assets: reused } });
        broadcastContentDirty(action.workspaceId);
        return { url: existing.url };
      }
      const img = await generateDocumentImage(prisma, action.workspaceId, doc.title, prompt);
      if (!img.ok || !img.url) return { ok: false, status: 'error', error: img.blocked ? 'media.budgetExceeded' : 'media.failed' };
      const prev = Array.isArray(doc.assets) ? doc.assets : [];
      const assets = [...prev, { kind: 'image', url: img.url, label: prompt.slice(0, 80), stub: img.stub === true }];
      await prisma.document.updateMany({ where: { workspaceId: action.workspaceId, id: documentId }, data: { assets } });
      broadcastContentDirty(action.workspaceId);
      return { url: img.url };
    }
    case 'save-stage-config': {
      const stageId = str(target, 'stageId') ?? str(payload, 'id');
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      if (!stageId || !requestedProjectId) return { ok: false, error: 'stage.invalidRequest' };
      const projectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (!projectId) return { ok: false, error: 'project.notFound' };
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
      if (Object.keys(data).length > 0) await prisma.pipelineStage.updateMany({ where: { workspaceId: action.workspaceId, projectId, key: stageId }, data });
      //? Return the updated stage so the realtime `_sync` route broadcasts the delta.
      return prisma.pipelineStage.findFirst({ where: { workspaceId: action.workspaceId, projectId, key: stageId } });
    }
    //? R1 — durably ADD a pipeline stage (the editor previously mutated React state only → a refresh discarded it).
    //? Appended at the end; the client supplies a unique `key` + `name` (+ optional `kind`).
    case 'stage-create': {
      const key = str(payload, 'key'); const name = str(payload, 'name');
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      if (!key || !name || !requestedProjectId) return { ok: false, error: 'stage.invalidRequest' };
      const projectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (!projectId) return { ok: false, error: 'project.notFound' };
      const kind = str(payload, 'kind') ?? 'code';
      const dupe = await prisma.pipelineStage.findFirst({ where: { workspaceId: action.workspaceId, projectId, key }, select: { id: true } });
      if (dupe) return { ok: false, error: 'stage.keyExists' };
      const last = await prisma.pipelineStage.findFirst({ where: { workspaceId: action.workspaceId, projectId }, orderBy: { order: 'desc' }, select: { order: true } });
      const order = (last?.order ?? -1) + 1;
      //? A hand-added stage used to start completely blank — no persona, no instructions, a bare
      //? `{{summary}}` carry-over — so the pipeline looked configured while that stage's agent ran on
      //? nothing. It now starts from the same blueprint `createDefaultPipeline` seeds for this KIND
      //? (owner decision 2026-08-18); every field stays editable, and `final` is still blank by design.
      const bp = stageBlueprint(isStageKind(kind) ? kind : 'code');
      return prisma.pipelineStage.create({ data: {
        workspaceId: action.workspaceId, projectId, key, kind, name, order, aiEnabled: true, wipLimit: null,
        roleKey: kind === 'code' ? 'code' : kind, systemPrompt: bp.systemPrompt, customInstructions: bp.customInstructions,
        promptTemplate: bp.promptTemplate.length > 0 ? bp.promptTemplate : '{{summary}}', definitionOfDone: bp.definitionOfDone,
        skillKeys: [], sourceIds: ['summary'], commands: [], tools: [], statuses: baseStageStatuses(), processes: [], visibleStageIds: [],
        modelCfg: { autoEscalate: false, base: { model: bp.model, effort: bp.effort, maxTurns: bp.maxTurns }, rules: [] },
        network: { enabled: true, mode: 'whitelist', categories: ['package-registries', 'source-hosts', 'ai-apis'], domains: [] },
        hooks: {},
      } });
    }
    //? R1 — durably REMOVE a pipeline stage.
    case 'stage-delete': {
      const stageId = str(target, 'stageId') ?? str(payload, 'stageId') ?? str(payload, 'key');
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      if (!stageId || !requestedProjectId) return { ok: false, error: 'stage.invalidRequest' };
      const projectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (!projectId) return { ok: false, error: 'project.notFound' };
      const deleted = await prisma.pipelineStage.deleteMany({ where: { workspaceId: action.workspaceId, projectId, key: stageId } });
      return deleted.count === 1 ? { ok: true, deleted: stageId } : { ok: false, error: 'stage.notFound' };
    }
    //? R1 — persist a new stage ORDER: `order` must contain exactly this project's stage keys.
    case 'stage-reorder': {
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      const order = strArr(payload, 'order');
      if (!requestedProjectId || order.length === 0) return { ok: false, error: 'stage.invalidRequest' };
      const projectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (!projectId) return { ok: false, error: 'project.notFound' };
      const existing = await prisma.pipelineStage.findMany({ where: { workspaceId: action.workspaceId, projectId }, select: { key: true } });
      const existingKeys = new Set(existing.map((stage) => stage.key));
      if (order.length !== existingKeys.size || new Set(order).size !== existingKeys.size || order.some((key) => !existingKeys.has(key))) return { ok: false, error: 'stage.invalidOrder' };
      for (let i = 0; i < order.length; i += 1) await prisma.pipelineStage.updateMany({ where: { workspaceId: action.workspaceId, projectId, key: order[i] }, data: { order: i } });
      return { ok: true, count: order.length };
    }
    //? Pipeline PRESETS made real on an EXISTING project (owner decision 2026-08-18). Two modes, one op:
    //?
    //?   fill   — non-structural. Writes the canonical blueprint into the fields that are EMPTY right now
    //?            and touches nothing else, so a pipeline seeded before the defaults carried prompt text
    //?            (or a hand-added blank stage) stops running its AI on nothing. Never overwrites.
    //?   switch — structural. Adds the target preset's missing stages, migrates the tickets out of the
    //?            stages it drops, deletes those stages, and prunes the dangling `visibleStageIds`.
    //?
    //? A stage the user ADDED themselves is never deleted: only keys the default pipeline owns are
    //? structural. Switching preset is "give me the standard N-stage flow", not "throw my own work away".
    case 'pipeline-apply-preset': {
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      const rawPreset = str(payload, 'preset') ?? '';
      const mode = str(payload, 'mode') === 'switch' ? 'switch' : 'fill';
      if (!requestedProjectId || !isPipelinePreset(rawPreset)) return { ok: false, error: 'pipeline.invalidRequest' };
      const projectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (!projectId) return { ok: false, error: 'project.notFound' };
      const existing = await prisma.pipelineStage.findMany({ where: { workspaceId: action.workspaceId, projectId }, orderBy: { order: 'asc' } });

      //? FILL runs in both modes — a switch that added stages but left the old ones blank would only
      //? move the same complaint one screen over.
      let filled = 0;
      for (const st of existing) {
        const bp = blueprintForStage(st.key, isStageKind(st.kind) ? st.kind : 'code');
        const data: { systemPrompt?: string; customInstructions?: string; promptTemplate?: string; definitionOfDone?: string } = {};
        if (st.systemPrompt.trim().length === 0 && bp.systemPrompt.length > 0) data.systemPrompt = bp.systemPrompt;
        if (st.customInstructions.trim().length === 0 && bp.customInstructions.length > 0) data.customInstructions = bp.customInstructions;
        if (st.promptTemplate.trim().length === 0 && bp.promptTemplate.length > 0) data.promptTemplate = bp.promptTemplate;
        if (st.definitionOfDone.trim().length === 0 && bp.definitionOfDone.length > 0) data.definitionOfDone = bp.definitionOfDone;
        if (Object.keys(data).length === 0) continue;
        await prisma.pipelineStage.updateMany({ where: { workspaceId: action.workspaceId, projectId, key: st.key }, data });
        filled += 1;
      }
      if (mode === 'fill') return { ok: true, mode, preset: rawPreset, filled, added: 0, removed: 0, movedTickets: 0 };

      const wanted = stagesForPreset(rawPreset);
      const wantedKeys = wanted.map((s) => s.key);
      const owned = new Set(defaultStageKeys());
      const present = new Set(existing.map((s) => s.key));
      const dropped = existing.filter((s) => owned.has(s.key) && !wantedKeys.includes(s.key)).map((s) => s.key);

      //? Tickets first: a ticket pointing at a deleted column is invisible on the board.
      let movedTickets = 0;
      for (const key of dropped) {
        const landing = fallbackStageKey(key, wantedKeys);
        const moved = await prisma.ticket.updateMany({ where: { workspaceId: action.workspaceId, projectId, stageId: key }, data: { stageId: landing } });
        movedTickets += moved.count;
      }
      if (dropped.length > 0) await prisma.pipelineStage.deleteMany({ where: { workspaceId: action.workspaceId, projectId, key: { in: dropped } } });

      let added = 0;
      for (const s of wanted) {
        if (present.has(s.key)) continue;
        await prisma.pipelineStage.create({ data: stageCreateData(action.workspaceId, projectId, s) });
        added += 1;
      }

      //? Re-order: the preset's stages in preset order, then whatever the user added themselves, so a
      //? custom stage keeps existing instead of silently jumping to the front.
      const after = await prisma.pipelineStage.findMany({ where: { workspaceId: action.workspaceId, projectId }, orderBy: { order: 'asc' }, select: { key: true, visibleStageIds: true } });
      const custom = after.filter((s) => !wantedKeys.includes(s.key)).map((s) => s.key);
      const finalOrder = [...wantedKeys.filter((k) => after.some((s) => s.key === k)), ...custom];
      for (let i = 0; i < finalOrder.length; i += 1) await prisma.pipelineStage.updateMany({ where: { workspaceId: action.workspaceId, projectId, key: finalOrder[i] }, data: { order: i } });

      //? A dropped key left inside `visibleStageIds` is a stage handing its agent context from a column
      //? that no longer exists — silently empty rather than loudly wrong, so prune it here.
      const live = new Set(finalOrder);
      for (const s of after) {
        const pruned = s.visibleStageIds.filter((k) => live.has(k));
        if (pruned.length !== s.visibleStageIds.length) await prisma.pipelineStage.updateMany({ where: { workspaceId: action.workspaceId, projectId, key: s.key }, data: { visibleStageIds: pruned } });
      }

      return { ok: true, mode, preset: rawPreset, filled, added, removed: dropped.length, movedTickets };
    }
    // ---- suggestions ----
    case 'accept-suggestion': {
      const suggestionId = str(target, 'suggestionId');
      if (!suggestionId) return;
      const suggestion = await prisma.workspaceSuggestion.findFirst({ where: { workspaceId: action.workspaceId, id: suggestionId, status: 'open' }, select: { type: true, patch: true } });
      if (!suggestion) return { ok: false, error: 'suggestion.notOpen' };
      const claimed = await prisma.workspaceSuggestion.updateMany({ where: { workspaceId: action.workspaceId, id: suggestionId, status: 'open' }, data: { status: 'accepted' } });
      if (claimed.count !== 1) return { ok: false, error: 'suggestion.notOpen' };
      //? Automation (#2): accepting an 'automation' suggestion EXECUTES the gated action it carries
      //? (the human consent the ActionExecutor's approval gate deferred to — B-23 single-writer).
      if (suggestion.type === 'automation') {
        await executeGatedAction(prisma, action.workspaceId, suggestion.patch);
        //? #83 — emit `stage.on_approval` when a gated automation action is approved+executed. Cycle-free:
        //? this runs in the Conductor's accept path, NOT the self-contained executor (which can't import
        //? fireEvent). Carries the patch's ticket/stage context when present so a trigger can match on it.
        const params = asRec(asRec(suggestion.patch).params);
        const apTicketKey = str(params, 'ticketKey');
        const apStageId = str(params, 'targetStageId') ?? str(params, 'stageId');
        void fireEvent(prisma, action.workspaceId, { on: 'stage.on_approval', ...(apTicketKey ? { ticketKey: apTicketKey } : {}), ...(apStageId ? { stageId: apStageId } : {}) });
      }
      //? AI MR-review (ADR 0041): accepting posts each proposed finding as a ReviewComment(authorKind:'ai').
      //? The AI never wrote it — the Conductor does, on human consent (B-23).
      if (suggestion.type === 'mr-review') await postAiReviewFindings(prisma, action.workspaceId, suggestion.patch);
      //? AI rollback (ADR 0042): accepting reverts the ranked culprit MR (forward `git revert -m 1`, #7) +
      //? drafts a tracking ticket. The AI never reverted — the Conductor does, on human consent (B-23).
      if (suggestion.type === 'rollback') return acceptRollback(action.workspaceId, userId, suggestion.patch);
      //? Publish (F3.1, ADR 0065): accepting posts the asset to the platform (dummy, no key). The AI never
      //? published — the Conductor does, on explicit human consent (B-23; publishing is irreversible).
      if (suggestion.type === 'publish') {
        const p = asRec(suggestion.patch);
        const contentProjectId = typeof p.contentProjectId === 'string' ? p.contentProjectId : '';
        const assetId = typeof p.assetId === 'string' ? p.assetId : '';
        const platform = typeof p.platform === 'string' ? p.platform : '';
        const accountId = typeof p.accountId === 'string' ? p.accountId : undefined;
        //? C1 — honour a scheduled post: parse the patch's `scheduledAt`; publishAsset parks it as a 'scheduled'
        //? PublishJob the leader loop fires when due (else it posts now). A3 — route to the chosen account.
        const schedMs = typeof p.scheduledAt === 'string' ? Date.parse(p.scheduledAt) : Number.NaN;
        const scheduledAt = Number.isFinite(schedMs) ? new Date(schedMs) : null;
        if (contentProjectId && assetId && isPublishPlatform(platform)) await publishAsset(prisma, action.workspaceId, { contentProjectId, assetId, platform, ...(accountId ? { accountId } : {}), scheduledAt });
      }
      //? Automation (#83): accepting any suggestion fires `suggestion.accepted` so a trigger can chain off it.
      void fireEvent(prisma, action.workspaceId, { on: 'suggestion.accepted' });
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
      //? A dev project owns its OWN board pipeline + starter guidance (ADR 0035); a content project
      //? uses the fixed content-stage sequence (F1.1), so it needs neither board columns nor dev docs.
      if (projectType !== 'content') {
        //? The pipeline PRESET is a per-project choice now (owner decision 2026-08-18): it was only ever
        //? askable when creating a WORKSPACE, so every project after the first got the 7-stage flow
        //? whether or not that matched the work. Falls back to the workspace's own tier, then professional.
        const requested = str(payload, 'preset') ?? '';
        const workspace = await prisma.workspace.findUnique({ where: { id: action.workspaceId }, select: { presetKey: true } });
        const inherited = workspace?.presetKey ?? '';
        const preset = isPipelinePreset(requested) ? requested : (isPipelinePreset(inherited) ? inherited : 'professional');
        await createDefaultPipeline(prisma, action.workspaceId, created.id, preset);
        await createStarterLibrary(prisma, action.workspaceId, created.id);
      }
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
          //? S2 — the template's stack drives the L1 base image (any-stack, S1).
          stack: template.stack,
          ...(template.baseImageRef ? { baseImageRef: template.baseImageRef } : {}),
          devCommand: template.devCommand,
        },
      });
      //? Seed the template's starter convention docs as context-doc InfoSources (visible in Sources,
      //? injectable into the coding agent — the 'starter' source pattern).
      for (const doc of template.starterDocs) {
        await prisma.infoSource.create({ data: { workspaceId: action.workspaceId, projectId: created.id, mode: 'context-doc', source: 'starter', name: doc.name, content: doc.content, summary: `Starter (${template.label})`, note: 'template', enabled: true, usedByStages: [] } });
      }
      //? Same per-project tier choice as `project-create` (owner decision 2026-08-18).
      const templPreset = str(payload, 'preset') ?? '';
      await createDefaultPipeline(prisma, action.workspaceId, created.id, isPipelinePreset(templPreset) ? templPreset : 'professional');
      //? G1 — actually make it a REPO: init the workspace bare repo from the template's seed file-tree so
      //? `isLinked` flips true → the runtime can cut a worktree + container from it (container → code). No-op
      //? if a repo already exists (never clobber). Best-effort — a git failure leaves the project unlinked.
      const [gitErr, status] = await tryCatch(() => initGreenfieldRepo(action.workspaceId, created.id, template.files));
      if (gitErr) console.error(`[greenfield] repo init for ${name} failed:`, gitErr.message);
      else if (status?.linked && !created.gitUrl) await prisma.project.updateMany({ where: { id: created.id, workspaceId: action.workspaceId }, data: { gitUrl: `greenfield://${action.workspaceId}` } });
      //? DESIGN_DOCS_PROGRAM 4.1–4.3 — "UI from 0": an optional brief seeds an APP_BRIEF.md context-doc and
      //? files a scaffold ticket auto-started with AI, so the EXISTING ticket→stage→agent pipeline generates
      //? the real starting UI from the brief (single writer, B-23). No-op without a linked repo (nothing to build).
      const brief = (str(payload, 'brief') ?? '').trim();
      if (brief.length > 0 && !gitErr && status?.linked) {
        await prisma.infoSource.create({ data: { workspaceId: action.workspaceId, projectId: created.id, mode: 'context-doc', source: 'starter', name: 'APP_BRIEF.md', content: `# App brief\n\n${brief}`, summary: 'App brief', note: 'brief', enabled: true, usedByStages: [] } });
        const last = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
        const number = (last?.number ?? 0) + 1;
        const ticket = await prisma.ticket.create({ data: { workspaceId: action.workspaceId, projectId: created.id, key: `DEV-${String(number)}`, number, title: 'Build the initial UI from the brief', description: brief, stageId: 'unrefined', status: 'idle', labels: ['scaffold'], creatorId: userId, priority: 'high' } });
        await recordTicketEvent(action.workspaceId, ticket.id, 'status-change', userId, 'created the scaffold ticket from the brief');
        const firstAi = await prisma.pipelineStage.findFirst({ where: { workspaceId: action.workspaceId, projectId: created.id, aiEnabled: true }, orderBy: { order: 'asc' }, select: { key: true } });
        if (firstAi) {
          await prisma.ticket.update({ where: { id: ticket.id }, data: { stageId: firstAi.key } });
          await recordTicketEvent(action.workspaceId, ticket.id, 'status-change', userId, `auto-started AI at ${firstAi.key}`);
          await activateWorktreesForStage(action.workspaceId, created.id, [ticket.key], firstAi.key);
        }
      }
      return created;
    }
    //? @adr 0276
    //? A09 — patch ONLY the managed Tailwind token declarations at the selected project/service path.
    //? The configured target branch + expected HEAD are explicit; a race fails closed before overwrite.
    case 'apply-design-tokens': {
      const projectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      if (!projectId) return { ok: false, status: 'error', error: 'project.unknown' };
      const serviceId = str(target, 'serviceId') ?? str(payload, 'serviceId');
      const service = serviceId
        ? await prisma.service.findFirst({ where: { workspaceId: action.workspaceId, id: serviceId, projectId }, select: { path: true } })
        : null;
      if (serviceId && !service) return { ok: false, status: 'error', error: 'service.unknown' };
      const cssPath = designTokenCssPath(service?.path);
      if (!cssPath.ok) return { ok: false, status: 'error', error: cssPath.error };

      const activeTheme = await activeThemeTokens(prisma, action.workspaceId);
      if (!activeTheme.ok) return { ok: false, status: 'error', error: activeTheme.error };
      const workspace = await prisma.workspace.findUnique({ where: { id: action.workspaceId }, select: { gitConfig: true } });
      const branch = normalizeGitConfig(workspace?.gitConfig ?? null).targetBranch;
      const current = await readRepoBranchFile(action.workspaceId, projectId, branch, cssPath.path);
      if (!current.ok) return { ok: false, status: 'error', error: current.error };
      const patched = patchManagedThemeCss(current.content, activeTheme.tokens);
      if (!patched.ok) return { ok: false, status: 'error', error: patched.error };

      const committed = await commitFilesToBranch({
        workspaceId: action.workspaceId,
        projectId,
        branch,
        expectedHead: current.head,
        files: [{ path: cssPath.path, content: patched.css }],
        message: 'chore: apply active design tokens',
      });
      if (!committed.ok) return { ok: false, status: 'error', error: committed.error };
      if (committed.status === 'committed') broadcastContentDirty(action.workspaceId);
      return { ok: true, changed: committed.status === 'committed', branch, path: cssPath.path, head: committed.sha };
    }
    //? Environments / deploy (ADR 0037) — B-23: the Conductor deploys (the leader holds the lease).
    case 'env-deploy': {
      const kind = str(payload, 'kind') ?? 'dev';
      //? SEC7 — prod is ONLY reachable via env-promote (approval + green CI + no security findings,
      //? promote.ts). A direct prod env-deploy would bypass all three gates.
      if (kind === 'prod') return { ok: false, status: 'error', error: 'env.prodViaPromote' };
      const deployProjectId = await resolveProjectId(prisma, action.workspaceId, str(target, 'projectId') ?? str(payload, 'projectId'));
      if (!deployProjectId) return { ok: false, status: 'error', error: 'env.noProject' };
      const serviceId = str(target, 'serviceId') ?? str(payload, 'serviceId') ?? null;
      //? D3 — a demo env can follow main (autoRedeploy, default true) or freeze at a pinned commit. Only pass
      //? autoRedeploy when the client set it explicitly, so ensureEnvironment's demo-default still applies.
      const pinnedCommit = str(payload, 'pinnedCommit');
      //? D2/D4 — a user-chosen subdomain, and D3 — a custom domain (served with on-demand TLS). Threaded so
      //? "publish commit X on DNS Y" is one deploy call (kind:'demo' + pinnedCommit + subdomain/customDomain).
      const subdomain = str(payload, 'subdomain');
      const customDomain = str(payload, 'customDomain');
      const envId = await ensureEnvironment(prisma, action.workspaceId, deployProjectId, serviceId, kind, { ...(pinnedCommit ? { pinnedCommit } : {}), ...('autoRedeploy' in payload ? { autoRedeploy: bool(payload, 'autoRedeploy') } : {}), ...(subdomain ? { subdomain } : {}), ...(customDomain ? { customDomain } : {}) });
      if (!envId) return { ok: false, status: 'error', error: 'env.noProject' };
      return deployEnvironment(prisma, action.workspaceId, envId);
    }
    //? D3 — roll an environment back to its last LIVE commit (refuses when there is no earlier good deploy).
    case 'env-rollback': {
      const envId = str(target, 'envId') ?? str(payload, 'envId');
      if (!envId) return { ok: false };
      return rollbackEnvironment(prisma, action.workspaceId, envId);
    }
    case 'env-teardown': {
      const envId = str(target, 'envId') ?? str(payload, 'envId');
      if (!envId) return { ok: false };
      return teardownEnvironment(prisma, action.workspaceId, envId);
    }
    //? K1 — attach a third-party SERVICE STACK. Production sends unrestricted Compose to the configured
    //? per-workspace isolated runner; it never runs on the app Docker daemon. Conductor is the only writer.
    case 'service-provision': {
      const name = str(payload, 'name');
      //? K2 — a preset key resolves to its curated compose; else the user's own compose (K1 bring-your-own).
      const presetKey = str(payload, 'preset');
      const compose = presetKey ? (presetCompose(presetKey) ?? '') : str(payload, 'compose');
      if (!name || !compose) return { ok: false, error: 'service.invalidRequest' };
      const result = await provisionServiceStack(prisma, action.workspaceId, name, compose);
      //? K3 — a local preset publishes service-name connection env; an isolated runner publishes explicit
      //? gateway/overlay env for presets OR custom stacks. Only on a successful provision;
      //? namespaced `SVC_<name>_` so teardown removes exactly this stack's rows without touching user env.
      if (result.ok) {
        //? Local development presets share the workspace bridge and may use service-name URLs. An isolated
        //? runner (preset OR arbitrary Compose) is another VM/daemon and MUST return explicit overlay/gateway
        //? endpoints; never inject fake DNS. Local custom Compose has no inferred connection contract.
        const env = result.executionMode === 'isolated-v1' ? (result.env ?? {}) : (presetKey ? presetEnv(presetKey) : {});
        for (const [key, v] of Object.entries(env)) {
          const existing = await prisma.envVar.findFirst({ where: { workspaceId: action.workspaceId, key }, select: { id: true } });
          //? Connection strings may contain database credentials. Runner metadata is workspace-controlled, but
          //? persistence remains encrypted-at-rest exactly like manually entered secret EnvVars.
          const encrypted = encryptSecret(v);
          await (existing
            ? prisma.envVar.updateMany({ where: { id: existing.id, workspaceId: action.workspaceId }, data: { value: encrypted, secret: true, serviceName: name } })
            : prisma.envVar.create({ data: { workspaceId: action.workspaceId, key, value: encrypted, secret: true, serviceName: name } }));
        }
      }
      return result;
    }
    case 'service-teardown': {
      const name = str(payload, 'name') ?? str(target, 'name');
      if (!name) return { ok: false };
      const result = await teardownServiceStack(prisma, action.workspaceId, name);
      //? Remove connection env only AFTER runtime teardown is proven. A failed isolated/local teardown keeps
      //? both ownership and connection context for retry instead of leaving a still-live orphan unreachable.
      if (result.ok) await prisma.envVar.deleteMany({ where: { workspaceId: action.workspaceId, serviceName: name } });
      return result;
    }
    //? U1 — persist a "unfuck the UI" review request (screenshots + ticked problems + notes). Off-taxonomy
    //? problems + non-/media screenshots are dropped (sanitized). B-23: the Conductor is the only writer.
    case 'ui-review-create': {
      const screenshots = sanitizeScreenshots(payload.screenshots);
      const problems = sanitizeProblems(payload.problems);
      if (screenshots.length === 0 && problems.length === 0) return { ok: false, error: 'uiReview.empty' };
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      const reviewProjectId = requestedProjectId === undefined ? null : await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (requestedProjectId !== undefined && !reviewProjectId) return { ok: false, error: 'project.notFound' };
      const page = str(payload, 'page'); const notes = str(payload, 'notes');
      return prisma.uiReviewRequest.create({ data: {
        workspaceId: action.workspaceId, ...(reviewProjectId ? { projectId: reviewProjectId } : {}), screenshots, problems,
        ...(page ? { page } : {}), ...(notes ? { notes } : {}), createdById: userId, status: 'open',
      } });
    }
    //? U2 (gap-fix): turn an open UI-review request into a redesign TICKET — the review's problems, notes
    //? and screenshot urls become the ticket description, so the pipeline (or a human) picks it up. The
    //? persisted review project is authoritative; an explicit request is only a mismatch guard. Legacy
    //? null-project reviews require an explicit current project and never fall back to project #1.
    case 'ui-review-to-ticket': {
      const reviewId = str(payload, 'reviewId');
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      if (!reviewId) return { ok: false, error: 'uiReview.invalidRequest' };
      const review = await prisma.uiReviewRequest.findFirst({ where: { workspaceId: action.workspaceId, id: reviewId, status: 'open' } });
      if (!review) return { ok: false, error: 'uiReview.notFound' };

      let reviewProjectId: string;
      if (review.projectId) {
        const persistedProjectId = await resolveProjectId(prisma, action.workspaceId, review.projectId);
        if (!persistedProjectId) return { ok: false, error: 'project.notFound' };
        if (requestedProjectId !== undefined) {
          const requestProjectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
          if (!requestProjectId) return { ok: false, error: 'project.notFound' };
          if (requestProjectId !== persistedProjectId) return { ok: false, error: 'uiReview.projectMismatch' };
        }
        reviewProjectId = persistedProjectId;
      } else {
        if (!requestedProjectId) return { ok: false, error: 'uiReview.projectRequired' };
        const legacyProjectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
        if (!legacyProjectId) return { ok: false, error: 'project.notFound' };
        reviewProjectId = legacyProjectId;
      }

      const lastTicket = await prisma.ticket.findFirst({ where: { workspaceId: action.workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
      const ticketNumber = (lastTicket?.number ?? 0) + 1;
      const description = [
        `Redesign request from the UI-review inbox${review.page ? ` — page: ${review.page}` : ''}.`,
        review.problems.length > 0 ? `Reported problems: ${review.problems.join(', ')}.` : '',
        review.notes ? `Notes: ${review.notes}` : '',
        review.screenshots.length > 0 ? `Screenshots:\n${review.screenshots.join('\n')}` : '',
      ].filter((s) => s.length > 0).join('\n\n');
      const redesignTicket = await prisma.ticket.create({ data: {
        workspaceId: action.workspaceId, projectId: reviewProjectId, key: `DEV-${String(ticketNumber)}`, number: ticketNumber,
        title: `Redesign: ${review.page ?? 'UI'}`, description, stageId: 'unrefined', status: 'idle',
        labels: ['ui-review'], creatorId: userId, priority: 'normal',
      } });
      //? Keep the original compare/review as a live implementation artifact: the stage-agent gets the
      //? screenshots + analysis through the existing TicketArtifactLink context seam.
      await prisma.ticketArtifactLink.create({ data: { workspaceId: action.workspaceId, ticketId: redesignTicket.id, artifactId: review.id, artifactKind: 'ui-review', label: review.page ?? 'UI review', linkedBy: userId } });
      await prisma.uiReviewRequest.updateMany({ where: { workspaceId: action.workspaceId, id: reviewId, status: 'open' }, data: { status: 'ticketed', projectId: reviewProjectId } });
      //? Best-effort tail (event + broadcast): a failure here must never error the op — the serial
      //? chain would re-run it and duplicate the ticket.
      await tryCatch(() => recordTicketEvent(action.workspaceId, redesignTicket.id, 'status-change', userId, 'created the ticket from a UI review'));
      await tryCatch(() => broadcastTicketDelta(prisma, action.workspaceId, [redesignTicket.key]));
      return redesignTicket;
    }
    //? U2 — dismiss an open UI-review request without a ticket.
    case 'ui-review-dismiss': {
      const reviewId = str(payload, 'reviewId');
      if (reviewId) await prisma.uiReviewRequest.updateMany({ where: { workspaceId: action.workspaceId, id: reviewId, status: 'open' }, data: { status: 'dismissed' } });
      return;
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
      //? Per-service export: the unit rides on the action the same way `env-deploy`/`env-promote` already
      //? carry it. Without this the op resolved a project and always exported the project root, so a
      //? service's own build command and output directory could never be reached.
      const exportServiceId = str(target, 'serviceId') ?? str(payload, 'serviceId') ?? null;
      return buildExport(prisma, action.workspaceId, exportProjectId, str(payload, 'kind') ?? 'image', Date.now(), exportServiceId);
    }
    //? Phase 1 of public CI: RBAC already ran, and the Conductor only validates +
    //? durably authorizes one immutable execution. Docker/repo work happens afterward;
    //? a duplicate request replays only `{keys}` and therefore receives no executable intent.
    case 'ci-run': {
      const ticketKey = str(target, 'ticketId');
      const projectId = str(target, 'projectId');
      const binding = asRec(payload.binding);
      const suppliedIntentId = str(payload, 'intentId');
      const intentId = projectId ? ciPublicIntentId(action.workspaceId, projectId, action.clientRequestId) : null;
      const expectedTicketId = str(binding, 'ticketId');
      const expectedBranch = str(binding, 'branch');
      const expectedCommitHash = str(binding, 'commitHash');
      const expectedMergeRequestId = str(binding, 'mergeRequestId');
      const trigger = str(binding, 'trigger') ?? 'manual';
      if (payload.phase !== 'prepare' || !ticketKey || !projectId || !intentId || suppliedIntentId !== intentId
        || !expectedTicketId || !expectedBranch || !expectedCommitHash || !/^[a-f\d]{40,64}$/i.test(expectedCommitHash)) {
        return { ok: false, error: 'ci.prepareRequired' };
      }
      const ticket = await prisma.ticket.findFirst({
        where: { id: expectedTicketId, workspaceId: action.workspaceId, projectId, key: ticketKey, branch: expectedBranch },
        select: { id: true },
      });
      if (!ticket) return { ok: false, error: 'ci.targetChanged' };
      const latestMr = await prisma.mergeRequest.findFirst({
        where: { workspaceId: action.workspaceId, projectId, ticketId: ticket.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, headSha: true },
      });
      if (expectedMergeRequestId) {
        if (latestMr?.id !== expectedMergeRequestId || latestMr.headSha !== expectedCommitHash) return { ok: false, error: 'ci.targetChanged' };
      } else if (latestMr !== null) {
        return { ok: false, error: 'ci.targetChanged' };
      }
      return {
        ok: true,
        executable: true,
        keys: [ticketKey],
        intent: {
          id: intentId,
          signalId: ciPublicIntentSignalId(action.workspaceId, action.clientRequestId),
          ticketId: ticket.id,
          ticketKey,
          projectId,
          branch: expectedBranch,
          commitHash: expectedCommitHash,
          mergeRequestId: expectedMergeRequestId ?? null,
          trigger,
        },
      };
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
      const artifact = await executeAgentRole(role.key, { workspaceId: action.workspaceId, ...(ticketKey ? { ticketKey } : {}), params: mrId ? { mrId } : {} });
      return { ok: true, ...(artifact ? { title: artifact.title, body: artifact.body } : {}) };
    }
    //? AI root-cause / rollback (ADR 0042): run the role on a symptom → it PROPOSES a rollback as a
    //? WorkspaceSuggestion(type:'rollback'). The human accepts to revert + get a tracking ticket (B-23).
    case 'root-cause': {
      const role = getAgentRole('root-cause');
      if (!role) return { ok: false };
      const artifact = await executeAgentRole(role.key, { workspaceId: action.workspaceId, params: { symptom: str(payload, 'symptom') ?? '' } });
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
      const artifact = await executeAgentRole(role.key, { workspaceId: action.workspaceId, ticketKey, params: {} });
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
      //? A finding is workspace-level, but converting it is an explicit active-project action.
      //? Missing/stale/foreign targets fail closed instead of falling through to project #1.
      const requestedProjectId = str(target, 'projectId') ?? str(payload, 'projectId');
      if (!requestedProjectId) return { ok: false, error: 'finding.invalidRequest' };
      const findingProjectId = await resolveProjectId(prisma, action.workspaceId, requestedProjectId);
      if (!findingProjectId) return { ok: false, error: 'project.notFound' };
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
    case 'run-agent-role': {
      //? #167 — invoke a registered agent-role NOW, on the user's explicit request (e.g. the interviewer
      //? "Generate ideas now" button). Unlike the scheduler's `trigger-run`, a user-initiated run is NOT
      //? gated on the role's `mutates` flag — the click IS the approval, and OP_CAPABILITY (workTickets)
      //? already gates who may do it — so we call the raw ungated executor directly.
      const role = str(payload, 'role');
      if (!role) return;
      //? Optional focus (e.g. "the auth flow") narrows the role's review — threaded through as a param.
      const roleFocus = str(payload, 'focus');
      const projectId = str(target, 'projectId') ?? str(payload, 'projectId');
      await executeTriggerAction(prisma, action.workspaceId, { action: 'invoke-agent-role', params: { role, ...(roleFocus ? { focus: roleFocus } : {}), ...(projectId ? { projectId } : {}) } });
      return;
    }
    // ---- notifications ----
    case 'mark-read': {
      if (target.all === true) {
        await prisma.notification.updateMany({ where: { workspaceId: action.workspaceId, userId }, data: { read: true } });
      } else {
        const notificationId = str(target, 'notificationId');
        //? SEC5 — scope the single-notification branch to the CALLER's rows (the all-branch already
        //? did); without `userId` any member could mark another member's notification read.
        if (notificationId) await prisma.notification.updateMany({ where: { workspaceId: action.workspaceId, id: notificationId, userId }, data: { read: true } });
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

//? Legacy first-run/bootstrap seam used before a tenant exists. It intentionally has no workspace
//? writer context or lease; the user-facing `create-workspace` ControlOp instead serializes on the
//? global Conductor chain and enters the explicit global writer scope around executeAction. Do not use
//? this seam for post-bootstrap domain writes. Creates Workspace + built-in roles + Owner membership.
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
  const builtins = await ensureWorkspaceBuiltins(prisma, ws.id);
  void scheduleWorkspaceBuiltinIndexing(prisma, ws.id, builtins.designArtifactsToIndex);
  return { workspaceId: ws.id };
}
