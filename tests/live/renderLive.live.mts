//? LIVE RENDER smoke (audit honesty fix) — proves the ONE thing the stub suite can't: that the pipeline can
//? produce a REAL, on-disk .mp4 video (not a `stub://render/...` placeholder). NOT `*.test.mts` on purpose:
//? it costs money (fal images) + needs Docker + the ffmpeg image + FAL_KEY, so it is OPT-IN
//? (run: `npx tsx tests/live/renderLive.live.mts`), never part of `npm run test`. It SKIPS cleanly (not fails)
//? when FAL_KEY or Docker/ffmpeg are absent, so it's safe to invoke anywhere.

import { db, enableLiveProviders, assert, report } from '../_helpers.mts';
import type { MediaFeature } from '../../server/media/types';

const prisma = await db();
const live = enableLiveProviders();

const { runMediaGeneration } = await import('../../server/media/registry');
const { renderTimeline } = await import('../../server/content/render');
const { dockerAvailable } = await import('../../server/container/runtime');
const { MEDIA_DIR } = await import('../../server/media/store');
const { existsSync, statSync } = await import('node:fs');
const nodePath = await import('node:path');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rl-${String(stamp)}@youcomm.nl`, name: 'RL' } });

try {
  //? Preconditions — SKIP (not fail) so this runs safely without infra.
  if (!live.fal) { console.log('[live-render] SKIP — no FAL_KEY (need real images to render).'); }
  else if (!(await dockerAvailable())) { console.log('[live-render] SKIP — Docker unavailable (render runs ffmpeg in a container).'); }
  else {
    //? 1) generate two REAL images (cheap mode, set by enableLiveProviders)
    const gen = async (prompt: string): Promise<string | null> => {
      const r = await runMediaGeneration({ feature: 'image-gen' as MediaFeature, prompt, workspaceId: owner.id });
      return r.ok && !r.stub && typeof r.url === 'string' ? r.url : null;
    };
    const a = await gen('a red cube on a white background, product shot');
    const b = await gen('a blue sphere on a white background, product shot');
    //? A present-but-non-working FAL_KEY returns a stub → SKIP (an env issue, not a code failure). This test
    //? only ASSERTS a real render when it genuinely obtained real images.
    if (a === null || b === null) { console.log('[live-render] SKIP — FAL_KEY did not return real images (invalid/quota?); cannot prove a real render.'); }
    else {
      //? 2) run the REAL render (real ffmpeg-in-Docker) over the two images
      const render = await renderTimeline({ beats: [{ imageUrl: a, durationMs: 1500 }, { imageUrl: b, durationMs: 1500 }], voiceUrl: null });
      assert(render.ok === true, `the render succeeded (error: ${render.ok ? '' : String(render.error)})`);
      const url = render.url ?? '';
      assert(url.startsWith('/media/') && !url.startsWith('stub://'), `the render produced a REAL /media url, not a stub (${url})`);
      //? 3) prove it's a real, non-empty .mp4 on disk
      const file = nodePath.join(MEDIA_DIR, url.slice('/media/'.length));
      assert(existsSync(file), 'the rendered .mp4 exists on disk');
      const bytes = existsSync(file) ? statSync(file).size : 0;
      assert(bytes > 1000, `the rendered .mp4 is a real non-trivial file (${String(bytes)} bytes)`);
      console.log(`[live-render] ✓ real video: ${url} (${String(bytes)} bytes)`);
    }
  }
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/live/renderLive.live.mts');
