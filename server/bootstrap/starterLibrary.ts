//? Workspaces — the curated STARTER LIBRARY of workflow-guidance snippets (hosting-proxy plan).
//?
//? Pre-written AI-guidance a user can TOGGLE ON per workspace — the "nudge, not a blank page"
//? half of git/workflow customization (the structured half is the git config; this is the
//? freeform BEHAVIOURAL half). Seeded as `mode='context-doc'`, `source='starter'`,
//? `enabled: false` InfoSource rows: the existing skill-toggle op flips `enabled`, and
//? stageRunner injects every ENABLED starter doc into each stage's CLAUDE.md
//? (server/orchestrator/stageRunner.ts + renderStage.ts). Server-owned + self-contained (no
//? `src/` import) so it survives the prod bundle, exactly like defaultPipeline.ts.

import type { PrismaClient } from '@prisma/client';

interface StarterDoc { name: string; summary: string; content: string }

//? Each doc's `content` is prose the in-container agent reads verbatim as a workspace
//? convention. Keep them short + imperative — they are injected into every AI stage's context.
export const STARTER_LIBRARY: StarterDoc[] = [
  {
    name: 'Conventional commits',
    summary: 'Write commit messages as type(scope): subject',
    content: [
      'Write every commit message as a Conventional Commit:',
      '`<type>(<optional scope>): <short imperative subject>`',
      '',
      'Types: feat, fix, refactor, test, docs, chore, perf, build, ci.',
      'Keep the subject under ~72 characters and in the imperative mood ("add", not "added").',
      'Add a body only when the *why* is not obvious from the subject.',
      'Example: `feat(auth): add password-reset email flow`.',
    ].join('\n'),
  },
  {
    name: 'Commit per testable step',
    summary: 'Split a ticket into small testable steps; commit each passing step',
    content: [
      'Break the ticket into the smallest sequence of steps that each leave the code in a',
      'working, testable state. After each step:',
      '1. make the focused change,',
      '2. run the relevant tests/build for that step,',
      '3. only once it passes, commit it as its own commit (a working sub-stage).',
      '',
      'Prefer several small green commits over one large commit. If a step cannot be made to',
      'pass, stop and report the blocker rather than committing broken work.',
    ].join('\n'),
  },
  {
    name: 'Test before commit',
    summary: 'Run the build + tests before every commit',
    content: [
      'Before committing, run the project build and the tests covering the change and confirm',
      'they pass. Never commit code you have not verified. If tests are missing for the',
      'behaviour you changed, add or update them first. Report test results plainly — including',
      'failures — rather than hiding them.',
    ].join('\n'),
  },
  {
    name: 'Small, focused changes',
    summary: 'Keep each change minimal and scoped to the ticket',
    content: [
      'Keep the change surgical: every edited line should trace to this ticket. Do not refactor',
      'unrelated code, reformat untouched files, or "improve" adjacent things — note them',
      'instead. Match the surrounding code style even if you would personally do it differently.',
      'A small, reviewable diff is the goal.',
    ].join('\n'),
  },
  {
    name: 'Clear PR / MR descriptions',
    summary: 'Summarise what changed, why, and how it was verified',
    content: [
      'When opening a merge/pull request, write a description that states: what changed, why',
      '(the problem it solves), and how it was verified (tests run, manual checks). Link the',
      'ticket. Keep it concise and factual — no filler.',
    ].join('\n'),
  },
];

//? Seed the starter library for a new workspace's project (idempotent by name). All docs are
//? created DISABLED — the user opts each one in from the Workflow settings / Sources page.
export async function createStarterLibrary(prisma: PrismaClient, workspaceId: string, projectId: string): Promise<void> {
  for (const d of STARTER_LIBRARY) {
    const existing = await prisma.infoSource.findFirst({ where: { workspaceId, projectId, mode: 'context-doc', source: 'starter', name: d.name } });
    if (existing) continue;
    await prisma.infoSource.create({
      data: {
        workspaceId, projectId, mode: 'context-doc', source: 'starter', name: d.name,
        summary: d.summary, content: d.content, note: 'starter', enabled: false, usedByStages: [],
      },
    });
  }
}
