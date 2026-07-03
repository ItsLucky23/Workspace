//? Workspaces — linked-repo store (register-flow step A: link a git repo).
//?
//? Clones a project's repo into `data/workspaces/<workspaceId>/repo.git` as a BARE
//? clone — the durable per-workspace baseline the runtime later cuts `DEV-####`
//? git-worktrees from (GIT_STRATEGY §0/§1, 07b §4). One bare repo per workspace;
//? per-ticket worktrees are added off it at ticket-create/stage-entry (a later slice).
//?
//? Auth: a token is injected into the clone URL only for the git process and is NEVER
//? persisted or logged — only the clean `gitUrl` is stored on `Project`. (Hardening to
//? a credential-helper/askpass so the token never touches argv is a follow-up.)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export interface RepoStatus { linked: boolean; gitUrl?: string; branch?: string; head?: string }

//? The DEV-#### git-worktree a ticket edits in, cut from the bare clone at activation
//? (07 §A step 3+5): its branch + the FROZEN baseline commitHash (DH5). `path` is the
//? on-disk checkout the container later mounts.
export interface WorktreeInfo { branch: string; commitHash: string; path: string }

//? Root for all linked clones. Under the project cwd, gitignored (`data/`).
export function workspaceDataDir(workspaceId: string): string {
  return path.join(process.cwd(), 'data', 'workspaces', workspaceId);
}
function bareRepoPath(workspaceId: string): string {
  return path.join(workspaceDataDir(workspaceId), 'repo.git');
}
function worktreePath(workspaceId: string, ticketKey: string): string {
  return path.join(workspaceDataDir(workspaceId), 'worktrees', ticketKey);
}

//? Is a bare clone present for this workspace? (worktrees require a linked repo.)
export function isLinked(workspaceId: string): boolean {
  return existsSync(bareRepoPath(workspaceId));
}

//? Run a git command, capturing stdout. Rejects with a token-scrubbed message on
//? non-zero exit so a bad URL/token surfaces without leaking the credential.
function git(args: string[], opts: { cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: opts.cwd, windowsHide: true });
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

//? Inject the token into an https URL per host convention (GitHub uses
//? x-access-token, GitLab/others use oauth2). No token → returned unchanged.
function withAuth(gitUrl: string, token: string | undefined): string {
  if (!token || !gitUrl.startsWith('https://')) return gitUrl;
  const rest = gitUrl.slice('https://'.length);
  const user = rest.startsWith('github.com') ? 'x-access-token' : 'oauth2';
  return `https://${user}:${token}@${rest}`;
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
export async function listRepoDocs(workspaceId: string): Promise<RepoDoc[]> {
  const bare = bareRepoPath(workspaceId);
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
export async function listRepoFiles(workspaceId: string, ref = 'HEAD'): Promise<RepoFile[]> {
  const bare = bareRepoPath(workspaceId);
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
export async function repoHead(workspaceId: string): Promise<string> {
  const bare = bareRepoPath(workspaceId);
  if (!existsSync(bare)) return '';
  return git(['--git-dir', bare, 'rev-parse', 'HEAD']).catch(() => '');
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
export async function repoManifests(workspaceId: string): Promise<RepoManifests> {
  const bare = bareRepoPath(workspaceId);
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
export async function repoStatus(workspaceId: string, gitUrl: string | undefined): Promise<RepoStatus> {
  const bare = bareRepoPath(workspaceId);
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
export async function cloneRepo(input: { workspaceId: string; gitUrl: string; token?: string }): Promise<RepoStatus> {
  const { workspaceId, gitUrl, token } = input;
  const dir = workspaceDataDir(workspaceId);
  const bare = bareRepoPath(workspaceId);
  mkdirSync(dir, { recursive: true });
  //? Fresh clone each link (idempotent re-link) — discard any prior bare repo.
  if (existsSync(bare)) rmSync(bare, { recursive: true, force: true });
  await git(['clone', '--bare', withAuth(gitUrl, token), bare]);
  //? Persist the origin WITHOUT the token so later fetches use the stored (clean) URL;
  //? the token is re-injected transiently per fetch (a later slice re-supplies it).
  await git(['--git-dir', bare, 'remote', 'set-url', 'origin', gitUrl]).catch(() => '');
  return repoStatus(workspaceId, gitUrl);
}

//? Add the ticket's worktree off the bare clone (07 §A step 5), freezing the default-branch
//? HEAD as the ticket's baseline commit (DH5, step 3). Idempotent: an existing worktree is
//? returned as-is; a re-activation reuses the durable branch. The on-disk worktree dir is
//? keyed by the (stable) ticket key, while the BRANCH name is `branchName` — the per-workspace
//? branch-strategy result (server/git/branchStrategy.ts), defaulting to the ticket key for the
//? legacy `ticket-prefix` behaviour. Returns null if no repo is linked.
export async function addWorktree(workspaceId: string, ticketKey: string, branchName: string = ticketKey): Promise<WorktreeInfo | null> {
  const bare = bareRepoPath(workspaceId);
  if (!existsSync(bare)) return null;
  const wt = worktreePath(workspaceId, ticketKey);
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

//? Push a ticket's branch to origin (push-on-approval, Track F). The token is injected ONLY
//? into this git process via `withAuth` — never stored on the remote (origin keeps the clean
//? url, like `cloneRepo`) and never logged (git errors are token-scrubbed). Pushes from the
//? ticket's worktree, where the AI's commits live. Throws a scrubbed error on failure.
export async function pushBranch(input: { workspaceId: string; ticketKey: string; gitUrl: string; token: string; branch: string }): Promise<void> {
  const wt = worktreePath(input.workspaceId, input.ticketKey);
  await git(['-C', wt, 'push', withAuth(input.gitUrl, input.token), `${input.branch}:${input.branch}`]);
}
