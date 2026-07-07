//? Test for FREEDOM_PROGRAM R3 — brand-kit portability. Verifies parseBrandKit validates/normalizes a portable
//? JSON blob, and exportBrandKit → importBrandKit round-trips a workspace's brand library into another
//? workspace losslessly. Real Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { parseBrandKit, exportBrandKit, importBrandKit, saveBrandLibrary } = await import('../../server/studio/brand');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

// pure parse/validation
{
  assert(parseBrandKit(null) === null, 'null → null');
  assert(parseBrandKit('nope') === null, 'a string → null');
  const p = parseBrandKit({ name: 'Acme', palette: [{ name: 'Primary', hex: '#f00' }, { hex: '' }, 'junk'], typography: { heading: 'Inter' }, voice: 'bold', taglines: ['Go', 1], logoIdeas: [] });
  eq(p?.name, 'Acme', 'name kept');
  eq(p?.palette.length, 1, 'palette entries without a hex are dropped');
  eq(p?.typography.heading, 'Inter', 'typography heading kept');
  eq(p?.typography.body, '', 'missing typography body → empty');
  assert(p?.taglines.length === 1, 'non-string taglines dropped');
  eq(parseBrandKit({})?.name, 'Brand', 'empty object → the default name');
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `bkp-${String(stamp)}@youcomm.nl`, name: 'BKP' } });
let wsA: string | null = null; let wsB: string | null = null;
try {
  wsA = (await createBlankWorkspace(prisma, owner.id, 'BKP A')).workspaceId;
  wsB = (await createBlankWorkspace(prisma, owner.id, 'BKP B')).workspaceId;

  // no library yet → null export
  assert((await exportBrandKit(prisma, wsA)) === null, 'a workspace with no brand library exports null');

  // seed a brand in A
  await saveBrandLibrary(prisma, wsA, { name: 'Acme', palette: [{ name: 'Primary', hex: '#ff0000' }, { name: 'Ink', hex: '#111' }], typography: { heading: 'Poppins', body: 'Inter' }, voice: 'confident, warm', taglines: ['Ship it', 'Own it'], logoIdeas: ['a rocket'] });

  const kit = await exportBrandKit(prisma, wsA);
  assert(kit !== null, 'A now exports a kit');
  eq(kit?.palette.length, 2, 'the palette exported');

  // import into B + re-export → identical
  const ok = await importBrandKit(prisma, wsB, JSON.parse(JSON.stringify(kit)));
  assert(ok, 'the kit imports into B');
  const kitB = await exportBrandKit(prisma, wsB);
  eq(JSON.stringify(kitB), JSON.stringify(kit), 'the brand kit round-trips losslessly A → B');

  // a garbage import is rejected
  assert((await importBrandKit(prisma, wsB, 42)) === false, 'a non-object kit is rejected');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  const ids = [wsA, wsB].filter((x): x is string => x !== null);
  for (const id of ids) await cleanupWorkspace(prisma, id, [owner.id]).catch(() => undefined);
  if (ids.length === 0) await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/brandKitPortability.test.mts');
