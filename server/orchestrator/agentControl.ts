//? Agent control-plane (C2) — stop a running autonomous turn on demand. The engine's normal
//? end-of-turn rides the Stop-hook capture; THIS is for a human-initiated kill of an in-flight
//? turn. Kills the in-container `claude` PROCPS-FREE (ps/pgrep are absent in the slim base
//? image) by matching /proc/[pid]/cmdline, then marks the ticket's busy worker AgentSession
//? stopped. Best-effort throughout — a missing container/docker never throws.

import { spawn } from 'node:child_process';
import type { PrismaClient } from '@prisma/client';

import { containerName, DOCKER_BIN } from '../container/runtime';

//? Kill claude in the container without procps: walk /proc/[pid]/cmdline, match 'claude', kill
//? (never the shell `$$` itself). openvscode/other procs don't contain 'claude', so this only
//? hits the turn. Transient greps that self-match are harmless (they exit immediately).
const KILL_SCRIPT = 'for d in /proc/[0-9]*; do if grep -qa claude "$d/cmdline" 2>/dev/null; then p="${d#/proc/}"; [ "$p" != "$$" ] && kill "$p" 2>/dev/null; fi; done; true';

export function killClaudeInContainer(workspaceId: string, ticketKey: string): Promise<boolean> {
  const name = containerName(workspaceId, ticketKey);
  return new Promise((resolve) => {
    const proc = spawn(DOCKER_BIN, ['exec', name, 'sh', '-c', KILL_SCRIPT], { windowsHide: true });
    proc.on('error', () => { resolve(false); });
    proc.on('close', (code) => { resolve(code === 0); });
  });
}

//? Human KILL of a ticket's in-flight turn: stop claude in the container + mark the busy worker
//? AgentSession stopped. Returns whether a busy worker session was found.
export async function killTicketAgent(prisma: PrismaClient, workspaceId: string, ticketKey: string): Promise<boolean> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { id: true } });
  if (!ticket) return false;
  await killClaudeInContainer(workspaceId, ticketKey);
  const res = await prisma.agentSession.updateMany({ where: { workspaceId, ticketId: ticket.id, kind: 'worker', status: 'busy' }, data: { status: 'stopped' } });
  return res.count > 0;
}
