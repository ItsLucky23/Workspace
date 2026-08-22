//? F-017 — the dispatch-side provider allowlist (workspaceAssignments.isAiProviderId) and the assistant-op
//? enum (opCatalog save-ai-provider.providerId) must both equal the provider CATALOG. A stale hardcoded pair
//? let the settings picker offer openai-api/anthropic-api/openrouter while dispatch silently dropped them.

import { assert, eq, report } from '../_helpers.mts';
import { AI_PROVIDER_CATALOG } from '../../server/ai/providers/catalog.ts';
import { isAiProviderId } from '../../server/ai/workspaceAssignments.ts';
import { PROPOSE_CATALOG } from '../../server/ai/opCatalog.ts';

const ids = Object.keys(AI_PROVIDER_CATALOG);
assert(ids.length > 2, 'the catalog has more than the old claude-cli/gemini-api pair');
for (const id of ids) assert(isAiProviderId(id), `${id} is routable at dispatch`);
assert(!isAiProviderId('gemini'), "'gemini' (not a catalog id) is not routable");
assert(!isAiProviderId('not-a-provider'), 'an unknown id is not routable');

const spec = PROPOSE_CATALOG['save-ai-provider'].params.providerId;
assert(spec !== undefined && spec.kind === 'enum', 'save-ai-provider.providerId is an enum');
if (spec !== undefined && spec.kind === 'enum') {
  eq(spec.values[0], 'default', "'default' (clear) stays first");
  for (const id of ids) assert(spec.values.includes(id), `the op enum offers ${id}`);
}

report('tests/unit/aiProviderAllowlist.test.mts');
