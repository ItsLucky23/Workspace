//? DESIGN_DOCS_PROGRAM 3.5 — LIVE web-discovery through the real AI provider: from a design brief the AI
//? suggests real, distinct reference sites. Skips gracefully when no provider key resolves.

import { db, enableLiveProviders, assert, report } from '../_helpers.mts';

await db();
const live = enableLiveProviders();
const { discoverReferenceSites } = await import('../../server/designer/webDiscovery');

if (!live.gemini && !live.fal && !live.suno && !live.elevenlabs) {
  console.log('  (skipped — no provider key resolved)');
  report('webDiscoveryLive');
} else {
  const sites = await discoverReferenceSites('premium minimal fintech dashboard UI', 5);
  assert(sites.length >= 2, `LIVE: discovery returned candidate reference sites (got ${String(sites.length)})`);
  assert(sites.every((s) => /^https?:\/\//.test(s.url)), 'LIVE: every candidate is a real http(s) URL');
  assert(new Set(sites.map((s) => s.url)).size === sites.length, 'LIVE: candidates are distinct');
  for (const s of sites.slice(0, 5)) console.log(`   • ${s.url} — ${s.title.slice(0, 60)}`);
  report('webDiscoveryLive');
}
