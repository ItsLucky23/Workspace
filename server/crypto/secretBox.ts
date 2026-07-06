//? Workspaces — app-owned symmetric encryption for per-workspace secrets (B-07).
//?
//? Used to encrypt credentials the app must store + later replay to a third party
//? (the per-workspace GitLab token → `Workspace.gitlabTokenEnc`). AES-256-GCM with a
//? single app key from `WORKSPACES_ENC_KEY` (any string; hashed to 32 bytes). The key
//? is resolved at boot like every other env (a secret-manager pointer or a literal).
//?
//? Format: `v1:<iv_b64>:<tag_b64>:<ct_b64>`. The key is MANDATORY (H2 fail-closed):
//? `encryptSecret`/`encryptBuffer` THROW when `WORKSPACES_ENC_KEY` is unset rather than
//? silently storing plaintext — a `plain:` secret in production is unacceptable. Boot
//? asserts the key up-front via `assertEncryptionConfigured` (server.ts). `decrypt*` still
//? transparently reads any LEGACY `plain:`/0x00 dev values so pre-hardening data stays
//? readable during migration (re-save such secrets to encrypt them at rest).
//? Spec: docs/decisions/0004-app-owned-secret-encryption.md + 0074 (H2 fail-closed).

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

function encryptionKey(): Buffer | null {
  const raw = process.env.WORKSPACES_ENC_KEY;
  if (raw === undefined || raw === '') return null;
  //? Hash to a fixed 32 bytes so any key length/encoding works.
  return createHash('sha256').update(raw).digest();
}

const NO_KEY_MESSAGE =
  'WORKSPACES_ENC_KEY is not set — refusing to store a secret UNENCRYPTED (H2 fail-closed). ' +
  'Set WORKSPACES_ENC_KEY (a secret-manager pointer or a literal) in the environment before storing credentials.';

//? True when a key is configured. Cheap boot/precondition check.
export function encryptionConfigured(): boolean {
  return encryptionKey() !== null;
}

//? Loud boot-time guarantee that at-rest encryption is available (H2). Call once
//? after secrets resolve; throws a clear fatal so the server never boots into a
//? state where a stored credential would land as plaintext.
export function assertEncryptionConfigured(): void {
  if (!encryptionConfigured()) throw new Error(`[secretBox] ${NO_KEY_MESSAGE}`);
}

//? Encrypt a secret for at-rest storage. THROWS (fail-closed) when no key is
//? configured — never emits a `plain:` fallback.
export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  if (!key) throw new Error(`[secretBox] ${NO_KEY_MESSAGE}`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

//? Encrypt a BINARY blob for at-rest storage (#14 editor-profile). Same key + AES-256-GCM as
//? `encryptSecret`, but a compact binary envelope (no base64) for large blobs like a profile tar:
//?   [0x01][12-byte iv][16-byte tag][ciphertext]
//? THROWS (fail-closed) when no key is configured. `decryptBuffer` still reads the legacy
//? 0x00-plaintext envelope from before H2 for migration.
export function encryptBuffer(plain: Buffer): Buffer {
  const key = encryptionKey();
  if (!key) throw new Error(`[secretBox] ${NO_KEY_MESSAGE}`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([0x01]), iv, cipher.getAuthTag(), ciphertext]);
}

//? Decrypt a blob produced by `encryptBuffer`. Returns null on a malformed envelope, a missing key,
//? or a failed auth-tag (tamper / wrong key).
export function decryptBuffer(stored: Buffer): Buffer | null {
  if (stored.length === 0) return null;
  const version = stored[0];
  if (version === 0x00) return stored.subarray(1);
  if (version !== 0x01 || stored.length < 29) return null;
  const key = encryptionKey();
  if (!key) return null;
  const iv = stored.subarray(1, 13);
  const tag = stored.subarray(13, 29);
  const ciphertext = stored.subarray(29);
  // eslint-disable-next-line luckystack/no-raw-try-catch -- sync AES-GCM auth-tag verify; the custom tryCatch is async-only and a failed tag is expected control flow.
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

//? Decrypt a value produced by `encryptSecret`. Returns null on a malformed/missing
//? key or a failed auth-tag check (tamper / wrong key).
export function decryptSecret(stored: string): string | null {
  if (stored.startsWith('plain:')) return Buffer.from(stored.slice('plain:'.length), 'base64').toString('utf8');
  if (!stored.startsWith('v1:')) return null;
  const key = encryptionKey();
  if (!key) return null;
  const [, ivB64, tagB64, ctB64] = stored.split(':');
  if (ivB64 === undefined || tagB64 === undefined || ctB64 === undefined) return null;
  // eslint-disable-next-line luckystack/no-raw-try-catch -- sync AES-GCM auth-tag verify; the custom tryCatch is async-only and a failed tag is expected control flow, not a captured error.
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
