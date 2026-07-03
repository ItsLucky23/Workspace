//? Edit-lock — coordinate the autonomous AI engine and a human's LIVE editor on a ticket's
//? shared container + worktree (CODE_EDITOR_BUILD_PLAN Track C4, previously "DATA-ONLY,
//? unenforced"). The engine drives an in-container `claude` turn that edits + commits on
//? `/work`; the per-ticket VS Code (openvscode-server) edits the same `/work`. Running both at
//? once races the worktree, so this module is the mutual guard, in two directions:
//?
//?  - ENGINE side (`isEditorRunning`, enforced in the conductor): before auto-running a stage
//?    turn, skip when a live editor is open on the container — never clobber a human's session.
//?  - EDITOR side (`ticketEditGuard`, for the editor's open-flow to call): refuse to open the
//?    editor while the AI is mid-turn (a busy `worker` AgentSession) or the current stage is
//?    marked not-`userEditable`.

import { spawn } from 'node:child_process';
import type { PrismaClient } from '@prisma/client';
import { containerName, DOCKER_BIN } from '../container/runtime';

//? The in-container editor port (openvscode-server, editorServer.ts EDITOR_IN_CONTAINER_PORT).
const EDITOR_PORT = Number(process.env.WS_EDITOR_PORT ?? '3000');

//? Is the live editor (openvscode-server) serving inside the ticket's container? (⇒ a human is
//? editing /work.) Detected by a socket on the editor port in the container's `/proc/net/tcp` —
//? deliberately NOT `pgrep`/`ps` (procps is absent from the slim base image, so those always
//? failed) and it never self-matches. Best-effort: no container / docker down / not serving all
//? resolve to `false`, so the engine simply proceeds.
export function isEditorRunning(workspaceId: string, ticketKey: string): Promise<boolean> {
  const name = containerName(workspaceId, ticketKey);
  const hex = EDITOR_PORT.toString(16).toUpperCase().padStart(4, '0'); //? 3000 → '0BB8'
  return new Promise((resolve) => {
    const proc = spawn(DOCKER_BIN, ['exec', name, 'sh', '-c', `grep -i ':${hex}' /proc/net/tcp /proc/net/tcp6 2>/dev/null`], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.on('error', () => { resolve(false); });
    proc.on('close', () => { resolve(out.trim().length > 0); });
  });
}

export interface EditGuard { allowed: boolean; reason?: string }

//? EDITOR-side guard — may a human open the live editor for this ticket right now? Denied when
//? the current stage is explicitly not `userEditable`, or the AI is mid-turn on this ticket (a
//? busy `worker` AgentSession) — opening then would race the agent's edits/commit. Intended to
//? be called at the top of the open-editor flow (openEditor `_api` / `openEditorForTicket`).
export async function ticketEditGuard(prisma: PrismaClient, workspaceId: string, ticketKey: string): Promise<EditGuard> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { id: true, stageId: true } });
  if (!ticket) return { allowed: false, reason: 'editor.ticketNotFound' };
  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, key: ticket.stageId }, select: { userEditable: true } });
  if (stage?.userEditable === false) return { allowed: false, reason: 'editor.stageLocked' };
  const busy = await prisma.agentSession.findFirst({ where: { workspaceId, ticketId: ticket.id, kind: 'worker', status: 'busy' }, select: { id: true } });
  if (busy) return { allowed: false, reason: 'editor.agentBusy' };
  return { allowed: true };
}
