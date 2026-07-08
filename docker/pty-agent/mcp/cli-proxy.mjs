//? K4 — a REAL, dependency-free MCP stdio server that lets the coding agent query an attached service via the
//? CLI already baked into the base image (psql / mysql / redis-cli / mongosh), using the connection string the
//? orchestrator injects as env (K3). The catalog's integration `mcp` command points here — replacing the old
//? `/pty-agent/mcp/<svc>.js` references that NEVER EXISTED (enabling an integration exec'd a missing file).
//? Usage in `.mcp.json`: `node /opt/pty-agent/mcp/cli-proxy.mjs <kind>` where kind = postgres|mysql|redis|mongo.
//? Speaks MCP over stdio (JSON-RPC line-delimited): initialize, tools/list, tools/call(query). No deps.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const kind = process.argv[2] ?? 'postgres';

//? Per-kind: the connection env var + how to run a one-shot command with the baked CLI.
const CLIS = {
  postgres: { env: 'DATABASE_URL', run: (conn, sql) => ['psql', conn, '-c', sql] },
  mysql: { env: 'DATABASE_URL', run: (conn, sql) => ['mysql', '--protocol=TCP', conn, '-e', sql] },
  redis: { env: 'REDIS_URL', run: (conn, sql) => ['redis-cli', '-u', conn, ...sql.split(' ')] },
  mongo: { env: 'MONGODB_URI', run: (conn, sql) => ['mongosh', conn, '--quiet', '--eval', sql] },
};
const cfg = CLIS[kind] ?? CLIS.postgres;

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function runCli(sql) {
  return new Promise((resolve) => {
    const conn = (process.env[cfg.env] ?? '').trim();
    if (conn.length === 0) { resolve(`error: ${cfg.env} not set (attach the service + set its connection env)`); return; }
    const [cmd, ...args] = cfg.run(conn, sql);
    const proc = spawn(cmd, args, { windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.stderr.on('data', (d) => { out += String(d); });
    proc.on('error', (e) => { resolve(`error: ${String(e)}`); });
    proc.on('close', () => { resolve(out.slice(0, 20000)); });
  });
}

const TOOL = { name: 'query', description: `Run a ${kind} query/command via the baked CLI (uses ${cfg.env}).`, inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } };

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const text = line.trim();
  if (text.length === 0) return;
  let req;
  try { req = JSON.parse(text); } catch { return; }
  const { id, method, params } = req;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: `cli-proxy-${kind}`, version: '1.0.0' } } });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
  } else if (method === 'tools/call') {
    const sql = params?.arguments?.sql ?? '';
    const result = await runCli(String(sql));
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } });
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
  }
});
