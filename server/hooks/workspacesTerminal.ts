//? Dev-only browser terminal: a Socket.io ⇄ node-pty bridge so the Workspaces
//? UI can run a real shell on THIS backend machine. A browser→shell channel is
//? an RCE surface, so it is HARD-gated to non-production. It wedges a socket
//? middleware (the framework's auth middleware authenticates the connection
//? itself) and attaches per-connection terminal listeners. One PTY per session
//? id; cleaned up on kill/disconnect.
//?
//? Wiring: `registerWorkspacesTerminalHooks()` is called once in
//? `server/server.ts`. Client side: `src/workspaces/_components/XtermTerminal.tsx`.

import { getLogger, registerSocketMiddleware } from '@luckystack/core';
import * as pty from 'node-pty';
import { DOCKER_BIN, PTY_AGENT_PORT, docker, isWorkspacesContainer } from '../container/runtime';
import { connectPtyAgent, resolvePtyAgentPort } from '../container/ptyAgentClient';

//? `container` targets a ticket's L3 container → the bridge relays the ticket's in-container
//? pty-agent (07b §9, durable scrollback + crash-resume) when one is published, else falls back
//? to a host `docker exec` PTY. Absent = the local dev host-shell.
interface TermMsg { id: string; cols?: number; rows?: number; data?: string; container?: string }

//? A uniform terminal handle so a node-pty (host shell / docker exec) and the pty-agent relay wire
//? to the ws-term:* socket identically.
interface TermHandle { write: (data: string) => void; resize: (cols: number, rows: number) => void; kill: () => void }
const fromPty = (term: pty.IPty): TermHandle => ({ write: (d) => { term.write(d); }, resize: (c, r) => { term.resize(c, r); }, kill: () => { term.kill(); } });

let registered = false;

export const registerWorkspacesTerminalHooks = (): void => {
  if (registered) return;
  registered = true;
  //? A browser→shell bridge is an RCE surface, so it's OFF in production by
  //? default. The real product attaches terminals to the per-ticket *container*
  //? (isolated) via the pty-agent — this host-shell bridge is a local-dev
  //? convenience. Set WORKSPACES_TERMINAL_ENABLED=1 to opt in beyond dev anyway.
  const enabled = process.env.NODE_ENV !== 'production' || process.env.WORKSPACES_TERMINAL_ENABLED === '1';
  if (!enabled) return;

  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? 'bash');
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  registerSocketMiddleware((socket, next) => {
    const sessions = new Map<string, TermHandle>();

    //? Wire a node-pty (host shell / docker exec) to this socket's ws-term relay (out/exit).
    const attachPty = (id: string, term: pty.IPty): void => {
      sessions.set(id, fromPty(term));
      term.onData((data) => { socket.emit('ws-term:out', { id, data }); });
      term.onExit(({ exitCode }) => { socket.emit('ws-term:exit', { id, exitCode }); sessions.delete(id); });
    };

    socket.on('ws-term:start', (payload: TermMsg) => {
      const { id } = payload;
      if (!id || sessions.has(id)) return;
      const opts = { name: 'xterm-256color', cols: payload.cols ?? 80, rows: payload.rows ?? 24, cwd: process.cwd(), env: { ...baseEnv, TERM: 'xterm-256color' } };
      const target = payload.container?.trim();
      if (target) {
        //? Container terminal: ONLY after confirming it's one of ours (never touch an arbitrary
        //? host container). Prefer the durable in-container pty-agent (07b §9) — its scrollback
        //? survives an orchestrator restart + reseeds on reconnect; fall back to a `docker exec`
        //? PTY when no agent port is published (a container that predates the agent).
        void (async () => {
          if (sessions.has(id) || !(await isWorkspacesContainer(target))) return;
          const agentPort = await resolvePtyAgentPort(docker, target, PTY_AGENT_PORT);
          if (agentPort !== null) {
            const conn = connectPtyAgent('127.0.0.1', agentPort, {
              onData: (data) => { socket.emit('ws-term:out', { id, data }); },
              onExit: (exitCode) => { socket.emit('ws-term:exit', { id, exitCode }); sessions.delete(id); },
              onError: () => { if (!sessions.has(id)) attachPty(id, pty.spawn(DOCKER_BIN, ['exec', '-it', target, 'bash'], opts)); },
            });
            if (!sessions.has(id)) { sessions.set(id, { write: conn.write, resize: conn.resize, kill: conn.close }); conn.resize(opts.cols, opts.rows); }
            return;
          }
          attachPty(id, pty.spawn(DOCKER_BIN, ['exec', '-it', target, 'bash'], opts));
        })();
        return;
      }
      attachPty(id, pty.spawn(shell, [], opts));
    });

    socket.on('ws-term:input', (payload: TermMsg) => {
      sessions.get(payload.id)?.write(payload.data ?? '');
    });

    socket.on('ws-term:resize', (payload: TermMsg) => {
      const term = sessions.get(payload.id);
      if (term && payload.cols && payload.rows && payload.cols > 0 && payload.rows > 0) term.resize(payload.cols, payload.rows);
    });

    socket.on('ws-term:kill', (payload: TermMsg) => {
      sessions.get(payload.id)?.kill();
      sessions.delete(payload.id);
    });

    socket.on('disconnect', () => {
      for (const term of sessions.values()) term.kill();
      sessions.clear();
    });

    next();
  });

  getLogger().info('[workspaces] dev terminal PTY bridge registered (non-production only)');
};
