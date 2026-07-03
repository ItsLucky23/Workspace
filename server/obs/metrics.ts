//? Metrics (#5) — the runtime gauges an operator scrapes: how busy the engine is (active vs queued
//? turns against the cap), how many worker containers/sessions are resident, and this instance's
//? leader/lease state (multi-instance). Emitted in Prometheus text-exposition format from /metrics
//? (server/obs/endpoints.ts) so Prometheus/Grafana can scrape it directly; the gather function is
//? also reused by the readiness probe + tests. Best-effort — a probe failure yields 0, never throws.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { activeCount, capacityLimit, queueLength } from '../orchestrator/capacity';
import { isLeader } from '../orchestrator/cluster';
import { dockerAvailable, docker } from '../container/runtime';

export interface EngineMetrics {
  activeTurns: number;      // slots currently held (CapacityManager, #12)
  queuedTurns: number;      // turns parked on the admission queue
  capacityLimit: number;    // the hard cap
  busyWorkerSessions: number; // AgentSession rows in `busy` (the DB view of running work)
  residentContainers: number; // running ticket containers (docker ps; 0 without Docker)
  isLeader: number;         // 1 if this instance holds the leader lease, else 0
}

//? Gather the current gauges. `now` feeds the capacity staleness eviction so a crash-leaked slot
//? isn't counted. Each probe is independently best-effort.
export async function gatherMetrics(now: number): Promise<EngineMetrics> {
  const prisma = getPrismaClient();
  const [active, queued] = await Promise.all([activeCount(now), queueLength()]);
  const [, busy] = await tryCatch(() => prisma.agentSession.count({ where: { kind: 'worker', status: 'busy' } }));
  let resident = 0;
  if (await dockerAvailable()) {
    const [, r] = await tryCatch(() => docker(['ps', '--filter', 'label=org.workspaces.ticket', '--format', '{{.Names}}']));
    resident = r ? r.out.split('\n').filter((l) => l.trim().length > 0).length : 0;
  }
  return {
    activeTurns: active,
    queuedTurns: queued,
    capacityLimit: capacityLimit(),
    busyWorkerSessions: typeof busy === 'number' ? busy : 0,
    residentContainers: resident,
    isLeader: isLeader() ? 1 : 0,
  };
}

//? One Prometheus HELP+TYPE+value block.
const gauge = (name: string, help: string, value: number): string =>
  `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${String(value)}`;

//? Render the gauges as Prometheus text-exposition format (one block per gauge).
export function renderPrometheus(m: EngineMetrics): string {
  return [
    gauge('workspaces_active_turns', 'AI turns currently holding a capacity slot', m.activeTurns),
    gauge('workspaces_queued_turns', 'AI turns parked on the admission queue', m.queuedTurns),
    gauge('workspaces_capacity_limit', 'The hard concurrent-turn cap', m.capacityLimit),
    gauge('workspaces_busy_worker_sessions', 'AgentSession rows in the busy state', m.busyWorkerSessions),
    gauge('workspaces_resident_containers', 'Running ticket containers', m.residentContainers),
    gauge('workspaces_is_leader', '1 if this instance holds the leader lease', m.isLeader),
  ].join('\n') + '\n';
}
