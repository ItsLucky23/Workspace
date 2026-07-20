//? Nav IA — pins the MODULE-BASED navigation shape the owner decided (ADR 0280): three top-level
//? categories (Develop / Content / Insights) that mirror the folder structure under src/workspaces/
//? AND the URL space, with sub-navigation per category. Structural, because this is the kind of thing
//? that silently drifts back to a flat list one "just add it to the rail" at a time.
//?
//? Also pins the two bugs the BROWSER pass caught, which no unit test would have:
//?   • the collapsed rail rendered group buttons AND every sub-item (19 icons, worse than the 15 before);
//?   • `packId` never reached the server, because the create route ENQUEUES an op rather than creating the
//?     workspace itself — so a fix written against the wrong shape silently did nothing.

import { readFileSync } from 'node:fs';

import { GROUP_ORDER, GROUP_LABELS, GROUP_ICONS, NAV_ITEMS, NAV_BOTTOM } from '../../src/workspaces/_shell/Shell.tsx';
import { VIEW_CATEGORY } from '../../src/workspaces/_data/nav.ts';
import { WORKSPACE_PACK_CHOICES } from '../../src/workspaces/_data/packs.ts';
import { assert, eq, report } from '../_helpers.mts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------ the shape */

eq(GROUP_ORDER.length, 3, 'three module-based categories (Develop / Content / Insights — ADR 0280 supersedes the five verb destinations)');
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

//? Category names are the MODULES a user picks at creation — the nav mirrors what they chose.
eq(GROUP_LABELS.develop, 'Develop', 'the development lane is called Develop');
eq(GROUP_LABELS.content, 'Content', 'the content lane is called Content');
eq(GROUP_LABELS.insights, 'Insights', 'what came of it is called Insights');

//? The exact category membership the owner decided (ADR 0280): folders, URLs and nav tell ONE story.
//? Develop deliberately holds ten pages — the owner chose module-cohesion over a size cap (the KISS
//? wave may sub-group it later, but the category SET is pinned here). 'code' (the whole-codebase browser)
//? was added after 'terminals' by owner decision 2026-07-20.
const EXPECTED: Record<string, string[]> = {
  develop: ['board', 'answers', 'backlog', 'pipeline', 'terminals', 'code', 'designer', 'interviewer', 'sources', 'scheduled'],
  content: ['content', 'documents', 'marketing', 'scheduled-posts', 'studio'],
  insights: ['activity', 'usage', 'knowledge'],
};
for (const [group, ids] of Object.entries(EXPECTED)) {
  eq(NAV_ITEMS.filter((it) => it.group === group).map((it) => it.id).join(','), ids.join(','), `${group} holds exactly its decided pages, in order`);
}
//? …and the Shell's grouping can never drift from the shared category model the URLs are built from.
for (const item of NAV_ITEMS) {
  eq(VIEW_CATEGORY[item.id], item.group, `${item.id}'s nav group matches its URL category`);
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
//? ADR 0280 flipped this: a pack pre-checks the modules, but the checkboxes are FIRST-CLASS — the
//? old "advanced" fold hid the one choice that shapes the whole workspace.
assert(onboarding.includes('ModulePicker'), 'and shows the module checkboxes first-class');
assert(!onboarding.includes('workspaces.packs.advanced'), 'the "advanced" fold is gone for good');

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
