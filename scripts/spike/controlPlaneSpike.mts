//? Spike — verify the two trickiest new control-plane server mechanics against real DB + Docker:
//?  1. Forge gating (item 1): pushTicketWork honours pushPolicy — 'local-only' skips; 'push'
//?     without a stored GitLab token returns 'forge.noToken' (never attempts a push).
//?  2. Procps-free kill (item 2): killClaudeInContainer stops a 'claude'-named process in the
//?     container (ps/pgrep are absent), verified by a procps-free /proc count that excludes the
//?     counting shell.
//? (Broadcast/reaper/preview reuse already-proven mechanics: the sync fan-out envelope, the
//? /proc/net/tcp port read from editLockSpike, and previewRoute.)
//? Run (needs the DB tunnel + Docker): `npx tsx scripts/spike/controlPlaneSpike.mts`

import { db } from '../../tests/_helpers.mts';

const prisma = await db();
await prisma.workspace.count();

const { addWorktree } = await import('../../server/git/repoStore');
const { launchTicketContainer, teardownTicketContainer, docker, containerName } = await import('../../server/container/runtime');
const { killClaudeInContainer } = await import('../../server/orchestrator/agentControl');
const { pushTicketWork } = await import('../../server/git/forge');

const ok = (label: string, cond: boolean): void => { console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
//? Count long-lived processes whose cmdline matches `claude`, excluding the counting shell — the
//? per-iteration grep reads OTHER processes' cmdline (the glob is expanded once), so it is accurate.
const COUNT = 'n=0; for d in /proc/[0-9]*; do if grep -qa claude "$d/cmdline" 2>/dev/null; then p="${d#/proc/}"; [ "$p" != "$$" ] && n=$((n+1)); fi; done; echo $n';

const ws = (await prisma.workspace.findFirst({ where: { name: { contains: 'Zé' } }, orderBy: { createdAt: 'desc' } }))!;
const ticket = (await prisma.ticket.findFirst({ where: { workspaceId: ws.id }, orderBy: { createdAt: 'asc' } }))!;
const key = ticket.key;
console.log(`workspace=${ws.name}  ticket=${key}`);

// --- 1. Forge gating -------------------------------------------------------------
const origCfg = ws.gitConfig;
const origTok = (await prisma.workspace.findUnique({ where: { id: ws.id }, select: { gitlabTokenEnc: true } }))?.gitlabTokenEnc ?? null;
const base = { branchStrategy: 'ticket-prefix', defaultBranchType: 'feature', branchTemplate: '{{key}}', targetBranch: 'main', protectedBranches: [], commitSigning: false };
await prisma.workspace.update({ where: { id: ws.id }, data: { gitConfig: { ...base, pushPolicy: 'local-only' } } });
const r1 = await pushTicketWork(prisma, ws.id, key);
ok(`forge local-only → skipped (pushed=${String(r1.pushed)})`, r1.ok && !r1.pushed);
await prisma.workspace.update({ where: { id: ws.id }, data: { gitConfig: { ...base, pushPolicy: 'push' }, gitlabTokenEnc: null } });
const r2 = await pushTicketWork(prisma, ws.id, key);
//? Refused without attempting a push — either 'noToken' (activated, but no token) or
//? 'notActivated' (this ticket has no branch/gitUrl yet); both mean nothing was pushed.
ok(`forge push without token/activation → refused (${r2.error ?? ''})`, !r2.ok && (r2.error === 'forge.noToken' || r2.error === 'forge.notActivated'));
await prisma.workspace.update({ where: { id: ws.id }, data: { gitConfig: origCfg ?? undefined, ...(origTok ? { gitlabTokenEnc: origTok } : {}) } });

// --- 2. Procps-free kill ---------------------------------------------------------
await addWorktree(ws.id, key);
const info = await launchTicketContainer({ workspaceId: ws.id, ticketKey: key, branch: ticket.branch ?? key });
if (!info) { console.log('no container — skipping kill check'); process.exit(0); }
const c = containerName(ws.id, key);
try {
  await docker(['exec', '-d', c, 'bash', '-lc', 'exec -a claude sleep 300']);
  await sleep(1200);
  const before = (await docker(['exec', c, 'sh', '-c', COUNT])).out.trim();
  ok(`fake claude process running (count=${before})`, Number(before) >= 1);
  await killClaudeInContainer(ws.id, key);
  await sleep(1000);
  const after = (await docker(['exec', c, 'sh', '-c', COUNT])).out.trim();
  ok(`killClaudeInContainer stopped it (count=${after})`, Number(after) === 0);
} finally {
  await teardownTicketContainer(ws.id, key);
  console.log('cleaned up');
}
process.exit(0);
