//? Built-in CI execution + persistence split. Execution is write-free and always runs
//? outside the Conductor lease; persistence accepts only a bounded, internally-consistent
//? report and runs under the single writer. Stage CI uses the current ticket container;
//? public ci-run uses an ephemeral checkout pinned to one immutable commit.

import type { PrismaClient } from '@prisma/client';

import {
  containerMatchesExecutionIdentity,
  containerRunToken,
  docker,
  isWorkspacesContainer,
  launchTicketContainer,
  teardownTicketContainer,
  type ContainerExecutionIdentity,
  type ContainerInfo,
  type DockerResult,
} from '../container/runtime';
import { deterministicObjectId } from '../orchestrator/actionIds';
import { currentWriterScope, assertWorkspaceWriterContext } from '../orchestrator/writerContext';
import { jsonInput } from '../util/json';
import { parseCiYaml, specFingerprint, type CiJob, type CiSpec } from './parse';
import { workdirOrRoot } from '../deploy/servicePath';
import { planWaves, skippedBy, chunkWave, describeUnrunnable } from './dag';
import { higherSeverity, isScannerType, parseScan, scannerCommand, type SecurityFinding } from './security';
import { tryCatch } from '@luckystack/core';

export interface CiRunResult { status: 'none' | 'success' | 'failed' | 'canceled'; runId?: string; error?: string }

export interface StageCiJobReport {
  name: string;
  //? F23 — `skipped` is a real outcome, not a failure: a job whose dependency failed never ran, and
  //? reporting it as failed would blame the wrong job (and turn one red into a cascade of reds).
  status: 'success' | 'failed' | 'skipped';
  exitCode: number;
  severity: 'none' | 'low' | 'moderate' | 'high' | 'critical';
  findings: SecurityFinding[];
  logTail: string;
}

export type CiIntegrityError =
  | 'ci.worktreeDirtyBefore'
  | 'ci.worktreeChanged'
  | 'ci.headChanged'
  | 'ci.worktreeCheckFailed'
  | 'ci.executionFailed';

export type StageCiReport =
  | { kind: 'none'; commitHash: string; error: string }
  | { kind: 'forced-failed'; commitHash: string; error: CiIntegrityError }
  | { kind: 'executed'; commitHash: string; spec: CiSpec; jobs: StageCiJobReport[]; integrityError?: CiIntegrityError };

export interface StageCiExecutionDependencies {
  inspectContainer?: (container: string) => Promise<boolean>;
  runDocker?: (args: string[], options?: { timeoutMs?: number; maxOutputBytes?: number }) => Promise<DockerResult>;
}

export interface PublicCiExecutionInput {
  workspaceId: string;
  projectId: string;
  ticketKey: string;
  branch: string;
  commitHash: string;
  intentId: string;
  //? The unit being tested. `null`/absent = the project root, which is every single-unit repo.
  serviceId?: string | null;
  servicePath?: string | null;
}

export interface PublicCiExecutionDependencies {
  launch?: typeof launchTicketContainer;
  teardown?: typeof teardownTicketContainer;
  executeCurrent?: typeof runStageCiInContainer;
  ownsContainer?: typeof containerMatchesExecutionIdentity;
}

export interface PersistCiReportInput {
  projectId: string;
  //? Which monorepo unit this run belongs to. `null` = the project root, which is what a single-unit repo
  //? always is — a first-class value, never "missing".
  serviceId?: string | null;
  ticketId: string;
  mergeRequestId?: string | null;
  trigger: string;
  stageId?: string;
  sessionKey?: string;
  containerId?: string | null;
  clientRequestId: string;
  stale?: boolean;
}

export interface PersistCiReportResult extends CiRunResult {
  maxSeverity: StageCiJobReport['severity'];
  events: number;
}

const CI_PATH = '.workspaces/ci.yml';
const MAX_STAGE_CI_CONFIG_BYTES = 262_144;
const MAX_STAGE_CI_JOBS = 100;
const MAX_STAGE_CI_SCRIPT_BYTES = 20_000;
const MAX_STAGE_CI_LOG_BYTES = 2000;
const MAX_STAGE_CI_FINDINGS = 50;
const MAX_STAGE_JSON_BYTES = 256_000;
const STAGE_CI_COMMAND_TIMEOUT_MS = 240_000;
const SEVERITIES = new Set(['none', 'low', 'moderate', 'high', 'critical']);
const INTEGRITY_ERRORS = new Set<CiIntegrityError>([
  'ci.worktreeDirtyBefore',
  'ci.worktreeChanged',
  'ci.headChanged',
  'ci.worktreeCheckFailed',
  'ci.executionFailed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, maxBytes: number, required = false): value is string {
  return typeof value === 'string' && (!required || value.length > 0) && Buffer.byteLength(value) <= maxBytes;
}

function boundedUtf8(value: string, maxBytes: number, tail = false): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const bytes = Buffer.from(value, 'utf8');
  let bounded = (tail ? bytes.subarray(-maxBytes) : bytes.subarray(0, maxBytes)).toString('utf8');
  while (Buffer.byteLength(bounded) > maxBytes) bounded = tail ? bounded.slice(1) : bounded.slice(0, -1);
  return bounded;
}

function exactSeverity(value: string): StageCiJobReport['severity'] {
  return value === 'low' || value === 'moderate' || value === 'high' || value === 'critical' ? value : 'none';
}

function severityFromFindings(findings: readonly SecurityFinding[]): StageCiJobReport['severity'] {
  let severity: StageCiJobReport['severity'] = 'none';
  for (const finding of findings) severity = exactSeverity(higherSeverity(severity, finding.severity));
  return severity;
}

function boundedStageSpec(spec: CiSpec): boolean {
  if (!Number.isSafeInteger(spec.version) || spec.version < 0 || spec.version > 100) return false;
  if (spec.stages.length === 0 || spec.stages.length > MAX_STAGE_CI_JOBS) return false;
  if (new Set(spec.stages).size !== spec.stages.length || spec.stages.some((stage) => !boundedString(stage, 512, true))) return false;
  if (spec.jobs.length === 0 || spec.jobs.length > MAX_STAGE_CI_JOBS) return false;
  const names = new Set<string>();
  for (const job of spec.jobs) {
    if (!boundedString(job.name, 512, true) || names.has(job.name)) return false;
    names.add(job.name);
    if (!boundedString(job.stage, 512, true) || !spec.stages.includes(job.stage)) return false;
    if (!boundedString(job.type, 100, true) || !boundedString(job.image, 512, true)) return false;
    if (typeof job.allowFailure !== 'boolean') return false;
    if (job.needs.length > MAX_STAGE_CI_JOBS || job.needs.some((need) => !boundedString(need, 512, true))) return false;
    if (job.script.length > MAX_STAGE_CI_JOBS || job.script.some((command) => !boundedString(command, MAX_STAGE_CI_SCRIPT_BYTES))) return false;
  }
  return spec.jobs.every((job) => job.needs.every((need) => names.has(need)));
}

function readCiSpec(value: unknown): CiSpec | null {
  if (!isRecord(value) || typeof value.version !== 'number' || !Array.isArray(value.stages) || !Array.isArray(value.jobs)) return null;
  const stages = value.stages.filter((stage): stage is string => typeof stage === 'string');
  if (stages.length !== value.stages.length) return null;
  const jobs: CiJob[] = [];
  for (const raw of value.jobs) {
    if (!isRecord(raw) || !Array.isArray(raw.script) || !Array.isArray(raw.needs)) return null;
    if (typeof raw.name !== 'string' || typeof raw.stage !== 'string' || typeof raw.type !== 'string' || typeof raw.image !== 'string' || typeof raw.allowFailure !== 'boolean') return null;
    const script = raw.script.filter((entry): entry is string => typeof entry === 'string');
    const needs = raw.needs.filter((entry): entry is string => typeof entry === 'string');
    if (script.length !== raw.script.length || needs.length !== raw.needs.length) return null;
    jobs.push({ name: raw.name, stage: raw.stage, type: raw.type, image: raw.image, allowFailure: raw.allowFailure, script, needs });
  }
  const spec = { version: value.version, stages, jobs };
  return boundedStageSpec(spec) ? spec : null;
}

function readFinding(value: unknown): SecurityFinding | null {
  if (!isRecord(value) || !boundedString(value.id, 512, true) || !boundedString(value.title, 500, true)) return null;
  if (typeof value.severity !== 'string' || !SEVERITIES.has(value.severity)) return null;
  return { id: value.id, severity: value.severity, title: value.title };
}

//? The one runtime report trust boundary, shared by stage InternalOps and public
//? ci-run persistence. Job status is derived from exitCode (allowFailure affects only
//? the rollup); scanner severity is recomputed from the bounded findings. A caller may
//? not smuggle a second allowFailure bit into a job result or under-report severity.
export function readCanonicalCiReport(value: unknown): StageCiReport | null {
  if (!isRecord(value) || !boundedString(value.commitHash, 128, true) || !/^[a-f\d]{40,64}$/i.test(value.commitHash)) return null;
  if ('status' in value || 'runId' in value) return null;
  if (value.kind === 'none') {
    if (!boundedString(value.error, 2000, true)) return null;
    return Buffer.byteLength(JSON.stringify(value)) <= MAX_STAGE_JSON_BYTES
      ? { kind: 'none', commitHash: value.commitHash, error: value.error }
      : null;
  }
  if (value.kind === 'forced-failed') {
    if (typeof value.error !== 'string' || !INTEGRITY_ERRORS.has(value.error as CiIntegrityError)) return null;
    return { kind: 'forced-failed', commitHash: value.commitHash, error: value.error as CiIntegrityError };
  }
  if (value.kind !== 'executed') return null;
  const spec = readCiSpec(value.spec);
  if (!spec || !Array.isArray(value.jobs) || value.jobs.length !== spec.jobs.length) return null;
  const specByName = new Map(spec.jobs.map((job) => [job.name, job]));
  const seen = new Set<string>();
  const jobs: StageCiJobReport[] = [];
  for (const raw of value.jobs) {
    if (!isRecord(raw) || 'allowFailure' in raw || !boundedString(raw.name, 512, true) || seen.has(raw.name)) return null;
    const jobSpec = specByName.get(raw.name);
    if (!jobSpec || typeof raw.exitCode !== 'number' || !Number.isSafeInteger(raw.exitCode) || raw.exitCode < -1 || raw.exitCode > 255) return null;
    if (!Array.isArray(raw.findings) || raw.findings.length > MAX_STAGE_CI_FINDINGS || !boundedString(raw.logTail, MAX_STAGE_CI_LOG_BYTES)) return null;
    const findings = raw.findings.map((finding) => readFinding(finding));
    if (findings.includes(null)) return null;
    const boundedFindings = findings.filter((finding): finding is SecurityFinding => finding !== null);
    const expectedStatus = raw.exitCode === 0 ? 'success' : 'failed';
    if (raw.status !== expectedStatus) return null;
    const expectedSeverity = isScannerType(jobSpec.type) ? severityFromFindings(boundedFindings) : 'none';
    if (!isScannerType(jobSpec.type) && boundedFindings.length > 0) return null;
    if (raw.severity !== expectedSeverity) return null;
    seen.add(raw.name);
    jobs.push({ name: raw.name, status: expectedStatus, exitCode: raw.exitCode, severity: expectedSeverity, findings: boundedFindings, logTail: raw.logTail });
  }
  const integrityError = value.integrityError;
  if (integrityError !== undefined && (typeof integrityError !== 'string' || !INTEGRITY_ERRORS.has(integrityError as CiIntegrityError))) return null;
  const canonical: StageCiReport = {
    kind: 'executed',
    commitHash: value.commitHash,
    spec,
    jobs,
    ...(integrityError === undefined ? {} : { integrityError: integrityError as CiIntegrityError }),
  };
  return Buffer.byteLength(JSON.stringify(canonical)) <= MAX_STAGE_JSON_BYTES ? canonical : null;
}

async function worktreeStatus(container: string, runDocker: NonNullable<StageCiExecutionDependencies['runDocker']>): Promise<DockerResult> {
  return runDocker(['exec', container, 'git', '-C', '/work', 'status', '--porcelain=v1', '--untracked-files=all'], { timeoutMs: 10_000, maxOutputBytes: 32_768 });
}

async function worktreeHead(container: string, runDocker: NonNullable<StageCiExecutionDependencies['runDocker']>): Promise<DockerResult> {
  return runDocker(['exec', container, 'git', '-C', '/work', 'rev-parse', 'HEAD'], { timeoutMs: 10_000, maxOutputBytes: 4096 });
}

function failedReports(spec: CiSpec, error: CiIntegrityError): StageCiJobReport[] {
  return spec.jobs.map((job) => ({
    name: job.name,
    status: 'failed',
    exitCode: -1,
    severity: 'none',
    findings: [],
    logTail: error,
  }));
}

//? Current-container execution. The worktree must be clean before CI; pre-HEAD is
//? frozen as report.commitHash; post-HEAD and the complete tracked+untracked status
//? must be byte-for-byte clean again. A mutating job forces the run red.
export async function runStageCiInContainer(
  container: string,
  dependencies: StageCiExecutionDependencies = {},
  //? Per-service CI: the repo-relative root of the unit being tested. Omitted / '.' means the repo root,
  //? which is what a single-unit repo always is — so every existing caller keeps its exact behaviour.
  servicePath?: string | null,
): Promise<StageCiReport> {
  const inspectContainer = dependencies.inspectContainer ?? isWorkspacesContainer;
  const runDocker = dependencies.runDocker ?? docker;
  if (!(await inspectContainer(container))) throw new Error('ci.containerNotOwned');

  const preHead = await worktreeHead(container, runDocker);
  const commitHash = preHead.out.trim();
  if (preHead.code !== 0 || !/^[a-f\d]{40,64}$/i.test(commitHash)) throw new Error('ci.commitUnavailable');
  const preStatus = await worktreeStatus(container, runDocker);

  //? Each unit carries its OWN ci.yml under its own root, which is what makes a service independently
  //? testable — the alternative (one root file with a `services:` key) would put every unit's spec behind
  //? a single parse and a single specHash, defeating the per-service Pipeline row entirely.
  const workDir = workdirOrRoot(servicePath);
  const configPath = `${workDir}/${CI_PATH}`;
  const config = await runDocker(['exec', container, 'sh', '-lc', `cat ${configPath} 2>/dev/null`], { timeoutMs: 10_000, maxOutputBytes: MAX_STAGE_CI_CONFIG_BYTES });
  if (config.outputLimitExceeded) return { kind: 'none', commitHash, error: 'ci.configTooLarge' };
  if (config.code !== 0 || config.out.trim().length === 0) {
    return preStatus.code === 0 && preStatus.out.length === 0
      ? { kind: 'none', commitHash, error: 'ci.empty' }
      : { kind: 'forced-failed', commitHash, error: preStatus.code === 0 ? 'ci.worktreeDirtyBefore' : 'ci.worktreeCheckFailed' };
  }
  const parsed = parseCiYaml(config.out);
  if (!parsed.ok) return { kind: 'none', commitHash, error: boundedUtf8(parsed.error, 2000) };
  if (!boundedStageSpec(parsed.spec)) return { kind: 'none', commitHash, error: 'ci.reportTooLarge' };
  if (preStatus.code !== 0 || preStatus.out.length > 0) {
    const integrityError: CiIntegrityError = preStatus.code === 0 ? 'ci.worktreeDirtyBefore' : 'ci.worktreeCheckFailed';
    return { kind: 'executed', commitHash, spec: parsed.spec, jobs: failedReports(parsed.spec, integrityError), integrityError };
  }

  //? F23 — a real DAG instead of a flat stage-ordered sequence. Jobs whose dependencies are satisfied form
  //? a WAVE and run concurrently (capped); a job whose dependency FAILED is never started and is reported
  //? `skipped` — it used to run anyway and fail confusingly on its own.
  const dagJobs = parsed.spec.jobs.map((job) => ({ name: job.name, stage: job.stage, needs: job.needs }));
  const plan = planWaves(dagJobs, parsed.spec.stages);
  const jobByName = new Map(parsed.spec.jobs.map((job) => [job.name, job]));
  const failedJobs = new Set<string>();
  const jobs: StageCiJobReport[] = [];

  const runOneJob = async (jobName: string): Promise<StageCiJobReport | null> => {
    const job = jobByName.get(jobName);
    if (!job) return null;
    const scanner = isScannerType(job.type);
    const command = scanner ? scannerCommand(job.type) : job.script.join(' && ');
    //? Jobs run in the SERVICE's directory. Running them at the repo root is why a monorepo service's
    //? `npm test` either failed outright or — worse — tested the root project while reporting the service.
    const result = await runDocker(['exec', '-w', workDir, container, 'sh', '-lc', command], {
      timeoutMs: STAGE_CI_COMMAND_TIMEOUT_MS,
      maxOutputBytes: 32_768,
    });
    if (scanner) {
      const scan = parseScan(job.type, result.out);
      const findings = scan.findings.slice(0, MAX_STAGE_CI_FINDINGS).map((finding) => ({
        id: boundedUtf8(finding.id, 512),
        severity: exactSeverity(finding.severity),
        title: boundedUtf8(finding.title, 500),
      }));
      return {
        name: job.name,
        status: result.code === 0 ? 'success' : 'failed',
        exitCode: result.code,
        severity: severityFromFindings(findings),
        findings,
        logTail: boundedUtf8(`${String(findings.length)} finding(s)`, MAX_STAGE_CI_LOG_BYTES, true),
      };
    }
    return {
      name: job.name,
      status: result.code === 0 ? 'success' : 'failed',
      exitCode: result.code,
      severity: 'none',
      findings: [],
      logTail: boundedUtf8(`${result.out}
${result.err}`, MAX_STAGE_CI_LOG_BYTES, true),
    };
  };

  for (const wave of plan.waves) {
    const blocked = skippedBy(dagJobs, failedJobs);
    for (const name of wave.filter((jobName) => blocked.has(jobName))) {
      jobs.push({ name, status: 'skipped', exitCode: 0, severity: 'none', findings: [], logTail: 'skipped: a dependency failed' });
    }
    //? Concurrency-capped: the whole DAG shares ONE container on a shared Docker host, so unbounded
    //? parallelism would trade "CI is slow" for "the host is wedged".
    for (const chunk of chunkWave(wave.filter((jobName) => !blocked.has(jobName)))) {
      const results = await Promise.all(chunk.map((name) => runOneJob(name)));
      for (const report of results) {
        if (!report) continue;
        jobs.push(report);
        if (report.status === 'failed') failedJobs.add(report.name);
      }
    }
  }

  //? A cycle (or a `needs` naming a job that does not exist) is a config error the user must SEE.
  for (const name of plan.unrunnable) {
    jobs.push({ name, status: 'skipped', exitCode: 0, severity: 'none', findings: [], logTail: describeUnrunnable(plan) });
  }

  const [postHead, postStatus] = await Promise.all([worktreeHead(container, runDocker), worktreeStatus(container, runDocker)]);
  let integrityError: CiIntegrityError | undefined;
  if (postHead.code !== 0 || postStatus.code !== 0) integrityError = 'ci.worktreeCheckFailed';
  else if (postHead.out.trim() !== commitHash) integrityError = 'ci.headChanged';
  else if (postStatus.out.length > 0) integrityError = 'ci.worktreeChanged';
  return { kind: 'executed', commitHash, spec: parsed.spec, jobs, ...(integrityError ? { integrityError } : {}) };
}

//? Public ci-run execution at an immutable ref. The ephemeral container has its own
//? ref-scoped volume and is always torn down after the write-free report is captured.
export async function runPublicCiAtCommit(
  input: PublicCiExecutionInput,
  dependencies: PublicCiExecutionDependencies = {},
): Promise<StageCiReport> {
  if (currentWriterScope() !== null) throw new Error('[ci] public execution cannot run under the workspace writer');
  const launch = dependencies.launch ?? launchTicketContainer;
  const teardown = dependencies.teardown ?? teardownTicketContainer;
  const executeCurrent = dependencies.executeCurrent ?? runStageCiInContainer;
  const ownsContainer = dependencies.ownsContainer ?? containerMatchesExecutionIdentity;
  const identitySeed = `${input.projectId}:${input.commitHash}:${input.intentId}`;
  const ephemeralKey = `ci-${deterministicObjectId(input.workspaceId, identitySeed, 'ephemeral')}`;
  const runToken = `ci-${deterministicObjectId(input.workspaceId, identitySeed, 'container-owner')}`;
  const executionIdentity: ContainerExecutionIdentity = { projectId: input.projectId, ref: input.commitHash, intentId: input.intentId };
  const [launchError, container] = await tryCatch(() => launch({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    ticketKey: ephemeralKey,
    branch: input.branch,
    ref: input.commitHash,
    runToken,
    executionIdentity,
  }));
  if (launchError || !container) return { kind: 'forced-failed', commitHash: input.commitHash, error: 'ci.executionFailed' };
  const [executionError, report] = await tryCatch(() => executeCurrent(container.name, {}, input.servicePath));
  const [ownershipError, owned] = await tryCatch(() => ownsContainer(container.name, executionIdentity));
  if (!ownershipError && owned === true) await tryCatch(() => teardown(input.workspaceId, ephemeralKey, input.commitHash));
  if (executionError || report?.commitHash !== input.commitHash) return { kind: 'forced-failed', commitHash: input.commitHash, error: 'ci.executionFailed' };
  return report;
}

async function ensurePipeline(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  serviceId: string | null,
  report: Exclude<StageCiReport, { kind: 'none' }>,
): Promise<string> {
  //? One pipeline per (project, service). Looking up by project alone made every service in a monorepo
  //? share — and overwrite — one pipeline row, so the last service to run defined the spec for all of them.
  const existing = await prisma.pipeline.findFirst({ where: { workspaceId, projectId, serviceId }, select: { id: true } });
  if (existing) {
    if (report.kind === 'executed') {
      await prisma.pipeline.update({ where: { id: existing.id }, data: { specHash: specFingerprint(report.spec), stages: report.spec.stages, enabled: true, runnerKind: 'builtin' } });
    }
    return existing.id;
  }
  const created = await prisma.pipeline.create({
    data: {
      workspaceId,
      projectId,
      //? Written EXPLICITLY, including the null: on MongoDB an omitted field is absent, and an absent field
      //? does not match the `serviceId: null` lookup above — the row would be invisible to its own query
      //? (lesson 0014) and the unique index would not hold it apart from a real per-service row.
      serviceId,
      specHash: report.kind === 'executed' ? specFingerprint(report.spec) : `integrity:${report.error}`,
      stages: report.kind === 'executed' ? report.spec.stages : [],
      enabled: true,
      runnerKind: 'builtin',
    },
    select: { id: true },
  });
  return created.id;
}

async function appendDeterministicCiEvent(
  prisma: PrismaClient,
  workspaceId: string,
  ticketId: string,
  id: string,
  input: { stageId?: string; sessionKey?: string; text: string; metadata: Record<string, unknown> },
): Promise<boolean> {
  const exists = await prisma.ticketEvent.findUnique({ where: { id }, select: { id: true } });
  if (exists) return false;
  const last = await prisma.ticketEvent.findFirst({ where: { workspaceId, ticketId }, orderBy: { seq: 'desc' }, select: { seq: true } });
  await prisma.ticketEvent.create({
    data: {
      id,
      workspaceId,
      ticketId,
      seq: (last?.seq ?? 0) + 1,
      type: 'ci',
      actor: 'conductor',
      ...(input.stageId ? { stageId: input.stageId } : {}),
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
      text: input.text,
      metadata: jsonInput(input.metadata),
    },
  });
  return true;
}

//? Writer-only CI materializer shared by stage completion and public ci-run. Every
//? run/job/event id is deterministic from clientRequestId. A partial preseed or a
//? direct helper retry converges on the same rows; no Mongo transaction is claimed.
export async function persistCiReport(
  prisma: PrismaClient,
  workspaceId: string,
  rawReport: unknown,
  input: PersistCiReportInput,
): Promise<PersistCiReportResult> {
  assertWorkspaceWriterContext(workspaceId);
  const report = readCanonicalCiReport(rawReport);
  if (!report) throw new Error('[ci] malformed execution report');
  if (report.kind === 'none') return { status: 'none', error: report.error, maxSeverity: 'none', events: 0 };

  const derivedStatus: 'success' | 'failed' = report.kind === 'forced-failed'
    || report.integrityError !== undefined
    || report.jobs.some((job) => job.status === 'failed' && report.spec.jobs.find((spec) => spec.name === job.name)?.allowFailure === false)
    ? 'failed'
    : 'success';
  const status: 'success' | 'failed' | 'canceled' = input.stale === true ? 'canceled' : derivedStatus;
  let maxSeverity: StageCiJobReport['severity'] = 'none';
  if (report.kind === 'executed') {
    for (const job of report.jobs) maxSeverity = exactSeverity(higherSeverity(maxSeverity, severityFromFindings(job.findings)));
  }
  const serviceId = input.serviceId ?? null;
  const pipelineId = await ensurePipeline(prisma, workspaceId, input.projectId, serviceId, report);
  //? The deterministic ids are salted with the SERVICE as well as the request. Without it, running two
  //? services under one `clientRequestId` — which is exactly what a fan-out CI run does — produces the same
  //? run/job/event ids for both, so the second service silently overwrites the first's results.
  const scope = serviceId ?? 'root';
  const runId = deterministicObjectId(workspaceId, input.clientRequestId, `ci-run:${scope}`);
  await prisma.pipelineRun.upsert({
    where: { id: runId },
    create: {
      id: runId,
      workspaceId,
      pipelineId,
      projectId: input.projectId,
      serviceId,
      ticketId: input.ticketId,
      ...(input.mergeRequestId ? { mergeRequestId: input.mergeRequestId } : {}),
      commitHash: report.commitHash,
      trigger: input.trigger,
      status,
      maxSeverity,
      finishedAt: new Date(),
      ...(input.stale === true ? { artifacts: jsonInput({ stale: true, reason: 'ci.sourceAdvanced' }) } : {}),
    },
    update: {
      pipelineId,
      projectId: input.projectId,
      serviceId,
      ticketId: input.ticketId,
      mergeRequestId: input.mergeRequestId ?? null,
      commitHash: report.commitHash,
      trigger: input.trigger,
      status,
      maxSeverity,
      finishedAt: new Date(),
      ...(input.stale === true ? { artifacts: jsonInput({ stale: true, reason: 'ci.sourceAdvanced' }) } : {}),
    },
  });

  let events = 0;
  if (report.kind === 'executed') {
    const specByName = new Map(report.spec.jobs.map((job) => [job.name, job]));
    for (let index = 0; index < report.jobs.length; index += 1) {
      const job = report.jobs[index];
      if (!job) continue;
      const spec = specByName.get(job.name);
      if (!spec) throw new Error('[ci] canonical report lost its spec job');
      const jobId = deterministicObjectId(workspaceId, input.clientRequestId, `ci-job:${scope}:${String(index)}:${job.name}`);
      await prisma.pipelineJob.upsert({
        where: { id: jobId },
        create: {
          id: jobId,
          workspaceId,
          pipelineRunId: runId,
          name: job.name,
          stage: spec.stage,
          jobType: spec.type,
          needs: spec.needs,
          script: spec.script,
          imageRef: spec.image,
          status: job.status,
          severity: job.severity,
          findings: jsonInput(job.findings),
          allowFailure: spec.allowFailure,
          containerId: input.containerId ?? null,
          exitCode: job.exitCode,
          logTail: job.logTail,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
        update: {
          pipelineRunId: runId,
          name: job.name,
          stage: spec.stage,
          jobType: spec.type,
          needs: spec.needs,
          script: spec.script,
          imageRef: spec.image,
          status: job.status,
          severity: job.severity,
          findings: jsonInput(job.findings),
          allowFailure: spec.allowFailure,
          containerId: input.containerId ?? null,
          exitCode: job.exitCode,
          logTail: job.logTail,
          finishedAt: new Date(),
        },
      });
      const eventId = deterministicObjectId(workspaceId, input.clientRequestId, `ci-event:${scope}:${String(index)}:${job.name}`);
      const appended = await appendDeterministicCiEvent(prisma, workspaceId, input.ticketId, eventId, {
        ...(input.stageId ? { stageId: input.stageId } : {}),
        ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
        text: `CI ${job.name} ${job.status}`,
        metadata: {
          pipelineRunId: runId,
          commitHash: report.commitHash,
          jobName: job.name,
          status: job.status,
          allowFailure: spec.allowFailure,
          severity: job.severity,
          findings: job.findings.length,
        },
      });
      if (appended) events += 1;
    }
  }

  const rollupEventId = deterministicObjectId(workspaceId, input.clientRequestId, `ci-event:rollup:${scope}`);
  const rollupAppended = await appendDeterministicCiEvent(prisma, workspaceId, input.ticketId, rollupEventId, {
    ...(input.stageId ? { stageId: input.stageId } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    text: input.stale === true ? 'CI canceled — source advanced during execution' : `CI ${status}`,
    metadata: {
      pipelineRunId: runId,
      commitHash: report.commitHash,
      status,
      ...(input.stale === true ? { stale: true } : {}),
      maxSeverity,
      ...(report.kind === 'forced-failed' ? { integrityError: report.error } : {}),
      ...(report.kind === 'executed' && report.integrityError ? { integrityError: report.integrityError } : {}),
    },
  });
  if (rollupAppended) events += 1;
  return { status, runId, maxSeverity, events };
}

//? Used only by cleanup tests/diagnostics to prove the ephemeral launch carries its owner label.
export async function publicCiContainerOwnsToken(container: ContainerInfo, token: string): Promise<boolean> {
  return (await containerRunToken(container.name)) === token;
}
