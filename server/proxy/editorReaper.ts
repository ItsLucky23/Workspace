//? Editor eviction / CapacityManager (server-side). A periodic reaper that stops IDLE per-ticket
//? live editors and prunes their proxy routes, so long-lived editor processes + routes don't
//? accumulate. IDLE = openvscode-server is LISTENING on the editor port but has NO connected
//? client (no ESTABLISHED socket), sustained for WS_EDITOR_IDLE_MIN. Self-contained: reads the
//? container's /proc/net/tcp (procps-free) + the proxy abstraction. A live browser connection
//? keeps the editor alive; a precise lastActivity signal from the editor layer can refine this.

import { spawn } from 'node:child_process';

import { DOCKER_BIN, docker } from '../container/runtime';
import { editorRouteId, getProxyProvider } from './index';

const EDITOR_PORT = Number(process.env.WS_EDITOR_PORT ?? '3000');
const IDLE_MS = Number(process.env.WS_EDITOR_IDLE_MIN ?? '30') * 60_000;
//? Reap cadence. Exported so the @luckystack/cron overlay job schedules it (cron's lease = single-instance).
export const EDITOR_REAP_MS = Number(process.env.WS_REAP_INTERVAL_MIN ?? '5') * 60_000;
const HEX = EDITOR_PORT.toString(16).toUpperCase().padStart(4, '0'); //? 3000 → '0BB8'

//? container name → epoch ms it was first seen idle (cleared when a client connects / editor stops).
const idleSince = new Map<string, number>();

//? Read the editor port's socket states from the container's /proc/net/tcp (procps-free).
//? `listening` = a LISTEN (0A) socket on the port; `connected` = an ESTABLISHED (01) one.
//? Exported so the worker-reaper (W3) can skip a container a human is actively editing.
export async function editorSockState(container: string): Promise<{ available: boolean; listening: boolean; connected: boolean }> {
  const r = await docker(['exec', container, 'sh', '-c', `grep -i ':${HEX}' /proc/net/tcp /proc/net/tcp6 2>/dev/null; code=$?; [ "$code" -eq 0 ] || [ "$code" -eq 1 ]`]);
  let listening = false;
  let connected = false;
  for (const line of r.out.split('\n')) {
    const p = line.trim().split(/\s+/);
    const local = p[1] ?? '';
    const st = (p[3] ?? '').toUpperCase();
    if (!local.toUpperCase().endsWith(`:${HEX}`)) continue;
    if (st === '0A') listening = true;
    else if (st === '01') connected = true;
  }
  return { available: r.code === 0, listening, connected };
}

//? Kill openvscode-server in the container (procps-free) — mirrors the claude kill in
//? agentControl.ts but matches the editor process.
function killEditor(container: string): Promise<void> {
  const script = 'for d in /proc/[0-9]*; do if grep -qa openvscode "$d/cmdline" 2>/dev/null; then p="${d#/proc/}"; [ "$p" != "$$" ] && kill "$p" 2>/dev/null; fi; done; true';
  return new Promise((resolve) => {
    const proc = spawn(DOCKER_BIN, ['exec', container, 'sh', '-c', script], { windowsHide: true });
    proc.on('error', () => { resolve(); });
    proc.on('close', () => { resolve(); });
  });
}

//? One reaper sweep: stop editors idle beyond the threshold + prune their routes. Best-effort.
export async function reapIdleEditors(now: number): Promise<{ reaped: string[] }> {
  const r = await docker(['ps', '--filter', 'label=org.workspaces.ticket', '--format', '{{.Names}}\t{{.Label "org.workspaces.workspace"}}\t{{.Label "org.workspaces.ticket"}}']);
  const rows = r.out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const live = new Set<string>();
  const reaped: string[] = [];
  for (const row of rows) {
    const [name, workspaceId, ticketKey] = row.split('\t');
    if (!name || !workspaceId || !ticketKey) continue;
    live.add(name);
    const { listening, connected } = await editorSockState(name);
    if (!listening || connected) { idleSince.delete(name); continue; } //? no editor, or a client is connected → not idle
    const since = idleSince.get(name) ?? now;
    idleSince.set(name, since);
    if (now - since >= IDLE_MS) {
      await killEditor(name);
      await getProxyProvider().removeRoute(editorRouteId(workspaceId, ticketKey));
      idleSince.delete(name);
      reaped.push(name);
    }
  }
  //? Forget containers that are gone (a restart of the same name resets its idle clock).
  const stale: string[] = [];
  for (const k of idleSince.keys()) { if (!live.has(k)) stale.push(k); }
  for (const k of stale) idleSince.delete(k);
  if (reaped.length > 0) console.log(`[editor-reaper] reaped ${String(reaped.length)} idle editor(s): ${reaped.join(', ')}`);
  return { reaped };
}

