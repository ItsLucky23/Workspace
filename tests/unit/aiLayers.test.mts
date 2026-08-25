//? The AI-prompt layer model must describe what the SERVER actually does (ADR 0311, F-075).
//?
//? ADR 0308 shipped a UI that told users their five prompt fields formed one ordered stack. ADR 0311
//? corrected it to two channels — and its guard was a SOURCE-TEXT test that read renderStage.ts and
//? matched expressions. That test pinned the wrong thing: it asserted the handover instruction at
//? system position 3, where the server actually renders the INCOMING handover, and never noticed the
//? definition of done at all. A confident, wrong explanation is worse than none, because a user acts
//? on it.
//?
//? So this is BEHAVIOURAL now: render a stage with a unique sentinel in every editable field, render a
//? one-shot system string the same way, and assert that every sentinel lands where the spec (the one
//? the server maps over) says it does — and that the client-side resolver reports the same positions.

import { assert, eq, report } from '../_helpers.mts';
import { renderStage } from '../../server/orchestrator/renderStage';
import { applyAiPromptBudget } from '../../server/ai/promptBudget';
import { UNTRUSTED_CONTEXT_POLICY } from '../../server/ai/untrustedContext';
import {
  AI_ONESHOT_SPEC, AI_STAGE_PROJECT_SPEC, AI_STAGE_SYSTEM_SPEC, editableCount, formatSkillBlock, formatWorkspaceInstruction,
  layerEntry, layersInChannel, resolveAiLayers, type AiOneShotEntryId, type AiStageProjectEntryId, type AiStageSystemEntryId,
} from '../../src/workspaces/_functions/aiLayers.ts';
import type { AiSkillEntry, PipelineStageCfg } from '../../src/workspaces/_data/types';

/* ------------------------------------------------------------ fixtures: a sentinel per field */

const skills: AiSkillEntry[] = [{ id: 'sk1', slug: 'sentinel', name: 'Sentinel', instruction: '@@SKILLS@@', examples: '', applyPoints: ['all'], builtin: false }];
const workspace = { aiInstruction: '@@WS@@', outputLanguage: 'Dutch' };

const cfg: PipelineStageCfg = {
  projectId: 'project-test', id: 'code', kind: 'code', name: 'Code', order: 2, aiEnabled: true,
  customInstructions: '@@TASK@@', handoverPrompt: '@@HANDOVER@@', definitionOfDone: '@@DOD@@', systemPrompt: '@@SYS@@',
  roleKey: 'coder', userEditable: true, gateForApproval: false,
  aiSkillIds: ['sk1'], sourceIds: [], commands: [], tools: [], statuses: [], processes: [], visibleStageIds: [],
  modelCfg: { autoEscalate: true, base: { model: 'sonnet', effort: 'medium' }, rules: [] },
  hooks: {},
};

//? The same context the stage runner assembles: the workspace prefix through the shared helper, a
//? real carry-over envelope, a starter doc BEFORE the skills doc (skills are last), RAG hits, a reload.
const artifacts = renderStage(cfg, {
  ticketId: 'T-1',
  carryOver: { summary: '@@INCOMING@@', changedFiles: [], openQuestions: [] },
  workspaceInstruction: formatWorkspaceInstruction(workspace),
  contextDocs: [
    { name: 'Conventions', content: '@@DOC@@', trusted: true },
    { name: 'Active skills', content: formatSkillBlock(skills), trusted: true },
  ],
  retrieved: [{ filePath: 'src/a.ts', content: '@@RAG@@' }],
  handoffReload: '@@RELOAD@@',
});

/* ------------------------------------------------------------ helpers */

//? Every probe must appear, and in spec order — the assertion the source-text test only pretended to make.
function assertSpecOrder<Id extends string>(text: string, spec: readonly { id: Id }[], probe: Record<Id, string>, label: string, find: (haystack: string, needle: string) => number = (h, n) => h.indexOf(n)): void {
  let cursor = -1;
  for (const { id } of spec) {
    const at = find(text, probe[id]);
    assert(at !== -1, `${label}: ${id} is present`);
    assert(at > cursor, `${label}: ${id} follows the previous segment (at ${String(at)} > ${String(cursor)})`);
    cursor = at;
  }
}

/* ------------------------------------------------------------ stage · system channel */

const systemProbe: Record<AiStageSystemEntryId, string> = {
  workspace: '@@WS@@',
  stageSystemPrompt: '@@SYS@@',
  incomingHandover: '@@INCOMING@@',
  definitionOfDone: '@@DOD@@',
  carryOverFence: '```ws-carryover',
  handoverPrompt: '@@HANDOVER@@',
  escalation: 'complexityScore',
  needsInput: 'ws-needs-input',
  questionsPolicy: 'NON-BLOCKING questions',
  untrustedPolicy: UNTRUSTED_CONTEXT_POLICY,
};
assertSpecOrder(artifacts.stageInstructions, AI_STAGE_SYSTEM_SPEC, systemProbe, 'system channel');
assert(artifacts.stageInstructions.startsWith('Write all output in Dutch.\n\n@@WS@@'), 'the workspace layer opens the system channel WITH its language directive');
assert(artifacts.stageInstructions.indexOf('@@INCOMING@@') < artifacts.stageInstructions.indexOf('@@HANDOVER@@'), 'position 3 is the INCOMING handover; the stage\'s own handover instruction comes after the fence (the 0311 mirror had these swapped)');

//? An empty optional segment is dropped, the order of the rest is unchanged.
const lean = renderStage({ ...cfg, modelCfg: { ...cfg.modelCfg, autoEscalate: false }, definitionOfDone: '', handoverPrompt: '' }, { ticketId: 'T-1', carryOver: null });
assert(!lean.stageInstructions.includes('complexityScore'), 'auto-escalation off → no self-score segment');
assert(!lean.stageInstructions.includes('shape its `summary`'), 'no handover instruction → the wrapper is not emitted either');
assert(lean.stageInstructions.includes('Judge for yourself'), 'no definition of done → the server\'s own default line');
assert(lean.stageInstructions.indexOf('@@SYS@@') < lean.stageInstructions.indexOf('Judge for yourself'), '…still in spec order');

/* ------------------------------------------------------------ stage · project channel */

const projectProbe: Record<AiStageProjectEntryId, string> = {
  title: '# Code stage — T-1',
  reload: '@@RELOAD@@',
  stageInstructions: '@@TASK@@',
  docs: '@@DOC@@',
  retrieved: '@@RAG@@',
  untrustedPolicy: UNTRUSTED_CONTEXT_POLICY,
};
assertSpecOrder(artifacts.claudeMd, AI_STAGE_PROJECT_SPEC, projectProbe, 'project channel', (h, n) => h.lastIndexOf(n));
assert(artifacts.claudeMd.indexOf('@@DOC@@') < artifacts.claudeMd.indexOf('@@SKILLS@@') && artifacts.claudeMd.indexOf('@@SKILLS@@') < artifacts.claudeMd.indexOf('@@RAG@@'), 'the skills block is the LAST context document, before the retrieved code');
assert(artifacts.claudeMd.includes(formatSkillBlock(skills)), 'the skills doc reaches CLAUDE.md verbatim in the shared format');
assert(!artifacts.stageInstructions.includes('@@TASK@@') && !artifacts.claudeMd.includes('@@SYS@@'), 'the two channels never borrow from each other');

/* ------------------------------------------------------------ the client resolver says the same */

const stageLayers = resolveAiLayers({ workspace, skills, stage: cfg });
eq(layersInChannel(stageLayers, 'system').map((l) => l.id), AI_STAGE_SYSTEM_SPEC.map((e) => e.id), 'the resolved system channel IS the spec, in order');
eq(layersInChannel(stageLayers, 'project').map((l) => l.id), AI_STAGE_PROJECT_SPEC.map((e) => e.id), 'the resolved project channel IS the spec, in order');
eq(layersInChannel(stageLayers, 'system').map((l) => l.position), AI_STAGE_SYSTEM_SPEC.map((_e, i) => i + 1), 'positions count every segment the server emits, not only the editable ones');
eq(layerEntry(stageLayers, 'handoverPrompt')?.position, 6, 'the handover instruction reports its REAL position (6 of 10)');
eq(layerEntry(stageLayers, 'definitionOfDone')?.position, 4, 'the definition of done is a layer of its own (4 of 10) — it was missing from the preview');
eq(layerEntry(stageLayers, 'skills')?.id, 'docs', 'the skills layer feeds the context-documents segment of the project channel');
eq(editableCount(stageLayers), 6, 'six editable fields feed a stage run');
eq(stageLayers.filter((l) => l.layer === undefined).every((l) => l.text === '' && l.source === 'server'), true, 'server machinery carries no client-side text and no edit destination');

//? Each editable layer's text — formatted by the shared helpers — appears in the server output verbatim,
//? and walking the layers in resolved order walks the server output forwards.
for (const channel of ['system', 'project'] as const) {
  const out = channel === 'system' ? artifacts.stageInstructions : artifacts.claudeMd;
  let cursor = -1;
  for (const l of layersInChannel(stageLayers, channel).filter((x) => x.text.length > 0)) {
    const at = out.indexOf(l.text);
    assert(at !== -1, `${channel}: the preview text of "${l.id}" is byte-for-byte what the server emits`);
    assert(at > cursor, `${channel}: …and at the position the preview claims`);
    cursor = at;
  }
}

/* ------------------------------------------------------------ one-shot path */

const oneShot = applyAiPromptBudget({
  request: { prompt: 'hello', system: '@@FEATURE@@' },
  workspaceInstruction: formatWorkspaceInstruction(workspace),
  skills: formatSkillBlock(skills),
  productCapabilities: '@@CAPS@@',
});
const oneShotProbe: Record<AiOneShotEntryId, string> = { productCapabilities: '@@CAPS@@', workspace: '@@WS@@', skills: '@@SKILLS@@', featureSystem: '@@FEATURE@@' };
assertSpecOrder(oneShot.system ?? '', AI_ONESHOT_SPEC, oneShotProbe, 'one-shot system string');
eq(oneShot.system, `@@CAPS@@\n\n${formatWorkspaceInstruction(workspace)}\n\n${formatSkillBlock(skills)}\n\n@@FEATURE@@`, 'one-shot: one string, four segments, shared formatting');

const oneShotLayers = resolveAiLayers({ workspace, skills, mode: 'oneShot' });
eq(oneShotLayers.map((l) => l.id), AI_ONESHOT_SPEC.map((e) => e.id), 'the one-shot model is a single channel in spec order');
eq(oneShotLayers.map((l) => l.channel), ['oneShot', 'oneShot', 'oneShot', 'oneShot'], '…and no project channel (there is none on this path)');
eq(editableCount(oneShotLayers), 2, 'only workspace + skills are editable on the one-shot path');
{
  let cursor = -1;
  for (const l of oneShotLayers.filter((x) => x.text.length > 0)) {
    const at = (oneShot.system ?? '').indexOf(l.text);
    assert(at !== -1 && at > cursor, `one-shot: the preview text of "${l.id}" is what the server sends, in order`);
    cursor = at;
  }
}

/* ------------------------------------------------------------ shared formatting helpers */

eq(formatWorkspaceInstruction({ outputLanguage: '', aiInstruction: '  X  ' }), 'X', 'no language → the instruction alone, trimmed');
eq(formatWorkspaceInstruction({ outputLanguage: 'German', aiInstruction: '' }), 'Write all output in German.', 'no instruction → the directive alone');
eq(formatWorkspaceInstruction({}), '', 'nothing set → nothing emitted');
eq(formatSkillBlock([]), '', 'no skills → no block');
eq(
  formatSkillBlock([{ name: 'A', instruction: ' one ', examples: ' ex ' }]),
  '## Active skills (apply these writing/working instructions to your output)\n\n### Skill: A\none\n\nExamples:\nex',
  'the skills block keeps its header, per-skill heading and examples',
);

/* ------------------------------------------------------------ which skills a run receives (F-010) */

//? A pipeline STAGE receives exactly its picked skills (stageRunner → resolveSkillsByIds), not the
//? apply-point='all' set. The preview must say the same.
{
  const both: AiSkillEntry[] = [
    { id: 'all1', slug: 'b-all', name: 'all', instruction: 'ALL-SKILL', examples: '', applyPoints: ['all'], builtin: false },
    { id: 'pick1', slug: 'a-picked', name: 'picked', instruction: 'PICKED', examples: '', applyPoints: [], builtin: false },
  ];
  const stageOf = (aiSkillIds: string[]) => ({ ...cfg, aiSkillIds });
  const staged = layerEntry(resolveAiLayers({ workspace, skills: both, stage: stageOf(['pick1']) }), 'skills')?.text ?? '';
  assert(staged.includes('PICKED') && !staged.includes('ALL-SKILL'), 'a stage shows the skills it PICKED — an unpicked "all" skill is not sent and not shown');
  const picked = layerEntry(resolveAiLayers({ workspace, skills: both, stage: stageOf(['all1', 'pick1']) }), 'skills')?.text ?? '';
  assert(picked.indexOf('PICKED') < picked.indexOf('ALL-SKILL'), 'picked skills are ordered by slug, like the server block');
  const noStage = layerEntry(resolveAiLayers({ workspace, skills: both, applyPoint: 'chat', mode: 'oneShot' }), 'skills')?.text ?? '';
  assert(noStage.includes('ALL-SKILL') && !noStage.includes('PICKED'), 'without a stage the apply-point rule applies (workspace/chat call sites)');
}

//? An empty layer must still be LISTED — its absence is the answer to "why is this being ignored?".
const sparse = resolveAiLayers({ workspace: { aiInstruction: '' }, skills: [] });
eq(sparse.length, AI_STAGE_SYSTEM_SPEC.length + AI_STAGE_PROJECT_SPEC.length, 'every segment is resolved even when nothing is filled in');
eq(sparse.filter((l) => l.text.length > 0).length, 0, '…with no text anywhere');

report('aiLayers');
