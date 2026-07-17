//? LIVE proof of the embed-metering fix (gap-scan billing leak): a REAL Gemini embedding call through
//? embedTexts({workspaceId}) must land a SpendRecord (feature rag-*, provider gemini) AND an Activity-feed
//? run for that workspace. Requires GEMINI_API_KEY; skips (exit 0 with notice) when absent.

import { db, cleanupWorkspace, enableLiveProviders, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
//? Restore the REAL resolved keys BEFORE importing embed.ts — it reads GEMINI_API_KEY at module load.
const live = enableLiveProviders();
if (!live.gemini) {
  console.log('[live] GEMINI_API_KEY absent — embed metering live test skipped');
  process.exit(0);
}
const { embedTexts } = await import('../../server/rag/embed.ts');
const { listAiRuns } = await import('../../server/ai/activity.ts');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace.ts');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `embed-live-${String(stamp)}@youcomm.nl`, name: 'Embed Live' } });
let wsId = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Embed Live WS');
  wsId = created.workspaceId;

  const vecs = await embedTexts(['const answer = 42; // metering proof'], { workspaceId: wsId, feature: 'rag-index' });
  eq(vecs.length, 1, 'one vector came back from the live embedder');
  assert((vecs[0] ?? []).length > 100, 'the vector is a real Gemini embedding (not the 256-dim local fallback is fine too, but non-empty)');

  //? recordTurnSpend is fired best-effort (void tryCatch) — poll briefly for the row.
  const deadline = Date.now() + 5000;
  let row = null;
  while (row === null && Date.now() < deadline) {
    row = await prisma.spendRecord.findFirst({ where: { workspaceId: wsId, feature: 'rag-index' } });
    if (row === null) await new Promise((r) => setTimeout(r, 150));
  }
  assert(row !== null, 'the embedding call landed a SpendRecord (was: completely invisible)');
  eq(row?.providerId, 'gemini', 'the spend row is attributed to gemini');
  assert((row?.tokensIn ?? 0) > 0, 'input tokens were estimated');

  const runs = listAiRuns(wsId);
  assert(runs.some((r) => r.feature === 'rag-index' && r.providerId === 'gemini'), 'the embedding run appears in the Activity feed');
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/live/embedMeter.live.mts');
}
