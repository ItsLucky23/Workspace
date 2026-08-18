//? Sub-navigation lives in the URL, not in React state (ADR 0312).
//?
//? Before this, a page's tab and section were `useState`: /workspaces/workspace always landed on the
//? default tab, "Repository → Runtime" could not be linked or bookmarked, the back button did nothing
//? inside a page, and a refresh lost your place. The deep-link affordance ("fix it over there") needed
//? a SECOND mechanism — a focus request pushed through context that the target page had to consume and
//? clear — and when the two disagreed the user landed on the wrong tab.
//?
//? This is a structural guard because the failure mode is drift, one `useState('members')` at a time,
//? and nothing about it fails a typecheck: the page still renders, it just forgets where you were.

import { readFileSync } from 'node:fs';

import { TRAIL_ROOTS } from '../../src/workspaces/_data/nav.ts';
import { assert, eq, report } from '../_helpers.mts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------ the roots are PATHS */

//? Path prefixes, not view ids: /workspaces/content/settings resolves to the view `content` (so the
//? rail keeps highlighting Content) while being its own page with its own tabs. Matching on the path
//? keeps those two concerns apart. A root written as a bare view id would silently never match.
assert(TRAIL_ROOTS.includes('develop/pipeline'), 'a categorised view is rooted at its full path');
assert(TRAIL_ROOTS.includes('content/settings'), 'a page whose view id differs from its path is rooted at its path');
for (const root of TRAIL_ROOTS) {
  assert(!root.startsWith('/'), `${root} is relative to /workspaces`);
  assert(!root.endsWith('/'), `${root} has no trailing slash`);
}

//? Every root must be a page that EXISTS, or a deep link points at nothing.
for (const root of TRAIL_ROOTS) {
  const [error] = ((): [unknown] => { try { read(`src/workspaces/${root}/page.tsx`); return [null]; } catch (e) { return [e]; } })();
  assert(error === null, `${root} has a page.tsx`);
}

/* ------------------------------------------------------------ one mechanism, not two */

const provider = read('src/workspaces/_shell/WorkspacesProvider.tsx');
const context = read('src/workspaces/_shell/WorkspacesContext.tsx');

assert(provider.includes('trailFromPath(location.pathname)'), 'the trail is derived from the URL');
assert(!provider.includes('setSettingsFocus'), 'the parallel focus-request state is gone');
assert(!context.includes('settingsFocus'), '…and so is its context surface — one mechanism, not two');
assert(provider.includes('pathForTrail(target.view'), 'focusSetup navigates to an address rather than pushing a request');

//? A trail must never be minted for a path whose extra segments are a real nested route
//? (/develop/board/<ticketId>/editor, /content/<pieceId>), or the page would read a ticket id as a tab.
for (const forbidden of ['develop/board', 'content']) {
  assert(!TRAIL_ROOTS.includes(forbidden), `${forbidden} is NOT a trail root — its sub-paths are real routes`);
}

/* ------------------------------------------------------------ pages read the URL, not state */

//? The four pages converted in this pass. Each must validate the segment against the ids that exist,
//? so a stale bookmark or a gated-away tab lands somewhere sensible instead of rendering blank.
const PAGES = [
  'src/workspaces/workspace/page.tsx',
  'src/workspaces/settings/page.tsx',
  'src/workspaces/content/settings/page.tsx',
  'src/workspaces/develop/pipeline/page.tsx',
];
for (const page of PAGES) {
  const src = read(page);
  assert(src.includes('useTrailSegment'), `${page} reads its tab from the URL`);
  assert(!src.includes('settingsFocus'), `${page} no longer consumes a focus request`);
}

//? The settings page gates its developer tab; the URL segment must be validated against the VISIBLE
//? tabs, not all of them, or a shared link renders an empty panel for someone without that surface.
const settings = read('src/workspaces/settings/page.tsx');
assert(settings.includes('visibleTabs.map((t) => t.id)'), 'settings validates the segment against the tabs the user can actually see');

/* ------------------------------------------------------------ the hook's contract */

const sections = read('src/workspaces/_components/sections.tsx');
assert(sections.includes('ids.find((id) => id === raw) ?? fallback'), 'an unknown segment falls back rather than rendering nothing');
//? The guard is the SHAPE, not one expression: the setter builds a head of exactly `depth` entries
//? and appends the new id, so the result is depth+1 long — deeper levels are dropped (a new tab must
//? not keep the old tab's section) AND the id lands at its own index even when the levels above it
//? were still implicit. That second half was a real bug: writing depth 1 against an empty trail put
//? the tab in the stage slot, and a pipeline tab click silently did nothing.
assert(sections.includes('Array.from({ length: depth }'), 'the setter writes every level above this one, so the id lands at its own index');
assert(sections.includes('setTrail([...head, id])'), '…and nothing below it, so a new tab drops the old tab\'s section');
assert(sections.includes('prefix[i] ?? trail[i]'), 'a caller-resolved value wins over the raw URL (it has been validated against the ids that exist)');
eq(sections.includes('key={index}'), false, 'no index keys in the section index');

report('urlTrail');
