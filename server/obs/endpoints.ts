//? Observability HTTP endpoints (#5): /healthz (liveness alias) + /metrics (Prometheus). Registered
//? as pre-params custom routes (like the edge-auth check) so they answer BEFORE auth/session — a
//? probe must not require a login. Each claims only its own path.
//?
//? READINESS is already provided by the FRAMEWORK: `config.http.readyEndpoint` (default /readyz)
//? checks bootUuid + Redis + Prisma, and `config.http.liveEndpoint` (default /livez) is liveness.
//? We add:
//?  - /healthz — a liveness alias under the name the goal + most k8s charts expect (the framework's
//?    canonical liveness path is /livez). Always 200 — the process is running.
//?  - /metrics — the engine gauges in Prometheus text format (server/obs/metrics.ts): active/queued
//?    turns vs the cap, busy sessions, resident containers, leader state.

import { tryCatch } from '@luckystack/core';
import { registerCustomRoute } from '@luckystack/server';

import { gatherMetrics, renderPrometheus } from './metrics';

const send = (res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void }, code: number, type: string, body: string): void => {
  res.statusCode = code;
  res.setHeader('Content-Type', type);
  res.end(body);
};

//? Register the probes (call once at boot). `now` is injectable for tests of the handler.
export function registerObservabilityEndpoints(now: () => number = () => Date.now()): void {
  registerCustomRoute(async (req, res) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    if (url === '/healthz') {
      send(res, 200, 'application/json', JSON.stringify({ status: 'ok' }));
      return true;
    }
    if (url === '/metrics') {
      const [error, m] = await tryCatch(() => gatherMetrics(now()));
      if (error || !m) { send(res, 503, 'text/plain', '# metrics unavailable\n'); return true; }
      send(res, 200, 'text/plain; version=0.0.4', renderPrometheus(m));
      return true;
    }
    return false;
  }, { phase: 'pre-params' });
}
