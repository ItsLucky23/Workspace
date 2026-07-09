//? The coding agent's design-system context-doc now carries a CATALOG of named looks (built-in premades +
//? the workspace's saved themes/styles), so a ticket "build the dropdown in the Apple style" grounds on the
//? real Apple tokens. Proves: a fresh workspace's design-system doc lists the premades with real tokens; a
//? saved custom look joins the catalog. Real Mongo; cleans up.

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { buildDesignSystemDoc } = await import('../../server/designer/designSystemDoc');
const { saveDesignArtifact } = await import('../../server/designer/library');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 9000, stepMs = 80): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

//? Pure: even with no active theme + no saved looks, the doc carries the built-in named looks with real tokens.
const bare = buildDesignSystemDoc(null, null, []);
assert(/Named looks/i.test(bare), 'the doc has a named-looks catalog');
assert(/\bApple\b/.test(bare), 'the catalog names the Apple look');
assert(/#3B82F6/i.test(bare) || /primary #/i.test(bare), 'the catalog carries real Apple tokens (e.g. its primary colour)');
assert(/\bBrutalist\b/.test(bare) && /\bMaterial\b/.test(bare), 'all premade looks are listed');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ds-${String(stamp)}@youcomm.nl`, name: 'DS' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'DS WS' }, userId: owner.id, clientRequestId: `ds-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? A fresh workspace already has the design-system InfoSource with the named looks (seeded on create).
  const seeded = await poll(async () => { const s = await prisma.infoSource.findFirst({ where: { workspaceId: wsId, source: 'design-system' }, select: { content: true } }); return s?.content && /\bApple\b/.test(s.content) ? s : null; });
  assert(seeded !== null, 'a fresh workspace has the design-system doc with the named looks (agent can build in Apple)');

  //? Saving a custom look joins the catalog.
  await saveDesignArtifact(prisma, wsId, { kind: 'style', name: 'MyBrand', content: { radius: 4, fontHeading: 'Georgia', shadow: 'none' }, source: 'manual' });
  const withSaved = await poll(async () => { const s = await prisma.infoSource.findFirst({ where: { workspaceId: wsId, source: 'design-system' }, select: { content: true } }); return s?.content && /MyBrand/.test(s.content) ? s : null; });
  assert(withSaved !== null, 'a saved custom look joins the workspace named-looks catalog');
  console.log('[ds] ✓ design-system doc carries premades + saved looks');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) { await prisma.infoSource.deleteMany({ where: { workspaceId } }).catch(() => null); await prisma.designArtifact.deleteMany({ where: { workspaceId } }).catch(() => null); await cleanupWorkspace(prisma, workspaceId, [owner.id]); }
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/designSystemCatalog.test.mts');
