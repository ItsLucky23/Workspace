//? P4-1 + P4-2 — the AI routing chain (server/ai/assignments.aiRouteCandidates) and the `providerId[:model]`
//? override format (server/ai/workspaceAssignments.parseAiOverride / formatAiOverride). Both are pure, so the
//? whole resolution order is pinned here without a backend: call-site → per-feature override → workspace
//? default → feature default → every other catalog backend in catalog order; dedup by providerId.

import { assert, eq, report } from '../_helpers.mts';
import { aiRouteCandidates, defaultAssignments } from '../../server/ai/assignments.ts';
import { AI_PROVIDER_LIST } from '../../server/ai/providers/catalog.ts';
import { AI_DEFAULT_FEATURE, formatAiOverride, parseAiOverride } from '../../server/ai/workspaceAssignments.ts';

const ids = (routes: { providerId: string }[]): string[] => routes.map((r) => r.providerId);
const catalog = ['claude-cli', 'gemini-api', 'openai-api', 'groq-api'];

//? ---- chain order
{
  const out = aiRouteCandidates({
    feature: 'script',
    callSite: { providerId: 'groq-api' },
    featureOverride: { providerId: 'openai-api', model: 'gpt-4.1-mini' },
    workspaceDefault: { providerId: 'claude-cli' },
    catalogIds: catalog,
  });
  //? script's feature default is gemini-api → the 4th slot; everything else already appeared.
  eq(ids(out), ['groq-api', 'openai-api', 'claude-cli', 'gemini-api'], 'full chain: call-site > feature override > ws default > feature default > rest');
  eq(out[1]?.model, 'gpt-4.1-mini', 'the per-feature route keeps its model');
}
{
  const out = aiRouteCandidates({ feature: 'script', featureOverride: { providerId: 'openai-api' }, workspaceDefault: { providerId: 'groq-api' }, catalogIds: catalog });
  eq(ids(out), ['openai-api', 'groq-api', 'gemini-api', 'claude-cli'], 'no call-site: feature override first');
}
{
  const out = aiRouteCandidates({ feature: 'script', workspaceDefault: { providerId: 'openai-api' }, catalogIds: catalog });
  eq(ids(out), ['openai-api', 'gemini-api', 'claude-cli', 'groq-api'], 'no per-feature: workspace default first');
}
{
  const out = aiRouteCandidates({ feature: 'script', catalogIds: catalog });
  eq(ids(out), ['gemini-api', 'claude-cli', 'openai-api', 'groq-api'], 'nothing stored: feature default first, then catalog order');
  eq(out[0]?.providerId, defaultAssignments().script, 'feature default matches assignments.ts');
}
{
  //? Dedup: the same backend named at several levels appears ONCE, at its first (strongest) position, with
  //? that level's model.
  const out = aiRouteCandidates({
    feature: 'mr-review',
    featureOverride: { providerId: 'claude-cli' },
    workspaceDefault: { providerId: 'claude-cli', model: 'x' },
    catalogIds: catalog,
  });
  eq(ids(out), ['claude-cli', 'gemini-api', 'openai-api', 'groq-api'], 'dedup by providerId');
  eq(out[0]?.model, undefined, 'the first occurrence wins (feature override had no model)');
}
{
  //? Every feature resolves to the FULL catalog — a feature can never be left with nothing to try.
  const all = AI_PROVIDER_LIST.map((m) => m.id);
  for (const feature of Object.keys(defaultAssignments()) as (keyof ReturnType<typeof defaultAssignments>)[]) {
    const out = aiRouteCandidates({ feature });
    eq(new Set(ids(out)).size, all.length, `${feature}: every catalog backend is a candidate exactly once`);
    eq(out[0]?.providerId, defaultAssignments()[feature], `${feature}: feature default leads when nothing is stored`);
  }
}
{
  //? A stale override pointing OUTSIDE the catalog still appears (dispatch skips it as unavailable) and the
  //? chain continues past it rather than ending.
  const out = aiRouteCandidates({ feature: 'script', featureOverride: { providerId: 'gone-api' }, catalogIds: catalog });
  eq(ids(out), ['gone-api', 'gemini-api', 'claude-cli', 'openai-api', 'groq-api'], 'an unknown id does not truncate the chain');
}

//? ---- providerId[:model] store format
eq(parseAiOverride('openai-api'), { providerId: 'openai-api' }, 'no colon ⇒ provider only (backwards-compatible)');
eq(parseAiOverride('openai-api:gpt-4.1-mini'), { providerId: 'openai-api', model: 'gpt-4.1-mini' }, 'provider:model');
eq(parseAiOverride('local-openai:llama3.1:8b'), { providerId: 'local-openai', model: 'llama3.1:8b' }, 'split at the FIRST colon — a model id may contain one');
eq(parseAiOverride('openai-api:  '), { providerId: 'openai-api' }, 'a blank model part is dropped');
eq(parseAiOverride('not-a-provider:gpt'), null, 'an unknown provider is rejected');
eq(parseAiOverride('gemini'), null, "'gemini' (not a catalog id) is rejected");
eq(formatAiOverride({ providerId: 'openai-api' }), 'openai-api', 'format: provider only');
eq(formatAiOverride({ providerId: 'openai-api', model: 'o4-mini' }), 'openai-api:o4-mini', 'format: provider:model');
eq(formatAiOverride({ providerId: 'openai-api', model: '' }), 'openai-api', 'format: empty model ⇒ provider only');
for (const v of ['openai-api', 'openai-api:gpt-4.1', 'local-openai:llama3.1:8b']) {
  const parsed = parseAiOverride(v);
  assert(parsed !== null && formatAiOverride(parsed) === v, `round-trip ${v}`);
}
assert(AI_DEFAULT_FEATURE.startsWith('_'), 'the default pseudo-feature cannot collide with a real feature id');
assert(!(AI_DEFAULT_FEATURE in defaultAssignments()), 'the default pseudo-feature is not a feature');

report('tests/unit/aiRouteChain.test.mts');
