//? Test the design-system doc synthesis (ADR 0034) — the pure builder that turns the active
//? theme+style into the context-doc the coding agent reads. Pure, no DB.

import { assert, report } from '../_helpers.mts';

const m = await import('../../server/designer/designSystemDoc');

try {
  const empty = m.buildDesignSystemDoc(null, null);
  assert(empty.toLowerCase().includes('no active'), 'no active theme/style → placeholder line');

  const theme = { name: 'Ocean', description: 'cool blues', content: { light: { primary: '#00aaff', background: '#ffffff' }, dark: { primary: '#0088cc' } } };
  const style = { name: 'Soft', description: 'rounded + airy', content: { radius: 16, radiusLg: 24, pill: true, border: 'none', density: 'cozy', motion: 'smooth', shadow: '0 8px 30px rgba(0,0,0,.1)', fontHeading: 'Inter', weightHeading: 700, fontBody: 'Inter' } };
  const doc = m.buildDesignSystemDoc(theme, style);

  assert(doc.includes('Ocean') && doc.includes('#00aaff') && doc.includes('#0088cc'), 'theme name + light/dark tokens rendered');
  assert(doc.includes('src/index.css'), 'the doc points the agent at src/index.css');
  assert(doc.includes('16px') && doc.includes('pill buttons') && doc.includes('Inter'), 'style rules rendered (radius/pill/font)');
  assert(!doc.includes('[object Object]'), 'no object leaks into the doc');

  //? A malformed style (object where a primitive is expected) must not crash or leak.
  const bad = m.buildDesignSystemDoc(null, { name: 'X', description: '', content: { radius: { nested: true }, border: ['a'] } });
  assert(!bad.includes('[object Object]'), 'non-primitive style fields are skipped, not stringified');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/designSystemDoc.test.mts');
