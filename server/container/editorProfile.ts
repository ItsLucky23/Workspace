//? Per-user editor PROFILE — the durable store that makes extensions + auth logins follow a
//? user across every per-ticket editor session (ADR 0010). The profile is openvscode's
//? user-data-dir (settings, globalStorage, and the SECRET STORAGE where extension auth
//? tokens live) + the extensions-dir. It is streamed INTO a ticket container at editor-session
//? start and captured BACK on install/login events + session end, so a login done once in any
//? ticket's editor is reused in the next.
//?
//? Transport = `tar` streamed through `docker exec` (NOT `docker cp`): the hardened ticket
//? container drops ALL caps (no CAP_CHOWN), and `docker cp` writes root-owned files the agent
//? then can't touch. Extracting the tar AS the container's default `agent` user lands the
//? profile agent-owned with no chown. Security: the profile carries auth tokens into the
//? container — contained by the egress allow-list + tenant isolation (ADR 0010).

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { workspaceDataDir } from '../git/repoStore';
import { encryptBuffer, decryptBuffer } from '../crypto/secretBox';

//? In-container profile root (agent uid 10001, WORKDIR /work — 07b §7).
const IN_CONTAINER_ROOT = '/home/agent/.ls-editor';
export const IN_CONTAINER_USER_DATA = `${IN_CONTAINER_ROOT}/user-data`;
export const IN_CONTAINER_EXTENSIONS = `${IN_CONTAINER_ROOT}/extensions`;

export interface ProfileResult { ok: boolean; error?: string }

function safeId(userId: string): string {
  return userId.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
}

//? Host store for a user's profile: data/editor-profiles/<userId>/{user-data,extensions}.
//? Per USER, spanning every workspace (that is the whole point). `workspaceDataDir` is reused
//? only to locate the repo's `data/` root.
export function editorProfileDir(userId: string): string {
  const dataRoot = path.dirname(path.dirname(workspaceDataDir('_'))); // .../data
  return path.join(dataRoot, 'editor-profiles', safeId(userId));
}
//? #14 encryption-at-rest: the profile carries extension AUTH TOKENS (openvscode secret-storage), so
//? it must NOT sit plaintext on disk. Each half is stored as an ENCRYPTED tar blob (AES-256-GCM via
//? secretBox) — captured out of the container, encrypted, written here; decrypted + streamed back in
//? on the next session. Filenames end `.tar.enc`.
const PROFILE_PARTS = [
  { dir: IN_CONTAINER_USER_DATA, file: 'user-data.tar.enc', label: 'user-data' },
  { dir: IN_CONTAINER_EXTENSIONS, file: 'extensions.tar.enc', label: 'extensions' },
] as const;
function encBlobPath(userId: string, file: string): string { return path.join(editorProfileDir(userId), file); }

//? The openvscode launch flags that point at the projected profile (used by editorServer).
export function editorProfileLaunchArgs(): string[] {
  return ['--user-data-dir', IN_CONTAINER_USER_DATA, '--extensions-dir', IN_CONTAINER_EXTENSIONS];
}

function dockerSync(args: string[]): { code: number; err: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return { code: r.status ?? -1, err: r.stderr.trim() };
}

//? Stream a decrypted tar Buffer INTO the container dir, extracted as the default (agent) user.
async function tarBufferInto(container: string, tar: Buffer, destDir: string): Promise<ProfileResult> {
  dockerSync(['exec', container, 'bash', '-lc', `mkdir -p ${destDir}`]);
  return new Promise((resolve) => {
    const consumer = spawn('docker', ['exec', '-i', container, 'tar', '-C', destDir, '-xf', '-'], { windowsHide: true });
    let err = '';
    consumer.on('error', (e) => { resolve({ ok: false, error: `tar-dst: ${String(e)}` }); });
    consumer.stderr.on('data', (d) => { err += String(d); });
    consumer.on('close', (code) => { resolve(code === 0 ? { ok: true } : { ok: false, error: err.slice(0, 200) }); });
    consumer.stdin.on('error', () => { /* consumer exited early; its close handler reports */ });
    consumer.stdin.end(tar);
  });
}

//? Capture a container dir as a tar Buffer on the host (for encryption). Null on failure.
async function tarOutToBuffer(container: string, srcDir: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const producer = spawn('docker', ['exec', container, 'tar', '-C', srcDir, '-cf', '-', '.'], { windowsHide: true });
    const chunks: Buffer[] = [];
    producer.on('error', () => { resolve(null); });
    producer.stdout.on('data', (d: Buffer) => { chunks.push(d); });
    producer.on('close', (code) => { resolve(code === 0 ? Buffer.concat(chunks) : null); });
  });
}

//? Create the host profile dir (idempotent). Call once per user before the first projection.
export function ensureEditorProfile(userId: string): void {
  mkdirSync(editorProfileDir(userId), { recursive: true });
}

//? Copy the user's profile INTO the container before the editor server starts — decrypting each
//? stored blob and streaming it in. A fresh profile (no blob yet) is skipped: the editor starts
//? clean. A blob that fails to decrypt (tamper / wrong key) is skipped loudly rather than crashing.
export async function projectProfileIntoContainer(container: string, userId: string): Promise<ProfileResult> {
  ensureEditorProfile(userId);
  for (const part of PROFILE_PARTS) {
    const blobPath = encBlobPath(userId, part.file);
    if (!existsSync(blobPath)) continue;
    const tar = decryptBuffer(readFileSync(blobPath));
    if (tar === null) { console.warn(`[editorProfile] could not decrypt ${part.label} for ${userId} — skipping (tamper or WORKSPACES_ENC_KEY changed)`); continue; }
    const res = await tarBufferInto(container, tar, part.dir);
    if (res.error !== undefined) return { ok: false, error: `editorProfile.copyInFailed(${part.label}): ${res.error}` };
  }
  return { ok: true };
}

//? Capture the (possibly changed) profile back OUT of the container, ENCRYPT it, and write it to the
//? per-user host store. Call on extension-install / login events and on editor-session end so a login
//? done in this ticket is reused in the next (ADR 0010). Last-writer-wins across concurrent sessions.
export async function captureProfileFromContainer(container: string, userId: string): Promise<ProfileResult> {
  ensureEditorProfile(userId);
  for (const part of PROFILE_PARTS) {
    const tar = await tarOutToBuffer(container, part.dir);
    if (tar === null) return { ok: false, error: `editorProfile.captureFailed(${part.label})` };
    writeFileSync(encBlobPath(userId, part.file), encryptBuffer(tar));
  }
  return { ok: true };
}
