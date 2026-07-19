//? Integration test for the automation/plugin-engine (#2): trigger matching + debounce + cron (pure),
//? the AgentRole registry, and the real firing pipeline against Mongo — a `notify` trigger creates
//? notifications, an approval-gated trigger opens an 'automation' suggestion (NOT executed), and
//? accepting that suggestion executes the deferred action.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { tryCatch } = await import('@luckystack/core');
const triggers = await import('../../server/automation/triggers');
const cron = await import('../../server/automation/cron');
const executor = await import('../../server/automation/executor');
const roles = await import('../../server/automation/agentRoles');
const writer = await import('../../server/orchestrator/writerContext');
const tenant = await import('../../server/tenant/tenantContext');
const { recordFindings } = await import('../../server/interviewer/findings');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(50); }
}

function signalRequestId(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || !('clientRequestId' in payload)) return null;
  return typeof payload.clientRequestId === 'string' ? payload.clientRequestId : null;
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `auto-${String(stamp)}@youcomm.nl`, name: 'Auto Owner' } });
let workspaceId: string | null = null;
let otherWorkspaceId: string | null = null;

try {
  // ---- matchesTrigger (pure) ----
  eq(triggers.matchesTrigger({ on: 'ticket.created', match: {} }, { on: 'ticket.created' }), true, 'empty match accepts any event of the right kind');
  eq(triggers.matchesTrigger({ on: 'ticket.created', match: {} }, { on: 'stage.on_enter' }), false, 'a different `on` never matches');
  eq(triggers.matchesTrigger({ on: 'stage.on_enter', match: { stageIds: ['plan'] } }, { on: 'stage.on_enter', stageId: 'plan' }), true, 'stageIds facet matches the event stage');
  eq(triggers.matchesTrigger({ on: 'stage.on_enter', match: { stageIds: ['plan'] } }, { on: 'stage.on_enter', stageId: 'review' }), false, 'stageIds facet rejects a non-listed stage');

  // ---- debounce (pure) ----
  const t0 = Date.now();
  eq(triggers.passesDebounce({ debounceMs: null, lastFiredAt: null }, t0), true, 'no debounce → always passes');
  eq(triggers.passesDebounce({ debounceMs: 60000, lastFiredAt: new Date(t0 - 1000) }, t0), false, 'within the debounce window → blocked');
  eq(triggers.passesDebounce({ debounceMs: 60000, lastFiredAt: new Date(t0 - 61000) }, t0), true, 'past the debounce window → passes');

  // ---- cronMatches (pure) — deterministic instant + explicit workspace IANA timezone ----
  const summerInstant = new Date('2026-07-03T07:05:00.000Z');
  eq(cron.cronMatches('* * * * *', summerInstant), true, 'all-star cron matches any UTC minute by default');
  eq(cron.cronMatches('5 9 * * *', summerInstant, 'Europe/Amsterdam'), true, 'the instant is 09:05 in Amsterdam');
  eq(cron.cronMatches('5 9 * * *', summerInstant, 'America/New_York'), false, 'the same instant is not 09:05 in New York');
  eq(cron.cronMatches('5 9 * * *', summerInstant, 'UTC'), false, 'the same instant is not 09:05 in UTC');
  eq(cron.cronMatches('0 9 * * *', new Date('2026-01-15T08:00:00.000Z'), 'Europe/Amsterdam'), true, 'Amsterdam winter offset resolves 09:00');
  eq(cron.cronMatches('0 9 * * *', new Date('2026-07-15T07:00:00.000Z'), 'Europe/Amsterdam'), true, 'Amsterdam summer offset resolves the same 09:00 wall time');
  eq(cron.cronMatches('*/5 * * * *', summerInstant, 'UTC'), true, 'every-5-min matches minute 5');
  eq(cron.cronMatches('*/5 * * * *', new Date('2026-07-03T07:07:00.000Z'), 'UTC'), false, 'every-5-min does not match minute 7');
  eq(cron.cronMatches('59 23 31 12 *', new Date('2026-12-31T23:59:00.000Z')), true, 'valid upper field boundaries match');
  eq(cron.cronMatches('bad', summerInstant), false, 'a malformed cron never matches');
  eq(cron.cronMatches('5 9 * * *', summerInstant, 'Not/A-Timezone'), false, 'an invalid IANA timezone fails closed');
  for (const invalid of ['0-99 * * * *', '9-5 * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 7', '*/0 * * * *', '5,,10 * * * *', '5,bad * * * *', '5/2 * * * *']) {
    eq(cron.cronMatches(invalid, summerInstant), false, `invalid cron fails fully: ${invalid}`);
  }

  // ---- AgentRole registry ----
  roles.registerAgentRole({ key: 'summariser', label: 'Summariser', description: 'x', mutates: false, run: async () => ({ kind: 'summary', title: 'S', body: 'B' }) });
  assert(roles.getAgentRole('summariser') !== undefined, 'a registered role is retrievable');
  assert(roles.listAgentRoles().some((r) => r.key === 'summariser'), 'listAgentRoles includes it');

  // ---- real firing pipeline ----
  const created = await createBlankWorkspace(prisma, owner.id, 'Auto WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  //? A notify trigger on ticket.created → fires → a notification for the owner.
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Welcome', on: 'ticket.created', match: {}, action: 'notify', params: { title: 'New ticket!', body: 'auto' }, requiresApproval: false } });
  const notifyRes = await triggers.fireEvent(prisma, wsId, { on: 'ticket.created', ticketKey: 'DEV-1' });
  eq(notifyRes.fired, 1, 'the notify trigger fired');
  const notif = await poll(() => prisma.notification.findFirst({ where: { workspaceId: wsId, type: 'automation', title: 'New ticket!' } }));
  assert(notif !== null, 'the notify action created a notification');

  //? An approval-gated trigger → opens a suggestion, does NOT execute.
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Gated move', on: 'ticket.created', match: {}, action: 'emit-signal', params: { kind: 'gated' }, requiresApproval: true } });
  const beforeGatedSignals = await prisma.workspaceSignal.count({ where: { workspaceId: wsId, kind: 'gated' } });
  const gatedRes = await triggers.fireEvent(prisma, wsId, { on: 'ticket.created', ticketKey: 'DEV-2' });
  assert(gatedRes.gated >= 1, 'the approval-gated trigger was gated, not executed');
  eq(await prisma.workspaceSignal.count({ where: { workspaceId: wsId, kind: 'gated' } }), beforeGatedSignals, 'no domain signal was emitted (the action is deferred to approval)');
  const suggestion = await prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'automation', title: { contains: 'Gated move' } } });
  assert(suggestion !== null, 'a gated trigger opened an automation suggestion');

  //? Accepting the suggestion through the public Conductor path executes the direct gated body.
  await enqueueControlAction({ workspaceId: wsId, op: 'accept-suggestion', target: { suggestionId: suggestion?.id ?? '' }, payload: {}, userId: owner.id, clientRequestId: `auto-accept-${String(stamp)}` });
  eq(await prisma.workspaceSignal.count({ where: { workspaceId: wsId, kind: 'gated' } }), beforeGatedSignals + 1, 'approving the suggestion executed the deferred action');

  //? #83 — emit-signal raises a stage.on_signal EVENT: an ungated emit-signal on ticket.created + a notify on
  //? stage.on_signal → firing ticket.created chains through the signal into the on_signal notify.
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Emit sig', on: 'ticket.created', match: {}, action: 'emit-signal', params: { kind: 'chained' }, requiresApproval: false } });
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'On signal', on: 'stage.on_signal', match: {}, action: 'notify', params: { title: 'Signal landed!', body: 'chain' }, requiresApproval: false } });
  await triggers.fireEvent(prisma, wsId, { on: 'ticket.created', ticketKey: 'DEV-3' });
  const chained = await poll(() => prisma.notification.findFirst({ where: { workspaceId: wsId, title: 'Signal landed!' } }));
  assert(chained !== null, 'emit-signal queued a stage.on_signal event without deadlocking the current writer chain (#83)');

  //? fireEvent registers its workspace ingress synchronously: two ignored return values must preserve
  //? occurrence order even though the lazy InternalOp import happens after registration.
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Ordered first', on: 'ordered.event', match: { statusKeys: ['first'] }, action: 'emit-signal', params: { kind: 'ordered-first' }, requiresApproval: false } });
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Ordered second', on: 'ordered.event', match: { statusKeys: ['second'] }, action: 'emit-signal', params: { kind: 'ordered-second' }, requiresApproval: false } });
  void triggers.fireEvent(prisma, wsId, { on: 'ordered.event', status: 'first' });
  void triggers.fireEvent(prisma, wsId, { on: 'ordered.event', status: 'second' });
  const orderedSignals = await poll(async () => {
    const rows = await prisma.workspaceSignal.findMany({ where: { workspaceId: wsId, kind: { in: ['ordered-first', 'ordered-second'] } }, orderBy: { seq: 'asc' }, select: { kind: true } });
    return rows.length === 2 ? rows : null;
  });
  eq(orderedSignals?.map((signal) => signal.kind), ['ordered-first', 'ordered-second'], 'void fireEvent calls preserve occurrence order before the dynamic import');

  //? Concurrent delivery of the same dedupe-keyed event executes exactly once.
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Concurrent event', on: 'ticket.merged', match: {}, action: 'notify', params: { title: 'Concurrent once', body: 'once' }, requiresApproval: false, dedupeKey: `event-${String(stamp)}` } });
  await Promise.all([
    triggers.fireEvent(prisma, wsId, { on: 'ticket.merged', ticketKey: 'DEV-CONCURRENT' }),
    triggers.fireEvent(prisma, wsId, { on: 'ticket.merged', ticketKey: 'DEV-CONCURRENT' }),
  ]);
  eq(await prisma.notification.count({ where: { workspaceId: wsId, title: 'Concurrent once' } }), 1, 'two concurrent event deliveries execute a dedupe-keyed trigger exactly once');

  //? Concurrent cron ticks share a stable trigger+minute InternalOp id and execute exactly once.
  const cronNow = new Date();
  cronNow.setSeconds(0, 0);
  const cronTrigger = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Concurrent cron', on: 'cron', match: {}, cron: '* * * * *', action: 'notify', params: { title: 'Cron once', body: 'once' }, requiresApproval: false } });
  const concurrentCron = await Promise.all([cron.runCronTriggers(prisma, cronNow), cron.runCronTriggers(prisma, cronNow)]);
  eq(concurrentCron.reduce((sum, outcome) => sum + outcome.fired, 0), 1, 'a dedup replay without an internal result counts zero; only the execution counts fired');
  eq(await prisma.notification.count({ where: { workspaceId: wsId, title: 'Cron once' } }), 1, 'two concurrent ticks execute one stable trigger+minute InternalOp');
  const cronAfter = await prisma.workspaceTrigger.findUnique({ where: { id: cronTrigger.id }, select: { lastFiredAt: true } });
  eq(Math.floor((cronAfter?.lastFiredAt?.getTime() ?? 0) / 60_000), Math.floor(cronNow.getTime() / 60_000), 'executed cron updates lastFiredAt for that minute');

  //? Gated is a real occurrence (suggestion created) but not a fired execution. Error/noop stay retryable
  //? and therefore do not advance lastFiredAt.
  const gatedCron = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Gated cron', on: 'cron', match: {}, cron: '* * * * *', action: 'notify', params: { title: 'Must be approved', body: 'gated' }, requiresApproval: true } });
  const noopCron = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Noop cron', on: 'cron', match: {}, cron: '* * * * *', action: 'start-stage', params: { targetStageId: 'plan' }, requiresApproval: false } });
  const errorCron = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Error cron', on: 'cron', match: {}, cron: '* * * * *', action: 'webhook', params: { url: 'http://127.0.0.1/internal' }, requiresApproval: false } });
  eq((await cron.runCronTriggers(prisma, cronNow)).fired, 0, 'gated, noop and error cron outcomes do not count as fired');
  const cronStates = await prisma.workspaceTrigger.findMany({ where: { id: { in: [gatedCron.id, noopCron.id, errorCron.id] } }, select: { id: true, lastFiredAt: true } });
  const lastFired = new Map(cronStates.map((trigger) => [trigger.id, trigger.lastFiredAt]));
  assert(lastFired.get(gatedCron.id) !== null, 'gated cron updates lastFiredAt because it created a suggestion');
  eq(lastFired.get(noopCron.id), null, 'noop cron does not update lastFiredAt');
  eq(lastFired.get(errorCron.id), null, 'error cron does not update lastFiredAt');
  assert(await prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'automation', title: { contains: 'Gated cron' } } }) !== null, 'gated cron actually created its approval suggestion');

  //? The cross-tenant scan resolves each workspace timezone, while the InternalOp independently re-reads
  //? it under the writer lease so a stale scan cannot fire after a timezone edit.
  const timezoneMinute = Date.parse('2026-07-03T07:05:00.000Z');
  await prisma.workspace.update({ where: { id: wsId }, data: { timezone: 'Europe/Amsterdam' } });
  const timezoneTrigger = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Amsterdam cron', on: 'cron', match: {}, cron: '5 9 * * *', action: 'notify', params: { title: 'Amsterdam fired', body: 'timezone' }, requiresApproval: false } });
  eq((await cron.runCronTriggers(prisma, new Date(timezoneMinute))).fired, 1, 'cross-tenant cron scan matches against Workspace.timezone');
  assert(await prisma.notification.findFirst({ where: { workspaceId: wsId, title: 'Amsterdam fired' } }) !== null, 'the Amsterdam-local cron executed');
  const timezoneRevalidation = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Timezone changed', on: 'cron', match: {}, cron: '5 9 * * *', action: 'notify', params: { title: 'Must not fire after timezone edit', body: 'stale scan' }, requiresApproval: false } });
  await prisma.workspace.update({ where: { id: wsId }, data: { timezone: 'America/New_York' } });
  await enqueueInternalAction({ workspaceId: wsId, op: 'automation-cron-fire', target: { triggerId: timezoneRevalidation.id }, payload: { minuteAt: timezoneMinute }, userId: 'automation', clientRequestId: `timezone-revalidation-${String(stamp)}` });
  eq(await prisma.notification.count({ where: { workspaceId: wsId, title: 'Must not fire after timezone edit' } }), 0, 'internal cron revalidation uses the current workspace timezone');
  eq((await prisma.workspaceTrigger.findUnique({ where: { id: timezoneRevalidation.id }, select: { lastFiredAt: true } }))?.lastFiredAt, null, 'a timezone-mismatched stale tick does not advance lastFiredAt');
  assert((await prisma.workspaceTrigger.findUnique({ where: { id: timezoneTrigger.id } }))?.lastFiredAt !== null, 'the timezone-matched tick records its minute');

  //? A delayed older tick after a newer minute is a no-op: no duplicate action and no timestamp regression.
  await prisma.workspace.update({ where: { id: wsId }, data: { timezone: 'UTC' } });
  const staleTrigger = await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Stale tick', on: 'cron', match: {}, cron: '* * * * *', action: 'notify', params: { title: 'Stale tick once', body: 'once' }, requiresApproval: false } });
  const newerMinute = Date.parse('2026-07-20T10:01:00.000Z');
  const olderMinute = newerMinute - 60_000;
  await enqueueInternalAction({ workspaceId: wsId, op: 'automation-cron-fire', target: { triggerId: staleTrigger.id }, payload: { minuteAt: newerMinute }, userId: 'automation', clientRequestId: `stale-new-${String(stamp)}` });
  await enqueueInternalAction({ workspaceId: wsId, op: 'automation-cron-fire', target: { triggerId: staleTrigger.id }, payload: { minuteAt: olderMinute }, userId: 'automation', clientRequestId: `stale-old-${String(stamp)}` });
  eq(await prisma.notification.count({ where: { workspaceId: wsId, title: 'Stale tick once' } }), 1, 'a delayed older tick does not duplicate the action');
  eq((await prisma.workspaceTrigger.findUnique({ where: { id: staleTrigger.id }, select: { lastFiredAt: true } }))?.lastFiredAt?.getTime(), newerMinute, 'a delayed older tick never overwrites the newer lastFiredAt');

  //? External action invocation enters the matching writer + tenant scope before a role callback runs.
  let observedWriter: string | null = null;
  let observedTenant: string | null = null;
  roles.registerAgentRole({
    key: 'scope-probe', label: 'Scope probe', description: 'test', mutates: false,
    run: async (ctx) => {
      observedWriter = writer.currentWriterScope();
      observedTenant = tenant.currentWorkspaceId();
      return { kind: 'probe', title: 'Scoped role', body: ctx.workspaceId };
    },
  });
  const roleOutcome = await executor.executeTriggerAction(prisma, wsId, { action: 'invoke-agent-role', params: { role: 'scope-probe' } });
  eq(roleOutcome.status, 'executed', 'an external role action routes through automation-action-run');
  eq(observedWriter, wsId, 'the role callback receives the matching writer scope');
  eq(observedTenant, wsId, 'the role callback receives the matching tenant scope');

  //? A server-internal enqueue made by a role callback is reentrant on that SAME lease too; it appends
  //? its own durable signal and completes instead of waiting on the outer automation-action-run chain.
  const nestedUrl = `/media/nested-internal-${String(stamp)}.txt`;
  const nestedDocument = await prisma.document.create({ data: { workspaceId: wsId, title: 'Nested internal target', content: '', assets: [{ kind: 'file', url: nestedUrl, label: 'Nested', extractStatus: 'pending' }] } });
  const nestedInternalRequestId = `nested-internal-${String(stamp)}`;
  roles.registerAgentRole({
    key: 'nested-internal', label: 'Nested internal', description: 'test', mutates: false,
    run: async (ctx) => {
      await enqueueInternalAction({ workspaceId: ctx.workspaceId, op: 'document-set-asset-text', target: { documentId: nestedDocument.id }, payload: { url: nestedUrl, text: 'nested complete', status: 'ok' }, userId: 'automation', clientRequestId: nestedInternalRequestId });
      return null;
    },
  });
  eq((await executor.executeTriggerAction(prisma, wsId, { action: 'invoke-agent-role', params: { role: 'nested-internal' } })).status, 'executed', 'same-workspace nested InternalOp returns without deadlock');
  const nestedCompleted = await prisma.document.findUnique({ where: { id: nestedDocument.id }, select: { assets: true } });
  assert(JSON.stringify(nestedCompleted?.assets).includes('nested complete'), 'the nested InternalOp executed its authoritative completion');
  const nestedInternalSignals = await prisma.workspaceSignal.findMany({ where: { workspaceId: wsId, kind: 'document-set-asset-text' }, select: { payload: true } });
  eq(nestedInternalSignals.filter((signal) => signalRequestId(signal.payload) === nestedInternalRequestId).length, 1, 'the nested InternalOp appended one durable signal');

  //? Actual mutation helpers reject direct use without a Conductor boundary.
  const [directMutationError] = await tryCatch(() => recordFindings(prisma, wsId, [{ area: 'ux', severity: 'normal', title: 'Must reject', summary: 'outside writer' }]));
  assert(directMutationError !== null, 'a role mutation helper rejects direct use outside writer context');

  //? An already-active writer can never switch to another workspace by enqueueing around the guard.
  const [wrongWorkspaceError] = await tryCatch(() => writer.runInWriterContext(
    wsId,
    async () => tenant.runInTenant(wsId, () => executor.executeTriggerAction(prisma, `${wsId}-wrong`, { action: 'webhook', params: {} })),
  ));
  assert(wrongWorkspaceError !== null, 'an action targeting a different active writer workspace fails loudly');

  //? The same guard applies to a REAL nested enqueue from a role callback: it cannot switch the active
  //? Conductor lease/tenant to another workspace.
  otherWorkspaceId = (await createBlankWorkspace(prisma, owner.id, 'Other automation WS')).workspaceId;
  roles.registerAgentRole({
    key: 'wrong-workspace-enqueue', label: 'Wrong workspace enqueue', description: 'test', mutates: false,
    run: async () => {
      await enqueueControlAction({ workspaceId: otherWorkspaceId ?? '', op: 'rename-workspace', target: {}, payload: { name: 'Must not change' }, userId: owner.id, clientRequestId: `wrong-nested-${String(stamp)}` });
      return null;
    },
  });
  const [nestedWrongWorkspaceError] = await tryCatch(() => executor.executeTriggerAction(prisma, wsId, { action: 'invoke-agent-role', params: { role: 'wrong-workspace-enqueue' } }));
  assert(nestedWrongWorkspaceError !== null, 'a nested enqueue for another workspace fails closed');
  eq((await prisma.workspace.findUnique({ where: { id: otherWorkspaceId } }))?.name, 'Other automation WS', 'the wrong-workspace nested action did not execute');

  //? A self-re-emitting signal is queued level-by-level and stops at the recursion fuse.
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Loop source', on: 'ticket.merged', match: { statusKeys: ['loop-source'] }, action: 'emit-signal', params: { kind: 'loop-signal' }, requiresApproval: false } });
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Loop signal', on: 'stage.on_signal', match: { statusKeys: ['loop-signal'] }, action: 'emit-signal', params: { kind: 'loop-signal' }, requiresApproval: false } });
  const loopBefore = await prisma.workspaceSignal.count({ where: { workspaceId: wsId, kind: 'loop-signal' } });
  await triggers.fireEvent(prisma, wsId, { on: 'ticket.merged', ticketKey: 'DEV-LOOP', status: 'loop-source' });
  const loopCount = await poll(async () => {
    const count = await prisma.workspaceSignal.count({ where: { workspaceId: wsId, kind: 'loop-signal' } });
    return count >= loopBefore + 5 ? count : null;
  });
  eq(loopCount, loopBefore + 5, 'signal recursion queues without deadlock and stops after the bounded depth');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  roles.resetAgentRoles();
  if (otherWorkspaceId) await cleanupWorkspace(prisma, otherWorkspaceId).catch(() => undefined);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/automation.test.mts');
