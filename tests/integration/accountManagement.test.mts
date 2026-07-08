//? A1+A2 — social-account management, end-to-end against the REAL Mongo. A1: the re-keyed connection store
//? holds MULTIPLE accounts per platform (was one). A2: channel-create/edit/delete + account-disconnect ops.
//? Fixtures for the tokens (no real OAuth apps — user decision). Cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { saveConnection, getConnection, tokenKey } = await import('../../server/content/publishOAuth');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `am-${String(stamp)}@youcomm.nl`, name: 'AM' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'AM WS' }, userId: owner.id, clientRequestId: `am-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  // ---- A1: MULTIPLE YouTube accounts stored separately (the re-key) --------------------------------
  eq(tokenKey('youtube'), '__publish_youtube', 'the legacy key is unchanged (default account)');
  eq(tokenKey('youtube', 'main'), '__publish_youtube_main', 'an accountId yields a distinct per-account key');
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'tok-main' }, 'main');
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'tok-second' }, 'second');
  const a1 = await getConnection(prisma, wsId, 'youtube', 'main');
  const a2 = await getConnection(prisma, wsId, 'youtube', 'second');
  eq(a1?.accessToken, 'tok-main', 'account "main" retrieves its own token');
  eq(a2?.accessToken, 'tok-second', 'account "second" retrieves its own token (no overwrite)');

  // ---- A2: channel CRUD -----------------------------------------------------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'channel-create', target: {}, payload: { name: 'My YT', platform: 'youtube', handle: '@myyt', brandVoice: 'upbeat, concise' }, userId: owner.id, clientRequestId: `am-cc-${String(stamp)}` });
  const channel = await poll(() => prisma.channel.findFirst({ where: { workspaceId: wsId, name: 'My YT' } }));
  assert(channel !== null, 'channel-create makes a channel');
  eq(channel?.platform, 'youtube', 'the channel carries its platform');

  await enqueueControlAction({ workspaceId: wsId, op: 'channel-edit', target: {}, payload: { channelId: channel?.id ?? '', name: 'My YouTube', brandVoice: 'calm, expert' }, userId: owner.id, clientRequestId: `am-ce-${String(stamp)}` });
  const edited = await poll(async () => { const c = await prisma.channel.findUnique({ where: { id: channel?.id ?? '' } }); return c && c.name === 'My YouTube' ? c : null; });
  eq(edited?.brandVoice, 'calm, expert', 'channel-edit updates the fields');

  //? The snapshot surfaces the channel + the connected accounts.
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  assert(snap.content.channels.some((c) => c.id === channel?.id), 'the channel is in the snapshot');

  //? account-disconnect removes one account's token; the other survives.
  await enqueueControlAction({ workspaceId: wsId, op: 'account-disconnect', target: {}, payload: { platform: 'youtube', accountId: 'main' }, userId: owner.id, clientRequestId: `am-ad-${String(stamp)}` });
  const gone = await poll(async () => { const c = await getConnection(prisma, wsId, 'youtube', 'main'); return c === null ? 'gone' : null; });
  eq(gone, 'gone', 'account-disconnect removes that account');
  const stillThere = await getConnection(prisma, wsId, 'youtube', 'second');
  eq(stillThere?.accessToken, 'tok-second', 'the other account survives the disconnect');

  await enqueueControlAction({ workspaceId: wsId, op: 'channel-delete', target: {}, payload: { channelId: channel?.id ?? '' }, userId: owner.id, clientRequestId: `am-cd-${String(stamp)}` });
  const deleted = await poll(async () => { const c = await prisma.channel.findUnique({ where: { id: channel?.id ?? '' } }); return c === null ? 'gone' : null; });
  eq(deleted, 'gone', 'channel-delete removes the channel');
  console.log(`[am] ✓ multi-account + channel CRUD + disconnect`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/accountManagement.test.mts');
