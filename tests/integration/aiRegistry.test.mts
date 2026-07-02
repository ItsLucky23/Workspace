//? Unit test for the AI-provider registry (server/ai/*). Asserts the GENERIC dispatch:
//? feature→provider resolution (defaults + per-feature overrides), the full assignment
//? map, and that dispatch gates on provider availability. Uses the `gemini-api` provider
//? WITHOUT a key (unavailable) so the whole path is deterministic + CI-safe — no real
//? Claude turn (that PTY path is verified manually; it bills a subscription + needs login).

import { assert, eq, report } from '../_helpers.mts';
import { resolveAssignment, defaultAssignments } from '../../server/ai/assignments';
import { runAiCompletion, currentAssignments } from '../../server/ai/registry';

//? Defaults: every feature resolves to a provider; chat defaults to the Claude CLI.
eq(resolveAssignment('workspace-chat'), 'claude-cli', 'workspace-chat defaults to claude-cli');
eq(resolveAssignment('pipeline-agent'), 'claude-cli', 'pipeline-agent defaults to claude-cli');

//? Per-feature override wins (the per-workspace/user picker seam) without touching others.
eq(resolveAssignment('workspace-chat', { 'workspace-chat': 'gemini-api' }), 'gemini-api', 'an override reassigns just that feature');
eq(resolveAssignment('docs-generate', { 'workspace-chat': 'gemini-api' }), 'claude-cli', 'an unrelated feature keeps its default under a partial override');

//? The assignment map covers all features (no feature can dispatch to `undefined`).
const map = defaultAssignments();
const keys = Object.keys(map).sort();
eq(keys.join(','), 'conflict-resolve,dockerfile-generate,docs-generate,pipeline-agent,workspace-chat', 'defaultAssignments covers every AiFeature');
eq(Object.keys(currentAssignments()).length, 5, 'currentAssignments exposes all five features');

//? Dispatch gates on availability: forcing gemini-api (no GEMINI_API_KEY) surfaces a
//? typed unavailable error rather than throwing or hardcoding another provider.
const res = await runAiCompletion('docs-generate', { prompt: 'noop' }, { 'docs-generate': 'gemini-api' });
eq(res.ok, false, 'dispatch to an unavailable provider returns ok=false');
eq(res.providerId, 'gemini-api', 'the result reports the resolved provider id');
eq(res.error, 'ai.providerUnavailable', 'an unavailable provider surfaces ai.providerUnavailable');
assert(res.text === '', 'an errored completion carries no text');

report('tests/integration/aiRegistry.test.mts');
