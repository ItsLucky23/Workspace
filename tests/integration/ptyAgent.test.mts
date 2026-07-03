//? Integration test for the in-container pty-agent (07b §9, #11) — run as a LOCAL process (no
//? Docker needed) and driven through the real host relay (server/container/ptyAgentClient.ts). Proves
//? the crash-resume core: live output streams, input reaches the shell, the DURABLE scrollback
//? REPLAYS on a fresh reconnect, and SURVIVES an agent restart (reloaded from the volume file).

import { spawn } from 'node:child_process';
import net from 'node:net';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';

import { assert, report } from '../_helpers.mts';

const { connectPtyAgent } = await import('../../server/container/ptyAgentClient');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const PORT = 7793;
const isWin = process.platform === 'win32';
const SHELL = isWin ? 'powershell.exe' : 'bash';
const stamp = String(Date.now());
const scrollFile = path.join(process.env.CLAUDE_JOB_DIR ?? process.cwd(), 'tmp', `ptyagent-${stamp}.log`);
const MARK = `PTYMARK_${stamp}`;

//? Wait until the agent's TCP port accepts connections.
async function waitForPort(port: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port });
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => { resolve(false); });
    });
    if (ok) return true;
    await wait(200);
  }
  return false;
}

function startAgent(): ReturnType<typeof spawn> {
  return spawn('node', ['docker/pty-agent/agent.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PTY_AGENT_PORT: String(PORT), PTY_AGENT_SHELL: SHELL, PTY_AGENT_CWD: process.cwd(), PTY_SCROLLBACK_FILE: scrollFile, PTY_SCROLLBACK_MAX: '65536' },
    stdio: 'ignore',
  });
}

//? Connect, collect all output for `ms`, return it. `onReady` fires once connected.
async function collect(ms: number, onReady?: (conn: ReturnType<typeof connectPtyAgent>) => void): Promise<string> {
  let out = '';
  const conn = connectPtyAgent('127.0.0.1', PORT, { onData: (d) => { out += d; }, onExit: () => { /* shell exit */ } });
  await wait(300);
  onReady?.(conn);
  await wait(ms);
  conn.close();
  return out;
}

let agent = startAgent();
try {
  const up = await waitForPort(PORT);
  assert(up, 'the pty-agent is listening on its port');

  //? 1) Live: send a marker command, see it echoed in the output stream.
  const live = await collect(3500, (conn) => { conn.resize(100, 30); conn.write(`echo ${MARK}\r`); });
  assert(live.includes(MARK), 'live output streams the shell result of an input command');

  //? 2) Reconnect (same agent): the durable scrollback REPLAYS the earlier marker immediately.
  const replay = await collect(1200);
  assert(replay.includes(MARK), 'a fresh reconnect replays the durable scrollback (no lost history)');

  //? 3) Crash-resume: kill the agent, restart it (same scrollback file) — the buffer is reloaded
  //? from the /work volume, so a reconnect STILL replays the marker.
  agent.kill();
  await wait(800);
  assert(existsSync(scrollFile), 'the scrollback was persisted to the volume file');
  agent = startAgent();
  const restarted = await waitForPort(PORT);
  assert(restarted, 'the pty-agent comes back up after a restart');
  const afterRestart = await collect(1200);
  assert(afterRestart.includes(MARK), 'scrollback survives an agent restart (reloaded from the file) — crash-resume');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  try { agent.kill(); } catch { /* already dead */ }
  await wait(300);
  if (existsSync(scrollFile)) { try { rmSync(scrollFile, { force: true }); } catch { /* best-effort */ } }
}

report('tests/integration/ptyAgent.test.mts');
