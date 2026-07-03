//? Test for the editor-profile encryption-at-rest primitives (#14). The profile carries extension
//? auth tokens, so the at-rest blob must be AES-256-GCM encrypted (secretBox.encryptBuffer): a
//? round-trip recovers the bytes, the ciphertext does NOT contain the plaintext, a flipped byte
//? fails the auth-tag (tamper → null), and the no-key dev fallback still round-trips.

import { assert, eq, report } from '../_helpers.mts';

//? Ensure a key is configured for the encrypted-path assertions (secretBox reads env per call).
process.env.WORKSPACES_ENC_KEY = 'test-editor-profile-key-do-not-use-in-prod';
const sb = await import('../../server/crypto/secretBox');

try {
  const secretTar = Buffer.from('PROFILE-TAR:github_pat_SECRET_TOKEN_123 + settings + secret-storage', 'utf8');

  // ---- encrypted round-trip ----
  const enc = sb.encryptBuffer(secretTar);
  assert(enc[0] === 0x01, 'a configured key produces the v1 (0x01) envelope');
  assert(!enc.includes(secretTar), 'the ciphertext does NOT contain the plaintext (token not on disk in the clear)');
  const dec = sb.decryptBuffer(enc);
  assert(dec !== null && dec.equals(secretTar), 'decryptBuffer recovers the exact original bytes');

  // ---- tamper detection ----
  const tampered = Buffer.from(enc);
  tampered[tampered.length - 1] ^= 0xff; // flip a ciphertext byte
  eq(sb.decryptBuffer(tampered), null, 'a flipped ciphertext byte fails the GCM auth-tag → null');
  const truncated = enc.subarray(0, 10);
  eq(sb.decryptBuffer(truncated), null, 'a truncated envelope → null (not a crash)');

  // ---- wrong key ----
  const encWithKey = sb.encryptBuffer(secretTar);
  process.env.WORKSPACES_ENC_KEY = 'a-completely-different-key';
  eq(sb.decryptBuffer(encWithKey), null, 'a different key cannot decrypt (auth-tag mismatch)');

  // ---- no-key dev fallback still round-trips ----
  delete process.env.WORKSPACES_ENC_KEY;
  const plainEnc = sb.encryptBuffer(secretTar);
  assert(plainEnc[0] === 0x00, 'no key → the 0x00 (plaintext) dev envelope');
  const plainDec = sb.decryptBuffer(plainEnc);
  assert(plainDec !== null && plainDec.equals(secretTar), 'the no-key fallback still round-trips the bytes');

  // ---- empty ----
  eq(sb.decryptBuffer(Buffer.alloc(0)), null, 'an empty buffer → null');

  // ---- #14 Open VSX gallery env (extensions resolve from open-vsx.org, not the MS marketplace) ----
  const es = await import('../../server/container/editorServer');
  const prefix = es.openVsxEnvPrefix();
  assert(prefix.includes('open-vsx.org'), 'the editor launch env points the extensions gallery at Open VSX');
  assert(prefix.startsWith("EXTENSIONS_GALLERY='") && prefix.trim().endsWith("'"), 'the gallery env is single-quoted for shell safety');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/editorProfileCrypto.test.mts');
