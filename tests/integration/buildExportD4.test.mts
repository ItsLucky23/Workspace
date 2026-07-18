//? D4 — prod build-export + deploy-hook. Part 1 proves the deploy-webhook through the central injectable
//? DNS-pinned transport (no local server/live network) and asserts the POST body + bearer. Part 2 proves the
//? `bundle` export by running a REAL production-build tar inside a throwaway container (alpine) and asserting
//? a non-empty .tgz on disk — this is what replaced `export.bundleNotImplemented`. Part 2 SKIPS (not fails)
//? without Docker so it's safe anywhere. Runs against the real Mongo; creates + cleans up its own data.

import { existsSync, statSync, rmSync } from 'node:fs';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { buildExport, postDeployWebhook } = await import('../../server/deploy/buildExport');
const { dockerAvailable } = await import('../../server/container/runtime');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `d4-${String(stamp)}@youcomm.nl`, name: 'D4' } });
let workspaceId: string | null = null;
const savedEnv = { url: process.env.WS_DEPLOY_WEBHOOK_URL, token: process.env.WS_DEPLOY_WEBHOOK_TOKEN, cmd: process.env.WS_BUILD_EXPORT_CMD, dir: process.env.WS_BUILD_EXPORT_DIR };

try {
  // ---- Part 1: the deploy-hook POST through mocked public DNS + pinned transport --------------------
  const received: { body: string; auth: string; pin: string; host: string }[] = [];
  const dependencies = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 as const }],
    transport: async (request: { body?: Buffer; headers: Record<string, string>; connectAddress: string; hostHeader: string }) => {
      received.push({
        body: request.body?.toString('utf8') ?? '',
        auth: request.headers.authorization ?? '',
        pin: request.connectAddress,
        host: request.hostHeader,
      });
      return { status: 200, headers: {}, body: Buffer.from('ok') };
    },
  };

  //? Unconfigured → no-op (the export works with or without a deploy target).
  delete process.env.WS_DEPLOY_WEBHOOK_URL;
  const noop = await postDeployWebhook({ event: 'build-export', workspaceId: 'w', projectId: 'p', kind: 'image', artifactId: 'a', imageRef: 'img', downloadToken: 'tok' }, dependencies);
  eq(noop.fired, false, 'no webhook configured → fired:false (no-op)');

  //? Configured → a bounded POST with descriptor + bearer reaches only the validated public pin.
  process.env.WS_DEPLOY_WEBHOOK_URL = 'https://deploy.test/deploy';
  process.env.WS_DEPLOY_WEBHOOK_TOKEN = 'sekret';
  const hook = await postDeployWebhook({ event: 'build-export', workspaceId: 'w1', projectId: 'p1', kind: 'bundle', artifactId: 'art1', imageRef: 'my/img:1', downloadToken: 'tok123' }, dependencies);
  eq(hook.fired, true, 'configured → fired:true');
  eq(hook.ok, true, 'the mocked external endpoint returned 200 → ok:true');
  eq(hook.status, 200, 'status propagated');
  assert(received.length === 1, 'the transport got exactly one POST');
  const sent: unknown = JSON.parse(received[0]?.body ?? '{}');
  const artifactId = sent !== null && typeof sent === 'object' && 'artifactId' in sent && typeof sent.artifactId === 'string' ? sent.artifactId : '';
  const downloadToken = sent !== null && typeof sent === 'object' && 'downloadToken' in sent && typeof sent.downloadToken === 'string' ? sent.downloadToken : '';
  eq(artifactId, 'art1', 'the descriptor carried the artifactId');
  eq(downloadToken, 'tok123', 'the descriptor carried the download token');
  eq(received[0]?.auth, 'Bearer sekret', 'the bearer token was sent');
  eq(received[0]?.pin, '93.184.216.34', 'the deploy hook connected to the validated IP pin');
  eq(received[0]?.host, 'deploy.test', 'the deploy hook retained the configured Host/SNI identity');

  // ---- Part 2: the bundle export produces a REAL build tarball (Docker) ------------------------------
  if (!(await dockerAvailable())) {
    console.log('[d4] SKIP bundle export — Docker unavailable.');
  } else {
    await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'D4 WS' }, userId: owner.id, clientRequestId: `d4-cw-${String(stamp)}` });
    const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
    workspaceId = ws?.id ?? null;
    const wsId = workspaceId ?? '';
    const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
    assert(project !== null, 'the workspace has a project to export');
    //? Pin a tiny image + a trivial "production build" so the real container path is exercised cheaply
    //? (alpine has sh + busybox tar/gzip). This is the SAME code path a real Node app's `npm run build` takes.
    await prisma.project.update({ where: { id: project?.id ?? '' }, data: { baseImageRef: 'alpine' } });
    process.env.WS_BUILD_EXPORT_CMD = 'mkdir -p /out && printf "<h1>hi</h1>" > /out/index.html';
    process.env.WS_BUILD_EXPORT_DIR = '/out';
    //? No deploy target for this leg (assert the artifact itself); the hook is Part 1's concern.
    delete process.env.WS_DEPLOY_WEBHOOK_URL;

    const result = await buildExport(prisma, wsId, project?.id ?? '', 'bundle', Date.now());
    eq(result.ok, true, `the bundle export succeeded (error: ${result.error ?? ''})`);
    eq(result.status, 'ready', 'the artifact is ready');
    const row = await prisma.buildArtifact.findFirst({ where: { id: result.artifactId ?? '' } });
    eq(row?.kind, 'bundle', 'the artifact is a bundle');
    eq(row?.status, 'ready', 'the row is marked ready');
    const filePath = row?.filePath ?? '';
    assert(filePath.length > 0 && existsSync(filePath), 'the bundle .tgz exists on disk');
    const bytes = existsSync(filePath) ? statSync(filePath).size : 0;
    assert(bytes > 40, `the bundle .tgz is a real non-trivial file (${String(bytes)} bytes)`);
    console.log(`[d4] ✓ real bundle export: ${filePath} (${String(bytes)} bytes)`);
    if (filePath.length > 0) rmSync(filePath, { force: true });
  }
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  process.env.WS_DEPLOY_WEBHOOK_URL = savedEnv.url ?? '';
  process.env.WS_DEPLOY_WEBHOOK_TOKEN = savedEnv.token ?? '';
  process.env.WS_BUILD_EXPORT_CMD = savedEnv.cmd ?? '';
  process.env.WS_BUILD_EXPORT_DIR = savedEnv.dir ?? '';
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/buildExportD4.test.mts');
