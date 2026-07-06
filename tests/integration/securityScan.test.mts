//? Integration test for C2 (security & dependency scanning, ADR 0040). Runs against the REAL Conductor +
//? Mongo. Asserts the pure scanner parsers (npm-audit + secret-scan), that ci.yml accepts a scanner job
//? with no script, and that a high-severity finding blocks a prod promote (report-only below high). The
//? actual scanner execution is a live Docker path — here we force the run's maxSeverity to drive the gate.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { parseCiYaml } = await import('../../server/ci/parse');
const { parseDepAudit, parseSecretScan, severityBlocksProd, scannerCommand } = await import('../../server/ci/security');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure parsers (no DB) -------------------------------------------------------------------------
const audit = parseDepAudit(JSON.stringify({ vulnerabilities: { lodash: { severity: 'high' }, minimist: { severity: 'low' }, info1: { severity: 'info' } } }));
eq(audit.maxSeverity, 'high', 'parseDepAudit rolls up to the highest severity');
eq(audit.findings.length, 2, 'parseDepAudit drops info-level, keeps real findings');
assert(severityBlocksProd('high') && severityBlocksProd('critical'), 'high/critical block a prod promote');
assert(!severityBlocksProd('moderate') && !severityBlocksProd('low') && !severityBlocksProd('none'), 'moderate/low/none are report-only');
const secrets = parseSecretScan('src/x.ts:12: const k = "ghp_012345678901234567890123456789012345"\nREADME:3: nothing');
assert(secrets.findings.length >= 1 && secrets.maxSeverity === 'high', 'parseSecretScan flags a leaked token as high');
assert(scannerCommand('dep-audit').includes('npm audit') && scannerCommand('secret-scan').includes('grep'), 'scannerCommand yields the right scanner command');
assert(parseCiYaml('version: 1\nstages: [security]\njobs:\n  audit:\n    stage: security\n    type: dep-audit').ok, 'ci.yml accepts a scanner job with no script');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sec-test-${String(stamp)}@youcomm.nl`, name: 'SEC Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'SEC Test WS' }, userId: owner.id, clientRequestId: `sec-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  const projId = proj?.id ?? '';
  const pipeline = await prisma.pipeline.create({ data: { workspaceId: wsId, projectId: projId, specHash: 'x', stages: ['security'], runnerKind: 'builtin' } });

  //? Force a live staging env so a prod promote reaches the gates.
  const stagingId = await poll(async () => {
    await enqueueControlAction({ workspaceId: wsId, op: 'env-deploy', target: { projectId: projId }, payload: { kind: 'staging' }, userId: owner.id, clientRequestId: `sec-sd-${String(stamp)}-${String(Date.now())}` });
    const s = await prisma.environment.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'staging' } });
    return s?.id ?? null;
  });
  await prisma.environment.updateMany({ where: { id: stagingId ?? '' }, data: { status: 'live', imageRef: 'img:1' } });

  // ---- a SUCCESS run with a HIGH security finding → prod promote blocked --------------------------
  const highRun = await prisma.pipelineRun.create({ data: { workspaceId: wsId, pipelineId: pipeline.id, projectId: projId, commitHash: 'c1', trigger: 'manual', status: 'success', maxSeverity: 'high' } });
  const blocked = await enqueueControlAction({ workspaceId: wsId, op: 'env-promote', target: { projectId: projId }, payload: { fromKind: 'staging', approved: true }, userId: owner.id, clientRequestId: `sec-p1-${String(stamp)}` });
  eq((blocked.result as Record<string, unknown> | null)?.error, 'promote.securityFindings', 'a high-severity finding blocks the prod promote (report-only below high)');

  // ---- lower the severity to moderate → the security gate no longer blocks ------------------------
  await prisma.pipelineRun.updateMany({ where: { id: highRun.id }, data: { maxSeverity: 'moderate' } });
  const notBlocked = await enqueueControlAction({ workspaceId: wsId, op: 'env-promote', target: { projectId: projId }, payload: { fromKind: 'staging', approved: true }, userId: owner.id, clientRequestId: `sec-p2-${String(stamp)}` });
  assert((notBlocked.result as Record<string, unknown> | null)?.error !== 'promote.securityFindings', 'moderate severity does not block prod (report-only)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/securityScan.test.mts');
