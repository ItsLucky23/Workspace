//? Workspaces — linked-repo store (register-flow step A: link a git repo).
//?
//? Clones a project's repo into `data/workspaces/<workspaceId>/repo.git` as a BARE
//? clone — the durable per-workspace baseline the runtime later cuts `DEV-####`
//? git-worktrees from (GIT_STRATEGY §0/§1, 07b §4). One bare repo per workspace;
//? per-ticket worktrees are added off it at ticket-create/stage-entry (a later slice).
//?
//? Auth (SEC9): the token NEVER touches argv or the URL — git receives only the username
//? convention in the URL and reads the password from a GIT_ASKPASS helper that echoes it
//? from the spawn env. Nothing is persisted or logged (errors are token-scrubbed); only the
//? clean `gitUrl` is stored on `Project`.

import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { withRetry } from '../util/retry';

export interface RepoStatus { linked: boolean; gitUrl?: string; branch?: string; head?: string }

//? The DEV-#### git-worktree a ticket edits in, cut from the bare clone at activation
//? (07 §A step 3+5): its branch + the FROZEN baseline commitHash (DH5). `path` is the
//? on-disk checkout the container later mounts.
export interface WorktreeInfo { branch: string; commitHash: string; path: string }

//? Root for a workspace's on-disk state (gitignored `data/`). Workspace-LEVEL artifacts (service
//? compose files, the editor profile) live directly under here; the git REPO + per-ticket worktrees
//? live one level deeper, under the owning PROJECT (R3-b) so a workspace can hold N independent repos.
export function workspaceDataDir(workspaceId: string): string {
  return path.join(process.cwd(), 'data', 'workspaces', workspaceId);
}
//? R3-b — per-PROJECT on-disk root: `data/workspaces/<ws>/projects/<proj>/…`. Every repo/worktree/
//? build-context/draft-Dockerfile is keyed here so linking or greenfield-ing a 2nd project never
//? clobbers the 1st (the pre-R3-b bug: everything was keyed by workspaceId only).
export function projectDataDir(workspaceId: string, projectId: string): string {
  return path.join(workspaceDataDir(workspaceId), 'projects', projectId);
}
//? R3-b resilience: the ROOT a project's repo/worktrees live under. Normally the per-project dir, BUT if that
//? project has NO repo yet AND a LEGACY per-workspace `repo.git` still exists (a migration that hasn't run or
//? failed — e.g. a Windows EPERM because a running container holds the file), fall back to the legacy root so
//? the existing repo keeps working. A migrated/new project always uses its own dir → full multi-repo isolation.
function projectRoot(workspaceId: string, projectId: string): string {
  const projDir = projectDataDir(workspaceId, projectId);
  if (existsSync(path.join(projDir, 'repo.git'))) return projDir;
  if (existsSync(path.join(workspaceDataDir(workspaceId), 'repo.git'))) return workspaceDataDir(workspaceId);
  return projDir;
}
function bareRepoPath(workspaceId: string, projectId: string): string {
  return path.join(projectRoot(workspaceId, projectId), 'repo.git');
}
//? Exported for the container runtime, which mounts the project's bare mirror into the ticket container
//? (same legacy-fallback resolution as the git functions).
export function bareMirrorPathFor(workspaceId: string, projectId: string): string {
  return bareRepoPath(workspaceId, projectId);
}
function worktreePath(workspaceId: string, projectId: string, ticketKey: string): string {
  return path.join(projectRoot(workspaceId, projectId), 'worktrees', ticketKey);
}

//? R3-b one-time migration: move a legacy per-WORKSPACE repo (`data/workspaces/<ws>/repo.git` +
//? `worktrees/` + `draft.Dockerfile`) into the workspace's FIRST project's slot. Idempotent — a
//? no-op once the legacy layout is gone (or the target already exists). Called on boot with the
//? (workspaceId → firstProjectId) map so repoStore stays DB-free.
export function migrateLegacyRepoLayout(pairs: { workspaceId: string; projectId: string }[]): number {
  let moved = 0;
  for (const { workspaceId, projectId } of pairs) {
    const legacyBare = path.join(workspaceDataDir(workspaceId), 'repo.git');
    if (!existsSync(legacyBare)) continue;
    const targetDir = projectDataDir(workspaceId, projectId);
    //? STRICT project path here (never the legacy-fallback) — the target is where we MOVE the repo TO.
    const targetBare = path.join(targetDir, 'repo.git');
    if (existsSync(targetBare)) continue; // already migrated / project already has its own repo
    //? Per-workspace resilience: if the repo.git rename fails (e.g. Windows EPERM — a running container holds
    //? the file), SKIP this workspace and leave the legacy layout intact. The projectRoot() read-fallback keeps
    //? that workspace working on the legacy path until the file is free (next boot with no holder). Never a
    //? half-move: repo.git is renamed FIRST; only if it succeeds do worktrees/draft follow.
    const [err] = tryCatchSync(() => {
      mkdirSync(targetDir, { recursive: true });
      renameSync(legacyBare, targetBare); // the critical one — atomic; throws (caught) if locked
      for (const name of ['worktrees', 'draft.Dockerfile']) {
        const from = path.join(workspaceDataDir(workspaceId), name);
        if (existsSync(from)) renameSync(from, path.join(targetDir, name));
      }
    });
    if (err) { console.warn(`[R3-b] repo migration for ${workspaceId} deferred (${err.message.split(':')[0]}) — using legacy fallback`); continue; }
    moved += 1;
  }
  return moved;
}

//? Is a bare clone present for this project? (worktrees require a linked repo.)
export function isLinked(workspaceId: string, projectId: string): boolean {
  return existsSync(bareRepoPath(workspaceId, projectId));
}

//? Disconnect only this project's durable repository baseline after the Conductor has
//? proven no project container is active. Capture the legacy-aware root before removal so
//? a legacy repo and its worktree registrations disappear together. Project config/drafts
//? outside repo.git/worktrees remain intact for a later re-link.
export function unlinkProjectRepo(workspaceId: string, projectId: string): RepoStatus {
  const root = projectRoot(workspaceId, projectId);
  rmSync(path.join(root, 'repo.git'), { recursive: true, force: true });
  rmSync(path.join(root, 'worktrees'), { recursive: true, force: true });
  if (existsSync(path.join(root, 'repo.git')) || existsSync(path.join(root, 'worktrees'))) throw new Error('repo.unlinkFailed');
  return { linked: false };
}

//? Run a git command, capturing stdout. Rejects with a token-scrubbed message on
//? non-zero exit so a bad URL/token surfaces without leaking the credential.
function git(args: string[], opts: { cwd?: string; env?: Record<string, string>; trimOutput?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: opts.cwd, windowsHide: true, ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}) });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', (e) => { reject(new Error(scrub(e.message))); });
    proc.on('close', (code) => {
      if (code === 0) resolve(opts.trimOutput === false ? out : out.trim());
      else reject(new Error(scrub(err.trim() || `git exited ${String(code)}`)));
    });
  });
}
//? Strip any embedded `user:token@` credential from a message before it is surfaced.
function scrub(s: string): string {
  return s.replaceAll(/\/\/[^/@\s]+:[^/@\s]+@/g, '//***@');
}

//? SEC9 — the URL only ever carries the USERNAME convention (GitHub: x-access-token,
//? GitLab/others: oauth2); the TOKEN itself never touches argv. Git asks its askpass
//? helper for the password, which echoes it from the spawn env (`authEnv`). Exported
//? for the unit test that locks the no-token-in-argv property down.
export function withAuth(gitUrl: string, token: string | undefined): string {
  if (!token || !gitUrl.startsWith('https://')) return gitUrl;
  const rest = gitUrl.slice('https://'.length);
  const user = rest.startsWith('github.com') ? 'x-access-token' : 'oauth2';
  return `https://${user}@${rest}`;
}

//? SEC9 — a tiny static askpass script (echoes the env token; the script itself contains NO
//? secret) written once under data/ and referenced via GIT_ASKPASS. Cross-platform: .cmd on
//? Windows, sh script elsewhere.
function askpassPath(): string {
  const dir = path.join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const p = path.join(dir, 'git-askpass.cmd');
    if (!existsSync(p)) writeFileSync(p, '@echo %WS_GIT_ASKPASS_TOKEN%\r\n');
    return p;
  }
  const p = path.join(dir, 'git-askpass.sh');
  if (!existsSync(p)) writeFileSync(p, '#!/bin/sh\necho "$WS_GIT_ASKPASS_TOKEN"\n', { mode: 0o700 });
  return p;
}

//? SEC9 — the env for an authenticated git call: the token travels ONLY via the environment
//? (never argv/URL); GIT_TERMINAL_PROMPT=0 hard-fails instead of hanging when auth is missing.
//? Exported for the unit test.
export function authEnv(token: string | undefined): Record<string, string> {
  if (!token) return {};
  return { GIT_ASKPASS: askpassPath(), WS_GIT_ASKPASS_TOKEN: token, GIT_TERMINAL_PROMPT: '0' };
}

//? A documentation file discovered in the linked repo (docs-init scan). Read straight
//? from the bare clone via `git show` — no working checkout needed.
export interface RepoDoc { path: string; content: string }

function isDocPath(p: string): boolean {
  const lower = p.toLowerCase();
  return /\.(?:md|mdx|markdown|rst|txt|adoc)$/.test(lower)
    || lower.startsWith('docs/')
    || /(?:^|\/)(?:readme|changelog|contributing|license|architecture)(?:$|\.)/.test(lower);
}

//? Scan the linked repo (default-branch HEAD) for documentation files — the docs-init
//? corpus the AI later reads/edits. Lists paths via `git ls-tree` and reads each body
//? via `git show HEAD:<path>` (bounded: ≤200 files, ≤20k chars each). Returns [] if no
//? repo is linked.
export async function listRepoDocs(workspaceId: string, projectId: string): Promise<RepoDoc[]> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return [];
  const listing = await git(['--git-dir', bare, 'ls-tree', '-r', 'HEAD', '--name-only']).catch(() => '');
  const paths = listing.split('\n').map((p) => p.trim()).filter((p) => p.length > 0 && isDocPath(p)).slice(0, 200);
  const docs: RepoDoc[] = [];
  for (const p of paths) {
    const content = await git(['--git-dir', bare, 'show', `HEAD:${p}`]).catch(() => '');
    docs.push({ path: p, content: content.slice(0, 20_000) });
  }
  return docs;
}

//? A code file read from the linked repo at a ref — the RAG-index input (07 §D).
export interface RepoFile { path: string; content: string }

//? Indexable source/config/doc extensions; vendored/build dirs are skipped.
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|h|cpp|hpp|cs|swift|kt|scala|sh|sql|css|scss|html|vue|svelte|json|ya?ml|toml|md|mdx|txt)$/i;
//? Well-known extension-less files worth indexing (README, LICENSE, Dockerfile, …).
const KNOWN_NAMES = /(?:^|\/)(?:readme|license|licence|dockerfile|makefile|changelog|contributing)$/i;
const SKIP_DIR = /(?:^|\/)(?:node_modules|\.git|dist|build|out|coverage|vendor|\.next|\.cache|__pycache__)\//;

//? List + read indexable code files at `ref` (default HEAD; pass a commitHash to pin to a ticket's
//? frozen baseline) straight from the bare clone — no checkout. Bounded (≤600 files, ≤60k chars).
//? Returns [] when no repo is linked.
export async function listRepoFiles(workspaceId: string, projectId: string, ref = 'HEAD'): Promise<RepoFile[]> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return [];
  const listing = await git(['--git-dir', bare, 'ls-tree', '-r', ref, '--name-only']).catch(() => '');
  const paths = listing.split('\n').map((p) => p.trim())
    .filter((p) => p.length > 0 && (CODE_EXT.test(p) || KNOWN_NAMES.test(p)) && !SKIP_DIR.test(p))
    .slice(0, 600);
  const files: RepoFile[] = [];
  for (const p of paths) {
    const content = await git(['--git-dir', bare, 'show', `${ref}:${p}`]).catch(() => '');
    if (content.length > 0) files.push({ path: p, content: content.slice(0, 60_000) });
  }
  return files;
}

//? The current HEAD commit of the bare clone (stamps a RAG index). '' when unlinked.
export async function repoHead(workspaceId: string, projectId: string): Promise<string> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return '';
  return git(['--git-dir', bare, 'rev-parse', 'HEAD']).catch(() => '');
}

//? Read a single file's contents at `ref` straight from the bare clone (e.g. `.workspaces/ci.yml`).
//? '' when unlinked or the file is absent at that ref. Bounded to 60k chars.
export async function showRepoFile(workspaceId: string, projectId: string, ref: string, filePath: string): Promise<string> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return '';
  const out = await git(['--git-dir', bare, 'show', `${ref}:${filePath}`]).catch(() => '');
  return out.slice(0, 60_000);
}

//? A single file entry in the workspace-level Code browser's tree: its repo-relative path + blob size
//? in bytes. The browser reads the bare clone directly (like `listRepoFiles`) — no checkout, nothing
//? authoritative written — so the whole codebase is reachable from the nav, not only the per-ticket editor.
export interface RepoTreeEntry { path: string; size: number }
export interface RepoTreeResult { linked: boolean; branch?: string; entries?: RepoTreeEntry[]; truncated?: boolean }

//? Bounds so a pathological monorepo can't stream an unbounded tree / a huge blob to the browser.
const MAX_TREE_ENTRIES = 5000;
const MAX_FILE_BYTES = 200_000;

//? List every file of the linked repo at its OWN default-branch pointer (the branch comes from
//? `repoStatus`, never a client-supplied ref — the browser only ever sees the baseline branch).
//? `git ls-tree -r -l <branch>` yields `<mode> <type> <object> <size>\t<path>` per blob; we parse the
//? path + size. Returns { linked:false } when no repo is linked; caps at MAX_TREE_ENTRIES.
export async function repoTree(workspaceId: string, projectId: string): Promise<RepoTreeResult> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return { linked: false };
  const status = await repoStatus(workspaceId, projectId);
  const ref = status.branch && status.branch.length > 0 ? status.branch : 'HEAD';
  const listing = await git(['--git-dir', bare, 'ls-tree', '-r', '-l', ref]).catch(() => '');
  const entries: RepoTreeEntry[] = [];
  for (const line of listing.split('\n')) {
    if (line.length === 0) continue;
    //? Split the path off the TAB first (a path never contains a tab); the left side is the padded
    //? `mode type object size` quadruple. `-r` lists only blobs, so the size is always numeric.
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const meta = line.slice(0, tab).trim().split(/\s+/);
    if (meta.length < 4) continue;
    const size = Number.parseInt(meta[3] ?? '', 10);
    entries.push({ path: line.slice(tab + 1), size: Number.isNaN(size) ? 0 : size });
    if (entries.length >= MAX_TREE_ENTRIES) break;
  }
  const result: RepoTreeResult = { linked: true, entries };
  if (status.branch) result.branch = status.branch;
  if (entries.length >= MAX_TREE_ENTRIES) result.truncated = true;
  return result;
}

//? One file read for the Code browser: its content (bounded), or a flag when the blob is binary /
//? was truncated. `error` is a typed reason the UI maps to copy.
export interface RepoFileResult {
  ok: boolean;
  content?: string;
  binary?: boolean;
  truncated?: boolean;
  size?: number;
  error?: 'repo.notLinked' | 'repo.invalidPath' | 'repo.fileMissing';
}

//? Read one file at the repo's baseline branch straight from the bare clone. The path is traversal-
//? guarded (`validRepoPath` — no leading `/`, no `..`, no drive/control chars) and must resolve to a
//? BLOB in the tree; a NUL byte marks the blob binary (returned WITHOUT content); content beyond
//? MAX_FILE_BYTES is truncated. The ref is the repo's own branch, never a client ref.
export async function readRepoFileAt(workspaceId: string, projectId: string, filePath: string): Promise<RepoFileResult> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return { ok: false, error: 'repo.notLinked' };
  if (!validRepoPath(filePath)) return { ok: false, error: 'repo.invalidPath' };
  const status = await repoStatus(workspaceId, projectId);
  const ref = status.branch && status.branch.length > 0 ? status.branch : 'HEAD';
  //? Confirm the path is a real blob at this ref before reading (a dir / an absent path → fileMissing).
  const entry = await git(['--git-dir', bare, 'ls-tree', ref, '--', filePath]).catch(() => '');
  if (!/\bblob\b/.test(entry)) return { ok: false, error: 'repo.fileMissing' };
  const raw = await git(['--git-dir', bare, 'show', `${ref}:${filePath}`], { trimOutput: false }).catch(() => null);
  if (raw === null) return { ok: false, error: 'repo.fileMissing' };
  //? Binary → the flag, no content (a NUL byte in the blob is the signal; scanning the bounded head
  //? keeps a huge blob cheap to classify). `fromCodePoint(0)` avoids a literal NUL in source.
  if (raw.slice(0, MAX_FILE_BYTES).includes(String.fromCodePoint(0))) return { ok: true, binary: true, size: raw.length };
  const truncated = raw.length > MAX_FILE_BYTES;
  return { ok: true, content: raw.slice(0, MAX_FILE_BYTES), size: raw.length, ...(truncated ? { truncated: true } : {}) };
}

//? Unified diff of `source` against `target` (three-dot = changes on source since it forked) from
//? the bare clone — the MR review diff. '' when unlinked or a ref is missing. -U15: fifteen context
//? lines per hunk (owner request 2026-07-20) so a reviewer sees the surrounding code, not bare +/-
//? lines; the parser's 2000-lines-per-file cap keeps a pathological diff bounded regardless.
export async function branchDiff(workspaceId: string, projectId: string, target: string, source: string): Promise<string> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return '';
  return git(['--git-dir', bare, 'diff', '-U15', `${target}...${source}`]).catch(() => '');
}

//? The commit sha at the tip of `branch` (the MR head — approvals stale when it changes). '' if missing.
export async function branchHead(workspaceId: string, projectId: string, branch: string): Promise<string> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return '';
  return git(['--git-dir', bare, 'rev-parse', branch]).catch(() => '');
}

//? The manifest files that tell an AI what toolchain a repo needs (for Dockerfile
//? generation, register-flow C). Read straight from the bare clone.
const MANIFEST_FILES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.nvmrc', '.tool-versions',
  'requirements.txt', 'pipfile', 'pyproject.toml', 'go.mod', 'cargo.toml', 'pom.xml',
  'build.gradle', 'gemfile', 'composer.json', 'dockerfile', '.workspaces/dockerfile',
]);

export interface RepoManifests { tree: string[]; manifests: { path: string; content: string }[] }

//? Scan the linked repo for its toolchain manifests + a bounded file tree — the context
//? an AI needs to author a project-appropriate `.workspaces/Dockerfile`. Reads via
//? `git ls-tree`/`git show` (no checkout). Returns empty when no repo is linked.
export async function repoManifests(workspaceId: string, projectId: string): Promise<RepoManifests> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return { tree: [], manifests: [] };
  const listing = await git(['--git-dir', bare, 'ls-tree', '-r', 'HEAD', '--name-only']).catch(() => '');
  const paths = listing.split('\n').map((p) => p.trim()).filter((p) => p.length > 0);
  const tree = paths.slice(0, 300);
  const manifests: { path: string; content: string }[] = [];
  for (const p of paths) {
    if (!MANIFEST_FILES.has(p.toLowerCase())) continue;
    const content = await git(['--git-dir', bare, 'show', `HEAD:${p}`]).catch(() => '');
    manifests.push({ path: p, content: content.slice(0, 8000) });
    if (manifests.length >= 12) break;
  }
  return { tree, manifests };
}

//? Read the current bare-repo status from disk (for the snapshot). `linked` reflects
//? whether the bare clone exists; branch/head are the current default-branch pointer.
export async function repoStatus(workspaceId: string, projectId: string, gitUrl?: string): Promise<RepoStatus> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return { linked: false, ...(gitUrl ? { gitUrl } : {}) };
  const out: RepoStatus = { linked: true, ...(gitUrl ? { gitUrl } : {}) };
  const head = await git(['--git-dir', bare, 'rev-parse', 'HEAD']).catch(() => '');
  const branch = await git(['--git-dir', bare, 'symbolic-ref', '--short', 'HEAD']).catch(() => '');
  if (branch) out.branch = branch;
  if (head) out.head = head.slice(0, 12);
  return out;
}

//? Clone (or re-clone) the repo as a bare mirror. Returns the clean status. Throws a
//? token-scrubbed error on failure (bad URL/token/network) so the caller can surface it.
export async function cloneRepo(input: { workspaceId: string; projectId: string; gitUrl: string; token?: string }): Promise<RepoStatus> {
  const { workspaceId, projectId, gitUrl, token } = input;
  const dir = projectDataDir(workspaceId, projectId);
  const bare = bareRepoPath(workspaceId, projectId);
  mkdirSync(dir, { recursive: true });
  //? Fresh clone each link (idempotent re-link) — discard any prior bare repo FOR THIS PROJECT only
  //? (R3-b: a sibling project's repo, under its own projectId dir, is never touched).
  if (existsSync(bare)) rmSync(bare, { recursive: true, force: true });
  await git(['clone', '--bare', withAuth(gitUrl, token), bare], { env: authEnv(token) });
  //? Persist the origin WITHOUT the token so later fetches use the stored (clean) URL;
  //? the token is re-injected transiently per fetch (a later slice re-supplies it).
  await git(['--git-dir', bare, 'remote', 'set-url', 'origin', gitUrl]).catch(() => '');
  return repoStatus(workspaceId, projectId, gitUrl);
}

//? G1 — greenfield: initialise the workspace's bare repo from a seed FILE-TREE (no external forge). Writes
//? the files into a temp checkout, commits them on `main`, then `git clone --bare` into the durable
//? per-workspace `repo.git` — so `isLinked` flips true and the runtime can cut worktrees + a container from
//? it (container → code). No-op (returns the existing status) when a repo is already present, so a second
//? greenfield project never clobbers an existing repo. Throws on git failure (caller surfaces it).
export async function initGreenfieldRepo(workspaceId: string, projectId: string, files: { path: string; content: string }[]): Promise<RepoStatus> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (existsSync(bare)) return repoStatus(workspaceId, projectId);
  const dir = projectDataDir(workspaceId, projectId);
  mkdirSync(dir, { recursive: true });
  const seed = path.join(dir, 'greenfield-seed');
  rmSync(seed, { recursive: true, force: true });
  mkdirSync(seed, { recursive: true });
  for (const f of files) {
    const full = path.join(seed, f.path);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, f.content);
  }
  //? A self-contained identity so the commit works on a host with no global git config.
  await git(['init', '-b', 'main'], { cwd: seed });
  await git(['config', 'user.email', 'workspaces@local'], { cwd: seed });
  await git(['config', 'user.name', 'Workspaces'], { cwd: seed });
  await git(['add', '-A'], { cwd: seed });
  await git(['commit', '-m', 'chore: scaffold greenfield project'], { cwd: seed });
  await git(['clone', '--bare', seed, bare]);
  rmSync(seed, { recursive: true, force: true });
  return repoStatus(workspaceId, projectId);
}

//? @adr 0276
//? A09 — revision-safe direct commits for small Conductor-owned mechanical patches. The caller reads
//? the target file at `expectedHead`, computes a surgical patch, then this helper compares the branch tip
//? again immediately before commit and uses `--force-with-lease=<expected>` as the final CAS at push.
export type RepoPatchError = 'repo.notLinked' | 'repo.invalidTarget' | 'repo.branchMissing' | 'repo.fileMissing' | 'repo.headChanged' | 'repo.commitFailed';
export type RepoBranchFileResult =
  | { ok: true; head: string; content: string }
  | { ok: false; error: RepoPatchError };
export type RepoCommitFilesResult =
  | { ok: true; status: 'committed' | 'unchanged'; sha: string }
  | { ok: false; error: RepoPatchError };

function validRepoPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  let hasControlCharacter = false;
  for (const char of normalized) if ((char.codePointAt(0) ?? 32) < 32) hasControlCharacter = true;
  if (normalized.length === 0 || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || hasControlCharacter) return false;
  return normalized.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.includes(':'));
}

async function validBranch(branch: string): Promise<boolean> {
  const [error] = await tryCatch(() => git(['check-ref-format', '--branch', branch]));
  return error === null;
}

async function headAtBranch(bare: string, branch: string): Promise<string | null> {
  const [error, head] = await tryCatch(() => git(['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${branch}`]));
  return error || !head ? null : head;
}

//? Read without `.trim()`: leading/trailing whitespace, comments, BOM and final newline are part of the
//? stylesheet revision the patch must preserve. The SHA is resolved first and then used for `git show`,
//? so a concurrent branch move cannot mix content from one revision with the HEAD of another.
export async function readRepoBranchFile(workspaceId: string, projectId: string, branch: string, filePath: string): Promise<RepoBranchFileResult> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return { ok: false, error: 'repo.notLinked' };
  if (!validRepoPath(filePath) || !(await validBranch(branch))) return { ok: false, error: 'repo.invalidTarget' };
  const head = await headAtBranch(bare, branch);
  if (!head) return { ok: false, error: 'repo.branchMissing' };
  const [fileError, content] = await tryCatch(() => git(['--git-dir', bare, 'show', `${head}:${filePath}`], { trimOutput: false }));
  if (fileError || content === null) return { ok: false, error: 'repo.fileMissing' };
  return { ok: true, head, content };
}

function pathContainsSymlink(root: string, filePath: string): boolean {
  let current = root;
  for (const part of filePath.replaceAll('\\', '/').split('/')) {
    current = path.join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

export async function commitFilesToBranch(input: {
  workspaceId: string;
  projectId: string;
  branch: string;
  expectedHead: string;
  files: { path: string; content: string }[];
  message: string;
}): Promise<RepoCommitFilesResult> {
  const { workspaceId, projectId, branch, expectedHead, files, message } = input;
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return { ok: false, error: 'repo.notLinked' };
  if (files.length === 0 || !/^[0-9a-f]{40,64}$/i.test(expectedHead) || files.some((file) => !validRepoPath(file.path)) || !(await validBranch(branch))) {
    return { ok: false, error: 'repo.invalidTarget' };
  }
  if ((await headAtBranch(bare, branch)) !== expectedHead) return { ok: false, error: 'repo.headChanged' };

  const dir = projectDataDir(workspaceId, projectId);
  mkdirSync(dir, { recursive: true });
  const work = path.join(dir, `apply-${randomUUID().slice(0, 8)}`);
  rmSync(work, { recursive: true, force: true });
  const [operationError, result] = await tryCatch<RepoCommitFilesResult>(async () => {
    await git(['clone', '--no-checkout', bare, work]);
    await git(['checkout', '--detach', expectedHead], { cwd: work });
    await git(['config', 'user.email', 'workspaces@local'], { cwd: work });
    await git(['config', 'user.name', 'Workspaces'], { cwd: work });
    for (const file of files) {
      if (pathContainsSymlink(work, file.path)) return { ok: false, error: 'repo.invalidTarget' };
      const full = path.join(work, file.path);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, file.content);
    }
    await git(['add', '--', ...files.map((file) => file.path)], { cwd: work });
    const status = await git(['status', '--porcelain'], { cwd: work });

    //? CAS immediately before commit: a stale patch never even creates a candidate commit. A move in
    //? the tiny commit→push window is caught by the force-with-lease below.
    if ((await headAtBranch(bare, branch)) !== expectedHead) return { ok: false, error: 'repo.headChanged' };
    if (status.length === 0) return { ok: true, status: 'unchanged', sha: expectedHead };

    await git(['commit', '-m', message], { cwd: work });
    const sha = await git(['rev-parse', 'HEAD'], { cwd: work });
    const [pushError] = await tryCatch(() => git([
      'push', `--force-with-lease=refs/heads/${branch}:${expectedHead}`, 'origin', `HEAD:refs/heads/${branch}`,
    ], { cwd: work }));
    if (pushError) {
      if ((await headAtBranch(bare, branch)) === expectedHead) return { ok: false, error: 'repo.commitFailed' };
      return { ok: false, error: 'repo.headChanged' };
    }
    return { ok: true, status: 'committed', sha };
  });
  rmSync(work, { recursive: true, force: true });
  if (operationError || !result) return { ok: false, error: 'repo.commitFailed' };
  return result;
}

//? Add the ticket's worktree off the bare clone (07 §A step 5), freezing the default-branch
//? HEAD as the ticket's baseline commit (DH5, step 3). Idempotent: an existing worktree is
//? returned as-is; a re-activation reuses the durable branch. The on-disk worktree dir is
//? keyed by the (stable) ticket key, while the BRANCH name is `branchName` — the per-workspace
//? branch-strategy result (server/git/branchStrategy.ts), defaulting to the ticket key for the
//? legacy `ticket-prefix` behaviour. Returns null if no repo is linked.
export async function addWorktree(workspaceId: string, projectId: string, ticketKey: string, branchName: string = ticketKey): Promise<WorktreeInfo | null> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return null;
  const wt = worktreePath(workspaceId, projectId, ticketKey);
  //? Already checked out → return its current branch + commit (idempotent re-activation).
  if (existsSync(wt)) {
    const commitHash = await git(['-C', wt, 'rev-parse', 'HEAD']).catch(() => '');
    const branch = await git(['-C', wt, 'symbolic-ref', '--short', 'HEAD']).catch(() => branchName);
    return { branch: branch || branchName, commitHash, path: wt };
  }
  //? Freeze the baseline = current default-branch HEAD of the bare clone.
  const commitHash = await git(['--git-dir', bare, 'rev-parse', 'HEAD']);
  mkdirSync(path.dirname(wt), { recursive: true });
  //? New branch at the frozen commit, unless the durable branch already exists (re-link).
  const branchExists = await git(['--git-dir', bare, 'rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`]).then(() => true).catch(() => false);
  await (branchExists
    ? git(['--git-dir', bare, 'worktree', 'add', wt, branchName])
    : git(['--git-dir', bare, 'worktree', 'add', '-b', branchName, wt, commitHash]));
  return { branch: branchName, commitHash, path: wt };
}

//? The outcome of a real branch merge (#9). `conflict` carries the unmerged files so the UI can
//? surface them (and a future AI --resume can be handed them); `error` is a scrubbed git message.
export type MergeOutcome =
  | { ok: true; sha: string }
  | { ok: false; conflict: true; files: string[] }
  | { ok: false; conflict: false; error: string };

const gitIdentity = ['-c', 'user.email=workspaces-bot@luckystack.local', '-c', 'user.name=Workspaces'];

//? Really merge `source` into `target` in the bare clone via a THROWAWAY merge-worktree (never a
//? long-lived checkout), honouring `strategy` ('merge' = --no-ff, 'squash', 'ff' = --ff-only). The
//? caller serialises merges per-workspace (the conductor holds the write-lease), so two merges can't
//? race the same target. On conflict the merge is ABORTED (target ref untouched) and the conflicting
//? files returned. Returns the resulting merge commit sha on success. Idempotent about a stale
//? merge-worktree left by a crash (removed first). Returns not-linked error if no repo is linked.
export async function mergeBranches(workspaceId: string, projectId: string, target: string, source: string, strategy: string): Promise<MergeOutcome> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return { ok: false, conflict: false, error: 'not-linked' };
  const mergeWt = path.join(projectDataDir(workspaceId, projectId), 'merge-wt');
  await cleanupWorktree(bare, mergeWt);
  const [error, result] = await tryCatch<MergeOutcome>(async () => {
    await git(['--git-dir', bare, 'worktree', 'add', '--force', mergeWt, target]);
    const args = ['-C', mergeWt, ...gitIdentity, 'merge', '--no-edit'];
    if (strategy === 'squash') args.push('--squash');
    else if (strategy === 'ff') args.push('--ff-only');
    else args.push('--no-ff');
    args.push(source);
    const mergeErr = await git(args).then(() => null).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (mergeErr) {
      const unmerged = await git(['-C', mergeWt, 'diff', '--name-only', '--diff-filter=U']).catch(() => '');
      const files = unmerged.split('\n').map((f) => f.trim()).filter((f) => f.length > 0);
      await git(['-C', mergeWt, 'merge', '--abort']).catch(() => '');
      await git(['-C', mergeWt, 'reset', '--hard']).catch(() => '');
      if (files.length > 0) return { ok: false, conflict: true, files };
      return { ok: false, conflict: false, error: mergeErr.message };
    }
    //? `--squash` stages the changes but writes no commit — finalize it so the target advances.
    if (strategy === 'squash') await git(['-C', mergeWt, ...gitIdentity, 'commit', '--no-edit', '-m', `Merge ${source} into ${target}`]);
    const sha = await git(['-C', mergeWt, 'rev-parse', 'HEAD']);
    return { ok: true, sha };
  });
  await cleanupWorktree(bare, mergeWt);
  if (error || !result) return { ok: false, conflict: false, error: error ? scrub(error.message) : 'merge-failed' };
  return result;
}

//? Roll a merge back by reverting its commit on `target` (a git-revert, so history is preserved —
//? the opposite of a destructive reset). Handles both a real merge commit (2 parents → revert the
//? first-parent mainline with `-m 1`) and a squash/ff commit (1 parent → plain revert). Runs in a
//? throwaway worktree under the caller's lease. Returns the revert commit sha.
export async function revertMergeCommit(workspaceId: string, projectId: string, target: string, sha: string): Promise<{ ok: true; sha: string } | { ok: false; error: string }> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return { ok: false, error: 'not-linked' };
  const revertWt = path.join(projectDataDir(workspaceId, projectId), 'revert-wt');
  await cleanupWorktree(bare, revertWt);
  type RevertResult = { ok: true; sha: string } | { ok: false; error: string };
  const [error, result] = await tryCatch<RevertResult>(async () => {
    await git(['--git-dir', bare, 'worktree', 'add', '--force', revertWt, target]);
    //? Parent count decides whether `-m 1` (mainline) is needed — a squash commit has one parent.
    const revList = await git(['-C', revertWt, 'rev-list', '--parents', '-n', '1', sha]).catch(() => '');
    const parents = revList.split(/\s+/).filter(Boolean);
    const isMerge = parents.length > 2; // sha + 2 parents
    const args = ['-C', revertWt, ...gitIdentity, 'revert', '--no-edit', ...(isMerge ? ['-m', '1'] : []), sha];
    const revertErr = await git(args).then(() => null).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (revertErr) {
      await git(['-C', revertWt, 'revert', '--abort']).catch(() => '');
      return { ok: false, error: scrub(revertErr.message) };
    }
    const revSha = await git(['-C', revertWt, 'rev-parse', 'HEAD']);
    return { ok: true, sha: revSha };
  });
  await cleanupWorktree(bare, revertWt);
  if (error || !result) return { ok: false, error: error ? scrub(error.message) : 'revert-failed' };
  return result;
}

//? Remove a throwaway merge/revert worktree (git registration + on-disk dir), best-effort.
async function cleanupWorktree(bare: string, wt: string): Promise<void> {
  await git(['--git-dir', bare, 'worktree', 'remove', '--force', wt]).catch(() => '');
  if (existsSync(wt)) tryCatchSync(() => { rmSync(wt, { recursive: true, force: true }); });
  await git(['--git-dir', bare, 'worktree', 'prune']).catch(() => '');
}

export const MAX_STAGE_BUNDLE_BYTES = 256 * 1024 * 1024;

//? Import a credential-free `git bundle` captured from the container-owned worktree into a
//? fresh host-controlled bare repository, then push that exact branch with host-side askpass.
//? The untrusted container's git config/hooks never execute on the host, and the forge token
//? never enters the container or Docker argv.
export async function pushBundleBranch(input: { bundlePath: string; gitUrl: string; token: string; branch: string; expectedHead: string }): Promise<void> {
  if (!(await validBranch(input.branch)) || !/^[0-9a-f]{40,64}$/i.test(input.expectedHead)) throw new Error('invalid-bundle-target');
  const bundleStat = lstatSync(input.bundlePath);
  if (!bundleStat.isFile() || bundleStat.isSymbolicLink() || bundleStat.size <= 0 || bundleStat.size > MAX_STAGE_BUNDLE_BYTES) throw new Error('invalid-bundle');
  const scratch = path.join(path.dirname(input.bundlePath), `outgoing-${randomUUID()}.git`);
  mkdirSync(scratch, { recursive: true });
  try {
    await git(['init', '--bare', scratch]);
    await git(['--git-dir', scratch, '-c', 'protocol.file.allow=always', 'fetch', '--no-tags', input.bundlePath, `refs/heads/${input.branch}:refs/heads/${input.branch}`]);
    const importedHead = await git(['--git-dir', scratch, 'rev-parse', '--verify', `refs/heads/${input.branch}`]);
    if (importedHead !== input.expectedHead) throw new Error('bundle-head-mismatch');
    await withRetry(() => git(['--git-dir', scratch, '-c', 'core.hooksPath=', '-c', 'credential.helper=', 'push', withAuth(input.gitUrl, input.token), `${input.branch}:${input.branch}`], { env: authEnv(input.token) }), { attempts: 3, baseMs: 200 });
  } finally {
    tryCatchSync(() => { rmSync(scratch, { recursive: true, force: true }); });
  }
}

//? Push a ticket's branch to origin (push-on-approval, Track F). The token is injected ONLY
//? into this git process via `withAuth` — never stored on the remote (origin keeps the clean
//? url, like `cloneRepo`) and never logged (git errors are token-scrubbed). Pushes from the
//? ticket's worktree, where the AI's commits live. Throws a scrubbed error on failure.
export async function pushBranch(input: { workspaceId: string; projectId: string; ticketKey: string; gitUrl: string; token: string; branch: string }): Promise<void> {
  const wt = worktreePath(input.workspaceId, input.projectId, input.ticketKey);
  //? Bounded retry/backoff so a transient network blip doesn't drop an approved push (C3).
  await withRetry(() => git(['-C', wt, 'push', withAuth(input.gitUrl, input.token), `${input.branch}:${input.branch}`], { env: authEnv(input.token) }), { attempts: 3, baseMs: 200 });
}

//? Push a branch ref straight from the BARE clone to origin (C1). Used after a server-side
//? merge/revert — those advance `target` in the bare repo, and this is what makes the forge ref
//? actually receive the result (previously the merge landed only locally). Bounded retry/backoff
//? so a transient blip doesn't drop an authoritative merge. Token injected only into this git
//? process via `withAuth` (never stored on the remote, never logged — errors are scrubbed).
export async function pushRef(input: { workspaceId: string; projectId: string; gitUrl: string; token: string; ref: string }): Promise<void> {
  const bare = bareRepoPath(input.workspaceId, input.projectId);
  if (!existsSync(bare)) throw new Error('not-linked');
  await withRetry(() => git(['--git-dir', bare, 'push', withAuth(input.gitUrl, input.token), `${input.ref}:${input.ref}`], { env: authEnv(input.token) }), { attempts: 3, baseMs: 200 });
}
