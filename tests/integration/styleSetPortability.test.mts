//? Test for FREEDOM_PROGRAM R1 (style-set slice) — a portable style-set captures a workspace's user-authored
//? styles and re-creates them in another workspace. parseStyleSet validates; export→import round-trips; builtin
//? global defaults are never exported or overwritten. Real Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { parseStyleSet, exportStyleSet, importStyleSet } = await import('../../server/content/styles');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

// pure validation
{
  const p = parseStyleSet([{ feature: 'image-gen', key: 'noir', label: 'Noir', systemPrompt: 'high contrast b&w' }, { key: 'bad' }, 'junk', { feature: 'x', key: 'y', systemPrompt: 'z' }]);
  eq(p.length, 2, 'malformed entries dropped');
  eq(p[0].label, 'Noir', 'label kept');
  eq(p[1].label, 'y', 'a missing label defaults to the key');
  eq(parseStyleSet('nope').length, 0, 'a non-array → empty');
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ss-${String(stamp)}@youcomm.nl`, name: 'SS' } });
let wsA: string | null = null; let wsB: string | null = null;
try {
  wsA = (await createBlankWorkspace(prisma, owner.id, 'SS A')).workspaceId;
  wsB = (await createBlankWorkspace(prisma, owner.id, 'SS B')).workspaceId;

  // seed 2 user styles in A (+ builtins may exist globally)
  await prisma.stylePreset.create({ data: { workspaceId: wsA, feature: 'image-gen', key: 'noir', label: 'Noir', systemPrompt: 'high contrast b&w', builtin: false } });
  await prisma.stylePreset.create({ data: { workspaceId: wsA, feature: 'video-gen', key: 'fast', label: 'Fast', systemPrompt: 'quick cuts', builtin: false } });
  //? a builtin global must never be exported by a workspace export
  await prisma.stylePreset.create({ data: { workspaceId: wsA, feature: 'image-gen', key: 'builtinish', label: 'B', systemPrompt: 'x', builtin: true } });

  const set = await exportStyleSet(prisma, wsA);
  eq(set.length, 2, 'only the 2 user styles export (builtin excluded)');

  const written = await importStyleSet(prisma, wsB, JSON.parse(JSON.stringify(set)));
  eq(written, 2, 'both styles import into B');
  const setB = await exportStyleSet(prisma, wsB);
  eq(JSON.stringify(setB), JSON.stringify(set), 'the style set round-trips A → B');

  // re-import is idempotent (upsert by feature+key)
  await importStyleSet(prisma, wsB, JSON.parse(JSON.stringify(set)));
  eq((await exportStyleSet(prisma, wsB)).length, 2, 're-import does not duplicate');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  for (const id of [wsA, wsB].filter((x): x is string => x !== null)) await cleanupWorkspace(prisma, id, [owner.id]).catch(() => undefined);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/styleSetPortability.test.mts');
