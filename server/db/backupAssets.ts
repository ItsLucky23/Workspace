//? F49 — the half of backup that was missing: everything that is NOT a Mongo document.
//?
//? `backup.ts` dumps every collection faithfully, and its own header admits the limit: "this protects DATA
//? only". In practice a restore from that backup gives you a workspace whose tickets reference media that
//? is gone, whose documents cite uploads that no longer exist, and whose git history is absent. The
//? database was never the whole install.
//?
//? This covers the file-backed state:
//?   • `data/media`  — every produced/uploaded asset the DB points at
//?   • `data/repos`  — the bare git mirrors (a project's actual history)
//?   • `WORKSPACES_ENC_KEY` presence — NOT the key itself (a backup that contains the key that decrypts it
//?     is not a backup, it is a single point of compromise) but a fingerprint, so a restore can TELL you
//?     whether the key you have is the key those secrets were encrypted with.
//?
//? Archives are plain tar.gz written next to the DB dumps, so one directory is the whole restore set.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { tryCatch } from '@luckystack/core';

import { docker } from '../container/runtime';
import { MEDIA_DIR } from '../media/store';

export interface AssetBackupResult {
  ok: boolean;
  archives: { name: string; bytes: number }[];
  encKeyFingerprint: string;
  skipped: string[];
  error?: string;
}

//? A fingerprint, never the key. Enough to answer "is this the same key?" and useless for decryption.
export function encKeyFingerprint(): string {
  const key = process.env.WORKSPACES_ENC_KEY ?? '';
  if (key.length === 0) return '';
  return createHash('sha256').update(`fingerprint:${key}`).digest('hex').slice(0, 16);
}

export function reposDir(): string {
  return process.env.WS_REPOS_DIR ?? path.join(process.cwd(), 'data', 'repos');
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

//? Archive one directory into `<dest>/<name>.tar.gz` using a throwaway container, so the host needs no tar
//? binary and the same code path works on Windows (where the rest of the media pipeline already relies on
//? containers). Returns 0 bytes when the source does not exist — an install with no repos is not an error.
async function archiveDir(source: string, dest: string, name: string): Promise<number> {
  if (!existsSync(source) || dirSize(source) === 0) return 0;
  mkdirSync(dest, { recursive: true });
  const src = source.replaceAll('\\', '/');
  const out = dest.replaceAll('\\', '/');
  const res = await docker([
    'run', '--rm', '--network', 'none',
    '-v', `${src}:/src:ro`, '-v', `${out}:/out`,
    'alpine:3.20', 'sh', '-c', `tar -czf /out/${name}.tar.gz -C /src . 2>/dev/null || true`,
  ]);
  if (res.code !== 0) return 0;
  const archive = path.join(dest, `${name}.tar.gz`);
  return existsSync(archive) ? statSync(archive).size : 0;
}

//? Back up the file-backed state next to the DB dump. Best-effort per archive: a missing repos dir must not
//? cost you the media backup.
export async function backupAssets(destDir: string): Promise<AssetBackupResult> {
  const archives: { name: string; bytes: number }[] = [];
  const skipped: string[] = [];

  for (const [name, dir] of [['media', MEDIA_DIR], ['repos', reposDir()]] as const) {
    const [error, bytes] = await tryCatch(() => archiveDir(dir, destDir, name));
    if (error || bytes === null || bytes === 0) { skipped.push(name); continue; }
    archives.push({ name, bytes });
  }

  return {
    ok: archives.length > 0 || skipped.length === 2,
    archives,
    //? Recorded so a restore can WARN when the key differs — encrypted secrets restored under a different
    //? key are unreadable, and finding that out during an incident is the worst possible moment.
    encKeyFingerprint: encKeyFingerprint(),
    skipped,
  };
}

//? Restore the file-backed state. Deliberately additive (tar extracts over the target) rather than
//? destructive: wiping `data/media` before an extract would turn a partial restore into total loss.
export async function restoreAssets(sourceDir: string): Promise<{ ok: boolean; restored: string[]; error?: string }> {
  const restored: string[] = [];
  for (const [name, dir] of [['media', MEDIA_DIR], ['repos', reposDir()]] as const) {
    const archive = path.join(sourceDir, `${name}.tar.gz`);
    if (!existsSync(archive)) continue;
    mkdirSync(dir, { recursive: true });
    const src = sourceDir.replaceAll('\\', '/');
    const out = dir.replaceAll('\\', '/');
    const [error, res] = await tryCatch(() => docker([
      'run', '--rm', '--network', 'none',
      '-v', `${src}:/src:ro`, '-v', `${out}:/out`,
      'alpine:3.20', 'sh', '-c', `tar -xzf /src/${name}.tar.gz -C /out`,
    ]));
    if (error || res?.code !== 0) return { ok: false, restored, error: `restore.${name}Failed` };
    restored.push(name);
  }
  return { ok: true, restored };
}

//? The check a restore drill actually needs: does the restored install have the same encryption key as the
//? one that produced the backup? A mismatch means every stored secret is unreadable — better a loud
//? warning at restore time than a mystery 500 a week later.
export function encKeyMatches(backupFingerprint: string): { matches: boolean; reason: string } {
  const current = encKeyFingerprint();
  if (backupFingerprint.length === 0) return { matches: false, reason: 'backup recorded no key fingerprint' };
  if (current.length === 0) return { matches: false, reason: 'WORKSPACES_ENC_KEY is not set on this install' };
  if (current !== backupFingerprint) return { matches: false, reason: 'a DIFFERENT encryption key — restored secrets will not decrypt' };
  return { matches: true, reason: 'encryption key matches the backup' };
}
