//? DESIGN_DOCS_PROGRAM Phase 3 (design premium loop) through the REAL Mongo: 3.6 the design-library RAG
//? corpus (saving a look indexes it + it's retrievable so generation can build on it) and 3.3 the lossless
//? ticket→agent artifact handoff (a linked animation renders its motion spec; a Studio artifact hands over
//? its actual HTML — no "HTML omitted" pointer, no dropped animation).

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { saveDesignArtifact, deleteDesignArtifact } = await import('../../server/designer/library');
const { DESIGN_LIBRARY_CORPUS, retrieveDesignLibrary } = await import('../../server/designer/designLibraryRag');
const { loadTicketArtifactContext } = await import('../../server/orchestrator/artifactContext');
const { runInTenant } = await import('../../server/tenant/tenantContext');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `dpl-${String(stamp)}@youcomm.nl`, name: 'DPL' } });
let wsId = '';

try {
  wsId = (await createBlankWorkspace(prisma, owner.id, 'Premium WS')).workspaceId;

  // ---- 3.6: saving a look indexes it into the design-library corpus + it's retrievable ----
  const themeId = await runInTenant(wsId, () => saveDesignArtifact(prisma, wsId, { kind: 'theme', name: 'Deep Ocean', description: 'A calm premium blue fintech look with soft depth.', content: { light: {}, dark: {} }, source: 'ai' }));
  assert(themeId.length > 0, 'saveDesignArtifact returned an id');
  const ragRows = await prisma.ragEntry.count({ where: { workspaceId: wsId, commitHash: DESIGN_LIBRARY_CORPUS, filePath: themeId } });
  assert(ragRows > 0, '3.6: the saved look indexed into the design-library corpus');
  const hits = await runInTenant(wsId, () => retrieveDesignLibrary(prisma, wsId, 'premium blue fintech', 4));
  assert(hits.some((h) => h.content.includes('Deep Ocean')), '3.6: the look is retrievable for a matching brief');

  // ---- 3.3: a linked ANIMATION renders its motion spec (was dropped before) ----
  const anim = await prisma.designArtifact.create({ data: { workspaceId: wsId, kind: 'animation', name: 'Rise', description: 'gentle upward entrance', content: { fade: true, y: 24, duration: 0.4, easing: 'spring' }, source: 'ai', active: false } });
  const studio = await prisma.studioArtifact.create({ data: { workspaceId: wsId, briefId: '000000000000000000000000', kind: 'landing', role: 'designer', title: 'Hero', content: { html: '<section class="hero"><h1>Premium</h1></section>' } } });
  //? loadTicketArtifactContext only joins TicketArtifactLink → the artifacts (never the Ticket table), so a
  //? dummy ticketId is enough to exercise the handoff rendering.
  const ticketId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  await prisma.ticketArtifactLink.create({ data: { workspaceId: wsId, ticketId, artifactId: anim.id, artifactKind: 'design' } });
  await prisma.ticketArtifactLink.create({ data: { workspaceId: wsId, ticketId, artifactId: studio.id, artifactKind: 'studio' } });

  const ctx = await runInTenant(wsId, () => loadTicketArtifactContext(prisma, wsId, ticketId));
  const joined = ctx.map((c) => `${c.name}\n${c.content}`).join('\n\n');
  assert(/Animation\b/i.test(joined) && joined.includes('spring'), '3.3: a linked animation hands over its motion spec (not dropped)');
  assert(joined.includes('<section class="hero"'), '3.3: a linked Studio artifact hands over its actual HTML (not "omitted")');

  // ---- de-index on delete ----
  await runInTenant(wsId, () => deleteDesignArtifact(prisma, wsId, themeId));
  assert(await prisma.ragEntry.count({ where: { workspaceId: wsId, commitHash: DESIGN_LIBRARY_CORPUS, filePath: themeId } }) === 0, '3.6: deleting the look de-indexes it');
} finally {
  if (wsId) await prisma.ragEntry.deleteMany({ where: { workspaceId: wsId, commitHash: DESIGN_LIBRARY_CORPUS } });
  if (wsId) await prisma.designArtifact.deleteMany({ where: { workspaceId: wsId } });
  if (wsId) await prisma.ticketArtifactLink.deleteMany({ where: { workspaceId: wsId } });
  if (wsId) await prisma.studioArtifact.deleteMany({ where: { workspaceId: wsId } });
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('designPremiumLoop');
