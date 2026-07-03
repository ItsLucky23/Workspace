//? Workspaces — app-owned symmetric encryption for per-workspace secrets (B-07).
//?
//? Used to encrypt credentials the app must store + later replay to a third party
//? (the per-workspace GitLab token → `Workspace.gitlabTokenEnc`). AES-256-GCM with a
//? single app key from `WORKSPACES_ENC_KEY` (any string; hashed to 32 bytes). The key
//? is resolved at boot like every other env (a secret-manager pointer or a literal).
//?
//? Format: `v1:<iv_b64>:<tag_b64>:<ct_b64>`. If no key is configured, secrets are
//? stored `plain:<b64>` with a loud one-time warning — dev-only; set the key before
//? storing real credentials. `decryptSecret` transparently reads both forms.
//? Spec: docs/decisions/0004-app-owned-secret-encryption.md.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

function encryptionKey(): Buffer | null {
  const raw = process.env.WORKSPACES_ENC_KEY;
  if (raw === undefined || raw === '') return null;
  //? Hash to a fixed 32 bytes so any key length/encoding works.
  return createHash('sha256').update(raw).digest();
}

let warnedNoKey = false;

//? Encrypt a secret for at-rest storage. Never throws — falls back to a marked,
//? base64-wrapped plaintext (dev) when no key is configured.
export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  if (!key) {
    if (!warnedNoKey) {
      console.warn('[secretBox] WORKSPACES_ENC_KEY not set — storing secrets UNENCRYPTED. Set it before storing real credentials.');
      warnedNoKey = true;
    }
    return `plain:${Buffer.from(plaintext, 'utf8').toString('base64')}`;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

//? Encrypt a BINARY blob for at-rest storage (#14 editor-profile). Same key + AES-256-GCM as
//? `encryptSecret`, but a compact binary envelope (no base64) for large blobs like a profile tar:
//?   key set   → [0x01][12-byte iv][16-byte tag][ciphertext]
//?   no key    → [0x00][plaintext]           (dev fallback, one-time warning)
//? Never throws.
export function encryptBuffer(plain: Buffer): Buffer {
  const key = encryptionKey();
  if (!key) {
    if (!warnedNoKey) { console.warn('[secretBox] WORKSPACES_ENC_KEY not set — storing blobs UNENCRYPTED.'); warnedNoKey = true; }
    return Buffer.concat([Buffer.from([0x00]), plain]);
  }
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
