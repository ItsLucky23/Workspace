//? Workspaces in-container pty-agent (07b §9, #11). A tiny process that runs INSIDE each L3
//? ticket container and OWNS a shell PTY + a DURABLE scrollback ring-buffer, so a terminal
//? survives an orchestrator crash / reconnect and a container `--restart`. The orchestrator
//? relays it over the existing `ws-term:*` protocol (server/hooks/workspacesTerminal.ts), so the
//? xterm client stays byte-identical — only the backend moves from a host `docker exec` PTY to
//? this durable in-container agent.
//?
//? Design:
//?  - Listens on a TCP port (default 7681) the container publishes to the host's 127.0.0.1; the
//?    orchestrator reads the mapped host port via `docker inspect` and stores it as
//?    AgentSession.ptyAgentUrl.
//?  - Owns ONE shell PTY (respawned if it exits, so the terminal is always usable).
//?  - Persists output to a bounded scrollback FILE on the /work volume, so the buffer survives an
//?    agent restart (container `--restart`). On startup it reloads that file → the orchestrator's
//?    in-memory ring becomes a cache rebuilt by replay.
//?  - On each client connect it REPLAYS the scrollback, then streams live. Multiple clients share
//?    the one PTY (broadcast). No auth here — the /pty namespace + SSH gate guard access upstream,
//?    and the port is only published to the host loopback.
//?
//? Protocol: newline-delimited JSON. Agent→client: {t:'o',d:<base64>} output · {t:'exit',code}
//? Client→agent: {t:'i',d:<base64>} input · {t:'r',c,r} resize · {t:'clear'} wipe scrollback.
//? Env: PTY_AGENT_PORT, PTY_AGENT_SHELL, PTY_AGENT_CWD, PTY_SCROLLBACK_FILE, PTY_SCROLLBACK_MAX.

import net from 'node:net';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

//? node-pty is a native module resolved from the global install in the container (NODE_PATH) or
//? node_modules on the host (tests) — require() so ESM doesn't need it in a static specifier.
const require = createRequire(import.meta.url);
const pty = require('node-pty');

const PORT = Number(process.env.PTY_AGENT_PORT ?? '7681');
const SHELL = process.env.PTY_AGENT_SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : 'bash');
const CWD = process.env.PTY_AGENT_CWD ?? (process.platform === 'win32' ? process.cwd() : '/work');
const SCROLLBACK_FILE = process.env.PTY_SCROLLBACK_FILE ?? path.join(CWD, '.pty', 'scrollback.log');
const MAX = Number(process.env.PTY_SCROLLBACK_MAX ?? String(256 * 1024));

//? Durable scrollback — a byte-bounded ring persisted to the volume. Kept as a Buffer so terminal
//? control sequences survive verbatim.
let scrollback = Buffer.alloc(0);
try {
  if (existsSync(SCROLLBACK_FILE)) scrollback = readFileSync(SCROLLBACK_FILE).subarray(-MAX);
} catch { /* fresh start */ }

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try { mkdirSync(path.dirname(SCROLLBACK_FILE), { recursive: true }); writeFileSync(SCROLLBACK_FILE, scrollback); } catch { /* best-effort */ }
  }, 400);
}

function appendScrollback(buf) {
  scrollback = Buffer.concat([scrollback, buf]);
  if (scrollback.length > MAX) scrollback = scrollback.subarray(scrollback.length - MAX);
  schedulePersist();
}

const clients = new Set();
function broadcast(obj) {
  const line = JSON.stringify(obj) + '\n';
  for (const c of clients) { try { c.write(line); } catch { /* dropped */ } }
}

let term = null;
function spawnShell() {
  term = pty.spawn(SHELL, [], { name: 'xterm-256color', cols: 80, rows: 24, cwd: CWD, env: { ...process.env, TERM: 'xterm-256color' } });
  term.onData((data) => { const buf = Buffer.from(data, 'utf8'); appendScrollback(buf); broadcast({ t: 'o', d: buf.toString('base64') }); });
  term.onExit(({ exitCode }) => {
    broadcast({ t: 'exit', code: exitCode });
    term = null;
    //? Keep the agent (and container terminal) usable: respawn a fresh shell shortly.
    setTimeout(spawnShell, 500);
  });
}
spawnShell();

const server = net.createServer((socket) => {
  clients.add(socket);
  //? Replay the durable scrollback so a reconnecting browser view is reseeded with no lost history.
  if (scrollback.length > 0) socket.write(JSON.stringify({ t: 'o', d: scrollback.toString('base64') }) + '\n');

  let acc = '';
  socket.on('data', (chunk) => {
    acc += chunk.toString('utf8');
    let nl;
    while ((nl = acc.indexOf('\n')) >= 0) {
      const line = acc.slice(0, nl); acc = acc.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.t === 'i' && typeof msg.d === 'string' && term) term.write(Buffer.from(msg.d, 'base64').toString('utf8'));
      else if (msg.t === 'r' && term && msg.c > 0 && msg.r > 0) { try { term.resize(msg.c, msg.r); } catch { /* ignore */ } }
      else if (msg.t === 'clear') { scrollback = Buffer.alloc(0); schedulePersist(); }
    }
  });
  socket.on('error', () => { clients.delete(socket); });
  socket.on('close', () => { clients.delete(socket); });
});

server.listen(PORT, '0.0.0.0', () => { console.log(`[pty-agent] listening on 0.0.0.0:${String(PORT)} shell=${SHELL} scrollback=${SCROLLBACK_FILE} (${String(scrollback.length)}B replayed)`); });
server.on('error', (err) => { console.error('[pty-agent] server error:', err); process.exit(1); });
