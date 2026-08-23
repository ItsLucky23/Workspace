//? Unit tests for the coding-agent seam (ADR 0322): the config normaliser (Codex ⇒ pi forced, tier-model
//? fallback), the pi turn argv, the pi auth-check/auth-merge helpers, the pi ready markers, and the pi
//? extension's deny-rule enforcement (pi has no permission system — the extension honours the stage's
//? `permissions.deny` set itself). Pure functions only — no docker, no PTY.

import { assert, eq, report } from '../_helpers.mts';

const {
  DEFAULT_CODING_AGENT, DEFAULT_TIER_MODELS, harnessFor, normalizeCodingAgent, parseStoredCodingAgent,
  formatCodingAgent, resolveTierModel,
} = await import('../../server/orchestrator/codingAgents/config.ts');
const { buildPiTurnArgs, newerPiAuth, piAuthCheckOk, matchesPiReady, PI_SESSION_DIR, PI_EXTENSION } = await import('../../server/orchestrator/codingAgents/piAgent.ts');
const { adapterFor } = await import('../../server/orchestrator/codingAgents/index.ts');
const { parseDenyRules, deniedBy } = await import('../../docker/pi/workspaces.ts');

// 1) the harness rule: Codex is only reachable through pi, whatever is requested
eq(harnessFor('codex', 'claude-code'), 'pi-agent', 'a Codex seat is forced onto pi');
eq(harnessFor('claude', undefined), 'claude-code', 'a Claude seat defaults to Claude Code');
eq(harnessFor('claude', 'pi-agent'), 'pi-agent', 'a Claude seat may explicitly pick pi');

// 2) normalise: unknown seat → defaults; partial/invalid tier models fall back per tier
{
  const cfg = normalizeCodingAgent({ subscription: 'copilot' });
  eq(cfg.subscription, DEFAULT_CODING_AGENT.subscription, 'unknown subscription falls back to the default seat');
  const codex = normalizeCodingAgent({ subscription: 'codex', harness: 'claude-code', tierModels: { sonnet: 'gpt-5.5' } });
  eq(codex.harness, 'pi-agent', 'normalise applies the forced harness');
  eq(codex.tierModels.sonnet, 'gpt-5.5', 'a provided tier model is kept');
  eq(codex.tierModels.opus, DEFAULT_TIER_MODELS['codex/pi-agent'].opus, 'a missing tier falls back to the pair default');
  const bad = normalizeCodingAgent({ subscription: 'claude', tierModels: { haiku: 'no spaces allowed!' } });
  eq(bad.tierModels.haiku, 'haiku', 'an invalid model id falls back rather than reaching the runner');
}

// 3) stored JSON round-trip; corrupt rows never throw
{
  const cfg = normalizeCodingAgent({ subscription: 'codex' });
  eq(parseStoredCodingAgent(formatCodingAgent(cfg)).tierModels.opus, cfg.tierModels.opus, 'format → parse round-trips');
  eq(parseStoredCodingAgent('{not json').subscription, 'claude', 'corrupt stored value is the default, not a throw');
  eq(parseStoredCodingAgent(null).harness, 'claude-code', 'missing row is the default config');
}
eq(resolveTierModel(normalizeCodingAgent({ subscription: 'codex' }), 'sonnet'), DEFAULT_TIER_MODELS['codex/pi-agent'].sonnet, 'resolveTierModel reads the configured map');

// 4) adapterFor picks the harness the config names
eq(adapterFor(normalizeCodingAgent({ subscription: 'claude' })).id, 'claude-code', 'claude/claude-code → claude adapter');
eq(adapterFor(normalizeCodingAgent({ subscription: 'codex' })).id, 'pi-agent', 'codex → pi adapter');

// 5) the pi turn argv
{
  const args = buildPiTurnArgs('codex', { model: 'gpt-5.6-sol', effort: 'high', resumeSessionId: 'sess-1' });
  const s = args.join(' ');
  assert(s.includes('--provider openai-codex'), 'codex seat rides the openai-codex provider');
  assert(s.includes('--model gpt-5.6-sol'), 'the resolved tier model is passed');
  assert(s.includes('--thinking high'), 'StageEffort maps onto --thinking');
  assert(s.includes('--session-id sess-1'), 'a resume passes the exact session id');
  assert(s.includes(`--session-dir ${PI_SESSION_DIR}`), 'sessions live on the /work volume');
  assert(s.includes(`--no-extensions -e ${PI_EXTENSION}`), 'exactly the Workspaces extension is loaded');
  assert(s.includes('--approve'), 'the project-trust prompt is pre-approved');
  const fresh = buildPiTurnArgs('claude', {});
  assert(fresh.join(' ').includes('--provider anthropic'), 'claude seat rides the anthropic provider');
  assert(!fresh.includes('--session-id'), 'no resume id on a fresh turn');
}

// 6) pi auth check parsing — only an explicit `ready` counts
assert(piAuthCheckOk(0, '{"status":"ready","provider":"openai-codex"}'), 'ready → ok');
assert(!piAuthCheckOk(0, '{"status":"not_ready"}'), 'not_ready → not ok');
assert(!piAuthCheckOk(1, '{"status":"ready"}'), 'non-zero exit → not ok even if the body says ready');
assert(!piAuthCheckOk(0, 'garbage'), 'unparseable → not ok');

// 7) auth-file merge: the fresher refresh token wins, per provider
{
  const older = JSON.stringify({ 'openai-codex': { type: 'oauth', expires: 100 } });
  const newer = JSON.stringify({ 'openai-codex': { type: 'oauth', expires: 200 } });
  eq(newerPiAuth(older, newer, 'openai-codex'), newer, 'the higher expires wins');
  eq(newerPiAuth(newer, older, 'openai-codex'), newer, '…in either argument order');
  eq(newerPiAuth(null, newer, 'openai-codex'), newer, 'a missing side yields the present one');
  eq(newerPiAuth('{bad', newer, 'openai-codex'), newer, 'a corrupt side yields the parseable one');
  eq(newerPiAuth(older, older, 'openai-codex'), older, 'a tie keeps the first (host) copy');
}

// 8) pi TUI ready markers
assert(matchesPiReady('────────────────────────────────────────'), 'footer rule detected');
assert(matchesPiReady('$0.002 (sub)'), 'subscription usage cell detected');
assert(matchesPiReady('0.9%/272k (auto)'), 'context cell detected');
assert(!matchesPiReady('loading extensions...'), 'boot noise is not ready');

// 9) the extension's deny-rule enforcement (the stage's permissions.deny, honoured by the extension)
{
  const rules = parseDenyRules(JSON.stringify({ permissions: { deny: ['Bash(cat /auth/*:*)', 'Read(/auth/**)', 'WebFetch', 42, 'weird(('] } }));
  eq(rules.length, 3, 'three parseable deny rules (non-strings and unknown shapes ignored)');
  assert(deniedBy(rules, 'bash', { command: 'cat /auth/token' }) !== null, 'a denied bash prefix blocks');
  eq(deniedBy(rules, 'bash', { command: 'ls /work' }), null, 'an unrelated command passes');
  assert(deniedBy(rules, 'read', { path: '/auth/creds.json' }) !== null, 'a denied path blocks reads');
  assert(deniedBy(rules, 'edit', { file_path: '/auth/creds.json' }) !== null, '…and edits, via file_path');
  assert(deniedBy(rules, 'webfetch', {}) !== null, 'a bare tool deny blocks the tool');
  eq(deniedBy([], 'bash', { command: 'anything' }), null, 'no rules → nothing blocked');
}

report('tests/unit/codingAgents.test.mts');
