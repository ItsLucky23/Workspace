//? Unit test for the workspace module/nav-section gating model (workspaces/_data/modules.ts).
//? Pure logic — no DB, no network. Verifies: module presets expand to their sections; empty
//? enabledSections means legacy all-on; gateable sections gate but non-gateable ones never do;
//? module gating (repo/Dockerfile lane) resolves; and caller input is sanitized to known ids.

import { assert, eq, report } from '../_helpers.mts';

const { WORKSPACE_MODULES, WORKSPACE_SECTIONS, GATEABLE_SECTIONS, sectionsForModules, isSectionEnabled, isModuleEnabled, sanitizeSections } =
  await import('../../src/workspaces/_data/modules.ts');

// 1) preset expansion
{
  const dev = sectionsForModules(['development']);
  assert(dev.includes('board') && dev.includes('pipeline') && !dev.includes('content'), 'development preset → dev sections only');
  const both = sectionsForModules(['content', 'design']);
  assert(both.includes('content') && both.includes('designer') && !both.includes('board'), 'content+design preset → their sections, no dev');
  eq(sectionsForModules([]).length, 0, 'no modules → no sections');
}

// 2) empty/legacy = all-on; gateable gating; non-gateable always on
{
  assert(isSectionEnabled([], 'board'), 'empty set → legacy all-on (board visible)');
  assert(isSectionEnabled(undefined, 'content'), 'undefined → legacy all-on');
  assert(!isSectionEnabled(['content', 'marketing'], 'board'), 'content-only workspace hides the dev board');
  assert(isSectionEnabled(['content', 'marketing'], 'content'), 'content section visible when enabled');
  assert(isSectionEnabled(['content'], 'usage'), 'non-gateable section (usage) is always visible');
}

// 3) module gating (repo/Dockerfile lane)
{
  assert(isModuleEnabled([], 'development'), 'legacy workspace counts as development-enabled');
  assert(!isModuleEnabled(['content', 'marketing'], 'development'), 'content-only → development module off (no repo/Dockerfile prompt)');
  //? A dev workspace that also added just the Interviewer keeps development on + design on.
  const mixed = [...sectionsForModules(['development']), 'interviewer'];
  assert(isModuleEnabled(mixed, 'development') && isModuleEnabled(mixed, 'design'), 'dev + lone interviewer → both modules read as active');
}

// 4) input sanitization
{
  eq(sanitizeSections(['board', 'nonsense', 'content', 42, 'board']).sort().join(','), 'board,content', 'sanitize keeps known ids, drops junk + dupes');
  eq(sanitizeSections('not-an-array').length, 0, 'non-array → empty');
  assert(WORKSPACE_SECTIONS.every((s) => GATEABLE_SECTIONS.includes(s.id)), 'every section def id is gateable');
  eq(WORKSPACE_SECTIONS.length, GATEABLE_SECTIONS.length, 'section defs cover exactly the gateable set');
  assert(WORKSPACE_MODULES.length === 4, 'four shippable modules (development, content, design, documents)');
}

report('tests/unit/workspaceModules.test.mts');
