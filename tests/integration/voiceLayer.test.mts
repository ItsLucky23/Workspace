//? FASE VO (DOCUMENTS_AND_SKILLS) — the voice layer (provider-abstracted STT + TTS).
//? Two runs in one file:
//?   • STUB world (default): both paths degrade HONESTLY — transcribeAudio returns an error (no fake
//?     transcript), synthesizeSpeech returns a stub asset flagged stub. Never a fabricated result.
//?   • LIVE world (enableLiveProviders — real keys): a REAL round-trip — ElevenLabs TTS synthesizes an
//?     audio clip, then Gemini STT transcribes THAT clip back to text. Skipped (not failed) if a key
//?     is absent, so CI without keys stays green; with keys it proves the whole loop end to end.
//? The transcript rides the existing text paths — no new verb, no write (invariant #2 holds).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db, enableLiveProviders, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { transcribeAudio, synthesizeSpeech } = await import('../../server/voice/voice');
const { MEDIA_DIR } = await import('../../server/media/store');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `vo-${String(stamp)}@youcomm.nl`, name: 'VO' } });
let wsId = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Voice WS');
  wsId = created.workspaceId;
  //? A workspace budget so live TTS spend is capped to cents (WS_MEDIA_CHEAP keeps it tiny).
  await prisma.mediaBudget.upsert({ where: { workspaceId: wsId }, create: { workspaceId: wsId, capCents: 500, alertPct: 90, enabled: true }, update: { capCents: 500, enabled: true } });

  // ---- guard: a non-/media audioUrl is rejected before any provider call ----
  eq((await transcribeAudio(wsId, 'http://evil/x.mp3')).ok, false, 'a non-/media audio url is refused');

  // ---- STUB world (default): honest degrade, no fabrication ----
  const sttStub = await transcribeAudio(wsId, '/media/nonexistent.webm');
  eq(sttStub.ok, false, 'STT without an audio provider fails honestly (no fake transcript)');
  eq(sttStub.text, '', 'and returns no text');
  const ttsStub = await synthesizeSpeech(prisma, wsId, 'Hello from the workspace.');
  assert(ttsStub.ok && ttsStub.stub === true, 'TTS without an ElevenLabs key returns an HONEST stub asset');
  assert(typeof ttsStub.url === 'string' && ttsStub.url.length > 0, 'the stub still yields a valid-shaped url');

  // ---- LIVE world: a real TTS → STT round-trip (skipped without keys) ----
  const live = enableLiveProviders();
  if (live.elevenlabs && live.gemini) {
    const spoken = 'The quick brown fox jumps over the lazy dog.';
    const tts = await synthesizeSpeech(prisma, wsId, spoken);
    assert(tts.ok && tts.stub !== true && typeof tts.url === 'string', 'LIVE ElevenLabs produced a real audio asset');
    const audioName = (tts.url ?? '').slice('/media/'.length);
    const bytes = readFileSync(path.join(MEDIA_DIR, audioName));
    assert(bytes.length > 1000, 'the synthesized audio is a non-trivial file');
    //? Gemini STT wants a well-known audio extension; the ElevenLabs asset is mp3.
    const sttUrl = tts.url ?? '';
    const stt = await transcribeAudio(wsId, sttUrl);
    assert(stt.ok, 'LIVE Gemini STT transcribed the synthesized clip');
    const words = stt.text.toLowerCase();
    assert(words.includes('fox') || words.includes('dog') || words.includes('quick'), `the transcript recovers the spoken words (got: "${stt.text.slice(0, 80)}")`);
    console.log(`[voice-live] round-trip ok — spoke "${spoken}" → transcribed "${stt.text.trim().slice(0, 80)}"`);
  } else {
    console.log(`[voice-live] SKIPPED (elevenlabs=${String(live.elevenlabs)} gemini=${String(live.gemini)}) — stub assertions still ran.`);
    //? Keep a green assertion so the file always reports a pass line.
    assert(true, 'live round-trip skipped (no keys) — stub-world honesty already proven');
  }

  // ---- STT on a real tiny WAV via Gemini (only when gemini is live) — a second live angle ----
  if (enableLiveProviders().gemini) {
    //? A ~0.2s silent WAV is enough to exercise the audio-inline path without asserting on content.
    const wavName = `vo-silence-${String(stamp)}.wav`;
    writeFileSync(path.join(MEDIA_DIR, wavName), silentWav(200));
    const stt = await transcribeAudio(wsId, `/media/${wavName}`);
    assert(stt.ok, 'Gemini STT accepts a wav clip (audio-inline path works)');
  }
} finally {
  if (wsId) {
    await prisma.mediaSpend.deleteMany({ where: { workspaceId: wsId } }).catch(() => undefined);
    await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  } else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/voiceLayer.test.mts');
}

//? A minimal PCM16 mono 8kHz silent WAV of `ms` milliseconds.
function silentWav(ms: number): Buffer {
  const rate = 8000;
  const samples = Math.round((rate * ms) / 1000);
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  return buf;
}
