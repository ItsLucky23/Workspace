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
import { DOCKER_BIN, isWorkspacesContainer } from '../container/runtime';

//? `container` targets a ticket's L3 container → the bridge execs a shell INTO it
//? (07b §9 relay) instead of the local dev host-shell. Absent = the dev host shell.
interface TermMsg { id: string; cols?: number; rows?: number; data?: string; container?: string }

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

    //? Wire a spawned PTY to this socket's ws-term relay (out/exit). Same for both the
    //? dev host shell and a container exec — only the spawn differs.
    const attach = (id: string, term: pty.IPty): void => {
      sessions.set(id, term);
      term.onData((data) => { socket.emit('ws-term:out', { id, data }); });
      term.onExit(({ exitCode }) => { socket.emit('ws-term:exit', { id, exitCode }); sessions.delete(id); });
    };

    socket.on('ws-term:start', (payload: TermMsg) => {
      const { id } = payload;
      if (!id || sessions.has(id)) return;
      const opts = { name: 'xterm-256color', cols: payload.cols ?? 80, rows: payload.rows ?? 24, cwd: process.cwd(), env: { ...baseEnv, TERM: 'xterm-256color' } };
      const target = payload.container?.trim();
      if (target) {
        //? Container terminal: exec a shell INTO the ticket's container — but ONLY after
        //? confirming it's one of ours (never exec into an arbitrary host container).
        void (async () => {
          if (sessions.has(id) || !(await isWorkspacesContainer(target))) return;
          attach(id, pty.spawn(DOCKER_BIN, ['exec', '-it', target, 'bash'], opts));
        })();
        return;
      }
      attach(id, pty.spawn(shell, [], opts));
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
