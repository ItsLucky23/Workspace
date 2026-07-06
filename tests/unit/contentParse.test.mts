//? Unit test for the live LLM parsing (M3) — server/content/jsonParse + the script/referenceVideo
//? structured parsers. No DB/network. Verifies: JSON is extracted from fenced/inline/prose responses;
//? a real model response yields structured beats; a prose response falls back to line-based beats; a
//? blueprint parses (and returns null → stub when unusable).

import { assert, eq, report } from '../_helpers.mts';

const { extractJson, coerceBeats } = await import('../../server/content/jsonParse.ts');
const { parseLiveScript } = await import('../../server/content/script.ts');
const { parseBlueprint } = await import('../../server/content/referenceVideo.ts');

// 1) extractJson — fenced, inline, prose-wrapped, invalid
{
  eq(extractJson('```json\n{"a":1}\n```'), { a: 1 }, 'fenced json');
  eq(extractJson('{"a":2}'), { a: 2 }, 'bare json');
  eq(extractJson('Sure! Here it is:\n{"a":3}\nHope that helps'), { a: 3 }, 'prose-wrapped json');
  eq(extractJson('{"s":"a } inside a string"}'), { s: 'a } inside a string' }, 'string-aware brace matching');
  eq(extractJson('no json here'), null, 'no json → null');
  eq(extractJson('{broken'), null, 'invalid json → null');
}

// 2) coerceBeats tolerates missing/blank fields
{
  const beats = coerceBeats([{ text: 'a', visualPrompt: 'shot a' }, { text: '', visualPrompt: 'x' }, { text: 'b' }, 'nope']);
  eq(beats.length, 2, 'drops blank-text + non-object entries');
  eq(beats[0], { text: 'a', visualPrompt: 'shot a' }, 'keeps a full beat');
  assert((beats[1]?.visualPrompt ?? '').includes('b'), 'synthesizes a visualPrompt when missing');
}

// 3) parseLiveScript — JSON path vs line-fallback
{
  const j = parseLiveScript('```json\n{"body":"full narration","beats":[{"text":"hook","visualPrompt":"a bold open"},{"text":"end","visualPrompt":"a calm close"}]}\n```');
  eq(j.body, 'full narration', 'script body from JSON');
  eq(j.beats.length, 2, 'two structured beats');
  eq(j.beats[0], { text: 'hook', visualPrompt: 'a bold open' }, 'first beat structured');

  const p = parseLiveScript('Line one about the topic\nLine two about it');
  eq(p.beats.length, 2, 'prose → one beat per line (fallback)');
  assert((p.beats[0]?.visualPrompt ?? '').length > 0, 'fallback synthesizes a visualPrompt');
}

// 4) parseBlueprint — JSON vs unusable
{
  const b = parseBlueprint('{"pacing":"fast","styleHint":"punchy","beats":[{"text":"hook","visualPrompt":"open"}]}');
  assert(b !== null && b.pacing === 'fast' && b.beats.length === 1, 'blueprint parsed from JSON');
  eq(parseBlueprint('no json'), null, 'no usable blueprint → null (caller falls back to stub)');
  eq(parseBlueprint('{"pacing":"x"}'), null, 'blueprint with no beats → null');
}

report('tests/unit/contentParse.test.mts');
