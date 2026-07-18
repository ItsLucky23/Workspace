//? DESIGN_DOCS_PROGRAM Phase 2.1 — document templates: safe section parsing, the blank skeleton, and the
//? generation structure instruction. Pure (no DB).

import { parseSections, buildSkeleton, buildTemplateStructure, builtinDocTemplate, BUILTIN_DOC_TEMPLATES } from '../../server/documents/templates.ts';
import { assert, report } from '../_helpers.mts';

/* -------------------------------------------------------------- parseSections */

const secs = parseSections([
  { heading: 'Overview', hint: 'what + why' },
  { heading: '  Requirements  ', hint: 42 },   // hint non-string → ''; heading trimmed
  { heading: '', hint: 'x' },                   // empty heading → dropped
  null, 'x', ['a'],                             // junk → dropped
]);
assert(secs.length === 2, 'only well-formed sections survive');
assert(secs[0]?.heading === 'Overview' && secs[0].hint === 'what + why', 'first section parsed');
assert(secs[1]?.heading === 'Requirements' && secs[1].hint === '', 'heading trimmed, non-string hint → empty');
assert(parseSections('nope').length === 0, 'a non-array → []');

/* -------------------------------------------------------------- builtin */

const tech = builtinDocTemplate('technical-design');
assert(tech !== null, 'the technical-design builtin exists');
assert((tech?.sections.length ?? 0) >= 6, 'technical-design has a full section set');
assert(tech?.sections.some((s) => s.heading === 'Wireframes & UX'), 'includes the vision-named wireframes section');
assert(tech?.sections.some((s) => s.heading === 'System decisions'), 'includes the vision-named system-decisions section');
assert(builtinDocTemplate('nope') === null, 'an unknown slug has no builtin');
assert(BUILTIN_DOC_TEMPLATES.length >= 1, 'at least one builtin ships');

/* -------------------------------------------------------------- buildSkeleton */

const skel = buildSkeleton('My Design', [{ heading: 'Overview', hint: 'the why' }, { heading: 'Requirements', hint: '' }]);
assert(skel.startsWith('# My Design'), 'skeleton starts with the H1 title');
assert(skel.includes('## Overview') && skel.includes('## Requirements'), 'each section becomes an H2');
assert(skel.includes('<!-- the why -->'), 'a hint becomes an author comment');
assert(!skel.includes('<!--  -->') && !skel.includes('<!-- undefined'), 'an empty hint adds no comment');

/* -------------------------------------------------------------- buildTemplateStructure */

const structure = buildTemplateStructure({ slug: 't', name: 'Tech', description: '', sections: [{ heading: 'Overview', hint: 'why' }, { heading: 'Risks', hint: 'what breaks' }] });
assert(structure.includes('## Overview') && structure.includes('## Risks'), 'structure lists every section heading');
assert(structure.includes('EXACTLY these sections'), 'structure demands the exact section set');
assert(structure.toLowerCase().includes('outline'), 'structure asks for outline-then-write');

report('documentTemplates');
