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
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { workspaceDataDir } from '../git/repoStore';

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
function hostUserData(userId: string): string { return path.join(editorProfileDir(userId), 'user-data'); }
function hostExtensions(userId: string): string { return path.join(editorProfileDir(userId), 'extensions'); }

//? The openvscode launch flags that point at the projected profile (used by editorServer).
export function editorProfileLaunchArgs(): string[] {
  return ['--user-data-dir', IN_CONTAINER_USER_DATA, '--extensions-dir', IN_CONTAINER_EXTENSIONS];
}

function dockerSync(args: string[]): { code: number; err: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return { code: r.status ?? -1, err: r.stderr.trim() };
}

//? Pipe a tar stream from `producer` into `consumer`; resolve ok when the consumer exits 0.
function pipeTar(producer: ReturnType<typeof spawn>, consumer: ReturnType<typeof spawn>): Promise<ProfileResult> {
  return new Promise((resolve) => {
    let err = '';
    producer.on('error', (e) => { resolve({ ok: false, error: `tar-src: ${String(e)}` }); });
    consumer.on('error', (e) => { resolve({ ok: false, error: `tar-dst: ${String(e)}` }); });
    producer.stderr?.on('data', (d) => { err += String(d); });
    consumer.stderr?.on('data', (d) => { err += String(d); });
    if (producer.stdout && consumer.stdin) producer.stdout.pipe(consumer.stdin);
    consumer.on('close', (code) => { resolve(code === 0 ? { ok: true } : { ok: false, error: err.slice(0, 200) }); });
  });
}

//? Stream a host dir's contents INTO the container dir, extracted as the default (agent) user.
async function tarInto(container: string, hostDir: string, destDir: string): Promise<ProfileResult> {
  dockerSync(['exec', container, 'bash', '-lc', `mkdir -p ${destDir}`]);
  return pipeTar(
    spawn('tar', ['-C', hostDir, '-cf', '-', '.'], { windowsHide: true }),
    spawn('docker', ['exec', '-i', container, 'tar', '-C', destDir, '-xf', '-'], { windowsHide: true }),
  );
}

//? Stream a container dir's contents OUT to a host dir.
async function tarOut(container: string, srcDir: string, hostDir: string): Promise<ProfileResult> {
  mkdirSync(hostDir, { recursive: true });
  return pipeTar(
    spawn('docker', ['exec', container, 'tar', '-C', srcDir, '-cf', '-', '.'], { windowsHide: true }),
    spawn('tar', ['-C', hostDir, '-xf', '-'], { windowsHide: true }),
  );
}

//? Create the host profile dirs (idempotent). Call once per user before the first projection.
export function ensureEditorProfile(userId: string): void {
  mkdirSync(hostUserData(userId), { recursive: true });
  mkdirSync(hostExtensions(userId), { recursive: true });
}

//? Copy the user's profile INTO the container before the editor server starts. A fresh profile
//? (empty host dirs) streams an empty tar — the editor starts clean.
export async function projectProfileIntoContainer(container: string, userId: string): Promise<ProfileResult> {
  ensureEditorProfile(userId);
  const data = await tarInto(container, hostUserData(userId), IN_CONTAINER_USER_DATA);
  if (data.error !== undefined) return { ok: false, error: `editorProfile.copyInFailed(user-data): ${data.error}` };
  const ext = await tarInto(container, hostExtensions(userId), IN_CONTAINER_EXTENSIONS);
  if (ext.error !== undefined) return { ok: false, error: `editorProfile.copyInFailed(extensions): ${ext.error}` };
  return { ok: true };
}

//? Capture the (possibly changed) profile back OUT of the container to the per-user host store.
//? Call on extension-install / login events and on editor-session end so a login done in this
//? ticket is reused in the next (ADR 0010). Last-writer-wins across concurrent sessions.
export async function captureProfileFromContainer(container: string, userId: string): Promise<ProfileResult> {
  ensureEditorProfile(userId);
  const data = await tarOut(container, IN_CONTAINER_USER_DATA, hostUserData(userId));
  if (data.error !== undefined) return { ok: false, error: `editorProfile.captureFailed(user-data): ${data.error}` };
  const ext = await tarOut(container, IN_CONTAINER_EXTENSIONS, hostExtensions(userId));
  if (ext.error !== undefined) return { ok: false, error: `editorProfile.captureFailed(extensions): ${ext.error}` };
  return { ok: true };
}
