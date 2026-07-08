//? L3 — import validation + copy-to-workspace payloads. Pure: a valid theme/style JSON is accepted, garbage
//? is refused, and a premade look converts into saveable artifacts that themselves pass validation (so
//? "save a copy" always round-trips). No DOM, no providers.

import { validArtifactContent } from '../../src/workspaces/designer/persisted.ts';
import { lookToArtifacts, resolveLook, PREMADE_LOOKS } from '../../src/workspaces/designer/premades.ts';
import { SEED_THEMES } from '../../src/workspaces/designer/themes.ts';
import { SEED_STYLES } from '../../src/workspaces/designer/styles.ts';
import { assert, report } from '../_helpers.mts';

const seedTheme = SEED_THEMES[0];
const seedStyle = SEED_STYLES[0];

//? A full token-set theme is valid; a half-set one is refused.
assert(validArtifactContent('theme', { light: seedTheme?.light, dark: seedTheme?.dark }) === true, 'a complete theme JSON validates');
assert(validArtifactContent('theme', { light: { background: '#fff' } }) === false, 'a half-set theme JSON is refused');
assert(validArtifactContent('theme', 'not-an-object') === false, 'a non-object theme is refused');

//? A style object validates; a non-object is refused; an unknown kind is refused.
assert(validArtifactContent('style', seedStyle) === true, 'a style JSON validates');
assert(validArtifactContent('style', 42) === false, 'a non-object style is refused');
assert(validArtifactContent('animation', { fade: true, duration: 0.3 }) === true, 'an animation JSON validates');
assert(validArtifactContent('nonsense', {}) === false, 'an unknown kind is refused');

//? L3 tightening — an EMPTY or unrelated object must NOT pass as a style/anim (the coercion is all-defaults,
//? so without a field-presence gate any object would be "valid" and poison the library).
assert(validArtifactContent('style', {}) === false, 'an empty object is NOT a valid style');
assert(validArtifactContent('style', { foo: 1, bar: 2 }) === false, 'an unrelated object is NOT a valid style');
assert(validArtifactContent('animation', {}) === false, 'an empty object is NOT a valid animation');
assert(validArtifactContent('animation', { nope: true }) === false, 'an unrelated object is NOT a valid animation');
assert(validArtifactContent('style', { radius: 8, fontHeading: 'x', shadow: 'none' }) === true, 'a partial-but-recognizable style validates');

//? A premade look → saveable artifacts (theme + style) that each pass validation.
for (const l of PREMADE_LOOKS) {
  const r = resolveLook(l.id);
  if (!r) continue;
  const arts = lookToArtifacts(r);
  assert(arts.length === 2, `look "${l.id}" yields a theme + a style artifact`);
  for (const a of arts) assert(validArtifactContent(a.kind, a.content, a.name) === true, `look "${l.id}" ${a.kind} artifact is valid + saveable`);
}

report('tests/unit/designerImport.test.mts');
