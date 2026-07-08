//? M2 — the style rides every scene-gen request. Pure: buildSceneRequest carries the resolved style +
//? extra instructions into the media-generation request (the fix — the video path used to send no style).

import { buildSceneRequest } from '../../server/content/sceneDecompose.ts';
import { assert, eq, report } from '../_helpers.mts';

//? With a style → the request carries it (key + systemPrompt) so composeMediaPrompt applies it to the clip.
const withStyle = buildSceneRequest('a rocket launch', 3, 'ws1', { key: 'stick-man', systemPrompt: 'stick-man figures, minimalist line art' });
eq(withStyle.style?.key, 'stick-man', 'the scene request carries the style key');
assert((withStyle.style?.systemPrompt ?? '').includes('stick-man'), 'the scene request carries the style systemPrompt');
eq(withStyle.prompt, 'a rocket launch', 'the beat prompt is preserved');
eq(withStyle.label, 'Scene 3 clip', 'the scene label is set');

//? Without a style → no style field (unchanged single-prompt behaviour).
const noStyle = buildSceneRequest('a rocket launch', 1, 'ws1');
eq(noStyle.style, undefined, 'no style → the request omits style');

//? Extra instructions ride through too.
const extra = buildSceneRequest('p', 2, 'ws1', { key: 's', systemPrompt: 'x' }, 'more dramatic');
eq(extra.extraInstructions, 'more dramatic', 'extra instructions are carried');

report('tests/unit/sceneStyle.test.mts');
