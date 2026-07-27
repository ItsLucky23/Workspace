//? Server-only Conductor operations. These are deterministic background writes,
//? never browser/Assistant ControlOps: no client union, RBAC catalogue, proposal
//? catalogue, or public sync allowlist may import them.

import { tryCatchSync } from '@luckystack/core';

import type { EngineEvent } from '../automation/triggers';
import type { TriggerAction } from '../automation/executor';
import type { ExtractStatus } from '../documents/parseUpload';
import { readCanonicalCiReport, type StageCiReport } from '../ci/runner';
import { MAX_FORGE_SIGNAL_BYTES, readForgeSnapshot, type ForgeSnapshot } from '../git/gitlabSync';
import type { HandoffBody } from './handoff';
import type { ToolTrailEntry } from './toolTrail';
import type { TurnResult } from './turnResult';
import type { ForgeIssueEvent } from '../git/webhookIngest';
import type {
  EnqueueControlActionOptions,
  EnqueuedControlAction,
} from './conductor';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';

interface InternalActionBase {
  workspaceId: string;
  //? Provenance only: internal actions never use this identity as an RBAC grant.
  userId: string;
  clientRequestId: string;
}

export interface DocumentAssetTextInternalAction extends InternalActionBase {
  op: 'document-set-asset-text';
  target: { documentId: string };
  payload: { url: string; text: string; status: ExtractStatus };
}

export interface ForgeEventInternalAction extends InternalActionBase {
  op: 'forge-event-apply';
  target: Record<string, never>;
  payload: { event: ForgeIssueEvent; acceptedAt: number };
}

export interface ForgeSnapshotInternalAction extends InternalActionBase {
  op: 'forge-snapshot-apply';
  target: { projectId: string };
  payload: { snapshot: ForgeSnapshot };
}

export interface CiPublicCompleteInternalAction extends InternalActionBase {
  op: 'ci-public-complete';
  target: { ticketId: string; ticketKey: string; projectId: string; serviceId?: string | null };
  payload: {
    intentId: string;
    prepareSignalId: string;
    branch: string;
    commitHash: string;
    observedHead: string;
    mergeRequestId: string | null;
    trigger: string;
    report: StageCiReport;
  };
}

export interface AutomationEventApplyInternalAction extends InternalActionBase {
  op: 'automation-event-apply';
  target: Record<string, never>;
  payload: { event: EngineEvent; depth: number };
}

export interface AutomationCronFireInternalAction extends InternalActionBase {
  op: 'automation-cron-fire';
  target: { triggerId: string };
  payload: { minuteAt: number };
}

export interface AutomationActionRunInternalAction extends InternalActionBase {
  op: 'automation-action-run';
  target: Record<string, never>;
  payload: { mode: 'gated' | 'execute'; action: TriggerAction; requiresApproval: boolean };
}

export interface WorkspaceBuiltinsEnsureInternalAction extends InternalActionBase {
  op: 'workspace-builtins-ensure';
  target: Record<string, never>;
  payload: Record<string, never>;
}

export interface StudioArtifactBeginInternalAction extends InternalActionBase {
  op: 'studio-artifact-begin';
  target: { artifactId: string; briefId: string };
  payload: { kind: string; tweak?: string };
}

export interface StudioArtifactCompleteInternalAction extends InternalActionBase {
  op: 'studio-artifact-complete';
  target: { artifactId: string; briefId: string };
  payload: { kind: string; title?: string; content?: unknown; providerId?: string; status: 'ready' | 'error'; error?: string | null };
}

export interface ProjectDocsCompleteInternalAction extends InternalActionBase {
  op: 'project-docs-complete';
  target: { expectedVersion?: number };
  payload: { content: string; summary: string };
}

export interface ProjectImageCompleteInternalAction extends InternalActionBase {
  op: 'project-image-complete';
  target: { projectId: string; expectedVersion?: number };
  payload: { tag: string };
}

export interface BrandImportInternalAction extends InternalActionBase {
  op: 'brand-import';
  target: { expectedVersion?: number };
  payload: { kit: unknown };
}

export interface StyleImportInternalAction extends InternalActionBase {
  op: 'style-import';
  target: { expectedVersion?: number };
  payload: { styles: unknown };
}

export interface DockerfileSaveInternalAction extends InternalActionBase {
  op: 'dockerfile-save';
  target: { projectId: string; expectedVersion?: number };
  payload: { dockerfile: string };
}

export interface WorktreeFileSaveInternalAction extends InternalActionBase {
  op: 'worktree-file-save';
  target: { ticketKey: string; expectedVersion?: number };
  payload: { path: string; content: string };
}

export interface ChatTurnRecordInternalAction extends InternalActionBase {
  op: 'chat-turn-record';
  target: { userMessageId: string; aiMessageId: string };
  payload: { userText: string; aiText: string };
}

export interface DesignLibraryWriteInternalAction extends InternalActionBase {
  op: 'design-library-write';
  target: { artifactId?: string };
  payload: { mode: 'save' | 'activate' | 'delete'; kind?: string; name?: string; description?: string; content?: unknown; source?: string };
}

export interface StudioBriefSaveInternalAction extends InternalActionBase {
  op: 'studio-brief-save';
  target: { briefId: string };
  payload: { create: boolean; projectId?: string; name: string; productName: string; audience: string; tone: string; goals: string; notes: string | null };
}

export interface StudioDeleteInternalAction extends InternalActionBase {
  op: 'studio-delete';
  target: { briefId?: string; artifactId?: string };
  payload: Record<string, never>;
}

export interface PatIssueInternalAction extends InternalActionBase {
  op: 'pat-issue';
  target: { patId: string };
  payload: { name: string; tokenHash: string; tokenPrefix: string; scopes: string[] };
}

export type RuntimeLaunchMode = 'preview-open' | 'preview-close' | 'ref-preview-open' | 'editor-open';

export interface RuntimeLaunchPrepareInternalAction extends InternalActionBase {
  op: 'runtime-launch-prepare';
  target: { intentId: string; ticketKey: string; projectId: string };
  payload: { mode: RuntimeLaunchMode; branch?: string; ref?: string; image?: string };
}

export interface RuntimeLaunchCompleteInternalAction extends InternalActionBase {
  op: 'runtime-launch-complete';
  target: { intentId: string; ticketKey: string; projectId: string };
  payload: { mode: RuntimeLaunchMode; ok: boolean; error?: string };
}

export interface StageTarget {
  ticketId: string;
  ticketKey: string;
  projectId: string;
  stageId: string;
}

export interface StageRunTarget extends StageTarget {
  sessionId: string;
  runToken: string;
  runFence: number;
}

export interface StageActivationCompleteInternalAction extends InternalActionBase {
  op: 'stage-activation-complete';
  target: StageTarget;
  payload: { branch: string; commitHash: string };
}

export interface StageSessionStartInternalAction extends InternalActionBase {
  op: 'stage-session-start';
  target: StageTarget;
  payload: { sessionKey: string; runToken: string; runFence: number; containerId: string; model: string; cliVersion: string };
}

export interface StageSessionUpdateInternalAction extends InternalActionBase {
  op: 'stage-session-update';
  target: StageRunTarget;
  payload: { containerId: string; status: 'busy' | 'stopped'; claudeSessionId?: string; failure?: 'claude.notAuthenticated' };
}

export interface StageToolTrailAppendInternalAction extends InternalActionBase {
  op: 'stage-tool-trail-append';
  target: StageRunTarget;
  payload: { containerId: string; entries: ToolTrailEntry[] };
}

export interface StageTurnCompleteInternalAction extends InternalActionBase {
  op: 'stage-turn-complete';
  target: StageRunTarget;
  payload: {
    containerId: string;
    claudeSessionId?: string;
    turn: TurnResult;
    spend: { userId: string | null; model: string; inputChars: number; outputChars: number };
    ci?: StageCiReport;
  };
}

export interface StageHandoffCompleteInternalAction extends InternalActionBase {
  op: 'stage-handoff-complete';
  target: StageRunTarget;
  payload: {
    containerId: string;
    expectedClaudeSessionId: string;
    body: HandoffBody;
    reason: 'budget' | 'precompact';
  };
}

export interface StageForgePrepareInternalAction extends InternalActionBase {
  op: 'stage-forge-prepare';
  target: StageRunTarget;
  payload: { containerId: string; expectedBranch: string };
}

export interface StageForgeCompleteInternalAction extends InternalActionBase {
  op: 'stage-forge-complete';
  target: StageRunTarget;
  payload: { containerId: string; intentId: string; expectedBranch: string; mrUrl: string };
}

export interface StageDeferUpdateInternalAction extends InternalActionBase {
  op: 'stage-defer-update';
  target: StageTarget;
  payload: { mode: 'set' | 'clear'; reason: 'blocked' | 'editor' | 'capacity'; blockers: string[] };
}

export type AgentRecoveryReason = 'boot' | 'stuck' | 'worker-reap' | 'manual-kill';
export interface AgentRecoveryExpected {
  ticketStatus: string;
  needsInputHash: string;
  sessionStatus: 'busy' | 'paused';
  containerId: string;
  runToken: string;
  runFence: number;
  startedAt: number;
}
export interface AgentRecoveryTransitionInternalAction extends InternalActionBase {
  op: 'agent-recovery-transition';
  target: StageTarget & { sessionId: string };
  payload:
    | { phase: 'prepare'; reason: AgentRecoveryReason; expected: AgentRecoveryExpected; observedAt: number }
    | { phase: 'complete' | 'cancel'; reason: AgentRecoveryReason; expected: AgentRecoveryExpected; intentId: string };
}

export interface WatchdogReminderApplyInternalAction extends InternalActionBase {
  op: 'watchdog-reminder-apply';
  target: StageTarget;
  payload: {
    expected: { ticketStatus: string; archived: false; needsInputHash: string; remindedAt: number | null };
    now: number;
    intervalMs: number;
  };
}

export type InternalAction =
  | DocumentAssetTextInternalAction
  | ForgeEventInternalAction
  | ForgeSnapshotInternalAction
  | CiPublicCompleteInternalAction
  | AutomationEventApplyInternalAction
  | AutomationCronFireInternalAction
  | AutomationActionRunInternalAction
  | WorkspaceBuiltinsEnsureInternalAction
  | StudioArtifactBeginInternalAction
  | StudioArtifactCompleteInternalAction
  | ProjectDocsCompleteInternalAction
  | ProjectImageCompleteInternalAction
  | BrandImportInternalAction
  | StyleImportInternalAction
  | DockerfileSaveInternalAction
  | WorktreeFileSaveInternalAction
  | ChatTurnRecordInternalAction
  | DesignLibraryWriteInternalAction
  | StudioBriefSaveInternalAction
  | StudioDeleteInternalAction
  | PatIssueInternalAction
  | RuntimeLaunchPrepareInternalAction
  | RuntimeLaunchCompleteInternalAction
  | StageActivationCompleteInternalAction
  | StageSessionStartInternalAction
  | StageSessionUpdateInternalAction
  | StageToolTrailAppendInternalAction
  | StageTurnCompleteInternalAction
  | StageHandoffCompleteInternalAction
  | StageForgePrepareInternalAction
  | StageForgeCompleteInternalAction
  | StageDeferUpdateInternalAction
  | AgentRecoveryTransitionInternalAction
  | WatchdogReminderApplyInternalAction;
export type InternalOp = InternalAction['op'];

export const INTERNAL_OP_NAMES: readonly InternalOp[] = [
  'document-set-asset-text', 'forge-event-apply', 'forge-snapshot-apply', 'ci-public-complete',
  'automation-event-apply', 'automation-cron-fire', 'automation-action-run', 'workspace-builtins-ensure',
  'studio-artifact-begin', 'studio-artifact-complete', 'project-docs-complete', 'project-image-complete',
  'brand-import', 'style-import', 'dockerfile-save', 'worktree-file-save', 'chat-turn-record',
  'design-library-write', 'studio-brief-save', 'studio-delete', 'pat-issue',
  'runtime-launch-prepare', 'runtime-launch-complete',
  'stage-activation-complete', 'stage-session-start', 'stage-session-update', 'stage-tool-trail-append',
  'stage-turn-complete', 'stage-handoff-complete', 'stage-forge-prepare', 'stage-forge-complete',
  'stage-defer-update', 'agent-recovery-transition', 'watchdog-reminder-apply',
];
const INTERNAL_OPS = new Set<string>(INTERNAL_OP_NAMES);

export function isInternalOp(value: string): value is InternalOp {
  return INTERNAL_OPS.has(value);
}

//? Only operations whose apply is idempotent and whose authoritative entity can be compared against
//? later processed signals may be replayed. Brand/style/file completions carry an entity-version CAS;
//? a crash may repeat the same idempotent bytes/upserts, while any newer completion makes the old job stale.
export const CRASH_REPLAYABLE_INTERNAL_OPS: readonly InternalOp[] = [
  'studio-artifact-begin',
  'studio-artifact-complete',
  'project-docs-complete',
  'project-image-complete',
  'brand-import',
  'style-import',
  'dockerfile-save',
  'worktree-file-save',
  'chat-turn-record',
  'design-library-write',
  'studio-brief-save',
  'studio-delete',
  'runtime-launch-complete',
];

export function internalActionReplayKeys(action: InternalAction): readonly string[] {
  if (action.op === 'studio-artifact-begin' || action.op === 'studio-artifact-complete') {
    return [`studio-artifact:${action.target.artifactId}`, `studio-brief:${action.target.briefId}`];
  }
  if (action.op === 'studio-delete') {
    return action.target.artifactId
      ? [`studio-artifact:${action.target.artifactId}`]
      : [`studio-brief:${action.target.briefId ?? ''}`];
  }
  if (action.op === 'project-docs-complete') return ['project-docs'];
  if (action.op === 'project-image-complete') return [`project-image:${action.target.projectId}`];
  if (action.op === 'brand-import') return ['brand-library'];
  if (action.op === 'style-import') return ['style-presets'];
  if (action.op === 'dockerfile-save') return [`dockerfile:${action.target.projectId}`];
  if (action.op === 'worktree-file-save') return [`worktree-file:${action.target.ticketKey}:${action.payload.path}`];
  if (action.op === 'chat-turn-record') return [`chat:${action.target.userMessageId}`, `chat:${action.target.aiMessageId}`];
  if (action.op === 'design-library-write') return action.target.artifactId ? [`design-artifact:${action.target.artifactId}`] : [];
  if (action.op === 'studio-brief-save') return [`studio-brief:${action.target.briefId}`];
  if (action.op === 'runtime-launch-complete') return [`runtime-launch:${action.target.intentId}`];
  return [];
}

export function internalActionFromSignal(input: { workspaceId: string; kind: string; payload: unknown }): InternalAction | null {
  if (!isInternalOp(input.kind) || !isRecord(input.payload)) return null;
  const replay = isRecord(input.payload.replay) ? input.payload.replay : input.payload;
  const candidate: unknown = {
    workspaceId: input.workspaceId,
    op: input.kind,
    userId: input.payload.userId,
    clientRequestId: input.payload.clientRequestId,
    target: replay.target,
    payload: replay.payload,
  };
  const [validationError] = tryCatchSync(() => { assertValidInternalAction(candidate); });
  if (validationError) return null;
  //? The assertion above runs inside tryCatchSync, so TypeScript cannot retain its narrowing here.
  //? Repeating this pure bounded validation preserves a cast-free return type.
  assertValidInternalAction(candidate);
  return candidate;
}

type AssertNoPublicOverlap<T extends never> = T;
export type _InternalOpsAreNotControlOps = AssertNoPublicOverlap<Extract<InternalOp, ControlOp>>;

export type EnqueueInternalActionOptions = EnqueueControlActionOptions;

const MAX_INTERNAL_FIELD_BYTES = 512;
const MAX_AUTOMATION_PARAMS_BYTES = 64_000;
const MAX_AUTOMATION_SIGNAL_DEPTH = 4;
const MAX_DOCUMENT_URL_BYTES = 4096;
const MAX_DOCUMENT_TEXT_BYTES = 800_000;
const MAX_STAGE_TEXT_BYTES = 20_000;
const MAX_STAGE_URL_BYTES = 4096;
const MAX_STAGE_ENTRIES = 100;
const MAX_STAGE_QUESTIONS = 20;
const MAX_STAGE_ADVISORIES = 50;
const MAX_STAGE_ARRAY_ITEMS = 200;
const MAX_STAGE_JSON_BYTES = 256_000;
const AUTOMATION_ACTIONS = new Set(['notify', 'webhook', 'emit-signal', 'start-stage', 'invoke-agent-role', 'run-command', 'invoke-workspace-ai']);
const FORGE_EVENT_ACTIONS = new Set(['open', 'update', 'close', 'reopen', 'other']);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function assertRecord(label: string, value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`[internal-op] ${label} must be an object`);
}

function assertString(label: string, value: unknown, maxBytes = MAX_INTERNAL_FIELD_BYTES): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > maxBytes) {
    throw new Error(`[internal-op] ${label} must be a string within ${String(maxBytes)} bytes`);
  }
}

function assertRequiredString(label: string, value: unknown, maxBytes = MAX_INTERNAL_FIELD_BYTES): asserts value is string {
  assertString(label, value, maxBytes);
  if (value.length === 0) throw new Error(`[internal-op] ${label} must not be empty`);
}

function assertOptionalString(label: string, value: unknown, maxBytes = MAX_INTERNAL_FIELD_BYTES): void {
  if (value !== undefined) assertString(label, value, maxBytes);
}

function isJsonValue(value: unknown, depth = 0, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 32 || ancestors.has(value)) return false;
  if (!Array.isArray(value) && !isRecord(value)) return false;
  ancestors.add(value);
  const entries = Array.isArray(value) ? value : Object.values(value);
  const valid = entries.every((entry) => isJsonValue(entry, depth + 1, ancestors));
  ancestors.delete(value);
  return valid;
}

function assertBoundedJson(label: string, value: unknown, maxBytes: number): void {
  if (!isJsonValue(value)) throw new Error(`[internal-op] ${label} must contain only bounded JSON values`);
  const [jsonError, json] = tryCatchSync(() => JSON.stringify(value));
  if (jsonError || typeof json !== 'string' || Buffer.byteLength(json) > maxBytes) {
    throw new Error(`[internal-op] ${label} exceeds ${String(maxBytes)} bytes`);
  }
}

function assertDepth(label: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_AUTOMATION_SIGNAL_DEPTH) {
    throw new Error(`[automation] invalid ${label}`);
  }
}

function assertEngineEvent(value: unknown): void {
  assertRecord('payload.event', value);
  assertRequiredString('event.on', value.on);
  assertOptionalString('event.ticketKey', value.ticketKey);
  assertOptionalString('event.stageId', value.stageId);
  assertOptionalString('event.status', value.status);
  assertOptionalString('event.projectId', value.projectId);
}

function assertTriggerAction(value: unknown): void {
  assertRecord('payload.action', value);
  assertRequiredString('action.action', value.action);
  if (!AUTOMATION_ACTIONS.has(value.action)) throw new Error('[automation] unsupported trigger action');
  assertRecord('action.params', value.params);
  assertBoundedJson('action.params', value.params, MAX_AUTOMATION_PARAMS_BYTES);
  assertOptionalString('action.ticketKey', value.ticketKey);
  assertOptionalString('action.triggerName', value.triggerName);
  if (value.signalDepth !== undefined) assertDepth('signal recursion depth', value.signalDepth);
}

function assertForgeEvent(value: unknown): void {
  assertRecord('payload.event', value);
  if (value.kind !== 'issue' && value.kind !== 'ignored') throw new Error('[internal-op] invalid forge event kind');
  if (value.provider !== 'gitlab' && value.provider !== 'github') throw new Error('[internal-op] invalid forge event provider');
  if (typeof value.iid !== 'number' || !Number.isSafeInteger(value.iid) || value.iid < 0 || value.iid > 2_147_483_647) throw new Error('[internal-op] invalid forge event iid');
  if (typeof value.action !== 'string' || !FORGE_EVENT_ACTIONS.has(value.action)) throw new Error('[internal-op] invalid forge event action');
  assertString('forge event title', value.title, 500);
  if (value.description !== null) assertString('forge event description', value.description, 2000);
  if (!Array.isArray(value.labels) || value.labels.length > 20) throw new Error('[internal-op] invalid forge event labels');
  for (const label of value.labels) assertString('forge event label', label, 80);
  if (value.url !== null) assertString('forge event url', value.url, 2000);
  assertString('forge event state', value.state, 40);
  if (value.repo !== null) assertString('forge event repo', value.repo, 512);
  assertBoundedJson('forge event', value, 16_000);
}

function assertSafeInteger(label: string, value: unknown, max = 100_000_000): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`[internal-op] invalid ${label}`);
  }
}

function assertStringArray(label: string, value: unknown, maxItems: number, maxBytes = MAX_STAGE_TEXT_BYTES): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`[internal-op] invalid ${label}`);
  for (const entry of value) assertString(label, entry, maxBytes);
}

function assertStageTarget(value: Record<string, unknown>, requireSession: boolean): void {
  assertRequiredString('target.ticketId', value.ticketId);
  assertRequiredString('target.ticketKey', value.ticketKey);
  assertRequiredString('target.projectId', value.projectId);
  assertRequiredString('target.stageId', value.stageId);
  if (requireSession) {
    assertRequiredString('target.sessionId', value.sessionId);
    assertRequiredString('target.runToken', value.runToken, 128);
    assertSafeInteger('target.runFence', value.runFence, Number.MAX_SAFE_INTEGER);
    if (value.runFence === 0) throw new Error('[internal-op] target.runFence must be positive');
  }
}

function assertStageContainer(value: Record<string, unknown>): void {
  assertRequiredString('payload.containerId', value.containerId);
}

function assertStageTurn(value: unknown): void {
  assertRecord('payload.turn', value);
  if (value.kind === 'continue') return;
  if (value.kind === 'needs-input') {
    assertStringArray('turn.questions', value.questions, MAX_STAGE_QUESTIONS);
    return;
  }
  if (value.kind !== 'done') throw new Error('[internal-op] invalid stage turn kind');
  assertRecord('turn.envelope', value.envelope);
  assertString('turn.envelope.summary', value.envelope.summary, MAX_STAGE_TEXT_BYTES);
  assertStringArray('turn.envelope.changedFiles', value.envelope.changedFiles, MAX_STAGE_ARRAY_ITEMS, 4096);
  assertStringArray('turn.envelope.openQuestions', value.envelope.openQuestions, MAX_STAGE_QUESTIONS);
  assertOptionalString('turn.envelope.commitHash', value.envelope.commitHash);
  if (value.envelope.complexityScore !== undefined) assertSafeInteger('turn.envelope.complexityScore', value.envelope.complexityScore, 10);
  if (value.envelope.advisories !== undefined) {
    if (!Array.isArray(value.envelope.advisories) || value.envelope.advisories.length > MAX_STAGE_ADVISORIES) throw new Error('[internal-op] invalid turn advisories');
    for (const advisory of value.envelope.advisories) {
      assertRecord('turn advisory', advisory);
      assertRequiredString('turn advisory question', advisory.q, MAX_STAGE_TEXT_BYTES);
      assertString('turn advisory assumption', advisory.assumption, MAX_STAGE_TEXT_BYTES);
    }
  }
  assertBoundedJson('stage turn', value, MAX_STAGE_JSON_BYTES);
}

function assertToolTrailEntries(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STAGE_ENTRIES) throw new Error('[internal-op] invalid tool trail entries');
  for (const entry of value) {
    assertRecord('tool trail entry', entry);
    assertRequiredString('tool trail event id', entry.eventId, 24);
    if (!/^[a-f\d]{24}$/i.test(entry.eventId)) throw new Error('[internal-op] invalid tool trail event id');
    if (entry.type !== 'file-change' && entry.type !== 'command' && entry.type !== 'tool-use') throw new Error('[internal-op] invalid tool trail type');
    assertRequiredString('tool trail text', entry.text, 1000);
    assertRecord('tool trail metadata', entry.metadata);
    assertRequiredString('tool trail metadata.tool', entry.metadata.tool, 200);
    if (typeof entry.metadata.ok !== 'boolean') throw new Error('[internal-op] invalid tool trail result');
    assertRequiredString('tool trail metadata.turnMarker', entry.metadata.turnMarker, 64);
    if (!/^[a-f\d]{64}$/i.test(entry.metadata.turnMarker)) throw new Error('[internal-op] invalid tool trail turn marker');
    assertSafeInteger('tool trail occurrence', entry.metadata.occurrence, Number.MAX_SAFE_INTEGER);
    if (entry.metadata.changedFiles !== undefined) assertStringArray('tool trail changed files', entry.metadata.changedFiles, 20, 4096);
  }
  assertBoundedJson('tool trail entries', value, MAX_STAGE_JSON_BYTES);
}

function assertHandoffBody(value: unknown): void {
  assertRecord('payload.body', value);
  assertRequiredString('handoff summary', value.summary, MAX_STAGE_TEXT_BYTES);
  assertString('handoff state', value.state, MAX_STAGE_TEXT_BYTES);
  assertStringArray('handoff decisions', value.decisions, MAX_STAGE_ARRAY_ITEMS);
  assertStringArray('handoff next', value.next, MAX_STAGE_ARRAY_ITEMS);
  assertStringArray('handoff gotchas', value.gotchas, MAX_STAGE_ARRAY_ITEMS);
  assertOptionalString('handoff carried', value.carried, MAX_STAGE_TEXT_BYTES);
  assertBoundedJson('handoff body', value, MAX_STAGE_JSON_BYTES);
}

function assertStageCiReport(value: unknown): void {
  if (readCanonicalCiReport(value) === null) throw new Error('[internal-op] invalid stage CI report');
}

function assertSha256(label: string, value: unknown): void {
  assertRequiredString(label, value, 64);
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error(`[internal-op] invalid ${label}`);
}

function assertRecoveryExpected(value: unknown): void {
  assertRecord('payload.expected', value);
  assertRequiredString('expected.ticketStatus', value.ticketStatus, 40);
  assertSha256('expected.needsInputHash', value.needsInputHash);
  if (value.sessionStatus !== 'busy' && value.sessionStatus !== 'paused') throw new Error('[internal-op] invalid expected.sessionStatus');
  assertRequiredString('expected.containerId', value.containerId, 128);
  assertRequiredString('expected.runToken', value.runToken, 128);
  assertSafeInteger('expected.runFence', value.runFence, Number.MAX_SAFE_INTEGER);
  if (value.runFence === 0) throw new Error('[internal-op] expected.runFence must be positive');
  assertSafeInteger('expected.startedAt', value.startedAt, Number.MAX_SAFE_INTEGER);
}

//? Runtime trust boundary: TypeScript callers get the discriminated InternalAction union, while values
//? arriving from JS/tests/rolling processes are still rejected before any nested property is dereferenced.
export function assertValidInternalAction(action: unknown): asserts action is InternalAction {
  assertRecord('action', action);
  assertRequiredString('workspaceId', action.workspaceId);
  assertRequiredString('userId', action.userId);
  assertRequiredString('clientRequestId', action.clientRequestId);
  assertRecord('target', action.target);
  assertRecord('payload', action.payload);

  if (action.op === 'document-set-asset-text') {
    assertRequiredString('target.documentId', action.target.documentId);
    assertRequiredString('payload.url', action.payload.url, MAX_DOCUMENT_URL_BYTES);
    if (typeof action.payload.text !== 'string' || Buffer.byteLength(action.payload.text) > MAX_DOCUMENT_TEXT_BYTES) throw new Error('[internal-op] invalid extracted document text');
    if (action.payload.status !== 'ok' && action.payload.status !== 'empty' && action.payload.status !== 'unsupported' && action.payload.status !== 'failed') throw new Error('[internal-op] invalid extract status');
    return;
  }
  if (action.op === 'forge-event-apply') {
    assertForgeEvent(action.payload.event);
    if (typeof action.payload.acceptedAt !== 'number' || !Number.isSafeInteger(action.payload.acceptedAt) || action.payload.acceptedAt < 0) throw new Error('[internal-op] invalid forge acceptedAt');
    return;
  }
  if (action.op === 'forge-snapshot-apply') {
    assertRequiredString('target.projectId', action.target.projectId);
    if (readForgeSnapshot(action.payload.snapshot) === null) throw new Error('[internal-op] invalid forge snapshot');
    assertBoundedJson('forge snapshot', action.payload.snapshot, MAX_FORGE_SIGNAL_BYTES);
    return;
  }
  if (action.op === 'ci-public-complete') {
    assertRequiredString('target.ticketId', action.target.ticketId);
    assertRequiredString('target.ticketKey', action.target.ticketKey);
    assertRequiredString('target.projectId', action.target.projectId);
    assertRequiredString('payload.intentId', action.payload.intentId, 128);
    assertRequiredString('payload.prepareSignalId', action.payload.prepareSignalId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.payload.prepareSignalId)) throw new Error('[internal-op] invalid CI prepare signal id');
    assertRequiredString('payload.branch', action.payload.branch);
    assertRequiredString('payload.commitHash', action.payload.commitHash, 128);
    assertRequiredString('payload.observedHead', action.payload.observedHead, 128);
    if (!/^[a-f\d]{40,64}$/i.test(action.payload.commitHash) || !/^[a-f\d]{40,64}$/i.test(action.payload.observedHead)) throw new Error('[internal-op] invalid CI commit identity');
    if (action.payload.mergeRequestId !== null) assertRequiredString('payload.mergeRequestId', action.payload.mergeRequestId);
    assertRequiredString('payload.trigger', action.payload.trigger, 100);
    assertStageCiReport(action.payload.report);
    return;
  }
  if (action.op === 'automation-event-apply') {
    assertEngineEvent(action.payload.event);
    assertDepth('event recursion depth', action.payload.depth);
    return;
  }
  if (action.op === 'automation-cron-fire') {
    assertRequiredString('target.triggerId', action.target.triggerId);
    const minuteAt = action.payload.minuteAt;
    if (typeof minuteAt !== 'number' || !Number.isSafeInteger(minuteAt) || minuteAt < 0 || minuteAt % 60_000 !== 0) throw new Error('[automation] cron minute must be a minute-aligned timestamp');
    return;
  }
  if (action.op === 'automation-action-run') {
    if (action.payload.mode !== 'gated' && action.payload.mode !== 'execute') throw new Error('[automation] mode must be exactly gated or execute');
    if (typeof action.payload.requiresApproval !== 'boolean') throw new Error('[automation] requiresApproval must be boolean');
    if (action.payload.mode === 'execute' && action.payload.requiresApproval) throw new Error('[automation] approval-required action cannot use execute mode');
    assertTriggerAction(action.payload.action);
    return;
  }
  if (action.op === 'workspace-builtins-ensure') {
    if (Object.keys(action.target).length > 0 || Object.keys(action.payload).length > 0) {
      throw new Error('[workspace-builtins] target and payload must be empty');
    }
    return;
  }
  if (action.op === 'studio-artifact-begin') {
    assertRequiredString('target.artifactId', action.target.artifactId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.artifactId)) throw new Error('[internal-op] invalid studio artifact id');
    assertRequiredString('target.briefId', action.target.briefId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.briefId)) throw new Error('[internal-op] invalid studio brief id');
    assertRequiredString('payload.kind', action.payload.kind, 40);
    assertOptionalString('payload.tweak', action.payload.tweak, MAX_STAGE_TEXT_BYTES);
    return;
  }
  if (action.op === 'studio-artifact-complete') {
    assertRequiredString('target.artifactId', action.target.artifactId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.artifactId)) throw new Error('[internal-op] invalid studio artifact id');
    assertRequiredString('target.briefId', action.target.briefId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.briefId)) throw new Error('[internal-op] invalid studio brief id');
    assertRequiredString('payload.kind', action.payload.kind, 40);
    if (action.payload.status !== 'ready' && action.payload.status !== 'error') throw new Error('[internal-op] invalid studio artifact status');
    assertOptionalString('payload.title', action.payload.title, 500);
    assertOptionalString('payload.providerId', action.payload.providerId, 100);
    if (action.payload.error !== null) assertOptionalString('payload.error', action.payload.error, 1000);
    if (action.payload.content !== undefined) assertBoundedJson('payload.content', action.payload.content, MAX_STAGE_JSON_BYTES);
    return;
  }
  if (action.op === 'project-docs-complete') {
    assertString('payload.content', action.payload.content, MAX_DOCUMENT_TEXT_BYTES);
    assertString('payload.summary', action.payload.summary, 500);
    if (action.target.expectedVersion !== undefined) assertSafeInteger('target.expectedVersion', action.target.expectedVersion, Number.MAX_SAFE_INTEGER);
    return;
  }
  if (action.op === 'project-image-complete') {
    assertRequiredString('target.projectId', action.target.projectId);
    if (action.target.expectedVersion !== undefined) assertSafeInteger('target.expectedVersion', action.target.expectedVersion, Number.MAX_SAFE_INTEGER);
    assertRequiredString('payload.tag', action.payload.tag, 1000);
    return;
  }
  if (action.op === 'brand-import') {
    if (action.target.expectedVersion !== undefined) assertSafeInteger('target.expectedVersion', action.target.expectedVersion, Number.MAX_SAFE_INTEGER);
    assertBoundedJson('payload.kit', action.payload.kit, MAX_STAGE_JSON_BYTES);
    return;
  }
  if (action.op === 'style-import') {
    if (action.target.expectedVersion !== undefined) assertSafeInteger('target.expectedVersion', action.target.expectedVersion, Number.MAX_SAFE_INTEGER);
    assertBoundedJson('payload.styles', action.payload.styles, MAX_STAGE_JSON_BYTES);
    return;
  }
  if (action.op === 'dockerfile-save') {
    assertRequiredString('target.projectId', action.target.projectId);
    if (action.target.expectedVersion !== undefined) assertSafeInteger('target.expectedVersion', action.target.expectedVersion, Number.MAX_SAFE_INTEGER);
    assertString('payload.dockerfile', action.payload.dockerfile, MAX_DOCUMENT_TEXT_BYTES);
    return;
  }
  if (action.op === 'worktree-file-save') {
    assertRequiredString('target.ticketKey', action.target.ticketKey, 100);
    if (action.target.expectedVersion !== undefined) assertSafeInteger('target.expectedVersion', action.target.expectedVersion, Number.MAX_SAFE_INTEGER);
    assertRequiredString('payload.path', action.payload.path, 4096);
    assertString('payload.content', action.payload.content, MAX_DOCUMENT_TEXT_BYTES);
    return;
  }
  if (action.op === 'chat-turn-record') {
    assertRequiredString('target.userMessageId', action.target.userMessageId, 24);
    assertRequiredString('target.aiMessageId', action.target.aiMessageId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.userMessageId) || !/^[a-f\d]{24}$/i.test(action.target.aiMessageId)) throw new Error('[internal-op] invalid chat message id');
    assertRequiredString('payload.userText', action.payload.userText, 64_000);
    assertString('payload.aiText', action.payload.aiText, 64_000);
    return;
  }
  if (action.op === 'design-library-write') {
    if (action.payload.mode !== 'save' && action.payload.mode !== 'activate' && action.payload.mode !== 'delete') throw new Error('[internal-op] invalid design library mode');
    const artifactId = action.target.artifactId;
    if (artifactId !== undefined) {
      assertString('target.artifactId', artifactId, 24);
      if (!/^[a-f\d]{24}$/i.test(artifactId)) throw new Error('[internal-op] invalid design artifact id');
    }
    if (action.payload.mode === 'save') {
      if (artifactId === undefined) throw new Error('[internal-op] design library save target is required');
      assertRequiredString('payload.kind', action.payload.kind, 40);
      assertRequiredString('payload.name', action.payload.name, 500);
      assertOptionalString('payload.description', action.payload.description, MAX_STAGE_TEXT_BYTES);
      assertOptionalString('payload.source', action.payload.source, 40);
      assertBoundedJson('payload.content', action.payload.content, MAX_STAGE_JSON_BYTES);
      return;
    }
    if (action.target.artifactId === undefined) throw new Error('[internal-op] design library target is required');
    return;
  }
  if (action.op === 'studio-brief-save') {
    assertRequiredString('target.briefId', action.target.briefId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.briefId)) throw new Error('[internal-op] invalid studio brief id');
    if (typeof action.payload.create !== 'boolean') throw new Error('[internal-op] invalid studio brief mode');
    assertOptionalString('payload.projectId', action.payload.projectId, 24);
    assertRequiredString('payload.name', action.payload.name, 500);
    assertRequiredString('payload.productName', action.payload.productName, 500);
    assertString('payload.audience', action.payload.audience, MAX_STAGE_TEXT_BYTES);
    assertString('payload.tone', action.payload.tone, MAX_STAGE_TEXT_BYTES);
    assertString('payload.goals', action.payload.goals, MAX_STAGE_TEXT_BYTES);
    if (action.payload.notes !== null) assertString('payload.notes', action.payload.notes, MAX_STAGE_TEXT_BYTES);
    return;
  }
  if (action.op === 'studio-delete') {
    if (Object.keys(action.payload).length > 0) throw new Error('[internal-op] studio delete payload must be empty');
    const briefId = action.target.briefId;
    const artifactId = action.target.artifactId;
    if ((briefId === undefined) === (artifactId === undefined)) throw new Error('[internal-op] studio delete requires exactly one target');
    const id = briefId ?? artifactId;
    assertRequiredString('studio delete target', id, 24);
    if (!/^[a-f\d]{24}$/i.test(id)) throw new Error('[internal-op] invalid studio delete target');
    return;
  }
  if (action.op === 'pat-issue') {
    assertRequiredString('target.patId', action.target.patId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.patId)) throw new Error('[internal-op] invalid PAT id');
    assertRequiredString('payload.name', action.payload.name, 200);
    assertRequiredString('payload.tokenHash', action.payload.tokenHash, 64);
    if (!/^[a-f\d]{64}$/i.test(action.payload.tokenHash)) throw new Error('[internal-op] invalid PAT hash');
    assertRequiredString('payload.tokenPrefix', action.payload.tokenPrefix, 40);
    assertStringArray('payload.scopes', action.payload.scopes, 10, 100);
    return;
  }
  if (action.op === 'runtime-launch-prepare' || action.op === 'runtime-launch-complete') {
    assertRequiredString('target.intentId', action.target.intentId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.intentId)) throw new Error('[internal-op] invalid runtime intent id');
    assertRequiredString('target.ticketKey', action.target.ticketKey, 100);
    assertRequiredString('target.projectId', action.target.projectId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.target.projectId)) throw new Error('[internal-op] invalid runtime project id');
    if (action.payload.mode !== 'preview-open' && action.payload.mode !== 'preview-close' && action.payload.mode !== 'ref-preview-open' && action.payload.mode !== 'editor-open') throw new Error('[internal-op] invalid runtime mode');
    if (action.op === 'runtime-launch-prepare') {
      assertOptionalString('payload.branch', action.payload.branch, 500);
      assertOptionalString('payload.ref', action.payload.ref, 500);
      assertOptionalString('payload.image', action.payload.image, 1000);
      if ((action.payload.mode === 'editor-open' && !action.payload.branch) || (action.payload.mode === 'ref-preview-open' && !action.payload.ref)) throw new Error('[internal-op] runtime intent lacks its immutable input');
      return;
    }
    if (typeof action.payload.ok !== 'boolean') throw new Error('[internal-op] invalid runtime completion');
    assertOptionalString('payload.error', action.payload.error, 1000);
    return;
  }
  if (action.op === 'stage-activation-complete') {
    assertStageTarget(action.target, false);
    assertRequiredString('payload.branch', action.payload.branch);
    assertRequiredString('payload.commitHash', action.payload.commitHash);
    return;
  }
  if (action.op === 'stage-session-start') {
    assertStageTarget(action.target, false);
    assertStageContainer(action.payload);
    assertRequiredString('payload.sessionKey', action.payload.sessionKey);
    assertRequiredString('payload.runToken', action.payload.runToken, 128);
    assertSafeInteger('payload.runFence', action.payload.runFence, Number.MAX_SAFE_INTEGER);
    if (action.payload.runFence === 0) throw new Error('[internal-op] payload.runFence must be positive');
    assertRequiredString('payload.model', action.payload.model, 100);
    assertRequiredString('payload.cliVersion', action.payload.cliVersion, 100);
    return;
  }
  if (action.op === 'stage-session-update') {
    assertStageTarget(action.target, true);
    assertStageContainer(action.payload);
    if (action.payload.status !== 'busy' && action.payload.status !== 'stopped') throw new Error('[internal-op] invalid stage session status');
    assertOptionalString('payload.claudeSessionId', action.payload.claudeSessionId);
    if (action.payload.failure !== undefined && action.payload.failure !== 'claude.notAuthenticated') throw new Error('[internal-op] invalid stage session failure');
    return;
  }
  if (action.op === 'stage-tool-trail-append') {
    assertStageTarget(action.target, true);
    assertStageContainer(action.payload);
    assertToolTrailEntries(action.payload.entries);
    return;
  }
  if (action.op === 'stage-turn-complete') {
    assertStageTarget(action.target, true);
    assertStageContainer(action.payload);
    assertOptionalString('payload.claudeSessionId', action.payload.claudeSessionId);
    assertStageTurn(action.payload.turn);
    assertRecord('payload.spend', action.payload.spend);
    if (action.payload.spend.userId !== null) assertRequiredString('payload.spend.userId', action.payload.spend.userId);
    assertRequiredString('payload.spend.model', action.payload.spend.model, 100);
    assertSafeInteger('payload.spend.inputChars', action.payload.spend.inputChars);
    assertSafeInteger('payload.spend.outputChars', action.payload.spend.outputChars);
    if (action.payload.ci !== undefined) assertStageCiReport(action.payload.ci);
    return;
  }
  if (action.op === 'stage-handoff-complete') {
    assertStageTarget(action.target, true);
    assertStageContainer(action.payload);
    assertRequiredString('payload.expectedClaudeSessionId', action.payload.expectedClaudeSessionId);
    if (action.payload.reason !== 'budget' && action.payload.reason !== 'precompact') throw new Error('[internal-op] invalid handoff reason');
    assertHandoffBody(action.payload.body);
    return;
  }
  if (action.op === 'stage-forge-prepare') {
    assertStageTarget(action.target, true);
    assertStageContainer(action.payload);
    assertRequiredString('payload.expectedBranch', action.payload.expectedBranch);
    return;
  }
  if (action.op === 'stage-forge-complete') {
    assertStageTarget(action.target, true);
    assertStageContainer(action.payload);
    assertRequiredString('payload.intentId', action.payload.intentId, 24);
    if (!/^[a-f\d]{24}$/i.test(action.payload.intentId)) throw new Error('[internal-op] invalid forge intent id');
    assertRequiredString('payload.expectedBranch', action.payload.expectedBranch);
    assertRequiredString('payload.mrUrl', action.payload.mrUrl, MAX_STAGE_URL_BYTES);
    return;
  }
  if (action.op === 'stage-defer-update') {
    assertStageTarget(action.target, false);
    if (action.payload.mode !== 'set' && action.payload.mode !== 'clear') throw new Error('[internal-op] invalid stage defer mode');
    if (action.payload.reason !== 'blocked' && action.payload.reason !== 'editor' && action.payload.reason !== 'capacity') throw new Error('[internal-op] invalid stage defer reason');
    assertStringArray('payload.blockers', action.payload.blockers, 20, 100);
    if (action.payload.mode === 'set' && action.payload.reason === 'blocked' && action.payload.blockers.length === 0) throw new Error('[internal-op] blocked defer requires blockers');
    return;
  }
  if (action.op === 'agent-recovery-transition') {
    assertStageTarget(action.target, false);
    assertRequiredString('target.sessionId', action.target.sessionId);
    if (action.payload.reason !== 'boot' && action.payload.reason !== 'stuck' && action.payload.reason !== 'worker-reap' && action.payload.reason !== 'manual-kill') throw new Error('[internal-op] invalid recovery reason');
    assertRecoveryExpected(action.payload.expected);
    if (action.payload.phase === 'prepare') {
      assertSafeInteger('payload.observedAt', action.payload.observedAt, Number.MAX_SAFE_INTEGER);
      return;
    }
    if (action.payload.phase === 'complete' || action.payload.phase === 'cancel') {
      assertRequiredString('payload.intentId', action.payload.intentId, 24);
      if (!/^[a-f\d]{24}$/i.test(action.payload.intentId)) throw new Error('[internal-op] invalid recovery intent id');
      return;
    }
    throw new Error('[internal-op] invalid recovery phase');
  }
  if (action.op === 'watchdog-reminder-apply') {
    assertStageTarget(action.target, false);
    assertRecord('payload.expected', action.payload.expected);
    assertRequiredString('expected.ticketStatus', action.payload.expected.ticketStatus, 40);
    if (action.payload.expected.archived !== false) throw new Error('[internal-op] reminder expected.archived must be false');
    assertSha256('expected.needsInputHash', action.payload.expected.needsInputHash);
    if (action.payload.expected.remindedAt !== null) assertSafeInteger('expected.remindedAt', action.payload.expected.remindedAt, Number.MAX_SAFE_INTEGER);
    assertSafeInteger('payload.now', action.payload.now, Number.MAX_SAFE_INTEGER);
    assertSafeInteger('payload.intervalMs', action.payload.intervalMs, Number.MAX_SAFE_INTEGER);
    if (action.payload.intervalMs === 0) throw new Error('[internal-op] reminder interval must be positive');
    return;
  }
  throw new Error('[internal-op] unsupported operation');
}

//? The only typed entry point for server-internal writer actions. The Conductor
//? supplies the same durable signal, tenant scope, renewable lease, serial queue,
//? and terminal dedup as public control actions, under a distinct dedup namespace.
export async function enqueueInternalAction(
  action: InternalAction,
  options: EnqueueInternalActionOptions = {},
): Promise<EnqueuedControlAction> {
  assertValidInternalAction(action);
  const { enqueueInternalWriterAction } = await import('./conductor');
  return enqueueInternalWriterAction(action, options);
}
