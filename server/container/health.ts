//? Container readiness probe (ADR 0037 B1; C2 depth-program). No app-readiness helper existed —
//? `launchTicketContainer` only checks liveness (`docker inspect .State.Running`). Before flipping a
//? stable route (deploy/preview/editor) to a freshly-launched container we must know the port is
//? actually SERVING, so poll the in-container port with curl (falling back to wget) until it answers
//? or the attempt budget runs out. This is what turns the preview/editor/deploy "dispatch + assume
//? success" fire-and-forget into "return only once bound (or a typed timeout)". Best-effort: a missing
//? docker/curl just yields `false` (the caller reports not-ready, never throws).

import { docker } from './runtime';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface ReadyOptions {
  attempts?: number;       // poll count (default 20)
  delayMs?: number;        // delay between polls (default 1500 → ~30s budget)
  //? Accept ANY HTTP response (drop curl `-f`), not just 2xx/3xx. Needed for a server that gates
  //? the root with an auth token (openvscode-server → 401 until the connection-token is presented):
  //? a 401 still proves the port is bound + serving. Deploy/preview want a healthy 2xx (default false).
  acceptAnyStatus?: boolean;
  //? Injectable probe runner (defaults to `docker exec <c> sh -lc <cmd>`). Lets tests drive the
  //? retry loop + assert the probe shape without a real container.
  run?: (containerName: string, shellCmd: string) => Promise<{ code: number }>;
}

//? Poll `http://localhost:<port>` INSIDE the container until it responds (2xx/3xx, or any status when
//? `acceptAnyStatus`) or attempts run out. Returns whether the port became ready.
export async function waitForContainerReady(containerName: string, port: number, opts: ReadyOptions = {}): Promise<boolean> {
  const attempts = opts.attempts ?? 20;
  const delayMs = opts.delayMs ?? 1500;
  const curlFlags = opts.acceptAnyStatus ? '-sS' : '-fsS';
  const probe = `curl ${curlFlags} -o /dev/null "http://localhost:${String(port)}" || wget -q -O /dev/null "http://localhost:${String(port)}"`;
  const run = opts.run ?? ((c, cmd): Promise<{ code: number }> => docker(['exec', c, 'sh', '-lc', cmd]).then((r) => ({ code: r.code })));
  for (let i = 0; i < attempts; i += 1) {
    const res = await run(containerName, probe);
    if (res.code === 0) return true;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return false;
}
