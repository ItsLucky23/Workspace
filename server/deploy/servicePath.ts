//? F28 — resolving a `Service.path` to a working directory inside the container.
//?
//? `Service.path` is the repo-relative root of a monorepo unit ("apps/web"), and the schema promises each
//? service is independently buildable and deployable. It was not: every `docker exec` ran with `-w /work`,
//? the repo root, so a service's dev/prod command executed in the wrong directory and either failed or —
//? worse — silently served the root project while claiming to serve the service.
//?
//? The path comes from user input and becomes part of a container path, so it is validated rather than
//? interpolated: absolute paths, drive letters, control characters and `..` segments are refused. The same
//? rules `designTokenCssPath` already applies, kept in one place so the two cannot drift apart.

const WORK_ROOT = '/work';

export interface ServiceWorkdir { ok: true; dir: string }
export interface ServiceWorkdirError { ok: false; error: string }

//? A validated absolute working directory inside the container. `null`/`.`/empty all mean the repo root,
//? which is also what a single-service project wants — so the default path is never an error.
export function serviceWorkdir(servicePath?: string | null): ServiceWorkdir | ServiceWorkdirError {
  const raw = (servicePath ?? '.').trim().replaceAll('\\', '/');
  if (raw.length === 0 || raw === '.') return { ok: true, dir: WORK_ROOT };
  if (/^(?:\/|[A-Za-z]:)/.test(raw)) return { ok: false, error: 'service.absolutePath' };
  //? A control character in a path is exactly what we reject, so the class is built explicitly.
  const CONTROL_CHARS = new RegExp(`[${String.fromCodePoint(0)}-${String.fromCodePoint(31)}${String.fromCodePoint(127)}]`);
  if (CONTROL_CHARS.test(raw)) return { ok: false, error: 'service.invalidPath' };

  const parts = raw.split('/').filter((part) => part.length > 0 && part !== '.');
  if (parts.some((part) => part === '..' || part.includes(':'))) return { ok: false, error: 'service.invalidPath' };
  if (parts.length === 0) return { ok: true, dir: WORK_ROOT };
  return { ok: true, dir: `${WORK_ROOT}/${parts.join('/')}` };
}

//? The working directory to hand `docker exec -w`. Falls back to the repo root on an invalid path: a
//? refused path must not silently redirect the command somewhere else, and the caller logs the refusal.
export function workdirOrRoot(servicePath?: string | null): string {
  const resolved = serviceWorkdir(servicePath);
  if (!resolved.ok) {
    console.warn(`[service] refusing path '${String(servicePath)}' (${resolved.error}) — running at the repo root instead`);
    return WORK_ROOT;
  }
  return resolved.dir;
}
