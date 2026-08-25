//? Integration test for GAP_SCAN Phase G against real Mongo: workspace cloning (G2), publishing a Studio
//? artifact as a live page (G3), the workspace asset library (G4), pipeline presets (G5) and site-watch
//? snapshots (G8). (G7 prompt A/B was removed 2026-08-25.)

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { cloneWorkspace } = await import('../../server/bootstrap/cloneWorkspace');
const { publishArtifactSite, unpublishArtifactSite, siteSlug } = await import('../../server/deploy/staticSite');
const { listLibrary, setAssetStarred } = await import('../../server/content/assetLibrary');
const { recordWatchSnapshot, pruneWatchSnapshots } = await import('../../server/scraper/watch');
const { runInWriterContext } = await import('../../server/orchestrator/writerContext');
const { runInTenant } = await import('../../server/tenant/tenantContext');

const inWriter = <T>(workspaceId: string, fn: () => Promise<T>): Promise<T> =>
  runInWriterContext(workspaceId, async () => runInTenant(workspaceId, fn));

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `gph-${String(stamp)}@youcomm.nl`, name: 'GPH' } });
const created: string[] = [];

try {
  /* ---------------------------------------------- G5: presets decide the seeded board */
  const simpleWs = await createBlankWorkspace(prisma, owner.id, 'Simple WS', undefined, 'simple');
  created.push(simpleWs.workspaceId);
  const proWs = await createBlankWorkspace(prisma, owner.id, 'Pro WS', undefined, 'professional');
  created.push(proWs.workspaceId);

  eq(await prisma.pipelineStage.count({ where: { workspaceId: simpleWs.workspaceId } }), 3, 'the simple tier seeds a 3-stage board');
  eq(await prisma.pipelineStage.count({ where: { workspaceId: proWs.workspaceId } }), 7, 'the professional tier keeps the full pipeline');
  eq((await prisma.workspace.findUnique({ where: { id: simpleWs.workspaceId }, select: { presetKey: true } }))?.presetKey, 'simple', 'the tier is recorded on the workspace');

  /* ---------------------------------------------- G2: cloning copies setup, never secrets or history */
  const sourceId = proWs.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: sourceId }, select: { id: true } });
  const projectId = project?.id ?? sourceId;

  await prisma.skill.create({ data: { workspaceId: sourceId, slug: 'tone', name: 'Tone', instruction: 'Be concise.', examples: '', applyPoints: ['all'], enabled: true, builtin: false } });
  await prisma.channel.create({ data: { workspaceId: sourceId, projectId, name: 'Main', platform: 'youtube', brandVoice: 'Direct', autopilot: true, defaultAccountId: 'acc-secret' } });
  await prisma.workspaceTrigger.create({ data: { workspaceId: sourceId, name: 'Daily idea', on: 'cron', action: 'notify', params: {}, match: {}, enabled: true, cron: '0 9 * * *' } });
  await prisma.envVar.create({ data: { workspaceId: sourceId, key: 'PUBLIC_FLAG', value: 'on', secret: false } });
  await prisma.envVar.create({ data: { workspaceId: sourceId, key: 'API_TOKEN', value: 'super-secret', secret: true } });
  await prisma.envVar.create({ data: { workspaceId: sourceId, key: '__publish_youtube', value: 'enc-token', secret: false } });
  await prisma.ticket.create({ data: { workspaceId: sourceId, projectId, key: 'DEV-99', number: 99, title: 'Source-only ticket', stageId: 'unrefined', status: 'idle', labels: [], creatorId: owner.id } });

  const clone = await cloneWorkspace(prisma, sourceId, owner.id, 'Cloned WS');
  assert(clone.ok && clone.workspaceId !== undefined, 'the clone succeeds');
  const cloneId = clone.workspaceId ?? '';
  created.push(cloneId);

  eq(await prisma.pipelineStage.count({ where: { workspaceId: cloneId } }), 7, 'the tuned pipeline is copied (not re-seeded blank)');
  eq(await prisma.skill.count({ where: { workspaceId: cloneId, slug: 'tone' } }), 1, 'skills are copied');

  const clonedChannel = await prisma.channel.findFirst({ where: { workspaceId: cloneId }, select: { name: true, brandVoice: true, autopilot: true, defaultAccountId: true } });
  eq(clonedChannel?.brandVoice, 'Direct', "the channel's brand voice is copied");
  eq(clonedChannel?.autopilot, false, 'but autopilot is OFF — a clone must not start posting');
  eq(clonedChannel?.defaultAccountId, null, 'and it inherits no connected account');

  eq((await prisma.workspaceTrigger.findFirst({ where: { workspaceId: cloneId }, select: { enabled: true } }))?.enabled, false, 'triggers are copied disabled');
  eq(await prisma.envVar.count({ where: { workspaceId: cloneId, key: 'PUBLIC_FLAG' } }), 1, 'non-secret env is copied');
  eq(await prisma.envVar.count({ where: { workspaceId: cloneId, key: 'API_TOKEN' } }), 0, 'secret env is NOT copied');
  eq(await prisma.envVar.count({ where: { workspaceId: cloneId, key: '__publish_youtube' } }), 0, 'stored OAuth tokens are NOT copied');
  eq(await prisma.ticket.count({ where: { workspaceId: cloneId, key: 'DEV-99' } }), 0, "the source's tickets stay in the source");
  eq(await prisma.workspaceMember.count({ where: { workspaceId: cloneId } }), 1, 'only the cloner is a member');

  /* ---------------------------------------------- G3: publish a Studio artifact as a live page */
  const brief = await prisma.studioBrief.create({ data: { workspaceId: sourceId, projectId, name: 'Launch v1', productName: 'Workspaces', audience: 'devs', tone: 'direct', goals: 'Launch' } });
  const page = await prisma.studioArtifact.create({ data: { workspaceId: sourceId, briefId: brief.id, kind: 'landing', role: 'designer', title: 'Launch Page', content: { html: '<h1>Launch</h1>' }, status: 'ready' } });
  const tokens = await prisma.studioArtifact.create({ data: { workspaceId: sourceId, briefId: brief.id, kind: 'brand', role: 'designer', title: 'Tokens', content: { colors: ['#fff'] }, status: 'ready' } });
  const pending = await prisma.studioArtifact.create({ data: { workspaceId: sourceId, briefId: brief.id, kind: 'landing', role: 'designer', title: 'Half baked', content: { html: '<h1>wip</h1>' }, status: 'generating' } });

  const published = await publishArtifactSite(prisma, sourceId, page.id, 'https://example.test');
  assert(published.ok, 'a ready landing page publishes');
  eq(published.slug, siteSlug('Launch Page', page.id), 'under its deterministic slug');
  assert(published.url?.startsWith('https://example.test/s/') === true, 'and returns a real public URL');

  const stored = await prisma.publishedSite.findFirst({ where: { workspaceId: sourceId, slug: published.slug ?? '' }, select: { html: true } });
  eq(stored?.html, '<h1>Launch</h1>', 'the html is served from the stored copy, not re-read from the artifact');

  //? Re-publishing must NOT mint a second URL — a shared link has to keep working.
  await prisma.studioArtifact.update({ where: { id: page.id }, data: { content: { html: '<h1>Launch v2</h1>' } } });
  const republished = await publishArtifactSite(prisma, sourceId, page.id, 'https://example.test');
  eq(republished.slug, published.slug, 're-publishing keeps the same URL');
  eq(await prisma.publishedSite.count({ where: { workspaceId: sourceId } }), 1, 'and does not create a second site');
  eq((await prisma.publishedSite.findFirst({ where: { workspaceId: sourceId }, select: { html: true } }))?.html, '<h1>Launch v2</h1>', 'the live page reflects the update');

  eq((await publishArtifactSite(prisma, sourceId, tokens.id, 'https://example.test')).error, 'artifact.notAPage', 'a token set is not publishable as a page');
  eq((await publishArtifactSite(prisma, sourceId, pending.id, 'https://example.test')).error, 'artifact.notReady', 'an unfinished artifact is not published');
  eq((await publishArtifactSite(prisma, cloneId, page.id, 'https://example.test')).error, 'artifact.notFound', "another workspace cannot publish this workspace's artifact");

  await unpublishArtifactSite(prisma, sourceId, published.slug ?? '');
  eq(await prisma.publishedSite.count({ where: { workspaceId: sourceId } }), 0, 'unpublishing takes it down');

  /* ---------------------------------------------- G4: the asset library spans pieces */
  const pieceA = await prisma.contentProject.create({ data: { workspaceId: sourceId, projectId, title: 'Piece A' } });
  const pieceB = await prisma.contentProject.create({ data: { workspaceId: sourceId, projectId, title: 'Piece B' } });
  const mascot = await prisma.contentAsset.create({ data: { workspaceId: sourceId, contentProjectId: pieceA.id, kind: 'image', url: '/media/mascot.png', status: 'ready' } });
  await prisma.contentAsset.create({ data: { workspaceId: sourceId, contentProjectId: pieceB.id, kind: 'music', url: '/media/theme.mp3', status: 'ready' } });
  await prisma.contentAsset.create({ data: { workspaceId: sourceId, contentProjectId: pieceB.id, kind: 'render', url: '/media/out.mp4', status: 'ready' } });
  await prisma.contentAsset.create({ data: { workspaceId: sourceId, contentProjectId: pieceB.id, kind: 'image', url: '/media/pending.png', status: 'pending' } });

  const library = await listLibrary(prisma, sourceId);
  eq(library.length, 2, 'the library spans pieces and excludes per-piece outputs + unfinished assets');
  assert(library.every((a) => a.kind !== 'render'), 'a render is not a library asset');
  assert(library.some((a) => a.pieceTitle === 'Piece A'), 'each asset knows which piece it came from');

  await setAssetStarred(prisma, sourceId, mascot.id, true);
  const starredFirst = await listLibrary(prisma, sourceId);
  eq(starredFirst[0]?.id, mascot.id, 'a starred asset floats to the top');
  eq((await listLibrary(prisma, sourceId, { starredOnly: true })).length, 1, 'and can be listed on its own');
  eq((await listLibrary(prisma, sourceId, { kind: 'music' })).length, 1, 'the library filters by kind');
  eq((await listLibrary(prisma, cloneId)).length, 0, "another workspace sees none of this workspace's assets");

  /* ---------------------------------------------- G8: watch snapshots */
  const url = 'https://competitor.test/pricing';
  const first = await inWriter(sourceId, () => recordWatchSnapshot(prisma, sourceId, url, 'Pricing is 20 euro per month for teams of any size.'));
  assert(first.first && !first.changed, 'the first check is a BASELINE, not a change (monitoring must not cry wolf on day one)');

  const same = await inWriter(sourceId, () => recordWatchSnapshot(prisma, sourceId, url, 'Pricing is 20 euro per month for teams of any size.'));
  assert(!same.changed, 'an unchanged page reports no change');
  eq(await prisma.siteSnapshot.count({ where: { workspaceId: sourceId, url } }), 1, 'and does not store a duplicate snapshot');

  const moved = await inWriter(sourceId, () => recordWatchSnapshot(prisma, sourceId, url, 'Pricing is 30 euro per month for teams of any size.'));
  assert(moved.changed, 'a real change is detected');
  assert(moved.summary.includes('30 euro'), 'and the report names what changed');
  eq(await prisma.siteSnapshot.count({ where: { workspaceId: sourceId, url } }), 2, 'the new state is stored for the next comparison');

  for (let i = 0; i < 5; i++) await inWriter(sourceId, () => recordWatchSnapshot(prisma, sourceId, url, `Pricing is ${String(40 + i)} euro per month for teams of any size.`));
  eq(await inWriter(sourceId, () => pruneWatchSnapshots(prisma, sourceId, url, 3)), 4, 'pruning bounds the history');
  eq(await prisma.siteSnapshot.count({ where: { workspaceId: sourceId, url } }), 3, 'keeping the newest snapshots');
} finally {
  for (const id of created) await cleanupWorkspace(prisma, id);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('newModules (integration)');
