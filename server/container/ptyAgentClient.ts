//? Host-side relay to the in-container pty-agent (07b §9, #11). The orchestrator connects to the
//? agent's TCP port (published to the host's 127.0.0.1 by `docker run -p`, resolved via
//? `docker inspect`) and translates its newline-JSON protocol to the callbacks the `ws-term:*`
//? bridge already speaks. On connect the agent replays its durable scrollback (arriving as a normal
//? `o` frame), so a reconnecting terminal is reseeded with no lost history — the crash-resume core.
//?
//? Protocol (mirror of docker/pty-agent/agent.mjs): agent→host {t:'o',d:<base64>} | {t:'exit',code};
//? host→agent {t:'i',d:<base64>} | {t:'r',c,r} | {t:'clear'}.

import net from 'node:net';

import { tryCatchSync } from '@luckystack/core';

export interface PtyAgentConn {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  clearScrollback: () => void;
  close: () => void;
}

export interface PtyAgentHandlers {
  onData: (data: string) => void;
  onExit: (code: number) => void;
  onError?: (err: Error) => void;
}

//? Open a relay to a pty-agent at host:port. Returns the write/resize/close handle. The socket is
//? line-delimited JSON; partial frames are buffered until their newline. Never throws — a failed
//? connect surfaces via `onError` so the caller can fall back to a `docker exec` PTY.
export function connectPtyAgent(host: string, port: number, handlers: PtyAgentHandlers): PtyAgentConn {
  const socket = net.createConnection({ host, port });
  socket.setNoDelay(true);
  let acc = '';

  socket.on('data', (chunk) => {
    acc += chunk.toString('utf8');
    let nl = acc.indexOf('\n');
    while (nl >= 0) {
      const line = acc.slice(0, nl);
      acc = acc.slice(nl + 1);
      if (line.trim().length > 0) {
        const [, msg] = tryCatchSync(() => JSON.parse(line) as { t?: string; d?: string; code?: number });
        if (msg) {
          if (msg.t === 'o' && typeof msg.d === 'string') handlers.onData(Buffer.from(msg.d, 'base64').toString('utf8'));
          else if (msg.t === 'exit') handlers.onExit(typeof msg.code === 'number' ? msg.code : 0);
        }
      }
      nl = acc.indexOf('\n');
    }
  });
  socket.on('error', (err) => { handlers.onError?.(err); });

  const send = (obj: Record<string, unknown>): void => { tryCatchSync(() => socket.write(JSON.stringify(obj) + '\n')); };
  return {
    write: (data) => { send({ t: 'i', d: Buffer.from(data, 'utf8').toString('base64') }); },
    resize: (cols, rows) => { if (cols > 0 && rows > 0) send({ t: 'r', c: cols, r: rows }); },
    clearScrollback: () => { send({ t: 'clear' }); },
    close: () => { tryCatchSync(() => socket.destroy()); },
  };
}

//? Resolve the host port the container publishes the pty-agent on (07b §9): the agent listens on
//? PORT inside the container; `docker run -p 127.0.0.1::PORT` maps it to an ephemeral host port,
//? which `docker inspect` reports. Returns null if unpublished (container predates the agent) so
//? the terminal bridge can fall back to `docker exec`.
export async function resolvePtyAgentPort(
  dockerFn: (args: string[]) => Promise<{ code: number; out: string }>,
  container: string,
  agentPort = 7681,
): Promise<number | null> {
  const r = await dockerFn(['inspect', '-f', `{{(index (index .NetworkSettings.Ports "${String(agentPort)}/tcp") 0).HostPort}}`, container]);
  if (r.code !== 0) return null;
  const port = Number(r.out.trim());
  return Number.isInteger(port) && port > 0 ? port : null;
}
