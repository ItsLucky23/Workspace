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
}

//? The canonical 7-stage default pipeline. `key` is the stable slug tickets reference
//? (the board columns key on it); `unrefined` is where quick-add lands (human triage,
//? AI off) and `final` wraps up (AI light).
const DEFAULT_STAGES: DefaultStage[] = [
  { key: 'unrefined', kind: 'refine', name: 'Unrefined', order: 0, aiEnabled: false, model: 'haiku', effort: 'low', maxTurns: 8 },
  { key: 'refined', kind: 'refine', name: 'Refined', order: 1, aiEnabled: true, model: 'haiku', effort: 'low', maxTurns: 12 },
  { key: 'plan', kind: 'plan', name: 'Plan', order: 2, aiEnabled: true, model: 'opus', effort: 'high', maxTurns: 20 },
  { key: 'impl', kind: 'code', name: 'Implementation', order: 3, aiEnabled: true, model: 'sonnet', effort: 'high', maxTurns: 30 },
  { key: 'test', kind: 'test', name: 'Test', order: 4, aiEnabled: true, model: 'sonnet', effort: 'medium', maxTurns: 20 },
  { key: 'review', kind: 'review', name: 'Review', order: 5, aiEnabled: true, model: 'opus', effort: 'high', maxTurns: 18 },
  { key: 'final', kind: 'final', name: 'Final', order: 6, aiEnabled: false, model: 'haiku', effort: 'low', maxTurns: 10 },
];

//? Seed the default pipeline stages for a new workspace's project. Mirrors the field
//? mapping `createBlankWorkspace` previously did over `STAGE_CONFIGS`, but from
//? server-owned data so it works in a production bundle.
export async function createDefaultPipeline(prisma: PrismaClient, workspaceId: string, projectId: string): Promise<void> {
  for (const s of DEFAULT_STAGES) {
    await prisma.pipelineStage.create({
      data: {
        workspaceId, projectId, key: s.key, kind: s.kind, name: s.name, order: s.order,
        aiEnabled: s.aiEnabled, wipLimit: null,
        roleKey: s.kind === 'code' ? 'code' : s.kind, systemPrompt: '',
        customInstructions: '', promptTemplate: '',
        skillKeys: [], sourceIds: ['summary'],
        commands: [], tools: [{ toolId: 'tool-mongodb', tier: 'ro' }],
        statuses: baseStatuses(),
        processes: s.aiEnabled ? [{ id: `${s.key}-claude`, name: 'claude', cwd: '/app', env: [], commands: ['npm run claude'] }] : [],
        visibleStageIds: [],
        modelCfg: { autoEscalate: false, base: { model: s.model, effort: s.effort, maxTurns: s.maxTurns }, rules: [] },
        network: { enabled: true, mode: 'whitelist', categories: ['package-registries', 'source-hosts', 'ai-apis'], domains: [] },
        hooks: {},
      },
    });
  }
}
