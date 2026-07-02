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

//? Root for all linked clones. Under the project cwd, gitignored (`data/`).
export function workspaceDataDir(workspaceId: string): string {
  return path.join(process.cwd(), 'data', 'workspaces', workspaceId);
}
function bareRepoPath(workspaceId: string): string {
  return path.join(workspaceDataDir(workspaceId), 'repo.git');
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
