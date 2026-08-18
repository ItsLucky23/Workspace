//? The AI-prompt layer model must describe what the SERVER actually does (ADR 0311).
//?
//? ADR 0308 shipped a UI that told users their five prompt fields formed one ordered stack, "layer N
//? of 5". Nobody checked it against renderStage.ts, and it was wrong in every particular: the fields
//? travel in two independent channels, and one of them — the workspace-wide instruction — never
//? reached the PTY coding agent at all. A confident, wrong explanation is worse than none, because a
//? user acts on it: they write "always use tabs" in the workspace field and believe the agent read it.
//?
//? So this pins the model to the renderer by READING renderStage.ts. It is deliberately source-text
//? matching rather than behaviour: renderStage builds a prompt for a container we cannot spawn here,
//? and the failure mode being guarded is exactly "someone reorders the array and the UI keeps its old
//? story". If a refactor renames these expressions, this test SHOULD fail — that is the moment to
//? re-check aiLayers.ts, not to loosen the pattern.

import { readFileSync } from 'node:fs';

import {
  AI_LAYER_CHANNEL_ORDER, AI_LAYER_ORDER, AI_LAYER_ORDER_BY_CHANNEL, AI_LAYER_COUNT,
  layerPlacement, resolveAiLayers, layersInChannel, composeChannel,
} from '../../src/workspaces/_functions/aiLayers.ts';
import { assert, eq, report } from '../_helpers.mts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------ the model is total + disjoint */

const placed = AI_LAYER_CHANNEL_ORDER.flatMap((c) => [...AI_LAYER_ORDER_BY_CHANNEL[c]]);
eq(placed.length, AI_LAYER_COUNT, 'every layer sits in exactly one channel (none dropped, none duplicated)');
for (const id of AI_LAYER_ORDER) {
  assert(placed.filter((p) => p === id).length === 1, `${id} is placed exactly once`);
}
//? A layer with no channel would silently fall back to "system · 1 of 1" and mislabel itself.
for (const id of AI_LAYER_ORDER) {
  const place = layerPlacement(id);
  eq(AI_LAYER_ORDER_BY_CHANNEL[place.channel][place.position - 1], id, `${id}'s placement round-trips`);
}

/* ------------------------------------------------------------ …and it matches the renderer */

const renderer = read('server/orchestrator/renderStage.ts');

//? The SYSTEM channel is the `stageInstructions` array (passed via --append-system-prompt). Its first
//? three entries are the three layers, in this order.
const systemBody = renderer.slice(renderer.indexOf('const stageInstructions = ['));
const systemOrder = ['ctx.workspaceInstruction', 'cfg.systemPrompt', 'renderPromptTemplate(cfg.promptTemplate'];
let cursor = -1;
for (const expr of systemOrder) {
  const at = systemBody.indexOf(expr);
  assert(at > cursor, `system channel: ${expr} appears, after the previous layer`);
  cursor = at;
}
eq(
  AI_LAYER_ORDER_BY_CHANNEL.system.join(','),
  'workspace,stageSystemPrompt,carryOver',
  'the system channel model matches the renderer order (workspace steering opens it — ADR 0311)',
);

//? The PROJECT channel is the `claudeMd` template literal: the stage's task instructions verbatim,
//? then the context documents (which is how the skills block arrives — see stageRunner).
const claudeMd = renderer.slice(renderer.indexOf('const claudeMd = `'), renderer.indexOf('//? --append-system-prompt'));
assert(claudeMd.includes('${cfg.customInstructions}'), 'project channel: the stage instructions go into CLAUDE.md');
assert(
  claudeMd.indexOf('${cfg.customInstructions}') < claudeMd.indexOf('${docsSection}'),
  'project channel: stage instructions precede the context documents',
);
eq(AI_LAYER_ORDER_BY_CHANNEL.project.join(','), 'stageInstructions,skills', 'the project channel model matches the renderer');

//? The skills block reaches the agent as a context-DOC, not as a system-prompt layer. If this moves,
//? the channel model above moves with it.
const runner = read('server/orchestrator/stageRunner.ts');
assert(runner.includes("skillPromptBlock(workspaceId, 'dev')"), 'skills resolve for the dev apply-point');
assert(runner.includes('contextDocs'), '…and are injected as a context document');

//? ADR 0311's actual bug fix: the workspace instruction must be RESOLVED by the runner and PASSED to
//? the renderer. Before this, it existed only on the one-shot path in ai/registry.ts.
assert(runner.includes('workspaceAiPrefix(workspaceId)'), 'the runner resolves the workspace-wide AI instruction');
assert(runner.includes('workspaceInstruction:'), '…and hands it to renderStage');
assert(
  read('server/ai/registry.ts').includes('export async function workspaceAiPrefix'),
  'both paths share ONE definition of the workspace prefix (a copy would drift)',
);

/* ------------------------------------------------------------ composition never merges channels */

const layers = resolveAiLayers({
  workspace: { aiInstruction: 'WS' },
  skills: [{ id: 's1', slug: 's', name: 's', instruction: 'SKILL', examples: [], applyPoints: ['all'], enabled: true, builtin: false }],
  stage: { systemPrompt: 'SYS', customInstructions: 'TASK', promptTemplate: 'CARRY' },
});

eq(composeChannel(layers, 'system'), 'WS\n\nSYS\n\nCARRY', 'the system channel composes its own three layers, in order');
eq(composeChannel(layers, 'project'), 'TASK\n\nSKILL', 'the project channel composes its own two — and never borrows from the other');
eq(layersInChannel(layers, 'system').map((l) => l.position).join(','), '1,2,3', 'positions are per channel, not global');
eq(layersInChannel(layers, 'project').map((l) => l.position).join(','), '1,2', 'so the project channel starts at 1 again');

//? An empty layer must still be LISTED — its absence is the answer to "why is this being ignored?".
const sparse = resolveAiLayers({ workspace: { aiInstruction: '' }, skills: [] });
eq(sparse.length, AI_LAYER_COUNT, 'every layer is resolved even when nothing is filled in');

report('aiLayers');
