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

interface TermMsg { id: string; cols?: number; rows?: number; data?: string }

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
    const sessions = new Map<string, pty.IPty>();

    socket.on('ws-term:start', (payload: TermMsg) => {
      const { id } = payload;
      if (!id || sessions.has(id)) return;
      const term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: payload.cols ?? 80,
        rows: payload.rows ?? 24,
        cwd: process.cwd(),
        env: { ...baseEnv, TERM: 'xterm-256color' },
      });
      sessions.set(id, term);
      term.onData((data) => { socket.emit('ws-term:out', { id, data }); });
      term.onExit(({ exitCode }) => {
        socket.emit('ws-term:exit', { id, exitCode });
        sessions.delete(id);
      });
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
