//? L2 — the design-artifact persistence ROUND-TRIP, end-to-end against the REAL Mongo. Saves a theme + a
//? style via the library helper, confirms the snapshot surfaces them, and parses them back into the typed
//? designer library shapes (so the gallery/rails re-show them on reload). Also checks a malformed row is
//? dropped, not crashed. Creates + cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { saveDesignArtifact } = await import('../../server/designer/library');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { parsePersistedLibraries, artifactToTheme } = await import('../../src/workspaces/designer/persisted');
const { SEED_THEMES } = await import('../../src/workspaces/designer/themes');
const { SEED_STYLES } = await import('../../src/workspaces/designer/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `dp-${String(stamp)}@youcomm.nl`, name: 'DP' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'DP WS' }, userId: owner.id, clientRequestId: `dp-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  const seedTheme = SEED_THEMES[0];
  const seedStyle = SEED_STYLES.find((s) => s.id === 'apple') ?? SEED_STYLES[0];
  //? Save a theme + a style (the same content shapes the designer's useInProject writes).
  const themeId = await saveDesignArtifact(prisma, wsId, { kind: 'theme', name: 'My Theme', description: 'saved', content: { light: seedTheme?.light, dark: seedTheme?.dark }, source: 'manual' });
  await saveDesignArtifact(prisma, wsId, { kind: 'style', name: 'My Style', description: 'saved', content: seedStyle, source: 'manual' });
  assert(typeof themeId === 'string' && themeId.length > 0, 'saving returns an artifact id');

  //? The snapshot surfaces the saved artifacts.
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  assert(snap.designArtifacts.length >= 2, `the snapshot carries the saved artifacts (${String(snap.designArtifacts.length)})`);

  //? They parse back into the typed library shapes (the round-trip).
  const parsed = parsePersistedLibraries(snap.designArtifacts);
  const theme = parsed.themes.find((t) => t.name === 'My Theme');
  const style = parsed.styles.find((s) => s.name === 'My Style');
  assert(theme !== undefined, 'the saved theme round-trips into a DesignTheme');
  assert(style !== undefined, 'the saved style round-trips into a DesignStyle');
  eq(theme?.light.background, seedTheme?.light.background, 'the theme tokens survived the round-trip');
  eq(style?.radius, seedStyle?.radius, 'the style spec survived the round-trip');

  //? A malformed theme row (missing tokens) is dropped, never crashes.
  const bad = artifactToTheme({ id: 'x', kind: 'theme', name: 'bad', description: '', content: { light: { background: '#fff' } }, source: 'manual', active: false });
  assert(bad === null, 'a half-set token row is rejected (null), not rendered');

  console.log(`[dp] ✓ round-trip: theme "${theme?.name ?? ''}" + style "${style?.name ?? ''}" from ${String(snap.designArtifacts.length)} artifacts`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await prisma.designArtifact.deleteMany({ where: { workspaceId } }).catch(() => null);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/designerPersistence.test.mts');
