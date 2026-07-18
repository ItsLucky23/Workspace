//? Unit test for O-B (IDEA_TO_OUTCOME): the Assistant's proposal guard now accepts CREATE ops
//? (create-ticket / create-content) in addition to the 3 board ops — each still maps to an EXISTING
//? control verb on accept. Pure guard; no AI/DB needed. Locks down accept/reject of the new shapes.

import { assert, eq, report } from '../_helpers.mts';
import { validateChatAction, validatePlan, type Ctx } from '../../server/ai/workspaceChat';
import { isChatProposalForProject } from '../../src/workspaces/_functions/chatDispatch';

const ctx: Ctx = {
  projectId: 'project-a',
  projectName: 'Project A',
  tickets: [{ key: 'DEV-1', title: 'Existing', stageId: 'unrefined' }],
  stages: [{ id: 'unrefined', name: 'Unrefined' }, { id: 'refined', name: 'Refined' }],
  members: [{ id: 'u1', name: 'Alice' }],
  //? X1 widened Ctx — empty here; the generic-op paths are covered by opCatalogParity.test.mts.
  pieces: [], environments: [], services: [], customTasks: [], triggers: [], mrs: [], channels: [],
};

try {
  //? create-ticket — needs a title; carries an optional description.
  const t = validateChatAction({ op: 'create-ticket', title: '  Add a login page  ', description: 'with 2FA' }, ctx);
  assert(t !== null && t.op === 'create-ticket', 'create-ticket with a title validates');
  eq(t?.title, 'Add a login page', 'the title is trimmed');
  eq(t?.description, 'with 2FA', 'the description is carried');
  eq(t?.projectId, ctx.projectId, 'the proposal is bound to the validated active project');
  assert(t !== null && isChatProposalForProject(t, 'project-a'), 'the proposal dispatches in its original project');
  assert(t !== null && !isChatProposalForProject(t, 'project-b'), 'the same proposal is stale after a project switch');
  assert((t?.summary ?? '').includes('Add a login page'), 'the summary names the ticket');
  eq(validateChatAction({ op: 'create-ticket', title: '   ' }, ctx), null, 'create-ticket with a blank title is rejected');
  eq(validateChatAction({ op: 'create-ticket' }, ctx), null, 'create-ticket with no title is rejected');

  //? create-content — needs BOTH a title and a brief; format is optional.
  const c = validateChatAction({ op: 'create-content', title: 'Launch video', brief: 'a 60s hype reel', format: 'faceless' }, ctx);
  assert(c !== null && c.op === 'create-content', 'create-content with title+brief validates');
  eq(c?.brief, 'a 60s hype reel', 'the brief is carried');
  eq(c?.format, 'faceless', 'the format is carried');
  eq(validateChatAction({ op: 'create-content', title: 'No brief' }, ctx), null, 'create-content without a brief is rejected');
  eq(validateChatAction({ op: 'create-content', brief: 'no title' }, ctx), null, 'create-content without a title is rejected');
  const cNoFmt = validateChatAction({ op: 'create-content', title: 'X', brief: 'Y' }, ctx);
  assert(cNoFmt !== null && cNoFmt.format === undefined, 'format is optional (omitted, not empty-string)');

  //? The 3 board ops still work + unknown ops still reject.
  assert(validateChatAction({ op: 'bulk-move', ticketKeys: ['DEV-1'], stageId: 'refined' }, ctx) !== null, 'bulk-move still validates');
  eq(validateChatAction({ op: 'delete-everything', title: 'x' }, ctx), null, 'an unknown op is rejected (no new verbs)');

  //? O-A — multi-step plans: a "build a todo app" idea decomposes into several create-ticket steps.
  const plan = validatePlan({ summary: 'Build a todo app', steps: [
    { op: 'create-ticket', title: 'Todo list UI' },
    { op: 'create-ticket', title: 'Add-todo form' },
    { op: 'create-ticket', title: 'Login page' },
  ] }, ctx);
  assert(plan !== null && plan.steps.length === 3, 'a 3-step plan validates with all steps');
  assert(plan?.steps.every((step) => step.projectId === ctx.projectId) === true, 'every plan step carries the same active project');
  eq(plan?.summary, 'Build a todo app', 'the plan summary is carried');
  eq(validatePlan({ summary: 'One step', steps: [{ op: 'create-ticket', title: 'Only one' }] }, ctx), null, 'a 1-step plan is rejected (that is just a proposal)');
  //? Invalid steps are dropped; a plan needs ≥2 SURVIVING steps.
  const mixed = validatePlan({ summary: 'Mixed', steps: [
    { op: 'create-ticket', title: 'Good one' },
    { op: 'create-ticket', title: '   ' },        // blank title → dropped
    { op: 'create-content', title: 'Vid', brief: 'about X' },
  ] }, ctx);
  assert(mixed !== null && mixed.steps.length === 2, 'invalid steps are dropped, valid survivors kept');
  eq(validatePlan({ summary: 'All bad', steps: [{ op: 'create-ticket' }, { op: 'nope' }] }, ctx), null, 'a plan with <2 valid steps is rejected');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/chatCreateOps.test.mts');
