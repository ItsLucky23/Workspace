//? T2 — time-travel refs. Produce a git ref the T1 ref-preview can run: (a) "main WITHOUT commit X" as a
//? SYNTHETIC revert-ref (a real revert commit pinned at `refs/synthetic/<slug>` in the bare mirror), and (b)
//? "main as of timestamp T" = the last commit at/before T. Pure git plumbing on the bare mirror (no Docker) —
//? fully testable against a real temp repo. A revert CONFLICT is a typed result the caller surfaces (+ can offer
//? AI help), never a broken ref. This is the user's "start main but from before commit X / yesterday's version".

import { spawn } from 'node:child_process';
import path from 'node:path';

import { bareMirrorPathFor } from './repoStore';
import { isSafeRef } from '../container/runtime';

//? Run git, capturing exit code + stdout/stderr (never throws — the caller branches on `code`, e.g. a revert
//? conflict). `--git-dir <bare>` targets the bare mirror; `cwd` runs inside a worktree.
function git(args: string[], cwd?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { ...(cwd ? { cwd } : {}), windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', (e) => { resolve({ code: -1, out, err: String(e) }); });
    proc.on('close', (code) => { resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }); });
  });
}

//? R3-b — the per-PROJECT bare mirror path (with the legacy-fallback resolution shared with repoStore/runtime).
//? Was per-workspace → time-travel looked at the wrong repo in a multi-project workspace.
export function bareMirrorDir(workspaceId: string, projectId: string): string { return bareMirrorPathFor(workspaceId, projectId); }

//? A short git-ref-safe slug.
export function synthSlug(seed: string): string { return seed.toLowerCase().replaceAll(/[^a-z0-9]+/g, '').slice(0, 12) || 'x'; }

//? T2(b) — the commit on `branch` as of timestamp T (ms epoch): the newest commit at/before T. '' when the repo
//? is empty / the branch has no commit before T.
export async function commitAsOf(bareDir: string, branch: string, whenMs: number): Promise<string> {
  const iso = new Date(whenMs).toISOString();
  const r = await git(['--git-dir', bareDir, 'rev-list', '-1', `--before=${iso}`, branch]);
  return r.code === 0 ? r.out.trim() : '';
}

export interface SyntheticRefResult { ok: boolean; ref?: string; sha?: string; conflict?: boolean; error?: string }

//? T2(a) — create the "branch minus <sha>" synthetic ref. Adds a throwaway detached worktree at the branch tip,
//? reverts <sha> there (auto-commit), pins the result at `refs/synthetic/<slug>` in the bare, and removes the
//? worktree. A revert conflict → `{ ok:false, conflict:true }` (aborted + cleaned up). The returned `sha`/`ref`
//? feed openRefPreview.
export async function prepareRevertRef(bareDir: string, branch: string, sha: string, slug = synthSlug(sha)): Promise<SyntheticRefResult> {
  const wt = path.join(path.dirname(bareDir), `_synthetic-${slug}`);
  const add = await git(['--git-dir', bareDir, 'worktree', 'add', '--detach', wt, branch]);
  if (add.code !== 0) return { ok: false, error: `worktree.failed: ${add.err}` };
  try {
    const rev = await git(['-c', 'user.email=workspaces@local', '-c', 'user.name=Workspaces', 'revert', '--no-edit', sha], wt);
    if (rev.code !== 0) {
      await git(['revert', '--abort'], wt);
      return { ok: false, conflict: true, error: 'revert.conflict' };
    }
    const head = await git(['rev-parse', 'HEAD'], wt);
    const newSha = head.out.trim();
    const ref = `refs/synthetic/${slug}`;
    const pin = await git(['--git-dir', bareDir, 'update-ref', ref, newSha]);
    if (pin.code !== 0) return { ok: false, error: `pin.failed: ${pin.err}` };
    return { ok: true, ref, sha: newSha };
  } finally {
    await git(['--git-dir', bareDir, 'worktree', 'remove', '--force', wt]);
  }
}

//? T3 — a structured time-travel request (what the Assistant proposes for the user to accept): a raw `commit`
//? SHA, a `revert` of commit X ("main minus X"), or `asof` a timestamp ("yesterday's version"). Resolved here to
//? a concrete ref the T1 ref-preview can run — WITHOUT any authoritative write (single-writer intact: this only
//? reads git / creates a throwaway synthetic ref).
export type RefSpec =
  | { kind: 'commit'; value: string }
  | { kind: 'revert'; value: string }
  | { kind: 'asof'; whenMs: number };

export interface ResolvedRef { ok: boolean; ref?: string; conflict?: boolean; error?: string }

//? Resolve a RefSpec against the bare mirror → the ref to preview. `commit` returns the SHA (safety-checked);
//? `revert` produces the synthetic "branch minus X" ref (or a typed conflict); `asof` returns the commit at/
//? before the timestamp. `isSafeRef` guards the raw values before any shell use downstream.
export async function resolveRefSpec(bareDir: string, branch: string, spec: RefSpec): Promise<ResolvedRef> {
  if (spec.kind === 'commit') {
    return isSafeRef(spec.value) ? { ok: true, ref: spec.value } : { ok: false, error: 'ref.unsafe' };
  }
  if (spec.kind === 'revert') {
    if (!isSafeRef(spec.value)) return { ok: false, error: 'ref.unsafe' };
    const r = await prepareRevertRef(bareDir, branch, spec.value);
    return r.ok ? { ok: true, ...(r.sha ? { ref: r.sha } : {}) } : { ok: false, ...(r.conflict ? { conflict: true } : {}), ...(r.error ? { error: r.error } : {}) };
  }
  const sha = await commitAsOf(bareDir, branch, spec.whenMs);
  return sha.length > 0 ? { ok: true, ref: sha } : { ok: false, error: 'ref.noCommitBefore' };
}

//? Workspace wrappers (resolve the bare mirror path from the workspace id).
export function commitAsOfForWorkspace(workspaceId: string, projectId: string, branch: string, whenMs: number): Promise<string> {
  return commitAsOf(bareMirrorDir(workspaceId, projectId), branch, whenMs);
}
export function prepareRevertRefForWorkspace(workspaceId: string, projectId: string, branch: string, sha: string): Promise<SyntheticRefResult> {
  return prepareRevertRef(bareMirrorDir(workspaceId, projectId), branch, sha);
}
