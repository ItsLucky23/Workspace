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

import { DOCKER_BIN, containerName, isWorkspacesContainer, dockerAvailable } from './runtime';

//? A RAW docker-exec that returns stdout BYTE-EXACT (the shared `docker()` helper `.trim()`s output, which
//? would silently drop a file's trailing newline/whitespace — significant for source files + git). Best-effort.
function dockerExecRaw(args: string[], stdin?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn(DOCKER_BIN, args, { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    proc.on('error', (e) => { resolve({ code: -1, out: '', err: e.message }); });
    proc.on('close', (code) => { resolve({ code: code ?? -1, out, err }); });
    if (stdin !== undefined) { proc.stdin.on('error', () => { /* close handler reports */ }); proc.stdin.end(stdin); }
  });
}

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
  //? Raw exec (byte-exact) — never `docker()` here: its `.trim()` would drop the file's trailing newline.
  const r = await dockerExecRaw(['exec', '-w', '/work', container, 'cat', path]);
  return r.code === 0 ? { ok: true, content: r.out } : { ok: false, error: 'editor.readFailed' };
}

//? Write edited content back to one worktree file (relative to /work), creating parent dirs. Content flows
//? through STDIN so it is never part of the command. Returns a typed error, never throws.
export async function writeWorktreeFile(workspaceId: string, ticketKey: string, path: string, content: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSafeWorktreePath(path)) return { ok: false, error: 'editor.pathInvalid' };
  if (!(await dockerAvailable())) return { ok: false, error: 'docker.unavailable' };
  const container = containerName(workspaceId, ticketKey);
  if (!(await isWorkspacesContainer(container))) return { ok: false, error: 'container.notOurs' };
  //? `$1` is the validated path; `mkdir -p "$(dirname …)"` then `cat > "$1"` writes STDIN to the file (content
  //? is never part of the command → no shell injection).
  const r = await dockerExecRaw(['exec', '-i', '-w', '/work', container, 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path], content);
  return r.code === 0 ? { ok: true } : { ok: false, error: r.err.slice(0, 200) || 'editor.writeFailed' };
}
