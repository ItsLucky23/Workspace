//? FASE SK (DOCUMENTS_AND_SKILLS) through the REAL Conductor + Mongo: the universal AI-skills layer.
//? Covers: builtin lazy-seed (idempotent), apply-point resolution, the prompt block, the four
//? ai-skill-* ops (builtin delete refused, reset restores the seed), and the SNAPSHOT — including the
//? cross-tenant regression: CustomAiTask/OutputTemplate reads were UNSCOPED (not in TENANT_MODELS,
//? so the no-where tenantDb read passed through) → every snapshot leaked every workspace's rows.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { ensureBuiltinSkills, resolveSkillsFor, skillPromptBlock, applyPointForFeature, builtinSkillDefault } = await import('../../server/ai/skills');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sk-${String(stamp)}@youcomm.nl`, name: 'SK' } });
const ownerB = await prisma.user.create({ data: { email: `sk-b-${String(stamp)}@youcomm.nl`, name: 'SKB' } });
let wsId = '';
let wsB = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Skills WS');
  wsId = created.workspaceId;
  const createdB = await createBlankWorkspace(prisma, ownerB.id, 'Other WS');
  wsB = createdB.workspaceId;

  // ---- 1. builtin seed: idempotent, all OFF by default ----
  await ensureBuiltinSkills(wsId);
  await ensureBuiltinSkills(wsId); // second run must not duplicate
  const seeded = await prisma.skill.findMany({ where: { workspaceId: wsId } });
  eq(seeded.length, 5, 'the 5 builtin skills seeded exactly once (idempotent)');
  assert(seeded.every((s) => !s.enabled), 'every builtin starts OFF (consent-first)');
  assert(seeded.some((s) => s.slug === 'humanizer'), 'humanizer is among the seeds');
  const humanizer = seeded.find((s) => s.slug === 'humanizer');
  assert((humanizer?.instruction ?? '').includes('Never attempt to defeat or evade AI-detection'), 'the humanizer instruction embeds the ADR-0015 integrity boundary');

  // ---- 2. resolution: enabled-only + apply-point matching ----
  eq((await resolveSkillsFor(wsId, 'content')).length, 0, 'nothing resolves while everything is OFF');
  await prisma.skill.updateMany({ where: { workspaceId: wsId, slug: 'humanizer' }, data: { enabled: true } });
  await prisma.skill.updateMany({ where: { workspaceId: wsId, slug: 'seo-optimizer' }, data: { enabled: true } });
  const forContent = await resolveSkillsFor(wsId, 'content');
  eq(forContent.length, 2, "content resolves humanizer + seo (both carry 'content')");
  const forDev = await resolveSkillsFor(wsId, 'dev');
  eq(forDev.length, 0, "dev resolves neither (their applyPoints don't include 'dev')");
  await prisma.skill.create({ data: { workspaceId: wsId, slug: `all-${String(stamp)}`, name: 'Everywhere', instruction: 'Apply everywhere.', applyPoints: ['all'], enabled: true } });
  eq((await resolveSkillsFor(wsId, 'dev')).length, 1, "an 'all' skill reaches every apply-point");

  // ---- 3. the prompt block ----
  const block = await skillPromptBlock(wsId, 'content');
  assert(block.includes('## Active skills'), 'the block carries the header');
  assert(block.includes('### Skill: Humanizer') && block.includes('### Skill: SEO optimizer'), 'both matching skills render');
  eq(await skillPromptBlock(undefined, 'content'), '', 'no workspaceId → empty block (never fails the turn)');
  eq(applyPointForFeature('script'), 'content', 'feature→group map routes script to content');
  eq(applyPointForFeature('pipeline-agent'), 'dev', 'feature→group map routes the PTY agent to dev');

  // ---- 4. the four ops through the Conductor ----
  await enqueueControlAction({ workspaceId: wsId, op: 'ai-skill-save', target: {}, payload: { name: 'Pirate mode', instruction: 'Talk like a pirate.', applyPoints: ['chat', 'bogus-point'] }, userId: owner.id, clientRequestId: `sk-c-${String(stamp)}` });
  const pirate = await poll(() => prisma.skill.findFirst({ where: { workspaceId: wsId, name: 'Pirate mode' } }));
  assert(pirate !== null, 'ai-skill-save created a user skill');
  eq(pirate?.applyPoints.join(','), 'chat', 'unknown apply-points are dropped at the op boundary');
  eq(pirate?.enabled, false, 'a new skill starts OFF unless enabled is sent');

  await enqueueControlAction({ workspaceId: wsId, op: 'ai-skill-toggle', target: {}, payload: { skillId: pirate?.id, on: true }, userId: owner.id, clientRequestId: `sk-t-${String(stamp)}` });
  assert(await poll(() => prisma.skill.findFirst({ where: { id: pirate?.id ?? '', enabled: true } })) !== null, 'ai-skill-toggle enabled it');

  await enqueueControlAction({ workspaceId: wsId, op: 'ai-skill-save', target: {}, payload: { skillId: pirate?.id, name: 'Pirate mode', instruction: 'Talk like a very polite pirate.', examples: 'Arr, if you please.', applyPoints: ['chat'] }, userId: owner.id, clientRequestId: `sk-e-${String(stamp)}` });
  assert(await poll(() => prisma.skill.findFirst({ where: { id: pirate?.id ?? '', instruction: { contains: 'polite' } } })) !== null, 'ai-skill-save edited the instruction');

  //? builtin delete must be refused; user-skill delete works.
  await enqueueControlAction({ workspaceId: wsId, op: 'ai-skill-delete', target: {}, payload: { skillId: humanizer?.id }, userId: owner.id, clientRequestId: `sk-dh-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'ai-skill-delete', target: {}, payload: { skillId: pirate?.id }, userId: owner.id, clientRequestId: `sk-dp-${String(stamp)}` });
  assert(await poll(async () => ((await prisma.skill.count({ where: { id: pirate?.id ?? '' } })) === 0 ? true : null)) === true, 'a user skill deletes');
  eq(await prisma.skill.count({ where: { id: humanizer?.id ?? '' } }), 1, 'a builtin skill NEVER deletes');

  //? reset restores the canonical seed text after a user edit.
  await enqueueControlAction({ workspaceId: wsId, op: 'ai-skill-save', target: {}, payload: { skillId: humanizer?.id, name: 'Broken', instruction: 'scrambled', applyPoints: ['dev'] }, userId: owner.id, clientRequestId: `sk-eh-${String(stamp)}` });
  await poll(() => prisma.skill.findFirst({ where: { id: humanizer?.id ?? '', name: 'Broken' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'ai-skill-reset', target: {}, payload: { skillId: humanizer?.id }, userId: owner.id, clientRequestId: `sk-r-${String(stamp)}` });
  const restored = await poll(() => prisma.skill.findFirst({ where: { id: humanizer?.id ?? '', name: 'Humanizer' } }));
  assert(restored !== null, 'ai-skill-reset restored the builtin name');
  eq(restored?.instruction, builtinSkillDefault('humanizer')?.instruction, 'and the canonical instruction text');

  // ---- 5. snapshot: aiSkills present + lazily seeded for OTHER workspaces too ----
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  assert(snap.aiSkills.length >= 5, 'the snapshot carries the aiSkills list');
  assert(snap.aiSkills.every((s) => s.slug !== `pirate`), 'deleted skills are gone from the snapshot');
  const snapB = await buildSnapshot(prisma, ownerB.id, wsB);
  eq(snapB.aiSkills.length, 5, "workspace B lazily seeded its OWN builtins via the snapshot read");

  // ---- 6. cross-tenant regression: customTasks/outputTemplates must NOT leak between workspaces ----
  await prisma.customAiTask.create({ data: { workspaceId: wsB, name: 'B task', promptTemplate: 'x' } });
  await prisma.outputTemplate.create({ data: { workspaceId: wsB, name: 'B tpl' } });
  const snapA = await buildSnapshot(prisma, owner.id, wsId);
  eq(snapA.customTasks.filter((t) => t.name === 'B task').length, 0, "workspace A's snapshot does NOT leak workspace B's custom tasks (was unscoped)");
  eq(snapA.outputTemplates.filter((t) => t.name === 'B tpl').length, 0, "…nor workspace B's output templates (was unscoped)");
  eq(snapA.aiSkills.length, snap.aiSkills.length, "workspace B's skill seeding did not bleed into workspace A's list");
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  if (wsB) await cleanupWorkspace(prisma, wsB, [ownerB.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: ownerB.id } }).catch(() => undefined);
  report('tests/integration/skillsLayer.test.mts');
}
