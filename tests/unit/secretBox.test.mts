//? Unit test for the app-owned secret encryption (server/crypto/secretBox). No DB.
//? Exercises: round-trip with a key, tamper detection, the H2 fail-closed behaviour
//? (encrypt THROWS without a key, never emits `plain:`) + legacy `plain:`/0x00 decrypt
//? for migration. encryptionKey() reads process.env at call time, so one import +
//? toggling the env covers both paths.

import { assert, eq, report } from '../_helpers.mts';

const { encryptSecret, decryptSecret, encryptBuffer, decryptBuffer, encryptionConfigured, assertEncryptionConfigured } =
  await import('../../server/crypto/secretBox.ts');

// ---- with a key: round-trip + format + tamper ----
process.env.WORKSPACES_ENC_KEY = 'test-enc-key-please-rotate-0123456789';
{
  assert(encryptionConfigured(), 'encryptionConfigured() true with a key');
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

  // buffer envelope round-trips
  const blob = Buffer.from('binary\x00profile\xff');
  const encB = encryptBuffer(blob);
  assert(encB[0] === 0x01, 'blob envelope tagged 0x01 (encrypted)');
  eq(decryptBuffer(encB)?.toString('latin1'), blob.toString('latin1'), 'decryptBuffer round-trips');
}

// ---- no key: H2 fail-closed — encrypt THROWS, never emits plain: ----
delete process.env.WORKSPACES_ENC_KEY;
{
  assert(!encryptionConfigured(), 'encryptionConfigured() false without a key');

  let threw = false;
  try { encryptSecret('hello'); } catch { threw = true; }
  assert(threw, 'encryptSecret THROWS without a key (never emits plain:)');

  let threwBuf = false;
  try { encryptBuffer(Buffer.from('x')); } catch { threwBuf = true; }
  assert(threwBuf, 'encryptBuffer THROWS without a key');

  let threwAssert = false;
  try { assertEncryptionConfigured(); } catch { threwAssert = true; }
  assert(threwAssert, 'assertEncryptionConfigured THROWS without a key (loud boot fail)');

  // legacy dev data stays readable for migration
  eq(decryptSecret('plain:aGVsbG8='), 'hello', 'legacy plain: value still decrypts (migration)');
  eq(decryptBuffer(Buffer.concat([Buffer.from([0x00]), Buffer.from('legacy')]))?.toString('utf8'), 'legacy', 'legacy 0x00 blob still decrypts');
}

report('tests/unit/secretBox.test.mts');
