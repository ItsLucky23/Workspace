import { chmodSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

import { applyIncusFirewall, reconcileIncusFirewall, type IncusFirewallRequest } from './incusFirewallHelper.js';
import { asRecord, parseJson, WORKSPACE_ID_PATTERN } from './runtime.js';

const MAX_REQUEST_BYTES = 4096;

function readRequest(value: unknown): IncusFirewallRequest | null {
  const row = asRecord(value);
  const portsValue: unknown = row?.ports;
  if (!row || (row.operation !== 'apply' && row.operation !== 'delete') || typeof row.workspaceId !== 'string'
    || !WORKSPACE_ID_PATTERN.test(row.workspaceId) || typeof row.ip !== 'string' || typeof row.agentPort !== 'number'
    || !Array.isArray(portsValue) || !portsValue.every((port): port is number => typeof port === 'number')) return null;
  const ports: number[] = [...portsValue];
  return { operation: row.operation, workspaceId: row.workspaceId.toLowerCase(), ip: row.ip, agentPort: row.agentPort, ports };
}

export function startIncusFirewallDaemon(socketPath = process.env.INCUS_FIREWALL_SOCKET ?? '/run/workspaces-compose-runner/firewall.sock') {
  reconcileIncusFirewall();
  //? RuntimeDirectory is private to this service; unlink only its fixed stale Unix socket after an unclean exit.
  // eslint-disable-next-line luckystack/no-raw-try-catch -- standalone root helper has no LuckyStack runtime dependency
  try { unlinkSync(socketPath); } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const server = createServer((socket) => {
    let body = '';
    let bytes = 0;
    let handled = false;
    const respond = (value: { ok: boolean; error?: string }): void => { if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`); };
    socket.on('data', (chunk: Buffer) => {
      if (handled) return;
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        handled = true;
        respond({ ok: false, error: 'request.tooLarge' });
        return;
      }
      body += chunk.toString('utf8');
      if (!body.includes('\n')) return;
      handled = true;
      const parsed = parseJson(body.slice(0, body.indexOf('\n')));
      const request = parsed.ok ? readRequest(parsed.value) : null;
      if (!request) {
        respond({ ok: false, error: 'request.invalid' });
        return;
      }
      // eslint-disable-next-line luckystack/no-raw-try-catch -- Unix-socket protocol must return a bounded error instead of crashing root helper
      try {
        applyIncusFirewall(request);
        respond({ ok: true });
      } catch (error) {
        respond({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : 'firewall.failed' });
      }
    });
    socket.on('error', () => { /* Client disconnects are isolated to their request. */ });
  });
  server.listen(socketPath, () => { chmodSync(socketPath, 0o660); });
  return server;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) startIncusFirewallDaemon();
