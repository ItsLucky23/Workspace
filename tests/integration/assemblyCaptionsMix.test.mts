//? F2 integration — assembleContent wires the beat-slideshow audio MIX (voice + ducked music) into the ffmpeg
//? plan, and emits REAL-timed .srt/.vtt captions anchored to the (injected-ffprobe) voice length. Uses an
//? injected ffmpeg runner (captures the plan + writes the output so the render "succeeds") + an injected probe
//? — no Docker/keys. Creates + cleans up its own data + the dummy media files it writes.

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { assembleContent } = await import('../../server/content/assembly');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { persistMediaBytes, MEDIA_DIR } = await import('../../server/media/store');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cap-${String(stamp)}@youcomm.nl`, name: 'Cap' } });
let workspaceId: string | null = null;
const written: string[] = [];
const track = (url: string): string => { written.push(path.join(MEDIA_DIR, url.slice('/media/'.length))); return url; };

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Cap WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const devProject = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: devProject?.id ?? '', title: 'Caption Piece' } });

  //? Real dummy media files so localizeAsset resolves them (existsSync under MEDIA_DIR).
  const voiceUrl = track(persistMediaBytes(Buffer.from('voice'), 'mp3', `${String(stamp)}-voice`).url);
  const musicUrl = track(persistMediaBytes(Buffer.from('music'), 'mp3', `${String(stamp)}-music`).url);
  const imgUrl = track(persistMediaBytes(Buffer.from('img'), 'png', `${String(stamp)}-img`).url);

  const image = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'image', url: imgUrl, status: 'ready' } });
  await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'voice', url: voiceUrl, status: 'ready' } });
  await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'music', url: musicUrl, status: 'ready' } });

  const script = await prisma.script.create({ data: { workspaceId: wsId, contentProjectId: piece.id, body: 'Hook. Payoff.' } });
  //? Two beats, 2000ms each → estimated total 4000ms; the injected probe reports 6000ms → the captions scale ×1.5.
  await prisma.beat.create({ data: { workspaceId: wsId, scriptId: script.id, contentProjectId: piece.id, order: 0, text: 'Hook line', visualPrompt: 'x', durationMs: 2000, imageAssetId: image.id } });
  await prisma.beat.create({ data: { workspaceId: wsId, scriptId: script.id, contentProjectId: piece.id, order: 1, text: 'Payoff line', visualPrompt: 'y', durationMs: 2000, imageAssetId: image.id } });

  //? Inject the ffmpeg runner (capture the plan + write the output mp4 so the render "succeeds") + the ffprobe.
  let capturedArgs: string[] = [];
  const res = await assembleContent(prisma, { workspaceId: wsId, contentProjectId: piece.id }, {
    run: async (a) => {
      //? F4/F2 — the render now triggers follow-up ffmpeg passes (poster-frame, optional caption mux); capture
      //? the FIRST call (the render plan itself) so this assertion still inspects the render, not a later pass.
      if (capturedArgs.length === 0) capturedArgs = a;
      const out = a[a.length - 1]; // /media/<id>.mp4
      const id = out.slice('/media/'.length).replace(/\.mp4$/, '');
      track(persistMediaBytes(Buffer.from('mp4'), 'mp4', id).url);
      return { code: 0, err: '' };
    },
    probe: async () => '6.000000',
  });

  // 1) the beat-path plan carries the audio MIX (music present) — the audit's "voice + music can't render" gap.
  const joined = capturedArgs.join(' ');
  assert(joined.includes(`-i /media/${String(stamp)}-voice.mp3`) && joined.includes(`-i /media/${String(stamp)}-music.mp3`), 'voice + music are both ffmpeg inputs on the beat path');
  assert(joined.includes('amix=inputs=2'), 'the beat-slideshow render mixes voice + music (was voice-only before F2)');
  assert(res.ok && res.stub === false, 'the render succeeded (real, non-stub)');

  // 2) captions were emitted with REAL timing anchored to the probed 6000ms (est 4000 × 1.5).
  const asset = await prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: piece.id, kind: 'render' }, orderBy: { createdAt: 'desc' } });
  const meta = (asset?.metadata ?? {}) as Record<string, unknown>;
  const srtUrl = typeof meta.captionsSrtUrl === 'string' ? meta.captionsSrtUrl : '';
  const vttUrl = typeof meta.captionsVttUrl === 'string' ? meta.captionsVttUrl : '';
  assert(srtUrl.endsWith('.srt') && vttUrl.endsWith('.vtt'), 'the render asset metadata carries .srt + .vtt caption urls');
  track(srtUrl); track(vttUrl);

  const srt = readFileSync(path.join(MEDIA_DIR, srtUrl.slice('/media/'.length)), 'utf8');
  assert(srt.includes('Hook line') && srt.includes('Payoff line'), 'the srt carries both beat texts');
  assert(srt.includes('00:00:03,000') && srt.includes('00:00:06,000'), 'timings are scaled to the probed 6s voice length (2000ms → 3000ms each)');
  assert(!srt.includes('00:00:04,000'), 'the un-scaled 4s estimate is NOT used (proves the ffprobe anchor)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  for (const f of written) { if (existsSync(f)) { try { unlinkSync(f); } catch { /* best-effort */ } } }
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/assemblyCaptionsMix.test.mts');
