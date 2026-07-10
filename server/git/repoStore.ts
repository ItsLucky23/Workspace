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
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

//? Run a git command, capturing stdout. Rejects with a token-scrubbed message on
//? non-zero exit so a bad URL/token surfaces without leaking the credential.
function git(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: opts.cwd, windowsHide: true, ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}) });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', (e) => { reject(new Error(scrub(e.message))); });
    proc.on('close', (code) => {
      if (code === 0) resolve(out.trim());
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

//? Unified diff of `source` against `target` (three-dot = changes on source since it forked) from
//? the bare clone — the MR review diff. '' when unlinked or a ref is missing.
export async function branchDiff(workspaceId: string, projectId: string, target: string, source: string): Promise<string> {
  const bare = bareRepoPath(workspaceId, projectId);
  if (!existsSync(bare)) return '';
  return git(['--git-dir', bare, 'diff', `${target}...${source}`]).catch(() => '');
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
