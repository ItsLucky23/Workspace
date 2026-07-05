//? Test for the Studio generation service (design + marketing tool). The PURE prompt builders +
//? artifact parsers need no DB, so they run even while the DB/secret-manager is unavailable. The
//? real store flow (generateArtifact against a live provider) is exercised by the browser test.

import { assert, eq, report } from '../_helpers.mts';

const g = await import('../../server/studio/generate');

const brief = { productName: 'Acme To-Do', audience: 'busy founders', tone: 'bold, playful', goals: 'sign-ups', notes: 'freemium' };

try {
  // ---- buildPrompt (pure) ----
  const landing = g.buildPrompt('landing', brief);
  assert(landing.system.includes('HTML') && landing.system.includes('```html'), 'landing prompt asks for a single HTML block');
  assert(landing.prompt.includes('Acme To-Do') && landing.prompt.includes('busy founders'), 'landing prompt embeds the brief');
  const copy = g.buildPrompt('copy', brief);
  assert(copy.system.includes('```json') && copy.system.includes('sections'), 'copy prompt asks for a JSON sections shape');
  const brand = g.buildPrompt('brand', brief);
  assert(brand.system.includes('palette') && brand.system.includes('```json'), 'brand prompt asks for a JSON palette shape');
  const strategy = g.buildPrompt('strategy', brief);
  assert(strategy.system.toLowerCase().includes('markdown'), 'strategy prompt asks for markdown');
  assert(strategy.prompt.includes('freemium'), 'the optional notes flow into the prompt');

  // ---- parseArtifact (pure) ----
  const lp = g.parseArtifact('landing', 'Here you go:\n```html\n<!doctype html><h1>Acme</h1>\n```\ndone');
  eq((lp.content.html as string).includes('<h1>Acme</h1>'), true, 'landing parse extracts the HTML block');
  const lpRaw = g.parseArtifact('landing', '<!doctype html><h1>NoFence</h1>');
  eq((lpRaw.content.html as string).includes('NoFence'), true, 'landing parse falls back to the raw text when unfenced');

  const cp = g.parseArtifact('copy', '```json\n{"sections":[{"channel":"Headlines","items":["A","B"]}]}\n```');
  const sections = cp.content.sections as { channel: string; items: string[] }[];
  eq(sections[0]?.channel, 'Headlines', 'copy parse reads the JSON sections');
  eq(sections[0]?.items.length, 2, 'copy parse reads the items');

  const bp = g.parseArtifact('brand', '```json\n{"palette":[{"name":"Ink","hex":"#111"}],"voice":"bold"}\n```');
  eq((bp.content.voice as string), 'bold', 'brand parse reads the JSON');

  const sp = g.parseArtifact('strategy', '## Positioning\n- point one');
  eq((sp.content.markdown as string).includes('## Positioning'), true, 'strategy parse keeps the markdown');

  const bad = g.parseArtifact('copy', 'not json at all');
  assert(typeof bad.content.raw === 'string', 'malformed JSON falls back to a raw shape (never throws)');

  // ---- KIND_META wiring (roles + provider features) ----
  eq(g.KIND_META.landing.role, 'designer', 'landing is a designer artifact');
  eq(g.KIND_META.copy.role, 'marketer', 'copy is a marketer artifact');
  eq(g.KIND_META.landing.feature, 'studio-designer', 'landing resolves to the studio-designer provider feature');
  eq(g.KIND_META.strategy.feature, 'studio-marketer', 'strategy resolves to the studio-marketer provider feature');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/studio.test.mts');
