//? L1 — the premade UI-look catalog. Pure: every look resolves to a real seed theme + style + font stacks,
//? unknown ids return null, and the catalog is a non-trivial starter set. No DOM, no providers.

import { PREMADE_LOOKS, resolveLook } from '../../src/workspaces/designer/premades.ts';
import { SEED_THEMES } from '../../src/workspaces/designer/themes.ts';
import { SEED_STYLES } from '../../src/workspaces/designer/styles.ts';
import { assert, report } from '../_helpers.mts';

//? A real starter set.
assert(PREMADE_LOOKS.length >= 8, `the catalog has a strong starter set (${String(PREMADE_LOOKS.length)} looks)`);

//? Every look resolves — its theme + style refs exist in the seed catalogs, and it yields concrete fonts.
const themeIds = new Set(SEED_THEMES.map((t) => t.id));
const styleIds = new Set(SEED_STYLES.map((s) => s.id));
for (const look of PREMADE_LOOKS) {
  assert(themeIds.has(look.themeId), `look "${look.id}" references a real theme (${look.themeId})`);
  assert(styleIds.has(look.styleId), `look "${look.id}" references a real style (${look.styleId})`);
  const r = resolveLook(look.id);
  assert(r !== null, `look "${look.id}" resolves`);
  assert((r?.fontHeading ?? '').length > 0 && (r?.fontBody ?? '').length > 0, `look "${look.id}" resolves concrete font stacks`);
  assert((r?.theme.light ?? null) !== null && (r?.theme.dark ?? null) !== null, `look "${look.id}" carries a light + dark palette`);
}

//? Unknown id → null (no throw).
assert(resolveLook('does-not-exist') === null, 'an unknown look id returns null');

//? Ids are unique.
assert(new Set(PREMADE_LOOKS.map((l) => l.id)).size === PREMADE_LOOKS.length, 'look ids are unique');

report('tests/unit/premades.test.mts');
