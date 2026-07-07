//? Test for FREEDOM_PROGRAM O5 — reusable output templates/format specs. Verifies save/delete ops persist a
//? named render spec (with format validation), and a saved spec DRIVES a render plan (its format resolves to
//? the right dimensions in buildFfmpegPlan). Real Conductor + Mongo; the render plan is pure (O1).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { resolveRenderFormat, buildFfmpegPlan } = await import('../../server/content/render.ts');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ot-${String(stamp)}@youcomm.nl`, name: 'OT' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'OT WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  // save (create) with a valid vertical format
  await enqueueControlAction({ workspaceId: wsId, op: 'save-output-template', target: {}, payload: { name: 'Reels', format: '9:16', watermarkPosition: 'br' }, userId: owner.id, clientRequestId: `ot-1-${String(stamp)}` });
  const rows = await prisma.outputTemplate.findMany({ where: { workspaceId: wsId } });
  eq(rows.length, 1, 'the output template was created');
  const tpl = rows[0];
  eq(tpl.format, '9:16', 'the format persisted');
  eq(tpl.watermarkPosition, 'br', 'the watermark position persisted');

  // garbage format → the safe default
  await enqueueControlAction({ workspaceId: wsId, op: 'save-output-template', target: {}, payload: { name: 'Bad', format: 'junk' }, userId: owner.id, clientRequestId: `ot-2-${String(stamp)}` });
  const bad = await prisma.outputTemplate.findFirst({ where: { workspaceId: wsId, name: 'Bad' } });
  eq(bad?.format, '16:9', 'an invalid format falls back to 16:9');

  // the saved spec DRIVES a render plan
  const fmt = resolveRenderFormat(tpl.format);
  eq(fmt.width, 720, 'the template format resolves to 720 wide (vertical)');
  const plan = buildFfmpegPlan([{ imageFile: 'a.png', durationMs: 1000 }], null, 'l.txt', 'o.mp4', fmt);
  assert(plan.args[plan.args.indexOf('-vf') + 1].includes('scale=720:1280'), 'the render plan uses the template format');

  // update + delete
  await enqueueControlAction({ workspaceId: wsId, op: 'save-output-template', target: {}, payload: { templateId: tpl.id, name: 'Reels HD', format: '1:1' }, userId: owner.id, clientRequestId: `ot-3-${String(stamp)}` });
  eq((await prisma.outputTemplate.findUnique({ where: { id: tpl.id } }))?.format, '1:1', 'update changed the format');
  eq(await prisma.outputTemplate.count({ where: { workspaceId: wsId } }), 2, 'update did not duplicate');
  await enqueueControlAction({ workspaceId: wsId, op: 'delete-output-template', target: {}, payload: { templateId: tpl.id }, userId: owner.id, clientRequestId: `ot-4-${String(stamp)}` });
  eq(await prisma.outputTemplate.count({ where: { workspaceId: wsId } }), 1, 'the template was deleted');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/outputTemplate.test.mts');
