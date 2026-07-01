//? Unit test for the app-owned secret encryption (server/crypto/secretBox). No DB.
//? Exercises: round-trip with a key, tamper detection, the no-key plaintext fallback.
//? encryptionKey() reads process.env at call time, so one import + toggling the env
//? covers both paths.

import { assert, eq, report } from '../_helpers.mts';

const { encryptSecret, decryptSecret } = await import('../../server/crypto/secretBox.ts');

// ---- with a key: round-trip + format + tamper ----
process.env.WORKSPACES_ENC_KEY = 'test-enc-key-please-rotate-0123456789';
{
  const plain = 'glpat-SECRET-token-value';
  const enc = encryptSecret(plain);
  assert(enc.startsWith('v1:'), 'encrypted value uses the v1: envelope');
  assert(!enc.includes(plain), 'ciphertext does not contain the plaintext');
  eq(decryptSecret(enc), plain, 'decrypt round-trips the plaintext');

  // tamper: flip a char in the ciphertext body → auth-tag fails → null (no throw)
  const parts = enc.split(':');
  const ct = parts[3] ?? '';
  const tampered = `${parts[0] ?? ''}:${parts[1] ?? ''}:${parts[2] ?? ''}:${(ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)}`;
  eq(decryptSecret(tampered), null, 'tampered ciphertext fails closed (null)');
  eq(decryptSecret('garbage'), null, 'non-envelope input returns null');
}

// ---- no key: plaintext fallback, still reversible ----
delete process.env.WORKSPACES_ENC_KEY;
{
  const enc = encryptSecret('hello');
  assert(enc.startsWith('plain:'), 'no key → plain: fallback marker');
  eq(decryptSecret(enc), 'hello', 'plain: fallback still decrypts');
}

report('tests/unit/secretBox.test.mts');
