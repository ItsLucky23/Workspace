//? Real Docker proof for the VM-local agent. It uses only a harmless BusyBox container on the developer daemon;
//? unrestricted/privileged syntax is covered structurally and is live-proven only inside a disposable Proxmox VM.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { assert, eq, report } from '../_helpers.mts';
import { createAgentServer } from '../../services/compose-runner/src/agent.ts';
import type { AgentConfig } from '../../services/compose-runner/src/config.ts';
import { ComposeExecutor } from '../../services/compose-runner/src/compose.ts';
import { dockerAvailable } from '../../server/container/runtime.ts';

if (!(await dockerAvailable())) {
  console.log('[composeSandboxAgent] Docker unavailable — skipping the VM-agent live proof.');
  report('composeSandboxAgent (skipped)');
} else {
  const workspaceId = '507f1f77bcf86cd799439011';
  const token = 'agent-live-token';
  const project = `ws-${workspaceId}-runner-live-${String(Date.now())}`;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'compose-agent-live-'));
  const config: AgentConfig = {
    bindHost: '127.0.0.1', port: 8788, workspaceId, token, dataDir, dockerBin: 'docker',
    operationTimeoutMs: 180_000, gatewayHost: '10.77.0.10',
  };
  const executor = new ComposeExecutor(config);
  const server = createAgentServer(config, { executor });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${String(address.port)}`;
  const compose = [
    'services:',
    '  heartbeat:',
    '    image: busybox:1.36',
    '    command: ["sh", "-c", "while true; do sleep 30; done"]',
    '    labels:',
    '      io.luckystack.gateway.ports: "8080"',
    '      io.luckystack.gateway.env.HEARTBEAT_URL: "http://{gatewayHost}:8080"',
    '',
  ].join('\n');

  try {
    const health = await fetch(`${base}/healthz`, { headers: { authorization: `Bearer ${token}` } });
    eq(health.status, 200, 'the VM-local agent sees Docker Compose');
    const up = await fetch(`${base}/v1/compose/up`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId, project, compose }),
    });
    const upBody: unknown = await up.json();
    assert(up.ok, `a real Compose project starts through the agent (${JSON.stringify(upBody)})`);
    assert(typeof upBody === 'object' && upBody !== null && 'env' in upBody, 'the live response contains explicit gateway metadata');

    const status = await fetch(`${base}/v1/status`, { headers: { authorization: `Bearer ${token}` } });
    const statusBody: unknown = await status.json();
    assert(JSON.stringify(statusBody).includes(project), 'the agent reports the durable active project marker');

    const mismatch = await fetch(`${base}/v1/compose/down`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: '507f191e810c19729de860ea', project }),
    });
    eq(mismatch.status, 400, 'another workspace cannot control the project');

    const down = await fetch(`${base}/v1/compose/down`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId, project }),
    });
    assert(down.ok, 'the agent removes the real Compose project and its volumes');
    eq((await executor.activeProjects()).length, 0, 'teardown removes the durable project marker');
  } finally {
    await executor.down({ workspaceId, project }).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
  report('composeSandboxAgent');
}
