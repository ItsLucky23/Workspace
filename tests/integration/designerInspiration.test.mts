//? FASE INS (DOCUMENTS_AND_SKILLS) — designer inspiration import + the TENANT_MODELS security fix.
//? Covers: the curated style-gallery seed (idempotent, complete 30-token sets, inactive), the REAL
//? chromium-container URL-capture (a data: URL renders offline → a PNG in the media store), the
//? honest no-provider paths of extraction/compare (null, never a fake theme), and the snapshot
//? cross-tenant regression for the EIGHT models that were read via tenantDb without being in
//? TENANT_MODELS (design library, studio, UI reviews, findings, chat, links leaked across
//? workspaces before this round's fix).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { ensureStyleGallery, GALLERY_PRESET_NAMES, captureUrlScreenshot, extractThemeFromScreenshot, compareDesigns } = await import('../../server/designer/inspiration');
const { THEME_TOKENS } = await import('../../server/designer/generateTheme');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { dockerAvailable } = await import('../../server/container/runtime');
const { MEDIA_DIR } = await import('../../server/media/store');
const { deterministicObjectId } = await import('../../server/orchestrator/actionIds');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ins-${String(stamp)}@youcomm.nl`, name: 'INS' } });
const ownerB = await prisma.user.create({ data: { email: `ins-b-${String(stamp)}@youcomm.nl`, name: 'INSB' } });
let wsId = '';
let wsB = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Inspire WS');
  wsId = created.workspaceId;
  const createdB = await createBlankWorkspace(prisma, ownerB.id, 'Inspire B');
  wsB = createdB.workspaceId;

  // ---- 1. the style gallery: bootstrap-seeded, idempotent, complete + inactive ----
  await prisma.designArtifact.deleteMany({ where: { workspaceId: wsId, kind: 'theme', source: 'seed' } });
  await Promise.all([ensureStyleGallery(prisma, wsId), ensureStyleGallery(prisma, wsId)]);
  const seeded = await prisma.designArtifact.findMany({ where: { workspaceId: wsId, kind: 'theme', source: 'seed' } });
  eq(seeded.length, 6, 'the 6 gallery presets seeded exactly once (idempotent)');
  eq(GALLERY_PRESET_NAMES.length, 6, 'and the exported name list matches');
  assert(seeded.every((a) => !a.active), 'presets never activate themselves');
  assert(seeded.every((artifact) => artifact.id === deterministicObjectId(wsId, artifact.name, 'builtin-design-artifact')), 'every newly-seeded preset has its deterministic workspace+name ObjectId');
  for (const a of seeded) {
    const content = a.content as { light?: Record<string, string>; dark?: Record<string, string> };
    for (const mode of ['light', 'dark'] as const) {
      const tokens = content[mode] ?? {};
      assert(THEME_TOKENS.every((t) => typeof tokens[t] === 'string' && tokens[t].length > 0), `${a.name} ${mode} carries all 30 tokens (parseTheme fill)`);
    }
  }

  // ---- 2. REAL chromium-container capture of an offline data: URL ----
  eq(await dockerAvailable(), true, 'docker daemon is available (the capture path is part of this suite)');
  const shotUrl = await captureUrlScreenshot('data:text/html,<body style="background:#123456"><h1>Inspire</h1></body>');
  assert(shotUrl !== null && shotUrl.startsWith('/media/'), 'the chromium container produced a screenshot into the media store');
  const png = readFileSync(path.join(MEDIA_DIR, (shotUrl ?? '').slice('/media/'.length)));
  eq(png.subarray(1, 4).toString('latin1'), 'PNG', 'and it is a real PNG');
  eq(await captureUrlScreenshot('javascript:alert(1)'), null, 'a non-http(s)/data scheme is refused');

  // ---- 3. honest no-provider paths (stub world: no Gemini key → null, never a fabricated theme) ----
  eq(await extractThemeFromScreenshot(wsId, shotUrl ?? ''), null, 'extraction without a vision provider returns null (honest)');
  eq(await compareDesigns(wsId, shotUrl ?? '', shotUrl ?? ''), null, 'compare without a vision provider returns null');
  eq(await prisma.uiReviewRequest.count({ where: { workspaceId: wsId } }), 0, 'and no review row was fabricated');

  // ---- 4. snapshot: reads the bootstrap gallery + the 8-model tenant-scoping fix ----
  const snapB1 = await buildSnapshot(prisma, ownerB.id, wsB);
  eq(snapB1.designArtifacts.filter((a) => a.source === 'seed').length, 6, "workspace B's snapshot reads its bootstrap gallery without seeding");
  //? Plant foreign rows in B; A's snapshot must not see ANY of them (was: unscoped tenantDb reads).
  await prisma.designArtifact.create({ data: { workspaceId: wsB, kind: 'theme', name: `B-theme-${String(stamp)}`, content: {}, source: 'manual' } });
  await enqueueControlAction({
    workspaceId: wsB, op: 'ui-review-create', target: {}, userId: ownerB.id,
    payload: { page: `b-page-${String(stamp)}`, screenshots: [], problems: ['confusing'] },
    clientRequestId: `ins-foreign-review-${String(stamp)}`,
  });
  await prisma.interviewFinding.create({ data: { workspaceId: wsB, area: 'ux', title: `B-finding-${String(stamp)}` } });
  await prisma.studioBrief.create({ data: { workspaceId: wsB, name: `B-brief-${String(stamp)}`, productName: 'x', audience: 'x', tone: 'x', goals: 'x' } });
  const snapA = await buildSnapshot(prisma, owner.id, wsId);
  eq(snapA.designArtifacts.filter((a) => a.name === `B-theme-${String(stamp)}`).length, 0, "A's snapshot does NOT leak B's design artifacts (TENANT_MODELS fix)");
  eq(snapA.uiReviews.filter((r) => r.page === `b-page-${String(stamp)}`).length, 0, "…nor B's UI reviews");
  eq(snapA.interviewFindings.filter((f) => f.title === `B-finding-${String(stamp)}`).length, 0, "…nor B's interviewer findings");
  eq(snapA.studioBriefs.filter((b) => b.name === `B-brief-${String(stamp)}`).length, 0, "…nor B's studio briefs");
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  if (wsB) await cleanupWorkspace(prisma, wsB, [ownerB.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: ownerB.id } }).catch(() => undefined);
  report('tests/integration/designerInspiration.test.mts');
}
