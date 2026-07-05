//? Test for the Designer style/animation AI generators — pure prompt builders + JSON parser (no DB).

import { assert, eq, report } from '../_helpers.mts';

const g = await import('../../server/designer/generateAsset');

try {
  const sp = g.buildStylePrompt('a warm premium fintech style');
  assert(sp.system.includes('```json') && sp.system.includes('radius'), 'style prompt asks for a JSON style shape');
  assert(sp.prompt.includes('a warm premium fintech style'), 'style prompt embeds the brief');

  const ap = g.buildAnimPrompt('a bouncy playful entrance');
  assert(ap.system.includes('easing') && ap.system.includes('```json'), 'anim prompt asks for a JSON anim shape');
  assert(ap.prompt.includes('a bouncy playful entrance'), 'anim prompt embeds the brief');

  const parsed = g.parseAsset('```json\n{"name":"Slate","radius":10,"border":"hairline"}\n```');
  eq(parsed.name, 'Slate', 'parseAsset reads the name');
  eq(parsed.radius, 10, 'parseAsset reads a number');
  eq(Object.keys(g.parseAsset('not json')).length, 0, 'malformed → empty object (never throws)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/designerAsset.test.mts');
