//? UI restructure — pins the navigation shape the owner asked for: ~5 top-level destinations with
//? sub-navigation, not 15 flat buttons. Structural, because this is the kind of thing that silently drifts
//? back to a flat list one "just add it to the rail" at a time.
//?
//? Also pins the two bugs the BROWSER pass caught, which no unit test would have:
//?   • the collapsed rail rendered group buttons AND every sub-item (19 icons, worse than the 15 before);
//?   • `packId` never reached the server, because the create route ENQUEUES an op rather than creating the
//?     workspace itself — so a fix written against the wrong shape silently did nothing.

import { readFileSync } from 'node:fs';

import { GROUP_ORDER, GROUP_LABELS, GROUP_ICONS, NAV_ITEMS, NAV_BOTTOM } from '../../src/workspaces/_shell/Shell.tsx';
import { WORKSPACE_PACK_CHOICES } from '../../src/workspaces/_data/packs.ts';
import { assert, eq, report } from '../_helpers.mts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------ the shape */

eq(GROUP_ORDER.length, 5, 'five top-level destinations (the owner asked for ~5, not 20)');
assert(NAV_ITEMS.length > GROUP_ORDER.length, 'and the pages live UNDER them, not beside them');

//? Every group must be complete: a label, an icon, and at least one page — a group that renders as an
//? unlabelled icon leading nowhere is exactly the "what is this?" problem this restructure fixes.
for (const group of GROUP_ORDER) {
  assert((GROUP_LABELS[group] ?? '').length > 0, `${group} has a label`);
  assert((GROUP_ICONS[group] ?? '').length > 0, `${group} has an icon`);
  assert(NAV_ITEMS.some((it) => it.group === group), `${group} has at least one page`);
}

//? Nothing may be orphaned: an item with no group would vanish from the rail entirely.
for (const item of NAV_ITEMS) {
  assert(item.group !== undefined && GROUP_ORDER.includes(item.group), `${item.id} belongs to a real group`);
}

//? Group names read as VERBS where possible — a first-time user recognises "Create" faster than "Studio".
eq(GROUP_LABELS.studio, 'Create', 'the old "Studio" is now "Create"');
eq(GROUP_LABELS.build, 'Automate', 'the old "Build" is now "Automate"');
assert(GROUP_ORDER.includes('publish'), 'publishing is its own destination — "made it" and "sent it" are different questions');

//? No group should be so large it recreates the original problem inside itself.
for (const group of GROUP_ORDER) {
  const count = NAV_ITEMS.filter((it) => it.group === group).length;
  assert(count <= 5, `${group} holds ${String(count)} pages — a group over ~5 is a wall of nouns again`);
}

eq(NAV_BOTTOM.length, 2, 'the assistant and settings stay out of the groups (they are not destinations)');

/* ------------------------------------------------------------ the collapsed-rail regression */

const shell = read('src/workspaces/_shell/Shell.tsx');
assert(shell.includes('{expanded && open && ('), 'sub-items render ONLY in the expanded rail');
assert(!shell.includes('{(open || !expanded) && ('), 'the collapsed rail no longer renders every sub-item (that made it 19 icons)');
assert(shell.includes('if ((!expanded || !open) && !holdsView && first) navigate(first.id)'), 'a collapsed group click still navigates — there is no sub-list to reveal');

/* ------------------------------------------------------------ packs reach the server */

const createRoute = read('src/workspaces/_api/createWorkspace_v1.ts');
assert(createRoute.includes('enqueueControlAction'), 'the create route enqueues an op (it does not create the workspace itself)');
assert(createRoute.includes('...(data.packId ? { packId: data.packId } : {})'), 'so packId must ride the Conductor PAYLOAD — the browser pass caught this being missing');

//? Onboarding is the FIRST screen a new user sees, and therefore the one place the pack question matters
//? most. It was initially only added to the in-app create form.
const onboarding = read('src/workspaces/_shell/Onboarding.tsx');
assert(onboarding.includes('WORKSPACE_PACK_CHOICES'), 'onboarding asks what the workspace is for');
assert(onboarding.includes('workspaces.packs.advanced'), 'and tucks the module checkboxes behind "advanced"');

//? Pack icons must exist in the icon map, or the card renders a "?" placeholder (seen in the browser).
const iconMap = read('src/workspaces/_components/Icon.tsx');
for (const choice of WORKSPACE_PACK_CHOICES) {
  assert(iconMap.includes(`'${choice.icon}'`) || iconMap.includes(`${choice.icon}:`), `pack icon '${choice.icon}' exists in the icon map`);
}
for (const group of GROUP_ORDER) {
  const icon = GROUP_ICONS[group] ?? '';
  assert(iconMap.includes(`'${icon}'`) || iconMap.includes(`${icon}:`), `group icon '${icon}' exists in the icon map`);
}

/* ------------------------------------------------------------ pack seeding order */

const seed = read('server/bootstrap/seedWorkspace.ts');
const packIndex = seed.indexOf('seedPack(');
const starterIndex = seed.indexOf('starterTickets');
assert(packIndex > starterIndex && starterIndex !== -1, 'the pack seeds AFTER the default starter tickets — seeding earlier collided with their DEV-1/DEV-2 numbering and the pack ticket vanished');

report('navStructure');
