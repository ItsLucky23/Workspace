//? ADR 0007 — the OpenAI-compatible backend's wire shape, and the catalog the settings page renders
//? itself from.
//?
//? Unit-tested because the failure mode is a 400 or a 404 that reads as "the AI is broken" and gives
//? the user nothing to act on. The endpoint and the body are the entire contract with every host that
//? speaks this API — OpenAI, Azure OpenAI, OpenRouter, Groq, a local Ollama.

import { openAiBody, openAiEndpoint } from '../../server/ai/providers/openaiApi.ts';
import { AI_PROVIDER_CATALOG } from '../../server/ai/providers/catalog.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ the endpoint */

eq(openAiEndpoint('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions', 'the default host resolves to /chat/completions');
//? A pasted base URL almost always has a trailing slash; doubling it 404s on several hosts.
eq(openAiEndpoint('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions', 'a trailing slash is trimmed rather than doubled');
//? The endpoint is an OPERATOR setting, never a UI field — this is what that setting buys.
eq(openAiEndpoint('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions', 'a local OpenAI-compatible server is reachable by changing one env var');
eq(openAiEndpoint('  '), `${AI_PROVIDER_CATALOG['openai-api'].defaultBaseUrl}/chat/completions`, 'a blank endpoint falls back to the catalog default, never to an empty URL');

/* ------------------------------------------------------------ the body */

{
  const body = openAiBody({ prompt: 'hello' }, 'gpt-4o-mini', null);
  eq(body.model, 'gpt-4o-mini', 'the resolved model is sent');
  const messages = body.messages as { role: string; content: string }[];
  eq(messages.length, 1, 'no system message is invented when the caller sent none');
  eq(messages[0]?.role, 'user', 'the prompt is the user message');
  //? Omitted, not null: several compatible hosts reject `temperature: null` outright.
  assert(!('temperature' in body), 'a null temperature is omitted rather than sent as null');
}

{
  const body = openAiBody({ prompt: 'hello', system: 'be terse' }, 'gpt-4o', 0.4);
  const messages = body.messages as { role: string; content: string }[];
  eq(messages.length, 2, 'a system prompt adds a message');
  //? System FIRST — the same position the other backends give it, so one feature's prompt behaves the
  //? same whichever backend answers it.
  eq(messages[0]?.role, 'system', 'the system message comes first');
  eq(messages[0]?.content, 'be terse', '…carrying the system text verbatim');
  eq(messages[1]?.role, 'user', 'the prompt follows it');
  eq(body.temperature, 0.4, 'a set temperature is sent');
}

/* ------------------------------------------------------------ the catalog the UI renders from */

//? The add-form is generated from this. An entry that offers a key field with nowhere to get a key,
//? or a model dropdown with nothing in it, is a broken settings page that typechecks fine.
for (const meta of Object.values(AI_PROVIDER_CATALOG)) {
  if (meta.auth !== 'api-key') continue;
  assert(meta.models.length > 0, `${meta.id} offers at least one predefined model`);
  assert(meta.models.some((m) => m.id === meta.defaultModel), `${meta.id}'s default model is one of the ones it offers`);
  assert(meta.defaultBaseUrl.startsWith('http'), `${meta.id} has a real default endpoint`);
  assert(meta.keyUrl.startsWith('http'), `${meta.id} says where to get a key`);
}
//? …and the host-CLI backend must NOT claim a key or a model, or the add-form would render two boxes
//? that cannot do anything — the exact dead end this work removed.
eq(AI_PROVIDER_CATALOG['claude-cli'].auth, 'host-cli', 'the subscription CLI is not an api-key backend');
eq(AI_PROVIDER_CATALOG['claude-cli'].models.length, 0, '…and offers no model choice, because it has none');

report('openaiProvider');
