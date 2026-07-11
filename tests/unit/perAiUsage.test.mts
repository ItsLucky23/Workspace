//? Per-AI usage/cost (Phase 2) — the pure spend functions. `priceFor` prices metered models (Claude = 0 =
//? Max subscription; Gemini = metered; WS_MODEL_PRICE_PER_1K_JSON overrides), and `aggregateByAi` groups
//? SpendRecord rows per AI (provider+feature) with the subscription flag. No DB — pure over injected rows.
import { priceFor, aggregateByAi, aggregateUsage, type SpendRow } from '../../server/spend/record.ts';
import { assert, eq, report } from '../_helpers.mts';

// priceFor — Claude models are absent → 0 (subscription); Gemini has a metered default.
eq(priceFor('claude-sonnet-4'), 0, 'a Claude model is subscription (price 0)');
eq(priceFor('gemini-2.5-flash'), 0.0015, 'gemini-2.5-flash has its metered default price');
eq(priceFor('totally-unknown-model'), 0, 'an unknown model defaults to 0');

// priceFor — the env override is merged over the defaults (parsed per call, so setting it here takes effect).
process.env.WS_MODEL_PRICE_PER_1K_JSON = '{"gemini-2.5-flash":0.99,"my-model":0.5}';
eq(priceFor('gemini-2.5-flash'), 0.99, 'env override wins over the default price');
eq(priceFor('my-model'), 0.5, 'env override adds a new model price');
delete process.env.WS_MODEL_PRICE_PER_1K_JSON;

// aggregateByAi — mixed rows group into per-(provider,feature) buckets with sums + subscription flag.
const now = new Date('2026-07-11T12:00:00Z');
const rows: SpendRow[] = [
  { ticketId: 't1', tokensIn: 100, tokensOut: 50, createdAt: now, providerId: 'claude-cli', feature: 'pipeline-agent', costEstimate: 0 },
  { ticketId: 't2', tokensIn: 40, tokensOut: 60, createdAt: now, providerId: 'claude-cli', feature: 'pipeline-agent', costEstimate: 0 },
  { ticketId: null, tokensIn: 200, tokensOut: 300, createdAt: now, providerId: 'gemini-api', feature: 'script', costEstimate: 0.75 },
  { ticketId: null, tokensIn: 10, tokensOut: 5, createdAt: now, providerId: null, feature: null, costEstimate: 0 },
];
const byAi = aggregateByAi(rows);
eq(byAi.length, 3, 'three buckets: claude/pipeline-agent, gemini/script, unknown');

const claude = byAi.find((b) => b.providerId === 'claude-cli');
assert(claude !== undefined, 'the claude bucket exists');
eq(claude?.turns, 2, 'claude bucket merged two turns');
eq((claude?.tokensIn ?? 0) + (claude?.tokensOut ?? 0), 250, 'claude bucket summed tokens');
eq(claude?.subscription, true, 'claude is flagged subscription');
eq(claude?.costEstimate, 0, 'claude subscription has no metered cost');
eq(claude?.providerLabel, 'Claude (CLI)', 'claude gets its human label');

const gemini = byAi.find((b) => b.providerId === 'gemini-api');
eq(gemini?.subscription, false, 'gemini is metered, not subscription');
eq(gemini?.costEstimate, 0.75, 'gemini bucket carries the real cost');
eq(gemini?.providerLabel, 'Gemini API', 'gemini gets its human label');

const unknown = byAi.find((b) => b.providerId === 'unknown');
assert(unknown !== undefined, 'a null-provider row lands in the unknown bucket');
eq(unknown?.feature, 'unknown', 'null feature becomes the unknown feature');

// sorted by total tokens desc: gemini (500) > claude (250) > unknown (15)
eq(byAi[0]?.providerId, 'gemini-api', 'the highest-token AI sorts first');
eq(byAi[2]?.providerId, 'unknown', 'the lowest-token AI sorts last');

// aggregateUsage — the full read now carries byAi (regression on the existing byTicket/totals).
const usage = aggregateUsage(rows, new Map([['t1', 'DEV-1'], ['t2', 'DEV-2']]), now.getTime());
eq(usage.byAi.length, 3, 'aggregateUsage exposes the per-AI breakdown');
eq(usage.totalTurns, 4, 'aggregateUsage still counts every turn');
assert(usage.byTicket.some((t) => t.ticketKey === 'DEV-1'), 'aggregateUsage still maps per-ticket usage');

report('tests/unit/perAiUsage.test.mts');
