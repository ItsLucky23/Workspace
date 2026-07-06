//? Container readiness probe (ADR 0037, B1). No app-readiness helper existed — `launchTicketContainer`
//? only checks liveness (`docker inspect .State.Running`). Before flipping a stable environment route
//? to a freshly-launched container we must know the app actually SERVES, so poll the in-container port
//? with curl (falling back to wget) until it answers or the attempt budget runs out. Best-effort:
//? a missing docker/curl just yields `false` (the deploy reports not-ready, never throws).

import { docker } from './runtime';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

//? Poll `http://localhost:<port>` INSIDE the container until it responds 2xx/3xx or attempts run out.
//? Returns whether the app became ready. `attempts * delayMs` bounds the wait (default ~30s).
export async function waitForContainerReady(containerName: string, port: number, attempts = 20, delayMs = 1500): Promise<boolean> {
  const probe = `curl -fsS -o /dev/null "http://localhost:${String(port)}" || wget -q -O /dev/null "http://localhost:${String(port)}"`;
  for (let i = 0; i < attempts; i += 1) {
    const res = await docker(['exec', containerName, 'sh', '-lc', probe]);
    if (res.code === 0) return true;
    await sleep(delayMs);
  }
  return false;
}
