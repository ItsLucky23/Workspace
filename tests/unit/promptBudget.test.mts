import assert from 'node:assert/strict';
import { applyAiPromptBudget, AI_PROMPT_BUDGET } from '../../server/ai/promptBudget.ts';
import { catalogPromptLines } from '../../server/ai/opCatalog.ts';
import { OP_CAPABILITY } from '../../server/control/rbac.ts';

const huge = (label: string, size: number): string => `${label}:${'x'.repeat(size)}`;

const request = applyAiPromptBudget({
  request: { prompt: huge('request-start', 30_000), system: huge('core-start', 50_000) },
  workspaceInstruction: huge('workspace-start', 10_000),
  skills: huge('skills-start', 20_000),
  productCapabilities: huge('product-start', 8_000),
});

assert.equal(request.prompt.length, AI_PROMPT_BUDGET.prompt, 'current request is bounded');
assert((request.system?.length ?? 0) <= AI_PROMPT_BUDGET.total - request.prompt.length, 'combined input stays within the total budget');
assert((request.system ?? '').includes('core-start'), 'the authoritative feature system contract is retained');
assert((request.system ?? '').includes('workspace-start'), 'bounded workspace steering is retained');
assert((request.system ?? '').includes('skills-start'), 'bounded skills are retained');
assert((request.system ?? '').includes('product-start'), 'bounded product capabilities are retained');
assert((request.system ?? '').includes('truncated by AI prompt budget'), 'truncation is explicit');

const small = applyAiPromptBudget({
  request: { prompt: 'hello', system: 'core' },
  workspaceInstruction: 'workspace', skills: 'skills', productCapabilities: 'product',
});
assert.equal(small.prompt, 'hello');
assert.equal(small.system, 'product\n\nworkspace\n\nskills\n\ncore');

const noPermissions = catalogPromptLines(undefined, [], undefined, 'rename workspace');
assert(!noPermissions.some((line) => line.startsWith('- rename-workspace:')), 'RBAC-inaccessible tools are absent from the prompt');
const permissions: boolean[] = [];
const renameCapability = OP_CAPABILITY['rename-workspace'];
assert.notEqual(renameCapability, null);
permissions[renameCapability ?? 0] = true;
const relevantTools = catalogPromptLines(undefined, permissions, undefined, 'rename workspace');
assert(relevantTools.some((line) => line.startsWith('- rename-workspace:')), 'a relevant permitted tool is retained');
assert(relevantTools.length <= 37, 'request-shaped catalog is capped at 36 tools plus preset metadata');

console.log('promptBudget tests: ok');
