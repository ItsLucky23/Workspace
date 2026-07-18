//? Workspaces — the server-side DEFAULT PIPELINE for a freshly-created workspace.
//?
//? Why this lives in `server/` (not `src/_data/seed`): the PROD server bundle stubs
//? non-`_api`/`_sync` `src/` runtime imports to `undefined`, so a real (prod)
//? `create-workspace` that looped over `src`'s `STAGE_CONFIGS` would seed ZERO stages
//? and hand the owner a broken board (lesson-0002). This module is fully self-contained
//? (no `src/` import) so it survives the prod bundle. It is also intentionally a CLEAN
//? default (7 stages, sensible model tiers, no demo-specific commands/prompts) — the
//? demo-flavoured `STAGE_CONFIGS` stays in `src` for `seedDemoWorkspace` (tests/dev only).

import type { PrismaClient } from '@prisma/client';

//? The 4 base (non-custom) statuses every stage shows on its board column.
const baseStatuses = (): { key: string; label: string; kind: string }[] => [
  { key: 'needs-input', label: 'Needs input', kind: 'base' },
  { key: 'busy', label: 'Busy', kind: 'base' },
  { key: 'stopped', label: 'Stopped', kind: 'base' },
  { key: 'done', label: 'Done', kind: 'base' },
];

interface DefaultStage {
  key: string;
  kind: 'refine' | 'plan' | 'code' | 'test' | 'review' | 'final';
  name: string;
  order: number;
  aiEnabled: boolean;
  model: 'haiku' | 'sonnet' | 'opus';
  effort: 'low' | 'medium' | 'high';
  maxTurns: number;
  //? The stage-runner renders these into the container: systemPrompt (role) →
  //? --append-system-prompt; customInstructions → CLAUDE.md; promptTemplate ({{chips}}
  //? filled from carry-over) → the task; definitionOfDone → the "done when…" guidance
  //? (empty ⇒ the AI judges completion itself). aiEnabled=false stages leave them blank.
  systemPrompt: string;
  customInstructions: string;
  promptTemplate: string;
  definitionOfDone: string;
}

//? The canonical 7-stage default pipeline. `key` is the stable slug tickets reference
//? (the board columns key on it); `unrefined` is where quick-add lands (human triage,
//? AI off) and `final` wraps up (AI light).
const BLANK = { systemPrompt: '', customInstructions: '', promptTemplate: '', definitionOfDone: '' };
const DEFAULT_STAGES: DefaultStage[] = [
  { key: 'unrefined', kind: 'refine', name: 'Unrefined', order: 0, aiEnabled: false, model: 'haiku', effort: 'low', maxTurns: 8, ...BLANK },
  {
    key: 'refined', kind: 'refine', name: 'Refined', order: 1, aiEnabled: true, model: 'haiku', effort: 'low', maxTurns: 12,
    systemPrompt: 'You are a senior engineer refining a development ticket before any code is written.',
    customInstructions: 'Read the ticket and skim the repository to understand its context. Clarify the scope: what should change, the acceptance criteria, and any ambiguities. This stage is ANALYSIS ONLY — do not write or run code.',
    promptTemplate: 'Refine this ticket for the repository and produce a crisp scope + acceptance criteria.\n\nTicket / prior context:\n{{summary}}',
    definitionOfDone: 'The ticket has a clear scope, explicit acceptance criteria, and any blocking questions are listed.',
  },
  {
    key: 'plan', kind: 'plan', name: 'Plan', order: 2, aiEnabled: true, model: 'opus', effort: 'high', maxTurns: 20,
    systemPrompt: 'You are a staff engineer producing an implementation plan.',
    customInstructions: 'Using the refined scope, write a concrete, ordered implementation plan: the files to change, the approach per step, and the main risks. Do NOT write code yet.',
    promptTemplate: 'Write the implementation plan.\n\nRefined scope:\n{{summary}}',
    definitionOfDone: 'An ordered implementation plan exists naming the files to touch and the approach, with risks noted.',
  },
  {
    key: 'impl', kind: 'code', name: 'Implementation', order: 3, aiEnabled: true, model: 'sonnet', effort: 'high', maxTurns: 30,
    systemPrompt: 'You are a senior engineer implementing a ticket in this repository.',
    customInstructions: 'Follow the plan. Make the change now with the Write/Edit tools (surgical, well-scoped edits), then run git add + git commit on the current branch with a clear message. Do NOT push. Make reasonable assumptions where small details are missing and act — do NOT ask questions unless you are genuinely blocked.',
    promptTemplate: 'Implement the plan.\n\nPlan:\n{{summary}}\n\nFiles flagged by planning: {{changedFiles}}',
    definitionOfDone: 'The change is implemented and committed on the ticket branch; the touched files are listed.',
  },
  {
    key: 'test', kind: 'test', name: 'Test', order: 4, aiEnabled: true, model: 'sonnet', effort: 'medium', maxTurns: 20,
    systemPrompt: 'You are a senior engineer responsible for test coverage.',
    customInstructions: 'Add or update tests for the implemented change and run them. Report the results plainly, then commit the new tests.',
    promptTemplate: 'Add and run tests for the change.\n\nChange summary:\n{{summary}}\n\nTouched files: {{changedFiles}}',
    definitionOfDone: 'Tests covering the change exist and pass, or any failures are clearly reported.',
  },
  {
    key: 'review', kind: 'review', name: 'Review', order: 5, aiEnabled: true, model: 'opus', effort: 'high', maxTurns: 18,
    systemPrompt: 'You are a principal engineer doing a code review.',
    customInstructions: 'Review the implemented change for correctness, security, and adherence to the repo conventions. Report concrete, actionable findings; do NOT modify code.',
    promptTemplate: 'Review the implemented change.\n\nSummary:\n{{summary}}\n\nTouched files: {{changedFiles}}',
    definitionOfDone: 'A review with concrete findings (or an explicit approval) is produced.',
  },
  { key: 'final', kind: 'final', name: 'Final', order: 6, aiEnabled: false, model: 'haiku', effort: 'low', maxTurns: 10, ...BLANK },
];

//? GAP_SCAN G5 — pipeline PRESETS. `Workspace.presetKey` existed as dead data: every workspace, from a
//? one-person side project to a team repo, was seeded the full 7-stage pipeline, and a content-only
//? workspace got a dev pipeline it can never run. The tier now decides which stages are seeded:
//?
//?   simple       — unrefined → implementation → final (three columns, no ceremony)
//?   advanced     — adds plan + test
//?   professional — the full 7-stage default (unchanged; still the default tier)
//?
//? Stage KEYS are unchanged across tiers, so a ticket, a carry-over and every stage-scoped setting keep
//? meaning if the owner later moves up a tier — upgrading adds columns, it does not rewrite history.
export type PipelinePreset = 'simple' | 'advanced' | 'professional';

const PRESET_STAGES: Record<PipelinePreset, string[]> = {
  simple: ['unrefined', 'impl', 'final'],
  advanced: ['unrefined', 'refined', 'plan', 'impl', 'final'],
  professional: DEFAULT_STAGES.map((s) => s.key),
};

export function isPipelinePreset(v: string): v is PipelinePreset {
  return v === 'simple' || v === 'advanced' || v === 'professional';
}

//? The stages a preset seeds, re-ordered contiguously so the board has no gaps.
export function stagesForPreset(preset: PipelinePreset): DefaultStage[] {
  const keys = new Set(PRESET_STAGES[preset]);
  return DEFAULT_STAGES.filter((s) => keys.has(s.key)).map((s, i) => ({ ...s, order: i }));
}

//? Seed the default pipeline stages for a new workspace's project. Mirrors the field
//? mapping `createBlankWorkspace` previously did over `STAGE_CONFIGS`, but from
//? server-owned data so it works in a production bundle.
export async function createDefaultPipeline(prisma: PrismaClient, workspaceId: string, projectId: string, preset: PipelinePreset = 'professional'): Promise<void> {
  for (const s of stagesForPreset(preset)) {
    await prisma.pipelineStage.create({
      data: {
        workspaceId, projectId, key: s.key, kind: s.kind, name: s.name, order: s.order,
        aiEnabled: s.aiEnabled, wipLimit: null,
        roleKey: s.kind === 'code' ? 'code' : s.kind, systemPrompt: s.systemPrompt,
        customInstructions: s.customInstructions, promptTemplate: s.promptTemplate, definitionOfDone: s.definitionOfDone,
        skillKeys: [], sourceIds: ['summary'],
        //? A blank workspace has no IntegrationTool rows yet, so it must not carry
        //? a phantom legacy seed id. Users explicitly bind real tools after creating them.
        commands: [], tools: [],
        statuses: baseStatuses(),
        //? Extra long-running terminals (dev servers) are project-specific — none by default.
        //? The claude AGENT is driven by the stage-runner, not a StageProcess command.
        processes: [],
        visibleStageIds: [],
        modelCfg: { autoEscalate: false, base: { model: s.model, effort: s.effort, maxTurns: s.maxTurns }, rules: [] },
        network: { enabled: true, mode: 'whitelist', categories: ['package-registries', 'source-hosts', 'ai-apis'], domains: [] },
        hooks: {},
      },
    });
  }
}
