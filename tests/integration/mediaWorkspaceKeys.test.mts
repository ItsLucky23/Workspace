//? Integration test for FIX-A (ADR 0091): the media registry consumes the per-workspace Settings config
//? (`save-media-provider`, ADR 0086) — the encrypted `__provider_key_<providerId>` key + the
//? `__media_provider_<feature>` override actually drive generation, not just `process.env`. Deterministic:
//? a bogus fal endpoint (127.0.0.1:9) makes the live attempt fail FAST with no external network, so we can
//? assert the dispatch LEFT the stub path (= the per-workspace key was consumed) without a real API call.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

process.env.FAL_QUEUE_BASE = 'http://127.0.0.1:9'; // unreachable — set BEFORE the fal module loads its base const

const prisma = await db();
const { encryptSecret } = await import('../../server/crypto/secretBox');
const { loadWorkspaceMediaConfig } = await import('../../server/media/workspaceKeys');
const { runMediaGeneration } = await import('../../server/media/registry');
const { falProvider } = await import('../../server/media/providers/fal');

const stamp = String(Date.now());
const owner = await prisma.user.create({ data: { email: `fixa-${stamp}@youcomm.nl`, name: 'FIX-A' } });
let workspaceId: string | null = null;
let bareWsId: string | null = null;

try {
  // ---- provider key threading (unit): an explicit key flips availability, no env needed ----
  assert(await falProvider.available('an-explicit-key'), 'a provider is available when handed an explicit key');
  assert(!(await falProvider.available()), 'a provider with no key + no env is unavailable (stub world)');

  // ---- a workspace with a stored (encrypted) key + a per-feature override ----
  const ws = await prisma.workspace.create({ data: { name: 'FIX-A WS', slug: `fixa-${stamp}`, ownerId: owner.id } });
  workspaceId = ws.id;
  await prisma.envVar.create({ data: { workspaceId: ws.id, key: '__provider_key_fal', value: encryptSecret('ws-fal-secret'), secret: true } });
  await prisma.envVar.create({ data: { workspaceId: ws.id, key: '__media_provider_image-gen', value: 'fal', secret: false } });

  const cfg = await loadWorkspaceMediaConfig(prisma, ws.id);
  eq(cfg.keys.fal, 'ws-fal-secret', 'the stored provider key decrypts back to plaintext');
  eq(cfg.overrides['image-gen'], 'fal', 'the stored per-feature override is parsed');

  // ---- Fase 5.2: an AiConnection row is now the canonical key store — it WINS over the legacy EnvVar ----
  const conn = await prisma.aiConnection.create({ data: { workspaceId: ws.id, providerId: 'fal', model: '', apiKey: encryptSecret('conn-fal-secret') } });
  const cfg2 = await loadWorkspaceMediaConfig(prisma, ws.id);
  eq(cfg2.keys.fal, 'conn-fal-secret', 'a keyed fal AiConnection overrides the legacy __provider_key_fal EnvVar');
  await prisma.aiConnection.delete({ where: { id: conn.id } });

  // ---- the registry CONSUMES it: dispatch leaves the stub path (goes live, then fails on the bogus base) ----
  const withKey = await runMediaGeneration({ feature: 'image-gen', prompt: 'a T-Rex', workspaceId: ws.id });
  assert(!withKey.stub, 'a per-workspace key flips the provider LIVE — no longer a stub');
  eq(withKey.ok, false, 'the live attempt fails (bogus endpoint) — but it was ATTEMPTED, proving the key was consumed');
  eq(withKey.providerId, 'fal', 'the override-resolved provider is fal');

  // ---- a workspace with NO stored key → stub (no env key in the deterministic test world) ----
  const bare = await prisma.workspace.create({ data: { name: 'FIX-A bare', slug: `fixa-bare-${stamp}`, ownerId: owner.id } });
  bareWsId = bare.id;
  const noKey = await runMediaGeneration({ feature: 'image-gen', prompt: 'a T-Rex', workspaceId: bare.id });
  assert(noKey.stub, 'no per-workspace key + no env → a valid-shaped stub');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  if (bareWsId) await cleanupWorkspace(prisma, bareWsId);
}

report('tests/integration/mediaWorkspaceKeys.test.mts');
