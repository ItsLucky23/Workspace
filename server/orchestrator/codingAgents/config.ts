//? Coding-agent CONFIG (CODING_AGENT_PROGRAM.md §2.1, ADR 0322) — which subscription seat pays for the
//? code-writing pipeline agent and which interactive harness runs it in the container PTY. Pure: parse /
//? normalise / default. Stored as ONE EnvVar (`__coding_agent`, JSON) per workspace; written only by the
//? Conductor's `save-coding-agent` op (B-23). The harness rule is enforced HERE, not in the UI: a Codex seat
//? can only be driven by pi, whatever a payload says.
//? @adr 0322

import { tryCatchSync } from '@luckystack/core';

import type { CodingAgentConfig, CodingHarness, CodingSubscription, StageModelTier } from '../../../src/workspaces/_data/types';

export const CODING_AGENT_KEY = '__coding_agent';

export const CODING_SUBSCRIPTIONS: readonly CodingSubscription[] = ['claude', 'codex'];
export const CODING_HARNESSES: readonly CodingHarness[] = ['claude-code', 'pi-agent'];

//? Tier → model per (seat, harness). Claude Code resolves its own tier aliases; pi needs real ids on both
//? providers (`pi --list-models anthropic|openai-codex`).
export const DEFAULT_TIER_MODELS: Record<`${CodingSubscription}/${CodingHarness}`, Record<StageModelTier, string>> = {
  'claude/claude-code': { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
  'claude/pi-agent': { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-5', opus: 'claude-opus-5' },
  'codex/pi-agent': { haiku: 'gpt-5.4-mini', sonnet: 'gpt-5.6-luna', opus: 'gpt-5.6-sol' },
  //? Unreachable (a Codex seat is forced onto pi) — present so the record type is total.
  'codex/claude-code': { haiku: 'gpt-5.4-mini', sonnet: 'gpt-5.6-luna', opus: 'gpt-5.6-sol' },
};

//? Model suggestions per (seat, harness) — a starting list, not a whitelist: the tier inputs accept any id.
export const MODEL_SUGGESTIONS: Record<`${CodingSubscription}/${CodingHarness}`, string[]> = {
  'claude/claude-code': ['opus', 'sonnet', 'haiku'],
  'claude/pi-agent': ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5'],
  'codex/pi-agent': ['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
  'codex/claude-code': [],
};

//? The pi provider id per seat (`--provider`).
export const PI_PROVIDER: Record<CodingSubscription, string> = { claude: 'anthropic', codex: 'openai-codex' };

export const DEFAULT_CODING_AGENT: CodingAgentConfig = { subscription: 'claude', harness: 'claude-code', tierModels: DEFAULT_TIER_MODELS['claude/claude-code'] };

const isSubscription = (v: unknown): v is CodingSubscription => typeof v === 'string' && (CODING_SUBSCRIPTIONS as readonly string[]).includes(v);
const isHarness = (v: unknown): v is CodingHarness => typeof v === 'string' && (CODING_HARNESSES as readonly string[]).includes(v);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

//? Forced harness per seat: Codex is only reachable through pi; Claude may use either.
export function harnessFor(subscription: CodingSubscription, requested: CodingHarness | undefined): CodingHarness {
  if (subscription === 'codex') return 'pi-agent';
  return requested ?? 'claude-code';
}

//? Normalise an untrusted payload/stored value into a complete config. Unknown seat → defaults; unknown or
//? empty tier models fall back to the seat's defaults, so a partially-filled map never reaches the runner.
export function normalizeCodingAgent(raw: unknown): CodingAgentConfig {
  const obj = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const subscription: CodingSubscription = isSubscription(obj.subscription) ? obj.subscription : 'claude';
  const harness = harnessFor(subscription, isHarness(obj.harness) ? obj.harness : undefined);
  const tiers = obj.tierModels !== null && typeof obj.tierModels === 'object' ? obj.tierModels as Record<string, unknown> : {};
  const defaults = DEFAULT_TIER_MODELS[`${subscription}/${harness}`];
  const pick = (tier: StageModelTier): string => {
    const v = tiers[tier];
    return typeof v === 'string' && MODEL_ID.test(v.trim()) ? v.trim() : defaults[tier];
  };
  return { subscription, harness, tierModels: { haiku: pick('haiku'), sonnet: pick('sonnet'), opus: pick('opus') } };
}

//? Stored JSON → config (a missing/corrupt row is the default, never a throw).
export function parseStoredCodingAgent(value: string | null | undefined): CodingAgentConfig {
  if (!value) return DEFAULT_CODING_AGENT;
  const [error, parsed] = tryCatchSync(() => JSON.parse(value) as unknown);
  return error ? DEFAULT_CODING_AGENT : normalizeCodingAgent(parsed);
}

export function formatCodingAgent(cfg: CodingAgentConfig): string {
  return JSON.stringify(normalizeCodingAgent(cfg));
}

//? The concrete model for a stage's resolved tier. A Claude tier alias on claude-code is passed through as
//? the alias (the CLI resolves it); anything else is the configured literal.
export function resolveTierModel(cfg: CodingAgentConfig, tier: StageModelTier): string {
  return cfg.tierModels[tier];
}
