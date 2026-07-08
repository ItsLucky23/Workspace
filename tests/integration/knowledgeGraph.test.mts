//? N1 — buildKnowledgeGraph assembles the workspace knowledge as a real graph (Mongo + the keyless RAG embedder,
//? no keys). Verifies: nodes are created for each source / ticket / content piece with typed ids + labels, and
//? similarity edges link semantically-close nodes (two near-identical ticket titles get an edge).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { buildKnowledgeGraph } = await import('../../server/rag/graph');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `kg-${String(stamp)}@youcomm.nl`, name: 'Kg' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Kg WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const projectId = project?.id ?? '';

  await prisma.infoSource.create({ data: { workspaceId: wsId, projectId, mode: 'context-doc', source: 'uploaded', name: 'Auth spec', content: 'The login flow uses OAuth and sessions.', enabled: true, usedByStages: [] } });
  await prisma.ticket.create({ data: { workspaceId: wsId, projectId, key: 'DEV-101', number: 101, title: 'Add OAuth login flow', description: 'implement oauth login and sessions', stageId: 'unrefined', status: 'idle', labels: [] } });
  await prisma.ticket.create({ data: { workspaceId: wsId, projectId, key: 'DEV-102', number: 102, title: 'Add OAuth login flow', description: 'implement oauth login and sessions', stageId: 'unrefined', status: 'idle', labels: [] } });
  await prisma.contentProject.create({ data: { workspaceId: wsId, projectId, title: 'Launch teaser video' } });

  const graph = await buildKnowledgeGraph(prisma, wsId, { topK: 5, minScore: 0.2 });
  assert(graph.nodes.some((n) => n.type === 'source' && n.label === 'Auth spec'), 'a source node exists');
  assert(graph.nodes.some((n) => n.type === 'ticket' && n.label.includes('DEV-101')), 'a ticket node exists with its key + title');
  assert(graph.nodes.some((n) => n.type === 'piece' && n.label === 'Launch teaser video'), 'a content-piece node exists');
  assert(graph.nodes.every((n) => /^(source|ticket|piece):/.test(n.id)), 'every node id is typed (type:id)');

  //? The two near-identical OAuth tickets should be similarity-linked.
  const t1 = graph.nodes.find((n) => n.label.includes('DEV-101'))?.id ?? '';
  const t2 = graph.nodes.find((n) => n.label.includes('DEV-102'))?.id ?? '';
  const linked = graph.edges.some((e) => e.kind === 'similarity' && ((e.from === t1 && e.to === t2) || (e.from === t2 && e.to === t1)));
  assert(linked, 'the two near-identical OAuth tickets are similarity-linked');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/knowledgeGraph.test.mts');
