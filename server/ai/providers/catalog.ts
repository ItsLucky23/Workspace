//? What can be connected as a TEXT backend, as data.
//?
//? Two things the owner asked for shape this file:
//?
//? 1. SUBSCRIPTION vs API KEY is a real distinction, not a label. A subscription backend is signed in
//?    on the HOST and billed by seat — there is no key to paste and no model to pick. An api-key
//?    backend is metered and needs both. The settings page groups them, and the add-form shows a key
//?    field only where a key exists to enter.
//?
//? 2. "More providers that ACTUALLY work." So an entry is not a name — it names a TRANSPORT, which is
//?    a real implementation. Most metered hosts speak the OpenAI `/chat/completions` shape, so one
//?    tested transport serves all of them and a new host is genuinely one entry here. Anthropic's
//?    messages API is its own shape and has its own transport. A CLI subscription is a per-CLI
//?    implementation (session handling, capture hooks, permissions), which is why exactly one exists:
//?    adding a second is real work, not a line in this file, and listing one before it is built would
//?    be the "looks connected, fails at the first turn" failure this page was made to remove.
//? @adr 0007

//? `pi-cli` (ADR 0322) = the second subscription transport: pi on the Codex seat, headless-json for one-shot
//? features (the coding agent uses the same seat interactively — see orchestrator/codingAgents).
export type AiTransport = 'claude-cli' | 'pi-cli' | 'openai-compatible' | 'anthropic';

//? What a backend can actually take as INPUT. A request carrying images needs 'vision', one carrying
//? audio needs 'audio' — routing a speech-to-text turn at a text-only backend produced "no audio clip
//? was attached" as a transcript, so dispatch refuses such a candidate instead of letting it answer.
export type AiModality = 'text' | 'vision' | 'audio';

export interface AiModelChoice { id: string; label: string }

export interface AiProviderMeta {
  id: string;
  label: string;
  /** How it is paid for and signed in — decides the whole shape of its add-form. */
  kind: 'subscription' | 'api-key';
  /** Which implementation runs it. Several entries may share one. */
  transport: AiTransport;
  /** Offered in a dropdown. Empty ⇒ the backend has no model concept (a subscription CLI). */
  models: AiModelChoice[];
  defaultModel: string;
  /** Server-side only: the endpoint is infrastructure and is never rendered to a user. */
  baseUrl: string;
  /** Where to get a key, for the one thing this app cannot do for you. Empty for a subscription. */
  keyUrl: string;
  /** Env var an operator can set to override this backend's endpoint (proxy / self-host / gateway). */
  baseUrlEnv: string;
  /** Input modalities beyond text. Omitted ⇒ text only (the safe default for a host we have not verified). */
  modalities?: AiModality[];
}

/** The modalities a backend accepts; text is always included. */
export function providerModalities(meta: AiProviderMeta): AiModality[] {
  return ['text', ...(meta.modalities ?? []).filter((m) => m !== 'text')];
}

//? Model lists are a STARTING POINT, not a whitelist — every add-form keeps an "other" escape hatch,
//? because a model released after this file was written must not make its backend unreachable.
//? Named so the one transport that needs its own entry can import it WITHOUT an index lookup — the
//? record's value type is `| undefined` under strict indexing, and a cast to remove that would be
//? exactly the kind of paper-over this codebase forbids.
export const ANTHROPIC_META: AiProviderMeta = {
  id: 'anthropic-api', label: 'Anthropic API', kind: 'api-key', transport: 'anthropic',
  models: [
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-1', label: 'Claude Opus 4.1' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  defaultModel: 'claude-sonnet-4-5',
  baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys',
  baseUrlEnv: 'WS_ANTHROPIC_BASE_URL',
};

export const AI_PROVIDER_CATALOG: Record<string, AiProviderMeta> = {
  //? ---------------------------------------------------------------- subscription
  'claude-cli': {
    id: 'claude-cli', label: 'Claude Code', kind: 'subscription', transport: 'claude-cli',
    models: [], defaultModel: '', baseUrl: '', keyUrl: '', baseUrlEnv: '',
  },
  //? Codex (ChatGPT Plus/Pro) through pi — signed in on the host with `pi` → `/login`. Like Claude Code it
  //? is a seat, not a key: no model picker on connect (a feature route may still pin `codex-cli:<model>`;
  //? the coding-agent tiers have their own map). Text-only on the one-shot path.
  'codex-cli': {
    id: 'codex-cli', label: 'Codex (ChatGPT subscription)', kind: 'subscription', transport: 'pi-cli',
    models: [], defaultModel: '', baseUrl: '', keyUrl: '', baseUrlEnv: '',
  },

  //? ---------------------------------------------------------------- api key, native shapes
  'anthropic-api': ANTHROPIC_META,
  'gemini-api': {
    id: 'gemini-api', label: 'Gemini', kind: 'api-key', transport: 'openai-compatible', modalities: ['vision', 'audio'],
    //? P4-6 — short, currently-shipping; the live listing (P4-4) is the real source.
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    ],
    defaultModel: 'gemini-2.5-flash',
    //? Google publishes an OpenAI-compatible endpoint, so Gemini rides the same tested transport as
    //? every other metered host instead of carrying a second bespoke implementation.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey', baseUrlEnv: 'WS_GEMINI_BASE_URL',
  },

  //? ---------------------------------------------------------------- api key, OpenAI-compatible
  //? These are not "more names": each one is a host that speaks the transport above, so connecting one
  //? works the day it is added. That is the whole reason the transport is a first-class concept.
  'openai-api': {
    id: 'openai-api', label: 'OpenAI', kind: 'api-key', transport: 'openai-compatible', modalities: ['vision'],
    //? P4-6 — short, currently-shipping; the live listing (P4-4) is the real source.
    models: [
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini' },
      { id: 'gpt-5-nano', label: 'GPT-5 nano' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    ],
    defaultModel: 'gpt-5-mini',
    baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys',
    baseUrlEnv: 'WS_OPENAI_BASE_URL',
  },
  'openrouter-api': {
    id: 'openrouter-api', label: 'OpenRouter', kind: 'api-key', transport: 'openai-compatible', modalities: ['vision'],
    //? A gateway in front of many vendors — its model ids are `vendor/model`, and the "other" escape
    //? hatch matters more here than anywhere else, because its catalog changes weekly.
    models: [
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'openai/gpt-5', label: 'GPT-5' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    ],
    defaultModel: 'openai/gpt-5',
    baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys',
    baseUrlEnv: 'WS_OPENROUTER_BASE_URL',
  },
  'groq-api': {
    id: 'groq-api', label: 'Groq', kind: 'api-key', transport: 'openai-compatible',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (instant)' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
    ],
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys',
    baseUrlEnv: 'WS_GROQ_BASE_URL',
  },
  'deepseek-api': {
    id: 'deepseek-api', label: 'DeepSeek', kind: 'api-key', transport: 'openai-compatible',
    //? Stable aliases — DeepSeek moves these to each new V3.x release, so they stay current by themselves.
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat (V3.x)' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (thinking)' },
    ],
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys',
    baseUrlEnv: 'WS_DEEPSEEK_BASE_URL',
  },
  'mistral-api': {
    id: 'mistral-api', label: 'Mistral', kind: 'api-key', transport: 'openai-compatible',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest', label: 'Codestral' },
    ],
    defaultModel: 'mistral-medium-latest',
    baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys',
    baseUrlEnv: 'WS_MISTRAL_BASE_URL',
  },
  //? P4-5 — four more hosts that speak the same transport (ADR 0321: no Azure — its per-deployment URL
  //? scheme needs a transport tweak, deferred until there is a concrete need). Data only, by design.
  'xai-api': {
    id: 'xai-api', label: 'xAI (Grok)', kind: 'api-key', transport: 'openai-compatible',
    models: [
      { id: 'grok-4', label: 'Grok 4' },
      { id: 'grok-4-fast-reasoning', label: 'Grok 4 Fast (reasoning)' },
      { id: 'grok-4-fast-non-reasoning', label: 'Grok 4 Fast (non-reasoning)' },
      { id: 'grok-3-mini', label: 'Grok 3 mini' },
    ],
    defaultModel: 'grok-4-fast-non-reasoning',
    baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai/',
    baseUrlEnv: 'WS_XAI_BASE_URL',
  },
  'together-api': {
    id: 'together-api', label: 'Together', kind: 'api-key', transport: 'openai-compatible',
    //? Open-weight models under `org/Model` ids; the live listing (P4-4) is the real catalog here.
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B Turbo' },
    ],
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.xyz/settings/api-keys',
    baseUrlEnv: 'WS_TOGETHER_BASE_URL',
  },
  'fireworks-api': {
    id: 'fireworks-api', label: 'Fireworks', kind: 'api-key', transport: 'openai-compatible',
    //? Ids carry the `accounts/fireworks/models/` prefix — that IS the model name on this host.
    models: [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Llama 3.3 70B' },
      { id: 'accounts/fireworks/models/deepseek-v3', label: 'DeepSeek V3' },
      { id: 'accounts/fireworks/models/qwen2p5-72b-instruct', label: 'Qwen 2.5 72B' },
    ],
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    baseUrl: 'https://api.fireworks.ai/inference/v1', keyUrl: 'https://fireworks.ai/settings/users/api-keys',
    baseUrlEnv: 'WS_FIREWORKS_BASE_URL',
  },
  'cerebras-api': {
    id: 'cerebras-api', label: 'Cerebras', kind: 'api-key', transport: 'openai-compatible',
    models: [
      { id: 'llama-3.3-70b', label: 'Llama 3.3 70B' },
      { id: 'llama3.1-8b', label: 'Llama 3.1 8B' },
      { id: 'gpt-oss-120b', label: 'GPT-OSS 120B' },
      { id: 'qwen-3-32b', label: 'Qwen 3 32B' },
    ],
    defaultModel: 'llama-3.3-70b',
    baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai/platform',
    baseUrlEnv: 'WS_CEREBRAS_BASE_URL',
  },
  'local-openai': {
    id: 'local-openai', label: 'Local / self-hosted', kind: 'api-key', transport: 'openai-compatible',
    //? Ollama, llama.cpp, vLLM, LM Studio — anything serving the OpenAI shape on your own machine.
    //? The model name is whatever you pulled, so the list is a hint and "other" is the normal path.
    models: [
      { id: 'llama3.1', label: 'llama3.1' },
      { id: 'qwen2.5', label: 'qwen2.5' },
    ],
    defaultModel: 'llama3.1',
    baseUrl: 'http://localhost:11434/v1', keyUrl: '', baseUrlEnv: 'WS_LOCAL_AI_BASE_URL',
  },
};

export const AI_PROVIDER_LIST: AiProviderMeta[] = Object.values(AI_PROVIDER_CATALOG);

//? P4-3 — THE validation source for a provider id. Dispatch (`isAiProviderId`), the `save-ai-provider`
//? op, the assistant op-catalog enum and the connection ops all consume this; nothing keeps its own list.
//? A fresh copy each call so no consumer can mutate the catalog's key set.
export function knownAiProviderIds(): string[] {
  return Object.keys(AI_PROVIDER_CATALOG);
}
export const isKnownAiProviderId = (id: string): boolean => Object.hasOwn(AI_PROVIDER_CATALOG, id);

/** The endpoint a backend talks to: an operator env override, else its catalog default. */
export function providerBaseUrl(meta: AiProviderMeta): string {
  const override = meta.baseUrlEnv.length > 0 ? (process.env[meta.baseUrlEnv] ?? '').trim() : '';
  return override.length > 0 ? override : meta.baseUrl;
}
