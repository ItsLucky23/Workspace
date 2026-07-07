//? LIVE-AI smoke (FIX overnight, task #37) — exercises EVERY AI-driven backend with the REAL env keys and
//? asserts REAL (non-stub) output. NOT named `*.test.mts` on purpose: it costs money + needs network, so
//? it is OPT-IN (run: `npx tsx tests/live/liveAi.live.mts`), never part of `npm run test` (ADR 0090 — the
//? default suite is the deterministic STUB world). Media runs in CHEAP mode (WS_MEDIA_CHEAP, set by
//? enableLiveProviders). Flaky-live policy: each live call retries a few times before it is a real failure.
//?
//? Coverage: gemini text (the reasoning backbone — script + every claude-cli feature forced to gemini via
//? the provider override, ADR 0007) + fal (image/reference-image/video/avatar/3d) + elevenlabs (tts/sfx) +
//? suno (music). The claude-cli PTY coding path (workspace-chat/pipeline-agent) is verified manually — it
//? bills the Max subscription + needs a login, so it is out of a headless run by design (invariant #6).

import { db, enableLiveProviders, assert, report } from '../_helpers.mts';
import type { AiFeature } from '../../server/ai/types';
import type { MediaFeature, MediaProviderId } from '../../server/media/types';

const prisma = await db();
const live = enableLiveProviders();
process.env.FAL_POLL_MAX ??= '120'; // slow fal queue models (triposr 3d) need headroom — set BEFORE the fal module loads
console.log(`[live] providers → fal:${String(live.fal)} elevenlabs:${String(live.elevenlabs)} suno:${String(live.suno)} gemini:${String(live.gemini)}`);

const { runAiCompletion } = await import('../../server/ai/registry');
const { runMediaGeneration } = await import('../../server/media/registry');

//? Retry a live call up to `attempts` times (flaky-live policy) — resolves the first success or the last value.
async function retry<T>(label: string, attempts: number, fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let last: T | null = null;
  for (let i = 1; i <= attempts; i += 1) {
    const v = await fn();
    if (ok(v)) return v;
    last = v;
    console.log(`  … ${label} attempt ${String(i)}/${String(attempts)} not-ok, retrying`);
  }
  return last as T;
}

//? Every AI text feature, mapped to the provider it must run on for a HEADLESS live test: the two
//? gemini-native features run as-is; every claude-cli feature is FORCED to gemini via the override seam
//? (proves the feature's dispatch + real generation without the subscription-billing PTY).
const TEXT_FEATURES: AiFeature[] = [
  'script', 'reference-video-analysis',                                  // gemini-native
  'docs-generate', 'dockerfile-generate', 'conflict-resolve',            // forced → gemini
  'studio-designer', 'studio-marketer', 'designer-theme', 'designer-style', 'designer-animation',
  'interviewer', 'scraper', 'mr-review', 'root-cause', 'plan-critique',
];

//? `needsRef` features are reference-conditioned (image-to-image / image-to-3D): the test chains them off
//? a freshly generated image. `bestEffort` = an environmental dependency outside our code (triposr is a
//? slow fal queue model; Suno's endpoint host is deployment-specific) — logged, not a hard failure.
const MEDIA: { feature: MediaFeature; provider: MediaProviderId; prompt: string; needsRef?: boolean; bestEffort?: boolean }[] = [
  { feature: 'image-gen', provider: 'fal', prompt: 'a small red cube on a white table, product photo' },
  { feature: 'reference-image', provider: 'fal', prompt: 'the same cube, cinematic lighting', needsRef: true },
  { feature: 'video-gen', provider: 'fal', prompt: 'a 2-second clip of a rotating red cube' },
  { feature: 'avatar', provider: 'fal', prompt: 'a friendly cartoon presenter avatar, head and shoulders' },
  { feature: 'tts', provider: 'elevenlabs', prompt: 'Hello, this is a short test.' },
  { feature: 'sfx', provider: 'elevenlabs', prompt: 'a short whoosh transition' },
  { feature: 'model-3d', provider: 'fal', prompt: 'a red cube', needsRef: true, bestEffort: true },
  { feature: 'music', provider: 'suno', prompt: 'a short upbeat synthwave loop', bestEffort: true },
];

const providerLive: Record<MediaProviderId, boolean> = { fal: live.fal, elevenlabs: live.elevenlabs, suno: live.suno };

try {
  // ---- gemini text: real, non-empty completion for every AI text feature ----
  if (!live.gemini) {
    console.log('[live] SKIP all text features — no GEMINI_API_KEY');
  } else {
    for (const feature of TEXT_FEATURES) {
      const res = await retry(`text:${feature}`, 3,
        () => runAiCompletion(feature, { prompt: `In one short sentence, confirm you are working. (feature: ${feature})`, label: `live-${feature}` }, { [feature]: 'gemini-api' }),
        (r) => r.ok && r.text.trim().length > 0);
      assert(res.ok && res.text.trim().length > 0, `text feature ${feature} → real gemini completion (${res.providerId}, ${String(res.text.trim().length)} chars)`);
    }
  }

  // ---- media: real, non-stub asset for every media feature whose provider is keyed ----
  //? A reference image the reference-conditioned features (reference-image, model-3d) chain off.
  let refImageUrl = '';
  for (const m of MEDIA) {
    if (!providerLive[m.provider]) { console.log(`[live] SKIP ${m.feature} — no ${m.provider} key`); continue; }
    if (m.needsRef && refImageUrl.length === 0) { console.log(`[live] SKIP ${m.feature} — no reference image was produced`); continue; }
    const res = await retry(`media:${m.feature}`, m.bestEffort ? 2 : 3,
      () => runMediaGeneration({ feature: m.feature, prompt: m.prompt, ...(m.needsRef ? { referenceUrl: refImageUrl } : {}) }),
      (r) => r.ok && !r.stub && (r.asset?.url ?? '').length > 0);
    const real = res.ok && !res.stub && (res.asset?.url ?? '').length > 0 && !(res.asset?.url ?? '').startsWith('stub://');
    if (m.bestEffort && !real) {
      //? Environmental (slow model / deployment-specific endpoint), not a code defect — log, don't fail.
      console.log(`[live] BEST-EFFORT ${m.feature} did NOT complete live (err=${res.error ?? 'timeout'}). Submitted OK; see notes.`);
      continue;
    }
    assert(real, `media feature ${m.feature} → REAL ${m.provider} asset (not stub)`);
    if (m.feature === 'image-gen') refImageUrl = res.asset?.url ?? '';
  }
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  await prisma.$disconnect().catch(() => undefined);
}

report('tests/live/liveAi.live.mts');
