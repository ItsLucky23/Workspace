//? Test for FREEDOM_PROGRAM X2 (outbound half) — the webhook automation action. Verifies executeTriggerAction
//? POSTs a compact event envelope to the configured URL (captured via the injectable poster), returns the
//? right outcome on success / failure / missing-or-bad url. Real Mongo (executor reads no rows for webhook).

import type { ExecOutcome, TriggerAction } from '../../server/automation/executor';
import { db, assert, eq, report } from '../_helpers.mts';

const executor = await import('../../server/automation/executor');
const { runInWriterContext } = await import('../../server/orchestrator/writerContext');
const { runInTenant } = await import('../../server/tenant/tenantContext');
await db();

const directExecute = (action: TriggerAction): Promise<ExecOutcome> =>
  runInWriterContext('ws-1', async () => runInTenant('ws-1', () => executor.executeTriggerAction({} as never, 'ws-1', action)));

let captured: { url: string; body: string } | null = null;
executor.__setWebhookPoster(async (url, body) => { captured = { url, body }; return { ok: true, status: 200 }; });

// happy path — posts the envelope
{
  captured = null;
  const out = await directExecute({ action: 'webhook', params: { url: 'https://example.com/hook', payload: { foo: 1 } }, ticketKey: 'DEV-2', triggerName: 'On done' });
  eq(out.status, 'executed', 'a valid webhook posts + reports executed');
  assert(captured !== null, 'the poster was called');
  const cap = captured as unknown as { url: string; body: string };
  eq(cap.url, 'https://example.com/hook', 'posted to the configured url');
  const env = JSON.parse(cap.body);
  eq(env.event, 'On done', 'the envelope carries the trigger name');
  eq(env.ticketKey, 'DEV-2', 'the envelope carries the ticket key');
  eq(env.workspaceId, 'ws-1', 'the envelope carries the workspace id');
  assert(env.payload?.foo === 1, 'the custom payload passes through');
}

// missing / non-http url → noop, no post
{
  captured = null;
  eq((await directExecute({ action: 'webhook', params: {} })).status, 'noop', 'no url → noop');
  eq((await directExecute({ action: 'webhook', params: { url: 'ftp://x' } })).status, 'noop', 'non-http url → noop');
  assert(captured === null, 'nothing was posted for a bad url');
}

// poster failure → error outcome, never throws
{
  executor.__setWebhookPoster(async () => ({ ok: false, status: 500 }));
  eq((await directExecute({ action: 'webhook', params: { url: 'https://example.com/hook' } })).status, 'error', 'a non-2xx → error');
  executor.__setWebhookPoster(async () => { throw new Error('network'); });
  eq((await directExecute({ action: 'webhook', params: { url: 'https://example.com/hook' } })).status, 'error', 'a thrown poster → error (never throws out)');
}

report('tests/integration/webhookAction.test.mts');
