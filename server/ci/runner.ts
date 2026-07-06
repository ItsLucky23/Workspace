//? Built-in CI runner (ADR 0039, C1). Reads a project's `.workspaces/ci.yml` at a frozen commit, parses
//? it into a job DAG, then runs each job's script in a container (`docker exec`) in stage order, recording
//? a `TicketEvent(type:'ci')` per job and rolling the run up to success/failed. "Borrowed, not built"
//? (BUILTIN_CI §1): reuses `launchTicketContainer` (same image/hardening/egress) + the `docker()` exec
//? primitive. Best-effort: no ci.yml ⇒ no run ('none'); no docker ⇒ 'canceled' (can't run, does NOT gate
//? red). The `PipelineJob` rows are the audit/resume truth; the events are the surface-rendering truth.

import type { PrismaClient } from '@prisma/client';

import { launchTicketContainer, teardownTicketContainer, docker, dockerAvailable } from '../container/runtime';
import { showRepoFile } from '../git/repoStore';
import { parseCiYaml, specFingerprint } from './parse';
import { isScannerType, scannerCommand, parseScan, higherSeverity } from './security';

export interface CiRunResult { status: string; runId?: string; error?: string }

const CI_PATH = '.workspaces/ci.yml';

//? Record one CI `TicketEvent` (seq-ordered, best-effort) so the MR/board render the checks list. Only
//? when the run gates a ticket (branch-only runs have no ticket to attach to).
async function recordCiEvent(prisma: PrismaClient, workspaceId: string, ticketId: string | null, text: string, metadata: Record<string, unknown>): Promise<void> {
  if (!ticketId) return;
  const last = await prisma.ticketEvent.findFirst({ where: { workspaceId, ticketId }, orderBy: { seq: 'desc' }, select: { seq: true } });
  await prisma.ticketEvent.create({ data: { workspaceId, ticketId, seq: (last?.seq ?? 0) + 1, type: 'ci', actor: 'conductor', text, metadata } }).catch(() => null);
}

//? Run the project's CI at `commitHash` (frozen). Creates Pipeline (upsert) + PipelineRun + PipelineJobs,
//? executes the jobs, rolls up. Returns the terminal run status.
export async function runPipeline(prisma: PrismaClient, workspaceId: string, projectId: string, input: { branch: string; commitHash: string; ticketId?: string | null; mergeRequestId?: string | null; trigger: string }): Promise<CiRunResult> {
  const yamlBody = await showRepoFile(workspaceId, input.commitHash || 'HEAD', CI_PATH);
  const parsed = parseCiYaml(yamlBody);
  if (!parsed.ok) return { status: 'none', error: parsed.error };
  const spec = parsed.spec;

  //? Upsert the project's Pipeline definition (one active per project).
  const existingPipe = await prisma.pipeline.findFirst({ where: { workspaceId, projectId }, select: { id: true } });
  const pipeline = existingPipe
    ? await prisma.pipeline.update({ where: { id: existingPipe.id }, data: { specHash: specFingerprint(spec), stages: spec.stages, enabled: true } })
    : await prisma.pipeline.create({ data: { workspaceId, projectId, specHash: specFingerprint(spec), stages: spec.stages, runnerKind: 'builtin' } });

  const run = await prisma.pipelineRun.create({
    data: {
      workspaceId, pipelineId: pipeline.id, projectId, commitHash: input.commitHash, trigger: input.trigger, status: 'running',
      ...(input.ticketId ? { ticketId: input.ticketId } : {}), ...(input.mergeRequestId ? { mergeRequestId: input.mergeRequestId } : {}),
    },
  });
  const ticketId = input.ticketId ?? null;

  //? Order jobs by stage (jobs within a stage run sequentially here — a parallel scheduler is a later
  //? optimization); resolve the image tag for audit (the actual image is the container's L2/L1).
  const ordered = spec.jobs.toSorted((a, b) => spec.stages.indexOf(a.stage) - spec.stages.indexOf(b.stage));
  const jobRows = await Promise.all(ordered.map((j) => prisma.pipelineJob.create({
    data: { workspaceId, pipelineRunId: run.id, name: j.name, stage: j.stage, jobType: j.type, needs: j.needs, script: j.script, imageRef: j.image, allowFailure: j.allowFailure, status: 'pending' },
  })));
  const pairs = ordered.map((job, i) => ({ job, row: jobRows[i] }));

  if (!(await dockerAvailable())) {
    await prisma.pipelineJob.updateMany({ where: { pipelineRunId: run.id }, data: { status: 'skipped' } });
    await prisma.pipelineRun.update({ where: { id: run.id }, data: { status: 'canceled', finishedAt: new Date() } });
    await recordCiEvent(prisma, workspaceId, ticketId, 'CI canceled — docker unavailable', { pipelineRunId: run.id, status: 'canceled' });
    return { status: 'canceled', runId: run.id };
  }

  //? Launch a single job container off the frozen branch (all jobs share it — cache-friendly).
  const container = await launchTicketContainer({ workspaceId, ticketKey: `ci-${run.id}`, branch: input.branch });
  if (!container) {
    await prisma.pipelineRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date() } });
    await recordCiEvent(prisma, workspaceId, ticketId, 'CI failed — no container', { pipelineRunId: run.id, status: 'failed' });
    return { status: 'failed', runId: run.id };
  }

  let anyRequiredFailed = false;
  let runMaxSeverity = 'none';
  for (const { job, row } of pairs) {
    if (!row) continue;
    await prisma.pipelineJob.update({ where: { id: row.id }, data: { status: 'running', startedAt: new Date(), containerId: container.containerId } });
    //? A SCANNER job (ADR 0040) runs its type's command + parses findings (report-only — it stays green;
    //? the SEVERITY gates the prod promote). A plain job gates on the exit code (C1).
    const scanner = isScannerType(job.type);
    const command = scanner ? scannerCommand(job.type) : job.script.join(' && ');
    const res = await docker(['exec', '-w', '/work', container.name, 'sh', '-lc', command]);
    if (scanner) {
      const scan = parseScan(job.type, res.out);
      runMaxSeverity = higherSeverity(runMaxSeverity, scan.maxSeverity);
      await prisma.pipelineJob.update({ where: { id: row.id }, data: { status: 'success', exitCode: res.code, severity: scan.maxSeverity, findings: scan.findings, logTail: `${String(scan.findings.length)} finding(s)`, finishedAt: new Date() } });
      await recordCiEvent(prisma, workspaceId, ticketId, `CI ${job.name}: ${String(scan.findings.length)} finding(s) (${scan.maxSeverity})`, { pipelineRunId: run.id, jobName: job.name, jobType: job.type, severity: scan.maxSeverity, findings: scan.findings.length });
      continue;
    }
    const ok = res.code === 0;
    if (!ok && !job.allowFailure) anyRequiredFailed = true;
    await prisma.pipelineJob.update({ where: { id: row.id }, data: { status: ok ? 'success' : 'failed', exitCode: res.code, logTail: (res.out + res.err).slice(-2000), finishedAt: new Date() } });
    await recordCiEvent(prisma, workspaceId, ticketId, `CI ${job.name} ${ok ? '✓' : '✗'}`, { pipelineRunId: run.id, jobName: job.name, status: ok ? 'success' : 'failed' });
  }

  await teardownTicketContainer(workspaceId, `ci-${run.id}`).catch(() => null);
  const status = anyRequiredFailed ? 'failed' : 'success';
  await prisma.pipelineRun.update({ where: { id: run.id }, data: { status, maxSeverity: runMaxSeverity, finishedAt: new Date() } });
  await recordCiEvent(prisma, workspaceId, ticketId, `CI ${status}`, { pipelineRunId: run.id, status });
  return { status, runId: run.id };
}
