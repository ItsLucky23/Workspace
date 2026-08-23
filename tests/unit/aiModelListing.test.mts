//? P4-4 — the live model-listing module (server/ai/modelListing.ts): the two pure response parsers, the
//? URL builder, and the no-network branches of fetchProviderModels (unknown id, subscription CLI).

import { assert, eq, report } from '../_helpers.mts';
import { fetchProviderModels, modelsUrl, parseAnthropicModels, parseOpenAiModels, MODEL_LIST_TTL_MS } from '../../server/ai/modelListing.ts';

eq(modelsUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/models', 'models url');
eq(modelsUrl('https://api.openai.com/v1///'), 'https://api.openai.com/v1/models', 'trailing slashes trimmed');
eq(MODEL_LIST_TTL_MS, 10 * 60 * 1000, 'cache TTL is 10 minutes');

//? OpenAI shape
eq(parseOpenAiModels({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }] }), [{ id: 'gpt-4.1', label: 'gpt-4.1' }, { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' }], 'openai: {data:[{id}]} → sorted, deduped, label=id');
eq(parseOpenAiModels({ data: [{ id: 'models/gemini-2.5-flash' }] }), [{ id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' }], "gemini-compat: the 'models/' prefix is stripped so the id is usable as-is");
eq(parseOpenAiModels({ data: [{ id: 42 }, { id: '  ' }, {}] }), [], 'non-string / blank ids are dropped');
eq(parseOpenAiModels(null), [], 'null body → []');
eq(parseOpenAiModels({ data: 'nope' }), [], 'non-array data → []');

//? Anthropic shape
eq(parseAnthropicModels({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }, { id: 'claude-haiku-4-5' }] }), [{ id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' }, { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }], 'anthropic: display_name becomes the label, id when absent; sorted by id');
eq(parseAnthropicModels({ data: [{ id: 'a', display_name: '' }, { id: 'a' }] }), [{ id: 'a', label: 'a' }], 'empty display_name falls back to id; duplicates dropped');
eq(parseAnthropicModels(undefined), [], 'undefined body → []');

//? No-network branches
{
  const unknown = await fetchProviderModels('not-a-provider', 'k');
  eq(unknown, { ok: false, models: [], error: 'ai.unknownProvider' }, 'unknown provider → ai.unknownProvider');
  const cli = await fetchProviderModels('claude-cli', '');
  eq(cli, { ok: false, models: [], error: 'ai.modelsUnsupported' }, 'subscription CLI → ai.modelsUnsupported (no model concept)');
  assert(cli.models.length === 0, 'no list for a CLI backend');
}

report('tests/unit/aiModelListing.test.mts');
