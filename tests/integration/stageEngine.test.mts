//? Unit test for the credential-free half of the stage-runner engine: turnResult
//? (parse the agent's turn signal + fill carry-over chips) and renderStage (stage config →
//? .claude artifacts). No container/credential — pure functions, CI-safe.

import { assert, eq, report } from '../_helpers.mts';
import { parseTurnResult, renderPromptTemplate } from '../../server/orchestrator/turnResult';
import { renderStage } from '../../server/orchestrator/renderStage';
import type { PipelineStageCfg } from '../../src/workspaces/_data/types';

//? A minimal-but-complete stage cfg (renderStage only reads name/instructions/commands/skills).
function stageCfg(over: Partial<PipelineStageCfg>): PipelineStageCfg {
  return {
    id: 'plan', kind: 'ai', name: 'Plan', order: 2, aiEnabled: true,
    customInstructions: 'Break the ticket into a plan.', promptTemplate: 'Ticket context: {{summary}}',
    systemPrompt: 'You are a senior planner.', roleKey: 'planner', userEditable: true, gateForApproval: false,
    skillKeys: ['rag'], sourceIds: [],
    commands: [{ id: 'c1', pattern: 'Bash(npm test:*)', mode: 'allow' }, { id: 'c2', pattern: 'Bash(rm:*)', mode: 'deny' }],
    tools: [], statuses: [], processes: [], visibleStageIds: [],
    modelCfg: { autoEscalate: false, base: { model: 'sonnet', effort: 'medium', maxTurns: 20 }, rules: [] },
    network: { enabled: false, mode: 'allowlist', categories: [], domains: [] },
    hooks: {},
    ...over,
  };
}

async function run(): Promise<void> {
  //? parseTurnResult — a ws-carryover block ⇒ done + parsed envelope.
  const done = await parseTurnResult('Work complete.\n```ws-carryover\n{"summary":"Added auth","changedFiles":["a.ts"],"openQuestions":[]}\n```');
  eq(done.kind, 'done', 'ws-carryover block ⇒ done');
  if (done.kind === 'done') {
    eq(done.envelope.summary, 'Added auth', 'envelope summary parsed');
    eq(done.envelope.changedFiles.join(','), 'a.ts', 'envelope changedFiles parsed');
  }
  //? A ws-needs-input block ⇒ needs-input.
  const blocked = await parseTurnResult('```ws-needs-input\n{"questions":["Which DB?"]}\n```');
  eq(blocked.kind, 'needs-input', 'ws-needs-input ⇒ needs-input');
  if (blocked.kind === 'needs-input') eq(blocked.questions[0], 'Which DB?', 'needs-input question parsed');
  //? A plain reply (no marker) ⇒ continue.
  eq((await parseTurnResult('Still working on it.')).kind, 'continue', 'no marker ⇒ continue');

  //? renderPromptTemplate — fills chips; null envelope ⇒ empty.
  eq(renderPromptTemplate('S: {{summary}} F: {{changedFiles}}', { summary: 'x', changedFiles: ['a', 'b'], openQuestions: [] }), 'S: x F: a\nb', 'chips filled');
  eq(renderPromptTemplate('S: {{summary}}', null), 'S: ', 'null envelope ⇒ empty chip');

  //? renderStage — the load-bearing artifacts.
  const art = renderStage(stageCfg({}), { ticketId: 'DEV-3', carryOver: { summary: 'prev work', changedFiles: [], openQuestions: [] } });
  assert(art.claudeMd.includes('Break the ticket into a plan.'), 'CLAUDE.md carries customInstructions');
  assert(art.claudeMd.includes('Plan stage — DEV-3'), 'CLAUDE.md has the stage header');
  assert(art.stageInstructions.includes('senior planner'), 'stage-instructions carry the systemPrompt');
  assert(art.stageInstructions.includes('prev work'), 'promptTemplate {{summary}} filled from carry-over');
  assert(art.stageInstructions.includes('ws-carryover'), 'stage-instructions teach the done-signal');

  const settings = JSON.parse(art.settingsJson) as { permissions: { allow: string[]; ask: string[]; deny: string[] }; hooks: Record<string, unknown> };
  assert(settings.permissions.allow.includes('Bash(ws emit-carryover:*)'), 'ws-verbs allowed');
  assert(settings.permissions.allow.includes('Bash(npm test:*)'), "stage command mode='allow' → allow");
  assert(settings.permissions.deny.includes('Bash(rm:*)'), "stage command mode='deny' → deny");
  assert(settings.permissions.deny.includes('Read(/auth/**)'), 'auth-path denyRead rendered (07b §2.4)');
  assert('Stop' in settings.hooks, 'Stop hook rendered');

  const mcp = JSON.parse(art.mcpJson) as { mcpServers: Record<string, unknown> };
  assert('rag' in mcp.mcpServers, 'skillKeys → mcp server entry');
}

await run();
report('tests/integration/stageEngine.test.mts');
