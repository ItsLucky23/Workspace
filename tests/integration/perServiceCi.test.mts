//? Per-service CI — the change that removes "one pipeline per project" as a structural assumption.
//?
//? The dangerous half is the GATE, not the feature. `ciGreenForProject` used to take the newest run for the
//? project, full stop: on a monorepo a green run for service A would pass a prod promote while service B's
//? run was red, purely because A finished last. Adding a second service silently WEAKENED the prod gate —
//? the worst failure mode a gate has, because nothing looks broken. Most of this file is about that.
//?
//? The second theme is MongoDB's absent-vs-null trap (lesson 0014). `serviceId: null` means "the project
//? root unit" and is a first-class value; an omitted field is not null, does not match a null filter, and
//? the unique index treats the two as the same. Every write path therefore has to write it explicitly.

import { readFileSync } from 'node:fs';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { ciGreenForProject, ciGateForMr, securityBlocksProdPromote } from '../../server/ci/gate.ts';
import { serviceWorkdir } from '../../server/deploy/servicePath.ts';
import { ciPublicIntentId, ciPublicIntentSignalId } from '../../server/orchestrator/actionIds.ts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const dispatch = read('src/workspaces/_sync/projectAdmin_server_v1.ts');
const prisma = await db();
const workspaceId = '000000000000000000c10001';
const projectId = '000000000000000000c10bbb';

const existing = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
if (existing) await cleanupWorkspace(prisma, workspaceId);
await prisma.workspace.create({ data: { id: workspaceId, name: 'Per-service CI', slug: `psci-${String(Date.now())}`, ownerId: '000000000000000000c10fff' } });

const pipelineFor = async (serviceId: string | null) => prisma.pipeline.create({
  data: { workspaceId, projectId, serviceId, specHash: 'x', stages: ['test'], runnerKind: 'builtin' },
});
const runFor = async (pipelineId: string, serviceId: string | null, status: string, commitHash = 'aaa111', extra: { mergeRequestId?: string; maxSeverity?: string } = {}) => prisma.pipelineRun.create({
  data: { workspaceId, pipelineId, projectId, serviceId, commitHash, trigger: 'manual', status, ...extra },
});

/* ------------------------------------------------------------ the promote gate is per UNIT */

const rootPipeline = await pipelineFor(null);
const webPipeline = await pipelineFor('000000000000000000c10aaa');

//? Baseline: no runs at all ⇒ green. CI is opt-in and must stay that way.
eq(await ciGreenForProject(prisma, workspaceId, projectId), true, 'a project with no CI runs is not gated');

await runFor(rootPipeline.id, null, 'success');
eq(await ciGreenForProject(prisma, workspaceId, projectId), true, 'one green unit with nothing else is green');

//? THE regression. The web unit is red; its run is OLDER than the green root run, so a "newest run wins"
//? gate reports the project green and lets a broken service reach prod.
await runFor(webPipeline.id, '000000000000000000c10aaa', 'failed');
await runFor(rootPipeline.id, null, 'success');
eq(await ciGreenForProject(prisma, workspaceId, projectId), false, 'a RED unit gates the promote even when a newer run of another unit is green');

//? And it recovers per unit rather than per project.
await runFor(webPipeline.id, '000000000000000000c10aaa', 'success');
eq(await ciGreenForProject(prisma, workspaceId, projectId), true, 'the promote opens once every unit is green');

//? A commit mismatch on ANY unit still blocks — a green run for the wrong commit is not a green run.
eq(await ciGreenForProject(prisma, workspaceId, projectId, 'bbb222'), false, 'a stale-commit green does not pass');
eq(await ciGreenForProject(prisma, workspaceId, projectId, 'aaa111'), true, 'the matching commit does');

//? A `running` unit is not green — the gate must not open while a unit is still deciding.
await runFor(webPipeline.id, '000000000000000000c10aaa', 'running');
eq(await ciGreenForProject(prisma, workspaceId, projectId), false, 'a unit still running gates the promote');

/* ------------------------------------------------------------ the security gate is per UNIT too */

await prisma.pipelineRun.deleteMany({ where: { workspaceId } });
await runFor(rootPipeline.id, null, 'success', 'aaa111', { maxSeverity: 'low' });
await runFor(webPipeline.id, '000000000000000000c10aaa', 'success', 'aaa111', { maxSeverity: 'critical' });
eq(await securityBlocksProdPromote(prisma, workspaceId, projectId, 'aaa111'), true, 'a critical finding in ANY unit blocks the prod promote');

await prisma.pipelineRun.deleteMany({ where: { workspaceId } });
await runFor(rootPipeline.id, null, 'success', 'aaa111', { maxSeverity: 'low' });
await runFor(webPipeline.id, '000000000000000000c10aaa', 'success', 'aaa111', { maxSeverity: 'moderate' });
eq(await securityBlocksProdPromote(prisma, workspaceId, projectId, 'aaa111'), false, 'and low/moderate findings do not');

/* ------------------------------------------------------------ the MR gate is per UNIT */

await prisma.pipelineRun.deleteMany({ where: { workspaceId } });
const mrId = '000000000000000000c10111';
await runFor(webPipeline.id, '000000000000000000c10aaa', 'failed', 'head999', { mergeRequestId: mrId });
await runFor(rootPipeline.id, null, 'success', 'head999', { mergeRequestId: mrId });
const redGate = await ciGateForMr(prisma, workspaceId, mrId, 'head999');
eq(redGate.gated, true, 'a red unit gates the merge even when the newest run is a green sibling');
eq(redGate.reason, 'ci-red', 'and says why');

await prisma.pipelineRun.deleteMany({ where: { workspaceId } });
await runFor(webPipeline.id, '000000000000000000c10aaa', 'success', 'head999', { mergeRequestId: mrId });
await runFor(rootPipeline.id, null, 'success', 'head999', { mergeRequestId: mrId });
eq((await ciGateForMr(prisma, workspaceId, mrId, 'head999')).gated, false, 'all-green opens the merge');
eq((await ciGateForMr(prisma, workspaceId, mrId, 'other')).reason, 'ci-stale', 'a head that moved on is stale, not green');

/* ------------------------------------------------------------ absent-vs-null (lesson 0014) */

//? The whole model rests on `serviceId: null` being FINDABLE. If a write path omits the field, the row is
//? invisible to its own lookup and collides with the row that lookup then tries to create.
const rootByNull = await prisma.pipeline.findFirst({ where: { workspaceId, projectId, serviceId: null } });
assert(rootByNull !== null, 'the root pipeline is findable by serviceId: null — it was written explicitly');

const runner = read('server/ci/runner.ts');
assert(/serviceId,\s+specHash:/.test(runner), 'ensurePipeline writes serviceId explicitly, including the null');
assert(runner.includes('findFirst({ where: { workspaceId, projectId, serviceId }'), 'and looks a pipeline up per (project, service)');
const buildExport = read('server/deploy/buildExport.ts');
assert(buildExport.includes('serviceId: serviceId ?? null,'), 'build artifacts carry an explicit unit');
const schemaVersion = read('server/db/schemaVersion.ts');
assert(schemaVersion.includes("name: 'ci-service-scope'"), 'existing CI rows are backfilled to an explicit null');
assert(schemaVersion.includes("name: 'ticket-service-scope'"), 'and so are existing tickets');

/* ------------------------------------------------------------ ids are unit-scoped */

//? A fan-out sends one request per unit under a SINGLE user action, so every derived id must differ per
//? unit — otherwise the second unit looks like a replay of the first and its run is dropped without a word.
//?
//? Uniqueness has exactly ONE source: the unit-scoped clientRequestId (`<requestId>:<unit>`). The id
//? helpers deliberately do NOT salt the unit themselves — the Conductor derives these same ids from the
//? request id it receives, so salting in both places made caller and Conductor disagree, which presented as
//? a prepared intent that never validated (a hang, not an error).
const rootRequest = 'req-1:root';
const webRequest = 'req-1:000000000000000000c10aaa';
assert(ciPublicIntentId(workspaceId, projectId, rootRequest) !== ciPublicIntentId(workspaceId, projectId, webRequest), 'two units under one action get different intent ids');
eq(ciPublicIntentId(workspaceId, projectId, rootRequest), ciPublicIntentId(workspaceId, projectId, rootRequest), 'and the same unit is stable (idempotency still works)');
assert(ciPublicIntentSignalId(workspaceId, rootRequest) !== ciPublicIntentSignalId(workspaceId, webRequest), 'the prepare-signal ids differ too');
//? The dispatcher is what builds that unit-scoped request id, and the Conductor must be handed it.
assert(dispatch.includes("const unitRequestId = `${input.clientRequestId}:${serviceId ?? 'root'}`"), 'the dispatcher scopes the request id by unit');
assert(dispatch.includes('clientRequestId: unitRequestId,'), 'and sends THAT to the Conductor');
assert(dispatch.includes('ciPublicIntentId(input.workspaceId, target.projectId, unitRequestId)'), 'deriving the intent id from the same string the Conductor sees');
assert(runner.includes('`ci-run:${scope}`'), 'the PipelineRun id is salted with the unit');
assert(runner.includes('`ci-job:${scope}:'), 'and so are job ids');
assert(runner.includes('`ci-event:${scope}:'), 'and event ids');

/* ------------------------------------------------------------ execution runs in the unit's directory */

eq(serviceWorkdir('apps/web').ok && serviceWorkdir('apps/web').dir, '/work/apps/web', 'a unit resolves to its own workdir');
assert(runner.includes('const workDir = workdirOrRoot(servicePath)'), 'the runner resolves the unit workdir');
assert(runner.includes('const configPath = `${workDir}/${CI_PATH}`'), "and reads THAT unit's ci.yml, not the repo root's");
assert(runner.includes("'exec', '-w', workDir, container"), 'and runs its jobs there');

/* ------------------------------------------------------------ the fan-out */

assert(dispatch.includes('export async function dispatchPublicCiRunAllUnits'), 'one action fans out over every unit');
assert(dispatch.includes('dispatchPublicCiRunAllUnits({'), 'and the ci-run op routes through it');
assert(dispatch.includes('onlyServiceId'), 'with a single-unit narrowing for the per-unit retry');
//? The root unit is not skipped just because services exist: a monorepo root commonly carries its own
//? lint/typecheck job, and dropping it would silently stop testing shared code.
assert(dispatch.includes('if (input.onlyServiceId === undefined || input.onlyServiceId === null) units.push({ serviceId: null, servicePath: null })'), 'the root unit always runs on a full fan-out');

/* ------------------------------------------------------------ reachability: it has to be usable */

const panel = read('src/workspaces/_components/MrReviewPanel.tsx');
assert(panel.includes('mr.checks.units.map'), 'the MR panel shows each unit separately');
assert(panel.includes('runCi(ticketKey, unit.serviceId)'), 'each with its own retry');
const mrService = read('server/mr/service.ts');
assert(mrService.includes('latestPerUnit'), 'the MR checks are assembled per unit');
assert(mrService.includes("const failed = units.find((u) => u.status !== 'success'"), 'and the headline status is the WORST unit, never the newest');

//? A ticket must be able to SAY which unit it belongs to, or preview/CI scoping is unreachable.
const ticketPage = read('src/workspaces/develop/board/[ticketId]/page.tsx');
assert(ticketPage.includes("ctx.editTicket(ticket.id, { serviceId: next })"), 'a ticket can be assigned to a unit');
//? A single-unit project names the whole-project fallback instead of hiding the question (audit fix-round).
assert(ticketPage.includes('ticketServices.length > 0 ?'), 'and a single-unit project is not asked a question it has no answer to');

const preview = read('server/container/previewSession.ts');
assert(preview.includes('workdirOrRoot(service?.path)'), 'a preview boots in the ticket\'s unit');
//? ADR 0317 — the unit's dev command is resolved by the shared runtime resolver (service first, then project).
assert(preview.includes('resolveRuntime(project, service)') && read('server/container/runtimeProcesses.ts').includes('service?.devCommand'), "and uses that unit's dev command");
assert(preview.includes('service?.baseImageRef ?? resolveProjectBaseImage(project)'), 'and its image');

/* ------------------------------------------------------------ export/import no longer drops units */

const fullExport = read('server/export/fullExport.ts');
assert(fullExport.includes('prisma.service.findMany({ where: { workspaceId }, take: 200 })'), 'services are exported');
assert(fullExport.includes("['services', rows(b.services)"), 'and imported');
assert(fullExport.includes("path: str(sv, 'path', '.')"), "including each unit's path");
assert(fullExport.includes("buildCmd: str(sv, 'buildCmd')"), 'and its build command');

await cleanupWorkspace(prisma, workspaceId);
report('perServiceCi');
