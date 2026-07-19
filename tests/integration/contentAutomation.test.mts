//? Integration test for content automation under ADR 0269. Real Conductor + Mongo.
//? A non-autopilot cron run proposes an idea without writing content or requiring a daily approval;
//? an opted-in autopilot channel runs idea → pipeline → publish through nested Conductor actions.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { runCronTriggers } = await import('../../server/automation/cron');
const { getAgentRole } = await import('../../server/automation/agentRoles');
const { registerContentIdeatorRole } = await import('../../server/content/ideatorRole');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

function signalRequestId(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || !('clientRequestId' in payload)) return null;
  return typeof payload.clientRequestId === 'string' ? payload.clientRequestId : null;
}

//? Roles register at boot; this test drives the engine directly, so register it here.
registerContentIdeatorRole();

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f33-${String(stamp)}@youcomm.nl`, name: 'CP F33' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F33 WS' }, userId: owner.id, clientRequestId: `f33-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? Conversational quick-start supplies a content project for the two channel fixtures.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { brief: 'a video about startup A for school', title: 'Startup A explainer', channelName: 'School' }, userId: owner.id, clientRequestId: `f33-fb-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Startup A explainer' } }));
  assert(piece !== null, 'content-from-brief spun up a content piece from the chat brief');
  eq(piece?.brief, 'a video about startup A for school', 'the brief is carried onto the piece');
  const proj = await prisma.project.findFirst({ where: { workspaceId: wsId, id: piece?.projectId ?? '' } });
  eq(proj?.projectType, 'content', 'it created a content-lane project');
  eq(proj?.name, 'School', 'the channel name is used for the project');

  const manualChannel = await prisma.channel.create({ data: { workspaceId: wsId, projectId: proj?.id ?? '', name: 'Manual review', platform: 'youtube', autopilot: false } });
  const autopilotChannel = await prisma.channel.create({ data: { workspaceId: wsId, projectId: proj?.id ?? '', name: 'Opted-in autopilot', platform: 'youtube', autopilot: true } });
  const manualTrigger = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Manual channel ideas', on: 'cron', match: {}, cron: '* * * * *', action: 'invoke-agent-role', params: { role: 'content-ideator', channelId: manualChannel.id }, requiresApproval: false } });
  const autopilotTrigger = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Autopilot channel run', on: 'cron', match: {}, cron: '* * * * *', action: 'invoke-agent-role', params: { role: 'content-ideator', channelId: autopilotChannel.id }, requiresApproval: false } });
  eq(getAgentRole('content-ideator')?.mutates, false, 'content-ideator is proposal-only and does not impose a static daily gate');

  //? Both cron actions run immediately. The manual channel only produces an idea artifact/notification;
  //? Channel.autopilot is the explicit owner opt-in that permits the nested authoritative chain.
  const cronNow = new Date();
  cronNow.setSeconds(0, 0);
  const cronOutcome = await runCronTriggers(prisma, cronNow);
  eq(cronOutcome.fired, 2, 'manual and autopilot channel cron runs execute without per-run approval');
  eq(await prisma.workspaceSuggestion.count({ where: { workspaceId: wsId, type: 'automation' } }), 0, 'neither cron run creates a daily approval suggestion');
  eq(await prisma.contentProject.count({ where: { workspaceId: wsId, channelId: manualChannel.id } }), 0, 'non-autopilot ideation writes no content');
  assert(await prisma.notification.findFirst({ where: { workspaceId: wsId, title: { contains: 'Content ideator: Content idea' }, body: { contains: manualChannel.name } } }) !== null, 'the non-autopilot idea is surfaced as a proposal artifact');
  assert((await prisma.workspaceTrigger.findUnique({ where: { id: manualTrigger.id } }))?.lastFiredAt !== null, 'the manual proposal occurrence advances its cron timestamp');

  const autopilotPiece = await prisma.contentProject.findFirst({ where: { workspaceId: wsId, channelId: autopilotChannel.id }, orderBy: { createdAt: 'desc' } });
  assert(autopilotPiece !== null, 'the opted-in autopilot cron created a channel-bound content piece');
  const readyOutput = await prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: autopilotPiece?.id ?? '', status: 'ready', kind: { in: ['render', 'video'] } } });
  assert(readyOutput !== null, 'the nested content pipeline produced a ready render/video output');
  const publishJob = await prisma.publishJob.findFirst({ where: { workspaceId: wsId, contentProjectId: autopilotPiece?.id ?? '', platform: 'youtube' } });
  assert(publishJob !== null, 'the nested publish op created a publish job');
  eq(publishJob?.status, 'stub', 'without OAuth the autopilot publish remains honestly stubbed');

  const minuteAt = cronNow.getTime();
  const nestedPrefix = `ap-${autopilotChannel.id.slice(-6)}-`;
  const writerSignals = await prisma.workspaceSignal.findMany({
    where: { workspaceId: wsId, kind: { in: ['automation-cron-fire', 'content-from-brief', 'content-run-pipeline', 'content-request-publish'] } },
    orderBy: { seq: 'asc' }, select: { seq: true, kind: true, payload: true },
  });
  const cronRequestId = `automation-cron-${autopilotTrigger.id}-${String(minuteAt)}`;
  const cronSignal = writerSignals.find((signal) => signalRequestId(signal.payload) === cronRequestId);
  const nestedSignals = writerSignals.filter((signal) => (signalRequestId(signal.payload) ?? '').startsWith(nestedPrefix));
  eq(nestedSignals.map((signal) => signal.kind), ['content-from-brief', 'content-run-pipeline', 'content-request-publish'], 'nested durable signals preserve piece → pipeline → publish order');
  assert(cronSignal !== undefined && nestedSignals.every((signal) => signal.seq > cronSignal.seq), 'every nested signal is sequenced after the autopilot cron parent signal');

  const pieceSignal = nestedSignals.find((signal) => signal.kind === 'content-from-brief');
  const nestedPieceRequestId = signalRequestId(pieceSignal?.payload);
  assert(nestedPieceRequestId !== null, 'the nested piece signal carries its namespaced request id');
  const pieceCountBeforeReplay = await prisma.contentProject.count({ where: { workspaceId: wsId, channelId: autopilotChannel.id } });
  const replayed = await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { brief: 'must not duplicate', title: 'Duplicate', channelId: autopilotChannel.id }, userId: owner.id, clientRequestId: nestedPieceRequestId ?? '' });
  eq(replayed.signalSeq, pieceSignal?.seq, 'replaying the nested request returns its terminal signal seq');
  eq(await prisma.contentProject.count({ where: { workspaceId: wsId, channelId: autopilotChannel.id } }), pieceCountBeforeReplay, 'nested dedup prevents a duplicate content write/signal');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentAutomation.test.mts');
