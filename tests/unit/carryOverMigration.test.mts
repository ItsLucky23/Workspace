//? The one-time migration that retires `PipelineStage.promptTemplate` (schema step 7).
//?
//? Why this is worth its own test: the migration is the only thing standing between an existing project
//? and silently losing text the user typed. A template was two things glued together — a task
//? instruction the user wrote, and `{{summary}}`-style slots — and only the slots became meaningless.
//? Getting the split wrong in either direction is bad: too greedy and customInstructions fills with
//? "Plan:" fragments, too shy and real instructions vanish with the field.
//?
//? The stripper is pure, so it is testable without a database. The row-level behaviour (append unless
//? already present, seed the handover default) is covered by the integration suite.

import { BACKFILL_STEPS, CURRENT_SCHEMA_VERSION, stripCarrySlots } from '../../server/db/schemaVersion.ts';
import { stageBlueprint } from '../../server/bootstrap/defaultPipeline.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ the stripper */

//? The shape the seeded pipelines actually shipped: an instruction, then labelled slots.
eq(
  stripCarrySlots('Implement the plan.\n\nPlan:\n{{summary}}\n\nFiles flagged by planning: {{changedFiles}}'),
  'Implement the plan.',
  'the instruction survives; the slots and the labels that introduced them do not',
);

//? A label WITH text after it is not a label — it is a sentence that happens to contain a colon, and
//? dropping it would be exactly the silent loss this test exists to prevent.
assert(
  stripCarrySlots('Review the diff. Note: be adversarial.\n{{summary}}').includes('Note: be adversarial.'),
  'a colon mid-sentence does not make the line a discardable label',
);

eq(stripCarrySlots('{{summary}}'), '', 'a template that was ONLY a slot leaves nothing behind');
eq(stripCarrySlots('  {{summary}}  \n\n  {{changedFiles}}  '), '', '…including when padded with whitespace');
eq(stripCarrySlots(''), '', 'an empty template is empty');
eq(stripCarrySlots('Do the thing.'), 'Do the thing.', 'a template with no slots at all is kept verbatim');

//? CRLF is what a Windows-authored template carries; splitting on \n alone would leave a stray \r that
//? makes the "already in customInstructions" check fail and duplicate the text.
eq(stripCarrySlots('Do it.\r\n{{summary}}\r\nAnd report.'), 'Do it.\nAnd report.', 'CRLF input normalises to \\n');

//? Unknown tokens are slots too: `{{ticketTitle}}` never existed, but a user could have typed it, and
//? leaving it in would ship literal braces into the next prompt.
eq(stripCarrySlots('Context: {{ ticketTitle }} done'), 'Context:  done', 'any {{token}} is stripped, spacing included');

/* ------------------------------------------------------------ the step is wired */

const step = BACKFILL_STEPS.find((s) => s.name === 'carry-over-template-to-handover-prompt');
assert(step !== undefined, 'the migration step is registered');
eq(step?.version, 7, 'as version 7');
eq(CURRENT_SCHEMA_VERSION, 7, 'and the install watermark moved with it — otherwise it never runs');

//? Append-only: a released step number is never reused, so a duplicate means one of them will be skipped
//? on every install that already passed it.
const versions = BACKFILL_STEPS.map((s) => s.version);
eq(new Set(versions).size, versions.length, 'every backfill step has a unique version');

/* ------------------------------------------------------------ the defaults it seeds */

//? The migration falls back to the blueprint's handover text, so a stage that had no template still ends
//? up with something sensible rather than blank.
for (const kind of ['refine', 'plan', 'code', 'test', 'review'] as const) {
  const bp = stageBlueprint(kind);
  assert(bp.handoverPrompt.trim().length > 0, `the ${kind} blueprint has a handover instruction`);
  assert(!bp.handoverPrompt.includes('{{'), `…and the ${kind} one is prose, not a slot template`);
}
//? `final` is AI-off by design; asserting it filled would be asserting a bug.
eq(stageBlueprint('final').handoverPrompt, '', 'the final stage stays blank on purpose');

report('carryOverMigration');
