//? Integration test for the automation/plugin-engine (#2): trigger matching + debounce + cron (pure),
//? the AgentRole registry, and the real firing pipeline against Mongo — a `notify` trigger creates
//? notifications, an approval-gated trigger opens an 'automation' suggestion (NOT executed), and
//? accepting that suggestion executes the deferred action.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const triggers = await import('../../server/automation/triggers');
const cron = await import('../../server/automation/cron');
const executor = await import('../../server/automation/executor');
const roles = await import('../../server/automation/agentRoles');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(50); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `auto-${String(stamp)}@youcomm.nl`, name: 'Auto Owner' } });
let workspaceId: string | null = null;

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

  // ---- cronMatches (pure) — cron runs in LOCAL time (operator convention), so build local dates ----
  const d = new Date(2026, 6, 3, 9, 5, 0); // 09:05 local, Fri Jul 3
  eq(cron.cronMatches('* * * * *', d), true, 'all-star cron matches any minute');
  eq(cron.cronMatches('5 9 * * *', d), true, 'exact 09:05 matches');
  eq(cron.cronMatches('5 10 * * *', d), false, 'wrong hour does not match');
  eq(cron.cronMatches('*/5 * * * *', d), true, 'every-5-min matches minute 5');
  eq(cron.cronMatches('*/5 * * * *', new Date(2026, 6, 3, 9, 7, 0)), false, 'every-5-min does not match minute 7');
  eq(cron.cronMatches('bad', d), false, 'a malformed cron never matches');

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
  const beforeSig = await prisma.workspaceSignal.count({ where: { workspaceId: wsId } });
  const gatedRes = await triggers.fireEvent(prisma, wsId, { on: 'ticket.created', ticketKey: 'DEV-2' });
  assert(gatedRes.gated >= 1, 'the approval-gated trigger was gated, not executed');
  eq(await prisma.workspaceSignal.count({ where: { workspaceId: wsId } }), beforeSig, 'no signal was emitted (the action is deferred to approval)');
  const suggestion = await prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'automation' } });
  assert(suggestion !== null, 'a gated trigger opened an automation suggestion');

  //? Accepting the suggestion (its patch) executes the deferred emit-signal.
  await executor.executeGatedAction(prisma, wsId, suggestion?.patch);
  eq(await prisma.workspaceSignal.count({ where: { workspaceId: wsId } }), beforeSig + 1, 'approving the suggestion executed the deferred action');

  //? #83 — emit-signal raises a stage.on_signal EVENT: an ungated emit-signal on ticket.created + a notify on
  //? stage.on_signal → firing ticket.created chains through the signal into the on_signal notify.
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'Emit sig', on: 'ticket.created', match: {}, action: 'emit-signal', params: { kind: 'chained' }, requiresApproval: false } });
  await prisma.workspaceTrigger.create({ data: { workspaceId: wsId, enabled: true, name: 'On signal', on: 'stage.on_signal', match: {}, action: 'notify', params: { title: 'Signal landed!', body: 'chain' }, requiresApproval: false } });
  await triggers.fireEvent(prisma, wsId, { on: 'ticket.created', ticketKey: 'DEV-3' });
  const chained = await poll(() => prisma.notification.findFirst({ where: { workspaceId: wsId, title: 'Signal landed!' } }));
  assert(chained !== null, 'emit-signal fired a stage.on_signal event that ran the on_signal trigger (#83)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  roles.resetAgentRoles();
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/automation.test.mts');
