//? Spike — verify the engine<->editor EDIT-LOCK end-to-end against a real Docker container
//? (ADR 0012, server/orchestrator/editGuard.ts). Proves both directions of the guard:
//?   1. isEditorRunning (ENGINE side): false with no editor, true once an openvscode-named
//?      process runs in the ticket container. The conductor uses this to SKIP an auto-turn.
//?   2. ticketEditGuard (EDITOR side): allowed by default; denied while a `worker` AgentSession
//?      is busy on the ticket, and denied when the current stage is not `userEditable`.
//?
//? Run (needs the DB tunnel + Docker): `npx tsx scripts/spike/editLockSpike.mts`
//? Env: WS_DOCKER_BIN + WS_AUTH_DIR (as for the engine).

import { db } from '../../tests/_helpers.mts';

const prisma = await db();
await prisma.workspace.count(); //? force the connection (surfaces a down tunnel early)

const { addWorktree } = await import('../../server/git/repoStore');
const { launchTicketContainer, teardownTicketContainer, docker, containerName } = await import('../../server/container/runtime');
const { isEditorRunning, ticketEditGuard } = await import('../../server/orchestrator/editGuard');

const ok = (label: string, cond: boolean): void => { console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`); };

const ws = (await prisma.workspace.findFirst({ where: { name: { contains: 'Zé' } }, orderBy: { createdAt: 'desc' } }))!;
const ticket = (await prisma.ticket.findFirst({ where: { workspaceId: ws.id }, orderBy: { createdAt: 'asc' } }))!;
const key = ticket.key;
console.log(`workspace=${ws.name}  ticket=${key}  stage=${ticket.stageId}`);

//? Bring up the ticket container (idempotent).
await addWorktree(ws.id, key);
const info = await launchTicketContainer({ workspaceId: ws.id, ticketKey: key, branch: ticket.branch ?? key });
if (!info) { console.log('no container (no linked repo?) — aborting'); process.exit(1); }
const c = containerName(ws.id, key);

try {
  // --- 1. ENGINE side: isEditorRunning ---------------------------------------
  ok('isEditorRunning === false with no editor', (await isEditorRunning(ws.id, key)) === false);
  //? Simulate the editor by opening a LISTEN socket on the editor port (3000) — node is in the
  //? base image; procps is not, which is exactly why the guard reads /proc/net/tcp not pgrep.
  await docker(['exec', '-d', c, 'node', '-e', 'require("http").createServer((q,s)=>s.end("ok")).listen(3000,"0.0.0.0")']);
  await new Promise((r) => setTimeout(r, 1500));
  ok('isEditorRunning === true once something listens on the editor port', (await isEditorRunning(ws.id, key)) === true);

  // --- 2. EDITOR side: ticketEditGuard ---------------------------------------
  await prisma.agentSession.deleteMany({ where: { workspaceId: ws.id, sessionKey: `spike:${key}` } });
  const base = await ticketEditGuard(prisma, ws.id, key);
  ok(`ticketEditGuard allowed by default (got allowed=${String(base.allowed)}${base.reason ? ' reason=' + base.reason : ''})`, base.allowed || base.reason === 'editor.stageLocked');

  //? Simulate a running AI turn → the guard must deny.
  await prisma.agentSession.create({ data: { workspaceId: ws.id, ticketId: ticket.id, stageId: ticket.stageId, kind: 'worker', sessionKey: `spike:${key}`, status: 'busy' } });
  const busy = await ticketEditGuard(prisma, ws.id, key);
  ok('ticketEditGuard denied while a worker is busy', !busy.allowed && busy.reason === 'editor.agentBusy');
  await prisma.agentSession.updateMany({ where: { workspaceId: ws.id, sessionKey: `spike:${key}` }, data: { status: 'stopped' } });

  //? Lock the current stage → the guard must deny with stageLocked.
  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId: ws.id, key: ticket.stageId }, select: { userEditable: true } });
  await prisma.pipelineStage.updateMany({ where: { workspaceId: ws.id, key: ticket.stageId }, data: { userEditable: false } });
  const locked = await ticketEditGuard(prisma, ws.id, key);
  ok('ticketEditGuard denied when the stage is not userEditable', !locked.allowed && locked.reason === 'editor.stageLocked');
  await prisma.pipelineStage.updateMany({ where: { workspaceId: ws.id, key: ticket.stageId }, data: { userEditable: stage?.userEditable ?? true } });

  await prisma.agentSession.deleteMany({ where: { workspaceId: ws.id, sessionKey: `spike:${key}` } });
} finally {
  await teardownTicketContainer(ws.id, key);
  console.log('cleaned up');
}
process.exit(0);
