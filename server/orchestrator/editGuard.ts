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

//? Is a live openvscode-server process running inside the ticket's container? (⇒ a human is
//? editing.) Best-effort: no container / docker down / not running all resolve to `false` —
//? there is then nothing to protect and the engine proceeds normally.
export function isEditorRunning(workspaceId: string, ticketKey: string): Promise<boolean> {
  const name = containerName(workspaceId, ticketKey);
  return new Promise((resolve) => {
    const proc = spawn(DOCKER_BIN, ['exec', name, 'pgrep', '-f', 'openvscode-server'], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.on('error', () => { resolve(false); });
    proc.on('close', (code) => { resolve(code === 0 && out.trim().length > 0); });
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
