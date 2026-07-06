//? Test for the publishing OAuth connect state (FIX-C, ADR 0092). The `state` that survives the external
//? OAuth round-trip is an ENCRYPTED {workspaceId,userId,platform,exp} blob (secretBox), so it is both
//? CSRF-safe (an attacker can't forge it) and carries the workspace. Asserts the round-trip + that a
//? tampered / wrong-key / garbage / different-platform state is rejected.

import { assert, eq, report } from '../_helpers.mts';

process.env.WORKSPACES_ENC_KEY = 'test-oauth-state-key-do-not-use-in-prod';
const { encodeOAuthState, decodeOAuthState } = await import('../../server/content/publishRoute');

try {
  const state = { workspaceId: 'ws_123', userId: 'user_456', platform: 'youtube' as const, exp: 4102444800000 };

  // ---- round-trip ----
  const encoded = encodeOAuthState(state);
  assert(!encoded.includes('ws_123'), 'the encoded state does NOT contain the workspaceId in the clear');
  const decoded = decodeOAuthState(encoded);
  assert(decoded !== null, 'a valid state decodes');
  eq(decoded?.workspaceId, 'ws_123', 'the workspaceId round-trips');
  eq(decoded?.platform, 'youtube', 'the platform round-trips');

  // ---- tamper (flip a middle byte of the ciphertext) ----
  const rawB64 = decodeURIComponent(encoded);
  const mid = Math.floor(rawB64.length / 2);
  const tampered = encodeURIComponent(`${rawB64.slice(0, mid)}${rawB64[mid] === 'A' ? 'B' : 'A'}${rawB64.slice(mid + 1)}`);
  eq(decodeOAuthState(tampered), null, 'a tampered state → null (auth-tag mismatch)');

  // ---- wrong key ----
  process.env.WORKSPACES_ENC_KEY = 'a-totally-different-key';
  eq(decodeOAuthState(encoded), null, 'a state encrypted under a different key → null');
  process.env.WORKSPACES_ENC_KEY = 'test-oauth-state-key-do-not-use-in-prod';

  // ---- garbage ----
  eq(decodeOAuthState('not-a-real-state'), null, 'garbage → null (no crash)');

  // ---- unknown platform in the blob is rejected by the shape-guard ----
  const badPlatform = encodeOAuthState({ workspaceId: 'ws', userId: 'u', platform: 'instagram' as never, exp: 4102444800000 });
  eq(decodeOAuthState(badPlatform), null, 'a state naming a non-OAuth platform → null');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/publishOAuthRoute.test.mts');
