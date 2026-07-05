//? Test for the Designer AI theme-generation service. The PURE prompt builder + parser need no DB
//? or provider, so they run even while the DB/secret-manager is unavailable. The real generate flow
//? (generateTheme against a live provider) is exercised by the browser test after a backend restart.

import { assert, eq, report } from '../_helpers.mts';

const g = await import('../../server/designer/generateTheme');

try {
  // ---- token set ----
  eq(g.THEME_TOKENS.length, 30, 'there are 30 theme tokens');

  // ---- buildThemePrompt (pure) ----
  const p = g.buildThemePrompt('a warm, premium fintech theme');
  assert(p.system.includes('```json'), 'the prompt asks for a single JSON block');
  assert(p.system.includes('container1-hover') && p.system.includes('wrong-hover'), 'the system lists the token names');
  assert(p.prompt.includes('a warm, premium fintech theme'), 'the brief is embedded in the prompt');

  // ---- parseTheme: a complete, well-formed response ----
  const good = g.parseTheme('```json\n{"name":"Fintech Slate","description":"Cool and premium","light":{"background":"#F7F8FA","primary":"#2563EB"},"dark":{"background":"#0A0C10","primary":"#3B82F6"}}\n```', 'AI theme');
  eq(good.name, 'Fintech Slate', 'reads the name');
  eq(good.description, 'Cool and premium', 'reads the description');
  eq(good.light.background, '#F7F8FA', 'reads a provided light token');
  eq(good.dark.primary, '#3B82F6', 'reads a provided dark token');
  eq(Object.keys(good.light).length, 30, 'the light map is completed to all 30 tokens');
  eq(Object.keys(good.dark).length, 30, 'the dark map is completed to all 30 tokens');
  assert(typeof good.light['container1-hover'] === 'string' && good.light['container1-hover'].length > 0, 'an omitted token is filled from the base');

  // ---- parseTheme: unfenced raw JSON still parses ----
  const raw = g.parseTheme('{"name":"Bare","light":{"primary":"#111111"},"dark":{}}', 'AI theme');
  eq(raw.name, 'Bare', 'unfenced JSON still reads the name');
  eq(raw.light.primary, '#111111', 'unfenced JSON reads tokens');
  eq(Object.keys(raw.light).length, 30, 'unfenced JSON is still completed');

  // ---- parseTheme: garbage never throws, falls back to base + fallback name ----
  const bad = g.parseTheme('sorry, I could not do that', 'Fallback name');
  eq(bad.name, 'Fallback name', 'garbage falls back to the given name');
  eq(Object.keys(bad.light).length, 30, 'garbage still yields a complete light map');
  eq(Object.keys(bad.dark).length, 30, 'garbage still yields a complete dark map');
  assert(bad.light.background.length > 0 && bad.dark.background.length > 0, 'garbage falls back to the base tokens');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/designerTheme.test.mts');
