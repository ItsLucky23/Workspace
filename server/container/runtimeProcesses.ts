//? ADR 0317 — what it takes to RUN this app, as a list rather than a single string.
//?
//? `Project.devCommand` was one command, and a real app is rarely one command: a frontend and a
//? backend, often a worker, sometimes an ssh tunnel to a database. The single field forced all of that
//? into one shell line (`a & b & wait`), which starts fine and then gives you one merged output stream
//? where you cannot tell which half died.
//?
//? The shape is NOT new: a pipeline stage has had `processes` — name, cwd, env, ordered commands —
//? which `startStageProcesses` starts in the ticket's container and `TerminalPanel` renders as one
//? terminal tab each. That is exactly the model the owner asked for; it was simply attached to the
//? stage rather than to the project, so it changed as a ticket moved and was empty in every stage of
//? a real (non-demo) pipeline. This module makes it a project-level runtime and shares ONE start
//? implementation with the stage runner, so "a process" means one thing in this product.
//?
//? Nothing about an existing project changes: an empty `runProcesses` falls back to `devCommand` and
//? then to the stack default, which is the exact resolution the preview did before.
//? @adr 0317

import { resolveDevCommand } from './baseImages';
import { docker } from './runtime';
import { tryCatch } from '@luckystack/core';

/** The stored shape, shared with `PipelineStage.processes` (Prisma composite `StageProcessCfg`). */
export interface RuntimeProcess {
  id: string;
  name: string;
  cwd: string;
  env: { key: string; value: string }[];
  commands: string[];
}

export interface ResolvedRuntime {
  processes: RuntimeProcess[];
  /** The process whose port is probed and proxied — the one the preview URL points at. */
  previewId: string;
}

const LEGACY_ID = 'dev';

/** Drop entries that would start nothing, so an empty row in the editor never becomes a phantom tab. */
function usable(processes: RuntimeProcess[]): RuntimeProcess[] {
  return processes.filter((p) => p.commands.some((c) => c.trim().length > 0));
}

//? Resolution order, service-first, because a monorepo ticket must preview ITS unit:
//?   1. the SERVICE's own single command, when it has one — this is the pre-0317 override and the only
//?      way a monorepo currently expresses "this unit starts differently". Kept exact so upgrading
//?      cannot change what an existing service ticket boots.
//?   2. the PROJECT's process list — the multi-command runtime, run inside the service's directory when
//?      the ticket has one.
//?   3. the project's legacy single command, then the stack default.
//? A per-SERVICE list is deliberately absent: there is no UI to set one, and schema no screen can fill
//? is how a product ends up with settings that silently do nothing.
export function resolveRuntime(
  project: { devCommand?: string | null; stack?: string | null; runProcesses?: RuntimeProcess[] | null; previewProcessId?: string | null } | null,
  service?: { devCommand?: string | null } | null,
): ResolvedRuntime {
  const serviceCommand = (service?.devCommand ?? '').trim();
  if (serviceCommand.length > 0) {
    return { processes: [{ id: LEGACY_ID, name: 'dev', cwd: '', env: [], commands: [serviceCommand] }], previewId: LEGACY_ID };
  }

  const list = usable(project?.runProcesses ?? []);
  if (list.length > 0) {
    //? An unknown or cleared preview id falls back to the first process rather than to nothing — a
    //? preview that silently proxies no one is indistinguishable from a broken dev server.
    const wanted = project?.previewProcessId ?? '';
    const previewId = list.some((p) => p.id === wanted) ? wanted : (list[0]?.id ?? LEGACY_ID);
    return { processes: list, previewId };
  }

  const command = resolveDevCommand({ devCommand: project?.devCommand ?? null, stack: project?.stack ?? null });
  return { processes: [{ id: LEGACY_ID, name: 'dev', cwd: '', env: [], commands: [command] }], previewId: LEGACY_ID };
}

/** Single-quote a value for `sh -lc`, closing and reopening around embedded quotes. */
export function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", String.raw`'''`)}'`;
}

//? Start one process detached, with its own cwd + env, teeing its output to a per-process log on the
//? /work volume so the terminal tab can show what it actually did. Best-effort by design: a wrong
//? command in one process must not stop the others or fail the stage that started them.
export async function startProcess(container: string, proc: RuntimeProcess, baseDir: string, extraEnv: Record<string, string> = {}): Promise<boolean> {
  const commands = proc.commands.filter((c) => c.trim().length > 0);
  if (commands.length === 0) return false;
  //? The name reaches a file path and the env values reach `export`, so both are quoted rather than
  //? interpolated raw.
  const safeName = proc.name.replaceAll(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'process';
  const dir = proc.cwd.trim().length > 0 ? proc.cwd.trim() : baseDir;
  const env = [...Object.entries(extraEnv).map(([key, value]) => ({ key, value })), ...proc.env];
  const exports = env.map((e) => `export ${e.key.replaceAll(/[^A-Za-z0-9_]/g, '')}=${quoteForShell(e.value)};`).join(' ');
  const script = `cd ${quoteForShell(dir)} 2>/dev/null || cd ${quoteForShell(baseDir)}; ${exports} ${commands.join(' && ')}`;
  const logPath = `/work/.claude/process-${safeName}.log`;
  const [error, result] = await tryCatch(() => docker(['exec', '-d', container, 'sh', '-lc', `mkdir -p /work/.claude; { ${script}; } >> ${logPath} 2>&1`]));
  if (error || result?.code !== 0) {
    console.warn(`[runtime] process '${proc.name}' failed to start in ${container}`);
    return false;
  }
  return true;
}

/** Start every process in order. Returns how many actually started.
 *  `previewEnv` is applied ONLY to `previewId` — the HOST/PORT hints belong to the process that binds
 *  the preview port, and telling a worker or an ssh tunnel to listen on the frontend's port is how you
 *  get two processes fighting over one socket. */
export async function startProcesses(container: string, processes: RuntimeProcess[], opts: { baseDir?: string; previewId?: string; previewEnv?: Record<string, string> } = {}): Promise<number> {
  const baseDir = opts.baseDir ?? '/work';
  let started = 0;
  for (const proc of processes) {
    const env = proc.id === opts.previewId ? (opts.previewEnv ?? {}) : {};
    if (await startProcess(container, proc, baseDir, env)) started += 1;
  }
  return started;
}
