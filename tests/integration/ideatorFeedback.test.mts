//? CP4 — the analytics→ideas feedback loop. `ingestPublishMetrics` + `topPerformers` existed but nothing joined
//? them to the ideator. This proves the ideator now reads the workspace's actual top-performing posts (by views)
//? and folds them into its idea prompt. Real Mongo, no keys (the join + ranking is what's under test).

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { recentWinnersLine } = await import('../../server/content/ideatorRole');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ideat-${String(stamp)}@youcomm.nl`, name: 'Ideat' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Ideator WS');
  workspaceId = created.workspaceId;
  const ws = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: ws } });

  //? No metrics yet → the loop stays silent (no fake winners).
  const empty = await recentWinnersLine(ws);
  assert(empty === '', 'with no metrics the ideator gets no winners line (no fabrication)');

  //? Two published pieces with ingested metrics — one a clear winner.
  const hit = await prisma.contentProject.create({ data: { workspaceId: ws, projectId: project?.id ?? '', title: 'The viral one' } });
  const flop = await prisma.contentProject.create({ data: { workspaceId: ws, projectId: project?.id ?? '', title: 'The quiet one' } });
  await prisma.publishJob.create({ data: { workspaceId: ws, contentProjectId: hit.id, assetId: hit.id, platform: 'youtube', status: 'done', externalId: 'yt1', metrics: { views: 50000, likes: 3000 } } });
  await prisma.publishJob.create({ data: { workspaceId: ws, contentProjectId: flop.id, assetId: flop.id, platform: 'tiktok', status: 'done', externalId: 'tt1', metrics: { views: 120, likes: 4 } } });

  const line = await recentWinnersLine(ws);
  assert(line.includes('The viral one'), 'the top performer is named in the winners line');
  assert(line.includes('50000') && line.includes('youtube'), 'the winner carries its view count + platform');
  assert(line.indexOf('The viral one') < (line.includes('The quiet one') ? line.indexOf('The quiet one') : Infinity), 'the bigger performer ranks first');
  assert(/WINNERS/i.test(line), 'the line is framed as recent winners for the prompt');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/ideatorFeedback.test.mts');
