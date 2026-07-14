//? W3 — idle worker-container reaper. A ticket parked at `needs-input` (waiting for a human) keeps its per-ticket
//? worker container running indefinitely — the editor-reaper only kills idle *editors*, never the worker itself.
//? This reaper STOPS (not removes) the worker container of a parked ticket after WS_WORKER_IDLE_MIN: a stopped
//? container frees CPU/RAM while preserving its filesystem, so the existing reprovision path (`docker start` the
//? same-named container on answer/resume) keeps `claude --resume` working. Leader-gated. The reap DECISION is
//? pure over injected deps (Docker/Prisma) so it is unit-testable without a daemon.

import { docker } from '../container/runtime';
import { getPrismaClient } from '@luckystack/core';
import { editorSockState } from '../proxy/editorReaper';

const IDLE_MS = Number(process.env.WS_WORKER_IDLE_MIN ?? '20') * 60_000;
//? Reap cadence. Exported so the @luckystack/cron overlay job schedules it (leadership handled by cron's lease).
export const WORKER_REAP_MS = Number(process.env.WS_REAP_INTERVAL_MIN ?? '5') * 60_000;

//? container name → epoch ms it was first seen parked-idle (cleared when the ticket leaves needs-input / is gone).
const idleSince = new Map<string, number>();

//? Statuses that hold a container we may reap: a parked ticket is idle (its `claude` was killed on needs-input).
//? A `busy` ticket has a live turn — NEVER reap it.
const REAPABLE = new Set(['needs-input']);

export interface WorkerReapDeps {
  //? Running per-ticket worker containers: `{ name, ticketKey }`.
  listWorkers: () => Promise<{ name: string; ticketKey: string }[]>;
  //? Map each ticket key → its current status.
  ticketStatus: (keys: string[]) => Promise<Map<string, string>>;
  //? True when a human has a live editor connection on that container (don't reap under them).
  hasConnectedEditor: (name: string) => Promise<boolean>;
  //? Stop (not remove) the container.
  stop: (name: string) => Promise<void>;
}

//? One reaper sweep (pure over deps). Stops parked-idle worker containers past the TTL; tracks the idle clock
//? per container across sweeps; forgets containers that are gone. Best-effort — never throws into the caller.
export async function reapIdleWorkers(now: number, deps: WorkerReapDeps): Promise<{ reaped: string[] }> {
  const workers = await deps.listWorkers();
  const statuses = await deps.ticketStatus(workers.map((w) => w.ticketKey));
  const reaped: string[] = [];
  const seen = new Set<string>();
  for (const w of workers) {
    seen.add(w.name);
    const status = statuses.get(w.ticketKey) ?? '';
    if (!REAPABLE.has(status)) { idleSince.delete(w.name); continue; } // active/other → not reapable
    if (await deps.hasConnectedEditor(w.name)) { idleSince.delete(w.name); continue; } // a human is editing → keep
    const since = idleSince.get(w.name) ?? now;
    idleSince.set(w.name, since);
    if (now - since >= IDLE_MS) {
      await deps.stop(w.name);
      idleSince.delete(w.name);
      reaped.push(w.name);
    }
  }
  //? Forget containers that are no longer running (a stop/restart resets the idle clock).
  const stale: string[] = [];
  for (const name of idleSince.keys()) if (!seen.has(name)) stale.push(name);
  for (const name of stale) idleSince.delete(name);
  if (reaped.length > 0) console.log(`[worker-reaper] stopped ${String(reaped.length)} idle worker container(s): ${reaped.join(', ')}`);
  return { reaped };
}

//? The real deps: list labelled containers via `docker ps`, read statuses from Prisma, probe the editor socket,
//? and `docker stop` the container.
function realDeps(): WorkerReapDeps {
  return {
    listWorkers: async () => {
      const r = await docker(['ps', '--filter', 'label=org.workspaces.ticket', '--format', '{{.Names}}\t{{.Label "org.workspaces.ticket"}}']);
      return r.out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).map((row) => {
        const [name, ticketKey] = row.split('\t');
        return { name: name ?? '', ticketKey: ticketKey ?? '' };
      }).filter((w) => w.name.length > 0 && w.ticketKey.length > 0);
    },
    ticketStatus: async (keys) => {
      const rows = keys.length > 0 ? await getPrismaClient().ticket.findMany({ where: { key: { in: keys } }, select: { key: true, status: true } }) : [];
      return new Map(rows.map((t) => [t.key, t.status]));
    },
    hasConnectedEditor: async (name) => { const s = await editorSockState(name); return s.connected; },
    stop: async (name) => { await docker(['stop', name]); },
  };
}

//? One reaper pass (called by the @luckystack/cron overlay job; cron's lease guarantees single-instance).
export async function runWorkerReapTick(): Promise<void> {
  await reapIdleWorkers(Date.now(), realDeps());
}
