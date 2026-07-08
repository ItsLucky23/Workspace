//? K4 — the integration MCP fix. Part A: the catalog no longer references the never-existent `/pty-agent/mcp/`
//? paths; the DB integrations point at the REAL baked `cli-proxy.mjs`, services without a baked CLI carry no mcp
//? (parseMcpCommand skips them → no broken exec). Part B: the actual `cli-proxy.mjs` MCP server runs (spawn node)
//? and speaks the MCP handshake (initialize → serverInfo, tools/list → a `query` tool, tools/call → runs, and
//? without a connection env returns a typed "not set" message instead of crashing). No Docker/Mongo.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { assert, eq, report } from '../_helpers.mts';
import { INTEGRATION_TYPES } from '../../src/workspaces/_data/seed.ts';
import { parseMcpCommand } from '../../server/orchestrator/renderStage.ts';

// Part A — the catalog is fixed
{
  for (const t of INTEGRATION_TYPES) {
    assert(!t.mcp.includes('/pty-agent/mcp/') || t.mcp.includes('/opt/pty-agent/mcp/'), `${t.key}: no dead /pty-agent/mcp path`);
    if (t.mcp.length > 0) {
      const parsed = parseMcpCommand(t.mcp);
      assert(parsed.command === 'node' && parsed.args.some((a) => a.includes('/opt/pty-agent/mcp/cli-proxy.mjs')), `${t.key}: mcp runs the real baked cli-proxy`);
    }
  }
  const db = INTEGRATION_TYPES.find((t) => t.key === 'postgres');
  assert((db?.mcp ?? '').endsWith('cli-proxy.mjs postgres'), 'postgres → cli-proxy postgres');
  const kafka = INTEGRATION_TYPES.find((t) => t.key === 'kafka');
  eq(kafka?.mcp, '', 'kafka (no baked CLI) carries no mcp → parseMcpCommand skips it (no broken exec)');
  eq(parseMcpCommand('').command, '', 'an empty mcp yields an empty command (renderStage skips it)');

  assert(existsSync('docker/pty-agent/mcp/cli-proxy.mjs'), 'the baked MCP server file exists in the build context');
}

// Part B — the real MCP server speaks the protocol
{
  const proc = spawn('node', ['docker/pty-agent/mcp/cli-proxy.mjs', 'postgres'], { windowsHide: true, env: { ...process.env, DATABASE_URL: '' } });
  const responses = new Map<number, unknown>();
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += String(d);
    let i = buf.indexOf('\n');
    while (i !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.length > 0) { try { const m = JSON.parse(line) as { id?: number }; if (typeof m.id === 'number') responses.set(m.id, m); } catch { /* ignore */ } }
      i = buf.indexOf('\n');
    }
  });
  const send = (obj: unknown): void => { proc.stdin.write(JSON.stringify(obj) + '\n'); };
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  async function rpc(id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
    send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    const deadline = Date.now() + 6000;
    while (!responses.has(id) && Date.now() < deadline) await wait(40);
    return (responses.get(id) ?? {}) as Record<string, unknown>;
  }

  try {
    const init = await rpc(1, 'initialize', {});
    assert(((init.result as { serverInfo?: { name?: string } })?.serverInfo?.name ?? '').includes('cli-proxy'), 'initialize returns the server info');
    const list = await rpc(2, 'tools/list');
    const tools = (list.result as { tools?: { name: string }[] })?.tools ?? [];
    assert(tools.some((t) => t.name === 'query'), 'tools/list exposes a query tool');
    const call = await rpc(3, 'tools/call', { name: 'query', arguments: { sql: 'SELECT 1' } });
    const text = ((call.result as { content?: { text?: string }[] })?.content?.[0]?.text ?? '');
    assert(text.includes('DATABASE_URL not set'), 'tools/call runs + reports the missing connection env (did not crash)');
  } finally {
    proc.kill();
  }
}

report('tests/integration/mcpProxy.test.mts');
