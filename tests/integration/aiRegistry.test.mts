//? Unit test for the AI-provider registry (server/ai/*). Asserts the GENERIC dispatch:
//? feature→provider resolution (defaults + per-feature overrides), the full assignment
//? map, and that dispatch gates on provider availability. Uses the `gemini-api` provider
//? WITHOUT a key (unavailable) so the whole path is deterministic + CI-safe — no real
//? Claude turn (that PTY path is verified manually; it bills a subscription + needs login).

import { assert, eq, report } from '../_helpers.mts';
//? Dynamic imports (after `_helpers` has booted dotenvx + forced the stub world): a STATIC import of a
//? server module is evaluated as a sibling of `_helpers` and races its provider-key unset, leaking a
//? real GEMINI key into the "unavailable provider" assertion. Every sibling test uses this same pattern.
const { resolveAssignment, defaultAssignments } = await import('../../server/ai/assignments');
const { runAiCompletion, currentAssignments } = await import('../../server/ai/registry');

//? Defaults: every feature resolves to a provider; chat defaults to the Claude CLI.
eq(resolveAssignment('workspace-chat'), 'claude-cli', 'workspace-chat defaults to claude-cli');
eq(resolveAssignment('pipeline-agent'), 'claude-cli', 'pipeline-agent defaults to claude-cli');

//? Per-feature override wins (the per-workspace/user picker seam) without touching others.
eq(resolveAssignment('workspace-chat', { 'workspace-chat': 'gemini-api' }), 'gemini-api', 'an override reassigns just that feature');
eq(resolveAssignment('docs-generate', { 'workspace-chat': 'gemini-api' }), 'claude-cli', 'an unrelated feature keeps its default under a partial override');

//? The assignment map covers all features (no feature can dispatch to `undefined`). Asserted by
//? COMPLETENESS, not a hardcoded list — the AiFeature union grows as features are added (ADR 0007 seam).
const map = defaultAssignments();
const keys = Object.keys(map);
assert(keys.length >= 5, 'defaultAssignments covers the AiFeatures');
assert(keys.every((k) => typeof (map as Record<string, string>)[k] === 'string' && ((map as Record<string, string>)[k] ?? '').length > 0), 'no feature dispatches to undefined');
assert(['workspace-chat', 'pipeline-agent', 'docs-generate'].every((f) => keys.includes(f)), 'the core features are all assigned');
eq(Object.keys(currentAssignments()).length, keys.length, 'currentAssignments matches defaultAssignments (every feature exposed)');

//? Dispatch gates on availability: forcing gemini-api (no GEMINI_API_KEY) surfaces a
//? typed unavailable error rather than throwing or hardcoding another provider.
const res = await runAiCompletion('docs-generate', { prompt: 'noop' }, { 'docs-generate': 'gemini-api' });
eq(res.ok, false, 'dispatch to an unavailable provider returns ok=false');
eq(res.providerId, 'gemini-api', 'the result reports the resolved provider id');
eq(res.error, 'ai.providerUnavailable', 'an unavailable provider surfaces ai.providerUnavailable');
assert(res.text === '', 'an errored completion carries no text');

report('tests/integration/aiRegistry.test.mts');
