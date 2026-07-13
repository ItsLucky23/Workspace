//? Workspaces — read/write a single file in a ticket's container WORKTREE (#35, Track D). The lightweight
//? in-ticket editor ("changes"/Monaco mode) reconstructs content from the diff and could only view it; this
//? seam lets it read the REAL worktree file and SAVE an edit back. All exec is bounded to OUR container
//? (`ws-<ws>-<ticket>`, verified by isWorkspacesContainer — never an arbitrary host container) and to a
//? path-validated relative file under /work. Content is written via STDIN (never interpolated into a shell),
//? so an edit can't inject a command. Best-effort: no docker / not our container ⇒ a clean error, never a throw.
//?
//? The save is STAGE-LOCKED at the route layer (a save while the agent is running would race the worktree) —
//? this module is the transport; the route enforces the lock (like the editor edit-lock, C4).

import { spawn } from 'node:child_process';

import { DOCKER_BIN, containerName, isWorkspacesContainer, dockerAvailable, docker } from './runtime';

//? A worktree-relative path: safe chars only, no `..` (traversal), no leading `/` (absolute escape). The
//? shell quoting below relies on this — never relax it without re-checking the exec.
const SAFE_PATH = /^[A-Za-z0-9._/-]{1,300}$/;
export function isSafeWorktreePath(p: string): boolean { return SAFE_PATH.test(p) && !p.includes('..') && !p.startsWith('/'); }

//? Read one file's real content out of the ticket worktree (relative to /work). Null-ish → a typed error.
export async function readWorktreeFile(workspaceId: string, ticketKey: string, path: string): Promise<{ ok: boolean; content?: string; error?: string }> {
  if (!isSafeWorktreePath(path)) return { ok: false, error: 'editor.pathInvalid' };
  if (!(await dockerAvailable())) return { ok: false, error: 'docker.unavailable' };
  const container = containerName(workspaceId, ticketKey);
  if (!(await isWorkspacesContainer(container))) return { ok: false, error: 'container.notOurs' };
  const r = await docker(['exec', '-w', '/work', container, 'cat', path]);
  return r.code === 0 ? { ok: true, content: r.out } : { ok: false, error: 'editor.readFailed' };
}

//? Write edited content back to one worktree file (relative to /work), creating parent dirs. Content flows
//? through STDIN so it is never part of the command. Returns a typed error, never throws.
export async function writeWorktreeFile(workspaceId: string, ticketKey: string, path: string, content: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSafeWorktreePath(path)) return { ok: false, error: 'editor.pathInvalid' };
  if (!(await dockerAvailable())) return { ok: false, error: 'docker.unavailable' };
  const container = containerName(workspaceId, ticketKey);
  if (!(await isWorkspacesContainer(container))) return { ok: false, error: 'container.notOurs' };
  return new Promise((resolve) => {
    //? `$1` is the validated path; `mkdir -p "$(dirname …)"` then `cat > "$1"` writes stdin to the file.
    const proc = spawn(DOCKER_BIN, ['exec', '-i', '-w', '/work', container, 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path], { windowsHide: true });
    let err = '';
    proc.on('error', (e) => { resolve({ ok: false, error: `editor.writeFailed: ${e.message}` }); });
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('close', (code) => { resolve(code === 0 ? { ok: true } : { ok: false, error: err.slice(0, 200) || 'editor.writeFailed' }); });
    proc.stdin.on('error', () => { /* the close handler reports */ });
    proc.stdin.end(content);
  });
}
