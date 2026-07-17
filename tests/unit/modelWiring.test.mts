//? Stage model-config wiring — the gap-scan critical "per-stage model/effort/auto-escalate is dead at
//? the execution side". Pure assertions: resolveModelChoice picks base vs the highest satisfied rule,
//? buildTurnArgs carries `--model`, renderStage writes the model backstop + MAX_THINKING_TOKENS into
//? settings.json, and parseTurnResult round-trips the agent's self-assigned complexityScore.

import { assert, eq, report } from '../_helpers.mts';
import { resolveModelChoice, effortThinkingTokens, buildTurnArgs } from '../../server/orchestrator/modelSelect';
import { renderStage } from '../../server/orchestrator/renderStage';
import { parseTurnResult } from '../../server/orchestrator/turnResult';
import type { PipelineStageCfg, StageModelCfg } from '../../src/workspaces/_data/types';

const modelCfg: StageModelCfg = {
  autoEscalate: true,
  base: { model: 'haiku', effort: 'low', maxTurns: 10 },
  rules: [
    { id: 'r1', minScore: 4, model: 'sonnet', effort: 'medium', maxTurns: 20 },
    { id: 'r2', minScore: 8, model: 'opus', effort: 'high', maxTurns: 30 },
  ],
};

const stageCfg = (cfg: StageModelCfg): PipelineStageCfg => ({
  id: 'code', kind: 'code', name: 'Code', order: 2, aiEnabled: true,
  customInstructions: 'Implement the ticket.', promptTemplate: '{{summary}}', definitionOfDone: '',
  systemPrompt: '', roleKey: 'coder', userEditable: true, gateForApproval: false,
  skillKeys: [], sourceIds: [], commands: [], tools: [], statuses: [], processes: [], visibleStageIds: [],
  modelCfg: cfg,
  network: { enabled: false, mode: 'whitelist', categories: [], domains: [] },
  hooks: {},
});

try {
  // ---- resolveModelChoice ------------------------------------------------------
  eq(resolveModelChoice(modelCfg, null).model, 'haiku', 'no score → base choice');
  eq(resolveModelChoice(modelCfg, 3).model, 'haiku', 'score below every rule → base');
  eq(resolveModelChoice(modelCfg, 5).model, 'sonnet', 'score 5 → the minScore-4 rule');
  eq(resolveModelChoice(modelCfg, 8).model, 'opus', 'score 8 → the HIGHEST satisfied rule wins');
  eq(resolveModelChoice(modelCfg, 10).effort, 'high', 'the escalated rule carries its effort');
  eq(resolveModelChoice({ ...modelCfg, autoEscalate: false }, 10).model, 'haiku', 'autoEscalate OFF ignores the score');

  // ---- effort → thinking budget ------------------------------------------------
  assert(effortThinkingTokens('low') < effortThinkingTokens('medium'), 'effort tiers are monotonic (low<medium)');
  assert(effortThinkingTokens('high') < effortThinkingTokens('max'), 'effort tiers are monotonic (high<max)');

  // ---- buildTurnArgs (the spawn argv) -------------------------------------------
  const args = buildTurnArgs({ model: 'opus' });
  assert(args.join(' ').includes('--model opus'), 'spawn args carry --model with the resolved tier');
  assert(args.join(' ').includes('--permission-mode bypassPermissions'), 'existing flags are preserved');
  const resumed = buildTurnArgs({ resumeSessionId: 'abc', model: 'sonnet' });
  eq(resumed.slice(0, 2), ['--resume', 'abc'], 'resume precedes the model flag');
  assert(!buildTurnArgs({}).join(' ').includes('--model'), 'no model choice → no --model flag (CLI default)');

  // ---- renderStage settings.json backstop ---------------------------------------
  const arts = renderStage(stageCfg(modelCfg), { ticketId: 'T-1', carryOver: null, modelChoice: { model: 'sonnet', effort: 'xhigh', maxTurns: 20 } });
  const settings = JSON.parse(arts.settingsJson) as { model?: string; env?: Record<string, string> };
  eq(settings.model, 'sonnet', 'settings.json carries the resolved model as backstop');
  eq(settings.env?.MAX_THINKING_TOKENS, String(effortThinkingTokens('xhigh')), 'effort becomes MAX_THINKING_TOKENS');
  assert(arts.stageInstructions.includes('complexityScore'), 'autoEscalate ON → the agent is taught to self-score');
  const noEsc = renderStage(stageCfg({ ...modelCfg, autoEscalate: false }), { ticketId: 'T-1', carryOver: null });
  assert(!noEsc.stageInstructions.includes('complexityScore'), 'autoEscalate OFF → no scoring instruction');
  const noChoice = JSON.parse(noEsc.settingsJson) as { model?: string };
  eq(noChoice.model, undefined, 'no modelChoice → settings.json unchanged (back-compat)');

  // ---- parseTurnResult complexityScore round-trip --------------------------------
  const done = await parseTurnResult('done\n```ws-carryover\n{ "summary": "s", "changedFiles": [], "openQuestions": [], "complexityScore": 7 }\n```');
  assert(done.kind === 'done' && done.envelope.complexityScore === 7, 'complexityScore parses through the envelope');
  const clamped = await parseTurnResult('x\n```ws-carryover\n{ "summary": "s", "changedFiles": [], "openQuestions": [], "complexityScore": 42 }\n```');
  assert(clamped.kind === 'done' && clamped.envelope.complexityScore === 10, 'out-of-range score clamps to 10');
  const absent = await parseTurnResult('x\n```ws-carryover\n{ "summary": "s", "changedFiles": [], "openQuestions": [] }\n```');
  assert(absent.kind === 'done' && absent.envelope.complexityScore === undefined, 'no score → absent, not defaulted');
} finally {
  report('modelWiring');
}
