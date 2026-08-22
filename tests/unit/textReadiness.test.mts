//? F-001/F-004 — readiness.aiText must mirror the sources the text dispatch actually reads: a keyed
//? AiConnection or a `WS_<PROVIDER_ID>_KEY` env fallback (providerConfig/openaiCompatible envKey naming).
//? GEMINI_API_KEY is the RAG-embed key only and must NOT flip text readiness; the dead
//? `__provider_key_gemini` store must not either. `textEnvKeyPresent` is the pure half.

import { assert, report } from '../_helpers.mts';
import { textEnvKeyPresent } from '../../server/read/readiness.ts';

assert(!textEnvKeyPresent({}), 'no env → no text key');
assert(!textEnvKeyPresent({ GEMINI_API_KEY: 'embed-only' }), 'GEMINI_API_KEY is the embed key, not a text fallback');
assert(textEnvKeyPresent({ WS_GEMINI_API_KEY: 'k' }), 'WS_GEMINI_API_KEY is the gemini-api text fallback');
assert(textEnvKeyPresent({ WS_OPENAI_API_KEY: 'k' }), 'every api-key catalog entry counts (openai-api)');
assert(!textEnvKeyPresent({ WS_GEMINI_API_KEY: '   ' }), 'a blank value does not count');
assert(!textEnvKeyPresent({ WS_CLAUDE_CLI_KEY: 'k' }), 'a subscription backend has no env key (the host probe covers it)');

report('tests/unit/textReadiness.test.mts');
