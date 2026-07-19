//? HARDENING phase 6 — the five subsystems the owner asked to ship COMPLETE, against real Mongo:
//? the schema-upgrade runner (F51), the full export/import round-trip (F54), retention (F55), workspace
//? packs (#19), and the durable job stores behind F35/F38.
//?
//? The restore drill is the point of the F54 block: not "does export produce JSON" but "does importing it
//? give you back a workspace you can work in".

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { buildFullBundle, importFullBundle, bundleCompatible, BUNDLE_VERSION } = await import('../../server/export/fullExport');
const { runSchemaUpgrade, readSchemaVersion, CURRENT_SCHEMA_VERSION, BACKFILL_STEPS } = await import('../../server/db/schemaVersion');
const { sweepWorkspaceRetention } = await import('../../server/retention/sweep');
const { findPack, WORKSPACE_PACKS } = await import('../../server/bootstrap/workspacePacks');
const { WORKSPACE_PACK_CHOICES } = await import('../../src/workspaces/_data/packs');
const { openRun, startRun, finishRun, listRunHistory, MAX_RUN_ATTEMPTS } = await import('../../server/automation/runHistory');
const { enqueueExtractJob, claimExtractJob, completeExtractJob } = await import('../../server/documents/extractJob');
const { encKeyFingerprint, encKeyMatches } = await import('../../server/db/backupAssets');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sub-${String(stamp)}@youcomm.nl`, name: 'SUB' } });
const created: string[] = [];

try {
  /* ---------------------------------------------- #19: packs seed a usable workspace */
  eq(WORKSPACE_PACKS.length, WORKSPACE_PACK_CHOICES.length, 'the server packs and the client picker stay in lockstep');
  for (const choice of WORKSPACE_PACK_CHOICES) {
    const server = findPack(choice.id);
    assert(server !== null, `pack ${choice.id} exists on the server`);
    eq(server?.preset, choice.preset, `pack ${choice.id} agrees on the pipeline tier`);
    eq(server?.labelKey, choice.labelKey, `pack ${choice.id} agrees on its label key`);
  }

  const packed = await createBlankWorkspace(prisma, owner.id, 'Creator WS', ['content', 'marketing'], 'simple', 'content-creator');
  created.push(packed.workspaceId);
  assert((await prisma.skill.count({ where: { workspaceId: packed.workspaceId } })) > 0, 'a pack seeds real skills — the workspace is not empty on first open');
  eq(await prisma.channel.count({ where: { workspaceId: packed.workspaceId } }), 1, 'and a starting channel');
  assert((await prisma.document.count({ where: { workspaceId: packed.workspaceId } })) > 0, 'and a starter document');
  const seededChannel = await prisma.channel.findFirst({ where: { workspaceId: packed.workspaceId }, select: { autopilot: true } });
  eq(seededChannel?.autopilot, false, 'a seeded channel never starts on autopilot');

  //? An unknown pack must degrade to a plain workspace, not fail creation.
  const unknownPack = await createBlankWorkspace(prisma, owner.id, 'Unknown pack WS', undefined, 'simple', 'does-not-exist');
  created.push(unknownPack.workspaceId);
  eq(await prisma.channel.count({ where: { workspaceId: unknownPack.workspaceId } }), 0, 'an unknown pack seeds nothing and still creates the workspace');

  /* ---------------------------------------------- F51: the schema upgrade runner */
  const before = await readSchemaVersion(prisma);
  const upgrade = await runSchemaUpgrade(prisma);
  eq(upgrade.failed, undefined, 'the upgrade runs cleanly');
  assert(upgrade.to >= before, 'the watermark never goes backwards');
  eq(await readSchemaVersion(prisma), CURRENT_SCHEMA_VERSION, 'and reaches the current version');

  //? Idempotency is the property that matters: a second boot must be a no-op, not a re-run.
  const again = await runSchemaUpgrade(prisma);
  eq(again.applied.length, 0, 'a second run applies nothing (the watermark holds)');
  eq(new Set(BACKFILL_STEPS.map((s) => s.version)).size, BACKFILL_STEPS.length, 'step versions are unique — a reused number would silently skip a step');

  /* ---------------------------------------------- F54: a bundle you can restore from */
  const source = await createBlankWorkspace(prisma, owner.id, 'Source WS', undefined, 'professional');
  created.push(source.workspaceId);
  const sourceProject = await prisma.project.findFirst({ where: { workspaceId: source.workspaceId }, select: { id: true } });
  const sourceProjectId = sourceProject?.id ?? source.workspaceId;

  await prisma.document.create({ data: { workspaceId: source.workspaceId, title: 'Design doc', content: '# Design\n\nThe real content.' } });
  await prisma.skill.create({ data: { workspaceId: source.workspaceId, slug: 'tone', name: 'Tone', instruction: 'Be terse.', examples: '', applyPoints: ['all'], enabled: true, builtin: false } });
  await prisma.channel.create({ data: { workspaceId: source.workspaceId, projectId: sourceProjectId, name: 'Main', platform: 'youtube', brandVoice: 'Direct', autopilot: true, defaultAccountId: 'acc-secret' } });
  await prisma.workspaceTrigger.create({ data: { workspaceId: source.workspaceId, name: 'Nightly', on: 'cron', action: 'notify', params: {}, match: {}, enabled: true, cron: '0 2 * * *' } });
  await prisma.envVar.create({ data: { workspaceId: source.workspaceId, key: 'PUBLIC_FLAG', value: 'on', secret: false } });
  await prisma.envVar.create({ data: { workspaceId: source.workspaceId, key: 'API_TOKEN', value: 'secret-value', secret: true } });

  const bundle = await buildFullBundle(prisma, source.workspaceId, stamp);
  assert(bundle !== null, 'the bundle builds');
  eq(bundle?.version, BUNDLE_VERSION, 'and is versioned');
  assert((bundle?.counts.documents ?? 0) > 0, 'documents are in the bundle (the old export dropped them entirely)');
  assert((bundle?.counts.skills ?? 0) > 0, 'so are skills');
  assert(bundle?.envKeys.includes('PUBLIC_FLAG') === true, 'non-secret env KEYS are listed');
  assert(bundle?.envKeys.includes('API_TOKEN') !== true, 'a secret key is not even named');
  assert(!JSON.stringify(bundle).includes('secret-value'), 'no secret VALUE can appear in a portable file');
  assert((bundle?.excluded.length ?? 0) > 0, 'the bundle states what it deliberately excludes');

  eq(bundleCompatible({ version: 999 }).ok, false, 'a newer bundle is refused rather than half-imported');
  eq(bundleCompatible({}).ok, false, 'a non-bundle is refused');

  //? THE DRILL: import into a fresh workspace and check it is actually usable.
  const restored = await importFullBundle(prisma, owner.id, bundle, {
    createWorkspace: async (name, sections, preset) => {
      const ws = await createBlankWorkspace(prisma, owner.id, name, sections, preset as 'simple' | 'advanced' | 'professional');
      created.push(ws.workspaceId);
      return ws.workspaceId;
    },
  });
  assert(restored.ok, 'the bundle imports');
  const restoredId = restored.workspaceId ?? '';
  eq(await prisma.document.count({ where: { workspaceId: restoredId, title: 'Design doc' } }), 1, 'the document survived the round-trip WITH its content');
  const restoredDoc = await prisma.document.findFirst({ where: { workspaceId: restoredId, title: 'Design doc' }, select: { content: true } });
  assert(restoredDoc?.content.includes('The real content.') === true, 'and it is the real content, not a title-only stub');
  //? The workspace is created through the normal path, which seeds a starter skill library — so count
  //? the IMPORTED skill by name rather than assuming an empty slate.
  eq(await prisma.skill.count({ where: { workspaceId: restoredId, name: 'Tone' } }), 1, 'the imported skill survived');
  eq(await prisma.pipelineStage.count({ where: { workspaceId: restoredId } }), 7, "the source's pipeline shape survived");

  const importedChannel = await prisma.channel.findFirst({ where: { workspaceId: restoredId }, select: { autopilot: true, defaultAccountId: true, brandVoice: true } });
  eq(importedChannel?.brandVoice, 'Direct', 'the channel config survived');
  eq(importedChannel?.autopilot, false, 'but autopilot is OFF — an import must not start posting');
  eq(importedChannel?.defaultAccountId, null, 'and it inherits no connected account');
  eq((await prisma.workspaceTrigger.findFirst({ where: { workspaceId: restoredId }, select: { enabled: true } }))?.enabled, false, 'triggers arrive disabled');
  eq(await prisma.envVar.count({ where: { workspaceId: restoredId, key: 'API_TOKEN' } }), 0, 'no secret crossed the boundary');

  /* ---------------------------------------------- F49: the encryption-key fingerprint */
  const fingerprint = encKeyFingerprint();
  eq(encKeyMatches(fingerprint).matches, fingerprint.length > 0, 'a backup taken on THIS install matches this key');
  eq(encKeyMatches('0000deadbeef0000').matches, false, 'a backup from another install is flagged');
  assert(encKeyMatches('0000deadbeef0000').reason.includes('DIFFERENT'), 'and the reason says why it matters');
  assert(!fingerprint.includes(process.env.WORKSPACES_ENC_KEY ?? '__none__'), 'the fingerprint is not the key');

  /* ---------------------------------------------- F55: retention deletes only what it was told to */
  const retentionWs = created[0] ?? '';
  const old = new Date(stamp - 90 * 86_400_000);
  await prisma.socialComment.create({ data: { workspaceId: retentionWs, platform: 'youtube', externalVideoId: 'v1', externalId: `old-read-${String(stamp)}`, author: 'a', text: 'old and read', publishedAt: old, read: true } });
  await prisma.socialComment.create({ data: { workspaceId: retentionWs, platform: 'youtube', externalVideoId: 'v1', externalId: `old-unread-${String(stamp)}`, author: 'b', text: 'old but unread', publishedAt: old, read: false } });

  const noop = await sweepWorkspaceRetention(prisma, retentionWs, { chatDays: 0, commentDays: 0, eventDays: 0, notificationDays: 0, aiRunDays: 0 }, stamp);
  eq(noop.deleted, 0, 'the DEFAULT policy deletes nothing — retention is opt-in');

  const swept = await sweepWorkspaceRetention(prisma, retentionWs, { chatDays: 0, commentDays: 30, eventDays: 0, notificationDays: 0, aiRunDays: 0 }, stamp);
  eq(swept.byClass.comments, 1, 'an opted-in window deletes the old READ comment');
  eq(await prisma.socialComment.count({ where: { workspaceId: retentionWs, externalId: `old-unread-${String(stamp)}` } }), 1, 'and never the unread one — that is still work');

  /* ---------------------------------------------- F38/F35: the durable job stores */
  const trigger = await prisma.workspaceTrigger.findFirst({ where: { workspaceId: source.workspaceId }, select: { id: true, name: true } });
  const minuteAt = new Date(Math.floor(stamp / 60_000) * 60_000);
  const runId = await openRun(prisma, { workspaceId: source.workspaceId, triggerId: trigger?.id ?? source.workspaceId, triggerName: trigger?.name ?? 'Nightly', minuteAt });
  assert(runId !== null, 'a run row is opened before the work');
  const duplicate = await openRun(prisma, { workspaceId: source.workspaceId, triggerId: trigger?.id ?? source.workspaceId, triggerName: 'Nightly', minuteAt });
  eq(duplicate, null, 'a duplicate tick for the same minute opens nothing (that is what makes catch-up safe)');

  assert(await startRun(prisma, runId ?? ''), 'the run can be claimed');
  await finishRun(prisma, runId ?? '', { ok: false, error: 'boom' });
  const history = await listRunHistory(prisma, source.workspaceId);
  eq(history[0]?.status, 'failed', 'a failed run is recorded as failed');
  eq(history[0]?.lastError, 'boom', 'with its error, so "did it run last night?" has an answer');

  //? Exhausting the attempts turns it into a dead letter rather than an endless retry.
  for (let i = 0; i < MAX_RUN_ATTEMPTS + 1; i++) {
    await startRun(prisma, runId ?? '');
    await finishRun(prisma, runId ?? '', { ok: false, error: 'still failing' });
  }
  eq((await listRunHistory(prisma, source.workspaceId))[0]?.status, 'dead', 'out of attempts → a dead letter an operator can list');

  const doc = await prisma.document.findFirst({ where: { workspaceId: source.workspaceId }, select: { id: true } });
  const extractId = await enqueueExtractJob(prisma, { workspaceId: source.workspaceId, documentId: doc?.id ?? '', url: '/media/x.pdf', userId: owner.id });
  assert(extractId !== null, 'an extraction records its intent durably');
  eq(await enqueueExtractJob(prisma, { workspaceId: source.workspaceId, documentId: doc?.id ?? '', url: '/media/x.pdf', userId: owner.id }), extractId, 're-attaching the same file reuses the pending job instead of queueing a second parse');
  assert(await claimExtractJob(prisma, extractId ?? ''), 'a job can be claimed');
  await completeExtractJob(prisma, extractId ?? '', { ok: true });
  eq((await prisma.documentExtractJob.findUnique({ where: { id: extractId ?? '' }, select: { status: true } }))?.status, 'done', 'and completed');
} finally {
  for (const id of created) await cleanupWorkspace(prisma, id);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('subsystems');
