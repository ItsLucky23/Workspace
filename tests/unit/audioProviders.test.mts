//? Unit test for the REAL ElevenLabs (voice/sfx) + Suno (music) adapters (M2). No key, no network —
//? the transports are injected with fixtures. Verifies: the ElevenLabs input is composed (text + voice)
//? and the produced asset is a voice/sfx asset with a url + cost; Suno produces a music asset from a
//? hosted url; failures are typed; `available()` gates on the respective keys (stub-fallback intact).

import { assert, eq, report } from '../_helpers.mts';

const { composeElevenInput, createElevenlabsProvider } = await import('../../server/media/providers/elevenlabs.ts');
const { createSunoProvider } = await import('../../server/media/providers/suno.ts');

// 1) ElevenLabs input composition
{
  const input = composeElevenInput({ feature: 'tts', prompt: 'hello world', style: { key: 'calm', systemPrompt: 'a calm narrator' }, params: { voiceId: 'Bella' } });
  eq(input.text, 'a calm narrator. hello world', 'tts text = style + prompt');
  eq(input.voiceId, 'Bella', 'voiceId from params override');
}

// 2) ElevenLabs generate() over a fixture transport (voice + sfx)
{
  let capturedFeature = '';
  const eleven = createElevenlabsProvider({
    generate: async (feature) => { capturedFeature = feature; return { url: '/media/abc.mp3' }; },
  });
  const tts = await eleven.generate({ feature: 'tts', prompt: 'narrate this' });
  assert(tts.ok && tts.asset?.kind === 'voice', 'tts → a voice asset');
  eq(tts.asset?.url, '/media/abc.mp3', 'voice asset url from the transport');
  assert(!tts.stub && tts.costCents > 0, 'live, metered');
  eq(capturedFeature, 'tts', 'the transport got the tts feature');

  const sfx = await eleven.generate({ feature: 'sfx', prompt: 'a whoosh' });
  assert(sfx.ok && sfx.asset?.kind === 'sfx', 'sfx → an sfx asset');

  const bad = await eleven.generate({ feature: 'image-gen', prompt: 'x' });
  assert(!bad.ok && bad.error === 'media.featureUnsupported', 'elevenlabs rejects a non-audio feature');
}

// 3) ElevenLabs transport failure → typed error
{
  const eleven = createElevenlabsProvider({ generate: async () => { throw new Error('429'); } });
  const r = await eleven.generate({ feature: 'tts', prompt: 'x' });
  assert(!r.ok && (r.error ?? '').startsWith('media.elevenlabsFailed'), 'a transport throw → media.elevenlabsFailed');
}

// 4) Suno music
{
  let capturedPrompt = '';
  const suno = createSunoProvider({ generate: async (prompt) => { capturedPrompt = prompt; return { url: 'https://cdn.suno/clip.mp3' }; } });
  const music = await suno.generate({ feature: 'music', prompt: 'a lofi beat', style: { key: 'chill', systemPrompt: 'chill lofi' } });
  assert(music.ok && music.asset?.kind === 'music', 'music → a music asset');
  eq(music.asset?.url, 'https://cdn.suno/clip.mp3', 'music asset url (hosted, no persistence)');
  eq(capturedPrompt, 'chill lofi. a lofi beat', 'suno prompt composed with the style');
  assert(music.costCents > 0, 'metered');

  const bad = await suno.generate({ feature: 'tts', prompt: 'x' });
  assert(!bad.ok && bad.error === 'media.featureUnsupported', 'suno rejects a non-music feature');

  const failing = createSunoProvider({ generate: async () => { throw new Error('boom'); } });
  const r = await failing.generate({ feature: 'music', prompt: 'x' });
  assert(!r.ok && (r.error ?? '').startsWith('media.sunoFailed'), 'a suno transport throw → media.sunoFailed');
}

// 5) available() gates on keys
{
  const eleven = createElevenlabsProvider({ generate: async () => ({ url: '' }) });
  const suno = createSunoProvider({ generate: async () => ({ url: '' }) });
  const prevE = process.env.ELEVENLABS_KEY;
  const prevS = process.env.SUNO_KEY;
  delete process.env.ELEVENLABS_KEY; delete process.env.SUNO_KEY;
  eq(await eleven.available(), false, 'no ELEVENLABS_KEY → not available');
  eq(await suno.available(), false, 'no SUNO_KEY → not available');
  process.env.ELEVENLABS_KEY = 'k'; process.env.SUNO_KEY = 'k';
  eq(await eleven.available(), true, 'ELEVENLABS_KEY set → available');
  eq(await suno.available(), true, 'SUNO_KEY set → available');
  if (prevE === undefined) delete process.env.ELEVENLABS_KEY; else process.env.ELEVENLABS_KEY = prevE;
  if (prevS === undefined) delete process.env.SUNO_KEY; else process.env.SUNO_KEY = prevS;
}

report('tests/unit/audioProviders.test.mts');
