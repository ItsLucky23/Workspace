//? Unit test for PTY prompt-ready detection (server/orchestrator/ptyReady, C4). No PTY — the output
//? buffer + clock are injected. Verifies the trust/ready markers, and that waitForOutput early-exits
//? once the marker appears but falls back to a bounded timeout (never a hang) when it never does.

import { assert, eq, report } from '../_helpers.mts';

const { matchesTrustPrompt, matchesReady, matchesTrustOrReady, waitForOutput } = await import('../../server/orchestrator/ptyReady.ts');

// 1) marker predicates
assert(matchesTrustPrompt('Do you trust the files in this folder?'), 'trust prompt detected');
assert(matchesReady('? for shortcuts'), 'ready hint detected');
assert(matchesReady('╭──────────╮'), 'boxed prompt border detected');
assert(!matchesReady('just booting up...'), 'plain boot noise is not ready');
assert(matchesTrustOrReady('welcome to Claude Code'), 'trust-or-ready matches the welcome banner');

// 2) early-exit once the buffer shows ready — resolves true well before the ceiling
{
  let buffer = 'booting';
  let ticks = 0;
  const sleepFn = async (): Promise<void> => { ticks += 1; if (ticks === 3) buffer = '│ > '; };
  let clock = 0;
  const ok = await waitForOutput(() => buffer, matchesReady, { timeoutMs: 100_000, pollMs: 10, now: () => (clock += 10), sleepFn });
  assert(ok, 'returns true once the prompt appears');
  eq(ticks, 3, 'stopped polling as soon as ready');
}

// 3) never ready → bounded timeout returns false (no hang), does not throw
{
  let clock = 0;
  const ok = await waitForOutput(() => 'never ready', matchesReady, { timeoutMs: 50, pollMs: 10, now: () => (clock += 20), sleepFn: async () => undefined });
  assert(!ok, 'times out to false when the marker never appears');
}

report('tests/unit/ptyReady.test.mts');
