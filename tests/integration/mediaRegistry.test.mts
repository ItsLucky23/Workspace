//? Test for F0.3 (media provider abstraction + stub adapters, ADR 0052). Pure — no DB. Asserts every
//? media feature resolves to a default provider, the reference-video-analysis TEXT feature resolves to
//? Gemini, and — with NO API keys — runMediaGeneration returns a valid-SHAPED STUB asset + a declared €
//? cost (so the whole pipeline runs on dummy data + the budget guard is exercised).

import { assert, eq, report } from '../_helpers.mts';

const { runMediaGeneration } = await import('../../server/media/registry');
const { resolveMediaAssignment, defaultMediaAssignments } = await import('../../server/media/assignments');
const { resolveAssignment } = await import('../../server/ai/assignments');

//? Defaults: every media feature resolves to a provider.
eq(Object.keys(defaultMediaAssignments()).length, 9, '9 media features are assigned (incl. inpaint)');
eq(resolveMediaAssignment('image-gen'), 'fal', 'image-gen defaults to fal');
eq(resolveMediaAssignment('reference-image'), 'fal', 'reference-image (the #1 feature) defaults to fal');
eq(resolveMediaAssignment('tts'), 'elevenlabs', 'tts defaults to elevenlabs');
eq(resolveMediaAssignment('video-gen', { 'video-gen': 'elevenlabs' }), 'elevenlabs', 'a per-workspace override reassigns just that feature');

//? reference-video-analysis is a TEXT feature (returns a blueprint) on Gemini.
eq(resolveAssignment('reference-video-analysis'), 'gemini-api', 'reference-video-analysis is a text feature on gemini');

//? No keys → stub mode: a shaped asset + a declared € cost.
const img = await runMediaGeneration({ feature: 'image-gen', prompt: 'a T-Rex', style: { key: 'realistisch', systemPrompt: 'photorealistic' }, extraInstructions: 'dancing' });
assert(img.ok && img.stub, 'image-gen returns a stub result (no key)');
eq(img.providerId, 'fal', 'the stub reports the resolved provider');
eq(img.asset?.kind, 'image', 'the stub image asset has kind=image');
assert((img.asset?.url ?? '').startsWith('stub://image/'), 'the stub asset url is valid-shaped');
assert(img.costCents > 0, 'the stub declares a € cost (budget-testable)');
assert(img.asset?.metadata.style === 'realistisch', 'the style key flows into the asset metadata');
assert(img.asset?.metadata.extra === 'dancing', 'the extra instructions flow through');

//? Realistic cost magnitudes: video » image.
const vid = await runMediaGeneration({ feature: 'video-gen', prompt: 'a clip' });
assert(vid.stub && vid.costCents > img.costCents, 'video gen declares a higher stub cost than image');

//? reference-image records the reference input.
const ref = await runMediaGeneration({ feature: 'reference-image', referenceUrl: 'stub://ref/1', style: { key: 'realistisch', systemPrompt: 'x' } });
assert(ref.asset?.metadata.hasReference === true, 'reference-image records the reference input');

//? tts routes to elevenlabs + produces a voice asset.
const voice = await runMediaGeneration({ feature: 'tts', prompt: 'read this' });
eq(voice.providerId, 'elevenlabs', 'tts routes to elevenlabs');
eq(voice.asset?.kind, 'voice', 'tts produces a voice asset');

//? A provider that does not support the feature (bad override) → typed error, no crash.
const bad = await runMediaGeneration({ feature: 'tts' }, { tts: 'fal' });
assert(!bad.ok && bad.error === 'media.featureUnsupported', 'a provider that does not support the feature is rejected');

report('tests/integration/mediaRegistry.test.mts');
