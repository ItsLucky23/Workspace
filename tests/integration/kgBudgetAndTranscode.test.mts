//? FASE KG (DOCUMENTS_AND_SKILLS) — budget-alert push (KG1) + webm/gif transcode (KG2).
//? KG1: the alertPct crossing CLAIMS the alert EXACTLY once (dedup via the alertPushed flag — the
//? push only sends when the claim flips false→true) and re-arms on a budget edit. We assert on the
//? flag (the real dedup mechanism) rather than the transport, which no-ops without a subscription.
//? KG2: the transcode arg builders (webm=VP9/Opus, gif=palette 2-pass) + a REAL ffmpeg-in-Docker
//? transcode of a tiny generated mp4 → a valid webm and gif, and the content-transcode op appends
//? the result as a sibling asset. Docker is REQUIRED (loud fail).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { recordMediaSpend, maybeSendBudgetAlert } = await import('../../server/media/budget');
const { buildTranscodeArgs, transcodeContainer } = await import('../../server/content/render');
const { docker, dockerAvailable } = await import('../../server/container/runtime');
const { MEDIA_DIR, persistMediaBytes } = await import('../../server/media/store');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 120_000, stepMs = 250): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}
const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `kg-${String(stamp)}@youcomm.nl`, name: 'KG' } });
let wsId = '';
const alertClaimed = async (): Promise<boolean> => ((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.alertPushed === true);

try {
  eq(await dockerAvailable(), true, 'docker daemon is available (the transcode path is part of this suite)');
  const created = await createBlankWorkspace(prisma, owner.id, 'KG WS');
  wsId = created.workspaceId;

  // ---- KG1: budget-alert push dedup + re-arm ----
  await prisma.mediaBudget.upsert({ where: { workspaceId: wsId }, create: { workspaceId: wsId, capCents: 1000, alertPct: 80, enabled: true, spentCents: 0 }, update: { capCents: 1000, alertPct: 80, enabled: true, spentCents: 0, alertPushed: false } });
  //? Below the threshold (50% of an 80% alert) → not claimed.
  await recordMediaSpend(prisma, wsId, { feature: 'image-gen', providerId: 'stub', costCents: 500 });
  eq(await alertClaimed(), false, 'the alert is not claimed below the threshold');
  //? Crossing 80% → claimed exactly once.
  await recordMediaSpend(prisma, wsId, { feature: 'image-gen', providerId: 'stub', costCents: 400 });
  eq(await alertClaimed(), true, 'crossing the alert threshold claims the alert (push fires once)');
  //? Further spend past the threshold → still claimed, never re-fires (maybeSendBudgetAlert bails on
  //? alertPushed=true and never re-claims — the flag stays exactly one crossing).
  await recordMediaSpend(prisma, wsId, { feature: 'image-gen', providerId: 'stub', costCents: 50 });
  eq(await alertClaimed(), true, 'a second spend past the threshold does not re-arm (dedup)');
  //? A budget edit re-arms the alert.
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 3000, alertPct: 80, enabled: true }, userId: owner.id, clientRequestId: `kg-edit-${String(stamp)}` });
  assert(await poll(async () => ((await alertClaimed()) ? null : true), 8000) === true, 'the budget edit re-armed the alert (alertPushed reset to false)');
  //? spent 950 of the new 3000 cap = 32% < 80% → maybeSendBudgetAlert does NOT re-claim.
  await maybeSendBudgetAlert(prisma, wsId);
  eq(await alertClaimed(), false, 'after raising the cap, the old spend is below the new threshold → not claimed');

  // ---- KG2: transcode arg builders ----
  const webmArgs = buildTranscodeArgs('in.mp4', 'out.webm', 'webm');
  assert(webmArgs.includes('libvpx-vp9') && webmArgs.includes('libopus'), 'webm args use VP9 + Opus');
  const gifArgs = buildTranscodeArgs('in.mp4', 'out.gif', 'gif');
  assert(gifArgs.some((a) => a.includes('palettegen') && a.includes('paletteuse')), 'gif args use the two-pass palette');

  // ---- KG2: a REAL ffmpeg transcode of a generated mp4 ----
  //? Generate a 1s test mp4 via ffmpeg (testsrc) directly in the media dir.
  const mp4Name = `kg-src-${String(stamp)}.mp4`;
  const gen = await docker(['run', '--rm', '-v', `${MEDIA_DIR.replaceAll('\\', '/')}:/media`, (process.env.WS_FFMPEG_IMAGE ?? '').trim() || 'jrottenberg/ffmpeg:latest', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', `/media/${mp4Name}`]);
  eq(gen.code, 0, 'generated a source mp4 with ffmpeg');
  const webmUrl = await transcodeContainer(mp4Name, 'webm');
  assert(webmUrl !== null && webmUrl.endsWith('.webm'), 'transcodeContainer produced a webm');
  const webmBytes = readFileSync(path.join(MEDIA_DIR, (webmUrl ?? '').slice('/media/'.length)));
  assert(webmBytes.length > 0 && webmBytes.subarray(0, 4).toString('hex') === '1a45dfa3', 'the webm has the Matroska/WebM EBML magic');
  const gifUrl = await transcodeContainer(mp4Name, 'gif');
  assert(gifUrl !== null && gifUrl.endsWith('.gif'), 'transcodeContainer produced a gif');
  const gifBytes = readFileSync(path.join(MEDIA_DIR, (gifUrl ?? '').slice('/media/'.length)));
  eq(gifBytes.subarray(0, 3).toString('latin1'), 'GIF', 'the gif starts with the GIF magic');

  // ---- KG2: the content-transcode op appends a sibling asset ----
  const project = await prisma.project.create({ data: { workspaceId: wsId, name: 'content', projectType: 'content', gitlabPath: '' } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project.id, title: 'Clip', brief: 'x' } });
  //? A real render asset pointing at our generated mp4.
  const persisted = persistMediaBytes(readFileSync(path.join(MEDIA_DIR, mp4Name)), 'mp4', `kg-asset-${String(stamp)}`);
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'render', url: persisted.url, status: 'ready' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'content-transcode', target: {}, payload: { contentProjectId: piece.id, assetId: asset.id, format: 'webm' }, userId: owner.id, clientRequestId: `kg-tc-${String(stamp)}` });
  const sibling = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: piece.id, url: { endsWith: '.webm' } } }), 60_000);
  assert(sibling !== null, 'the content-transcode op appended a webm sibling asset');
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/kgBudgetAndTranscode.test.mts');
}
