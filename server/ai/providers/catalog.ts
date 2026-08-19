//? What each TEXT backend needs to be set up, as data rather than as three hardcoded Gemini fields.
//?
//? The AI-behaviour page used to be Gemini-shaped: a free-text model box, a free-text base URL, a
//? temperature, and nothing at all for Claude — while Gemini's KEY lived on the Content settings page
//? next to ElevenLabs and Suno. Two things were wrong with that. Media providers belong with media;
//? the text backend that runs the whole product does not. And a model name you have to type from
//? memory is a field that is wrong more often than it is right.
//?
//? So: one entry per backend, carrying how it authenticates, which models it offers, and what its
//? defaults are. The settings UI renders itself from this — adding a backend is an entry here plus a
//? provider implementation, never another hand-built settings panel.
//? @adr 0007

import type { AiProviderId } from '../types';

export interface AiModelChoice { id: string; label: string }

export interface AiProviderMeta {
  id: AiProviderId;
  label: string;
  //? `host-cli` = installed and signed in on the SERVER; there is nothing to type in the app, and a
  //? key field for it would be a lie. `api-key` = a per-workspace secret this page can take.
  auth: 'host-cli' | 'api-key';
  /** Offered in a dropdown. Empty ⇒ the backend has no model concept (the subscription CLI). */
  models: AiModelChoice[];
  defaultModel: string;
  /** Pre-filled, editable for a proxy/self-host. Empty ⇒ the backend has no endpoint to point. */
  defaultBaseUrl: string;
  supportsTemperature: boolean;
  /** Where to get the key, for the one thing this app genuinely cannot do for you. */
  keyUrl: string;
}

//? Model lists are deliberately short and current-generation. They are a STARTING POINT, not a
//? whitelist: every provider row keeps an "other" escape hatch, because a model released after this
//? file was written must not make the product unusable.
export const AI_PROVIDER_CATALOG: Record<AiProviderId, AiProviderMeta> = {
  'claude-cli': {
    id: 'claude-cli',
    label: 'Claude',
    auth: 'host-cli',
    models: [],
    defaultModel: '',
    defaultBaseUrl: '',
    supportsTemperature: false,
    keyUrl: '',
  },
  'gemini-api': {
    id: 'gemini-api',
    label: 'Gemini',
    auth: 'api-key',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
    defaultModel: 'gemini-2.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsTemperature: true,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  'openai-api': {
    id: 'openai-api',
    label: 'OpenAI',
    auth: 'api-key',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
    defaultModel: 'gpt-4o-mini',
    //? OpenAI-COMPATIBLE, not OpenAI-only: the same shape reaches Azure OpenAI, OpenRouter, Groq,
    //? Together and a local llama.cpp/Ollama server. Changing this one field is how you get there.
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsTemperature: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
};

export const AI_PROVIDER_LIST: AiProviderMeta[] = Object.values(AI_PROVIDER_CATALOG);
