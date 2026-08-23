//? ADR 0007 — the provider catalog and the two wire shapes behind it.
//?
//? The owner's ask was "more providers that ACTUALLY work", so the thing worth pinning is not that a
//? name appears in a list — it is that every listed backend names a transport that exists, and that
//? each transport's request shape is right. A 400 or a 404 from a mis-shaped body reads to a user as
//? "the AI is broken" and gives them nothing to act on.

import { AI_PROVIDER_CATALOG, AI_PROVIDER_LIST, providerBaseUrl } from '../../server/ai/providers/catalog.ts';
import { chatBody, chatCompletionsUrl } from '../../server/ai/providers/openaiCompatible.ts';
import { anthropicBody, anthropicText, messagesUrl } from '../../server/ai/providers/anthropicApi.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ the catalog is honest */

const TRANSPORTS = new Set(['claude-cli', 'openai-compatible', 'anthropic']);
for (const meta of AI_PROVIDER_LIST) {
  //? A backend whose transport has no implementation is the "looks connected, fails at the first
  //? turn" defect this page exists to prevent — the one thing this file must make impossible.
  assert(TRANSPORTS.has(meta.transport), `${meta.id} names a transport that exists`);
  eq(meta.id, AI_PROVIDER_CATALOG[meta.id]?.id, `${meta.id} is keyed by its own id`);

  if (meta.kind === 'subscription') {
    //? Signed in on the host: a key field or a model dropdown for it would be boxes that do nothing.
    eq(meta.models.length, 0, `${meta.id} (subscription) offers no model choice`);
    eq(meta.keyUrl, '', `${meta.id} (subscription) has no key to fetch`);
    continue;
  }
  assert(meta.models.length > 0, `${meta.id} offers at least one predefined model`);
  assert(meta.models.some((m) => m.id === meta.defaultModel), `${meta.id}'s default model is one it offers`);
  assert(meta.baseUrl.startsWith('http'), `${meta.id} has a real endpoint`);
  //? The endpoint is never a user field, so an operator MUST have a way to repoint it.
  assert(meta.baseUrlEnv.length > 0, `${meta.id} can be repointed by an operator env var`);
}

//? Both kinds must actually be represented — a catalog that is all api-key would make the grouping
//? the owner asked for meaningless.
assert(AI_PROVIDER_LIST.some((m) => m.kind === 'subscription'), 'at least one subscription backend exists');
assert(AI_PROVIDER_LIST.filter((m) => m.kind === 'api-key').length >= 4, 'several api-key backends exist');

//? P4-5 — the four added OpenAI-compatible hosts: each is a real endpoint, has a key page, an operator
//? env override, and (via the generic loop above) a default model it offers. No Azure (ADR 0321).
for (const [id, baseUrl, env] of [
  ['xai-api', 'https://api.x.ai/v1', 'WS_XAI_BASE_URL'],
  ['together-api', 'https://api.together.xyz/v1', 'WS_TOGETHER_BASE_URL'],
  ['fireworks-api', 'https://api.fireworks.ai/inference/v1', 'WS_FIREWORKS_BASE_URL'],
  ['cerebras-api', 'https://api.cerebras.ai/v1', 'WS_CEREBRAS_BASE_URL'],
] as const) {
  const meta = AI_PROVIDER_CATALOG[id];
  assert(meta !== undefined, `${id} is in the catalog`);
  eq(meta?.transport, 'openai-compatible', `${id} rides the shared transport`);
  eq(meta?.kind, 'api-key', `${id} is a metered api-key backend`);
  eq(meta?.baseUrl, baseUrl, `${id} endpoint`);
  eq(meta?.baseUrlEnv, env, `${id} operator env override`);
  assert((meta?.keyUrl ?? '').startsWith('https://'), `${id} links to a key page`);
  assert((meta?.models.length ?? 0) >= 2 && (meta?.models.length ?? 0) <= 4, `${id} lists 2-4 models`);
}
assert(!('azure-openai' in AI_PROVIDER_CATALOG), 'no Azure entry (ADR 0321: deferred)');

{
  const local = AI_PROVIDER_CATALOG['local-openai'];
  //? A self-hosted server has no key to fetch, and demanding one would block the one backend that
  //? costs nothing to try.
  eq(local?.keyUrl, '', 'the local backend needs no key');
}

/* ------------------------------------------------------------ endpoint resolution */

eq(chatCompletionsUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions', 'the OpenAI shape resolves to /chat/completions');
//? A pasted or configured base URL almost always has a trailing slash; doubling it 404s on several hosts.
eq(chatCompletionsUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com/openai/v1/chat/completions', 'a trailing slash is trimmed rather than doubled');
eq(messagesUrl('https://api.anthropic.com/v1'), 'https://api.anthropic.com/v1/messages', 'the Anthropic shape resolves to /messages');
//? Inherited from the deleted `geminiEndpoint.test.mts`: Gemini used to have its own transport with a
//? custom-endpoint test. It now rides the shared OpenAI-compatible one, so the behaviour that test
//? protected — a self-hosted/proxy base honoured, trailing slashes collapsed — is pinned here instead.
eq(chatCompletionsUrl('https://my-proxy.test/v1'), 'https://my-proxy.test/v1/chat/completions', 'a proxy or self-hosted base is honoured');
assert(!chatCompletionsUrl('https://x.test//').includes('///'), 'multiple trailing slashes collapse');

{
  const openai = AI_PROVIDER_CATALOG['openai-api'];
  //? No env override set in this process, so it must fall back to the catalog value rather than ''.
  eq(openai === undefined ? '' : providerBaseUrl(openai), 'https://api.openai.com/v1', 'an unset override falls back to the catalog endpoint');
}

/* ------------------------------------------------------------ OpenAI-compatible body */

{
  const body = chatBody({ prompt: 'hello' }, 'gpt-4o-mini', null);
  eq(body.model, 'gpt-4o-mini', 'the resolved model is sent');
  const messages = body.messages as { role: string; content: string }[];
  eq(messages.length, 1, 'no system message is invented when the caller sent none');
  //? Omitted, not null: several compatible hosts reject `temperature: null` outright.
  assert(!('temperature' in body), 'a null temperature is omitted rather than sent as null');
}
{
  const messages = chatBody({ prompt: 'hi', system: 'be terse' }, 'gpt-4o', 0.4).messages as { role: string }[];
  eq(messages[0]?.role, 'system', 'the system message comes first');
  eq(messages[1]?.role, 'user', '…and the prompt follows it');
}

/* ------------------------------------------------------------ Anthropic body: the difference */

{
  const body = anthropicBody({ prompt: 'hello', system: 'be terse' }, 'claude-sonnet-4-5');
  //? THE reason this transport exists: `system` is top-level here, not a message. Sent as a message it
  //? would be rejected, which is exactly how a provider ends up listed but non-functional.
  eq(body.system, 'be terse', 'the system prompt is a TOP-LEVEL field, not a message');
  const messages = body.messages as { role: string }[];
  eq(messages.length, 1, 'only the user message is in the messages array');
  //? `max_tokens` is REQUIRED by this API — there is no "unset".
  assert(typeof body.max_tokens === 'number' && (body.max_tokens as number) > 0, 'max_tokens is always sent');
}
eq(anthropicText({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] }), 'ab', 'text blocks are concatenated and non-text blocks skipped');
eq(anthropicText(null), '', 'a malformed response yields empty text rather than throwing');

report('aiProviders');
